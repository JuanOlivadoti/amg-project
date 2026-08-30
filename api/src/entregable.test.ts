import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones, PglitePool, PgStore, PgClientes, PgMembresias, PgIdeas, PgResenas } from "db";
import type { DatosEntregable, PageRow } from "db";
import { renderReport } from "contrato";
import { createApp } from "./app.js";
import { briefDelEntregable } from "./entregable.js";
import { MockGoogleOAuthProvider } from "./google-oauth.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";
import { SIN_PAGINAS_APROBADAS } from "./codigos.js";

/**
 * `GET /runs/:id/entregable.md` — el documento que la agencia le manda al RESTAURANTE.
 *
 * Dos garantías, y las dos son de negocio antes que de código:
 *
 *  1. **El margen no sale de la agencia.** El documento se genera SIN el bloque de coste
 *     (`audiencia: "restaurante"`), y el test lo comprueba contra un run que SÍ tiene coste — si el número
 *     fuera 0 el test pasaría por el motivo equivocado y no cazaría a quien invierta la opción.
 *  2. **El entregable lo produce solo la agencia.** No con un `if` de rol: `getDatosEntregable` lleva
 *     `app.es_staff()` en el predicado, así que el `cliente` recibe el mismo 404 que un run inexistente.
 *
 * ## La medición del motor, repetida acá a propósito
 *
 * `api/` corre **PostgreSQL 18.3** y `db/` **16.4**. Un comportamiento del motor medido en un paquete no
 * se puede afirmar del otro, así que el primer test vuelve a medir `app.es_staff()` en este major en vez
 * de heredar la medición de `db/src/entregable-store.test.ts`.
 */
describe("GET /runs/:id/entregable.md", () => {
  let pg: PGlite;
  let app: ReturnType<typeof createApp>;

  let tenantA: string;
  let tenantB: string;
  let clientA1: string; // "Bella Napoli"
  let clientA2: string; // nombre HOSTIL, para el saneo end-to-end del header
  let equipoA: string; // staff de A
  let duenoA1: string; // rol cliente en A, atado a clientA1
  let equipoB: string; // staff del OTRO tenant
  let runA1: string; // con páginas aprobadas y coste
  let runA2: string; // del cliente de nombre hostil
  let runB1: string; // del tenant B
  let clientB1: string; // del tenant B, para el test de que el 409 no filtra existencia

  const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";
  const NOMBRE_HOSTIL = 'Bar "El Bueno"\r\nX-Inyectado: si';

  /** El coste del run A1. `usdFromMicros` lo imprimiría como `0.3125`: una cadena inconfundible. */
  const COSTE_A1 = 312_500;
  const COSTE_IMPRESO = "0.3125";

  const verificar: VerificadorToken = async (token) =>
    token.startsWith("valid:") ? { userId: token.slice(6) } : null;

  async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
    return (await pg.query<T>(q, params)).rows;
  }

  async function mkCliente(tenantId: string, nombre: string): Promise<string> {
    return (
      await sql<{ id: string }>(
        "insert into clients (tenant_id, nombre, vertical) values ($1,$2,'restauracion') returning id",
        [tenantId, nombre],
      )
    )[0]!.id;
  }

  async function mkMembresia(tenantId: string, rol: string, clientId: string | null): Promise<string> {
    return (
      await sql<{ user_id: string }>(
        `insert into memberships (tenant_id, user_id, rol, client_id)
         values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
        [tenantId, rol, clientId],
      )
    )[0]!.user_id;
  }

  async function mkRun(tenantId: string, clientId: string, coste = 0): Promise<string> {
    return (
      await sql<{ id: string }>(
        `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt, market_country,
                              market_language, market_location_code, coste_micros_usd, coste_breakdown,
                              calidad_datos)
         values ($1,$2,'kr.v0.5','pending_approval','prompt','ES','es',2724,$3::bigint,
                 '{"dataforseo_micros":250000,"llm_generation_micros":50000,"llm_embeddings_micros":12500}'::jsonb,
                 '{"cobertura_volumen":0.75,"cobertura_kd":0.5,"endpoints_degradados":[]}'::jsonb)
         returning id`,
        [tenantId, clientId, coste],
      )
    )[0]!.id;
  }

  /**
   * Una página del run. Los jsonb van COMPLETOS acá: el caso del `{}` —el default de la columna— tiene su
   * propio test, y mezclarlo con éstos escondería cuál de los dos escenarios está fallando.
   */
  async function mkPagina(
    tenantId: string,
    runId: string,
    clientId: string,
    slug: string,
    opts: { orden: number | null; aprobada: boolean; retirada?: boolean; evidencia?: string },
  ): Promise<void> {
    await sql(
      `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug,
                             keyword_principal, keywords_secundarias, intencion, local, volumen,
                             dificultad, evidencia, opportunity_score, score_confidence, seo,
                             content_brief, preguntas_frecuentes, approved, retirada, orden_brief)
       values ($1::uuid,$2::uuid,$3::uuid, gen_random_uuid(), 'servicio', 'single', $4::text,
               'kw ' || $4::text, array['secundaria'], 'commercial', false, 480, 21, $5::text, 84, 0.9,
               '{"meta_title":"T","meta_description":"D","schema_type":"WebPage","canonical":"/c"}'::jsonb,
               '{"h1":"Encabezado","secciones_sugeridas":["Una"],"word_count_objetivo":800,"enlazado_interno":[]}'::jsonb,
               array['Reservan?'], $6::boolean, $7::boolean, $8::int)`,
      [
        tenantId,
        runId,
        clientId,
        slug,
        opts.evidencia ?? "datos_mercado",
        opts.aprobada,
        opts.retirada ?? false,
        opts.orden,
      ],
    );
  }

  async function pedir(path: string, opts: { user?: string; tenant?: string } = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (opts.user) headers["authorization"] = `Bearer valid:${opts.user}`;
    if (opts.tenant) headers["x-amg-tenant"] = opts.tenant;
    return app.request(path, { method: "GET", headers });
  }

  beforeEach(async () => {
    pg = new PGlite();
    await aplicarMigraciones(pg);
    const pool = new PglitePool(pg);
    const emisor: EmisorEventos = { send: async () => ({}) };
    app = createApp({
      store: new PgStore(pool), // amg_api → app_user
      clientes: new PgClientes(pool),
      membresias: new PgMembresias(pool),
      ideas: new PgIdeas(pool),
      resenas: new PgResenas(pool),
      googleOAuth: new MockGoogleOAuthProvider(),
      oauthStateSecret: "secreto-de-test-no-para-produccion",
      telegramBotUsername: "AMGReviewsBotTest",
      emisor,
      verificar,
      portalUrl: "http://localhost:4200",
    });

    [tenantA, tenantB] = (
      await sql<{ id: string }>(
        `insert into tenants (nombre, slug)
         values ('Agencia A','agencia-a'), ('Agencia B','agencia-b') returning id`,
      )
    ).map((r) => r.id) as [string, string];

    clientA1 = await mkCliente(tenantA, "Bella Napoli");
    clientA2 = await mkCliente(tenantA, NOMBRE_HOSTIL);
    clientB1 = await mkCliente(tenantB, "Sushi Zen");

    equipoA = await mkMembresia(tenantA, "equipo", null);
    duenoA1 = await mkMembresia(tenantA, "cliente", clientA1);
    equipoB = await mkMembresia(tenantB, "equipo", null);

    runA1 = await mkRun(tenantA, clientA1, COSTE_A1);
    runA2 = await mkRun(tenantA, clientA2);
    runB1 = await mkRun(tenantB, clientB1);

    // El orden de inserción CONTRADICE el del brief a propósito: con los dos de acuerdo no se podría
    // distinguir cuál de los dos criterios se respetó.
    await mkPagina(tenantA, runA1, clientA1, "/segunda", { orden: 1, aprobada: true });
    await mkPagina(tenantA, runA1, clientA1, "/primera", { orden: 0, aprobada: true });
    await mkPagina(tenantA, runA1, clientA1, "/sin-aprobar", { orden: 2, aprobada: false });
    await mkPagina(tenantA, runA2, clientA2, "/hostil", { orden: 0, aprobada: true });
    await mkPagina(tenantB, runB1, clientB1, "/ajena", { orden: 0, aprobada: true });
  });

  afterEach(async () => {
    await pg.close();
  });

  // ------------------------------------------------------- la medición del motor de ESTE paquete

  test("MEDIDO en PostgreSQL 18.3: `app.es_staff()` da true / false / NULL, y nunca error", async () => {
    /*
     * Lo que este test fija no es una decisión nuestra: es el comportamiento del motor del que depende el
     * `case when` de `RUN_SUMMARY_COLS` y el predicado de `getDatosEntregable`. Va acá porque `api/` corre
     * otro major que `db/` (18.3 vs 16.4) y extrapolar entre los dos ya mordió antes.
     */
    const version = (await sql<{ v: string }>("select version() as v"))[0]!.v;
    assert.match(version, /PostgreSQL 18\./, "si el major cambia, esta medición hay que rehacerla");

    const comoUsuario = async (userId: string): Promise<boolean | null> => {
      await pg.exec("begin");
      try {
        await pg.query("select set_config('app.tenant_id', $1, true)", [tenantA]);
        await pg.query("select set_config('app.user_id', $1, true)", [userId]);
        await pg.exec("set local role app_user"); // como superusuario esto pasaría siempre
        const r = await pg.query<{ s: boolean | null }>("select app.es_staff() as s");
        return r.rows[0]!.s;
      } finally {
        await pg.exec("rollback");
      }
    };

    assert.equal(await comoUsuario(equipoA), true);
    assert.equal(await comoUsuario(duenoA1), false, "false, NO un error: el control falla cerrado y en silencio");
    const sinMembresia = (await sql<{ id: string }>("select gen_random_uuid() as id"))[0]!.id;
    assert.equal(await comoUsuario(sinMembresia), null, "sin membresía es NULL, y NULL tampoco es TRUE");
  });

  // ------------------------------------------------------------------------- el margen

  test("🔴 el entregable NO lleva el bloque de coste, y el run SÍ tiene coste", async () => {
    // Precondición, y es LA que hace que este test muerda: con coste 0 el documento no imprimiría el
    // número igual, y quien invirtiera la audiencia seguiría pasando.
    const crudo = await sql<{ c: string }>("select coste_micros_usd::text as c from kr_runs where id = $1", [
      runA1,
    ]);
    assert.equal(crudo[0]?.c, String(COSTE_A1), "el run tiene un coste real que se podría filtrar");

    const res = await pedir(`/runs/${runA1}/entregable.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200);
    const md = await res.text();

    assert.doesNotMatch(md, /Coste del research/, "el bloque entero no se genera");
    assert.ok(!md.includes(COSTE_IMPRESO), `el total ($${COSTE_IMPRESO}) no aparece en ninguna forma`);
    assert.doesNotMatch(md, /DataForSEO/, "ni el desglose por proveedor");
    // Y no queda un hueco raro: el documento sigue siendo el informe de siempre.
    assert.match(md, /^# Keyword Research — Bella Napoli/);
    assert.match(md, /## Páginas propuestas/);
  });

  test("🔴 el informe interno SIGUE llevando su coste: la exclusión es del entregable, no global", async () => {
    /*
     * Sin este test, "arreglar" el margen quitando el bloque de coste de `renderReport` para todos dejaría
     * la suite en verde y le sacaría al informe interno su argumento comercial ante Frank.
     */
    const { rows } = await pg.query<{ id: string }>("select id from kr_runs where id = $1", [runA1]);
    assert.equal(rows.length, 1);

    await sql(`insert into kr_informes (run_id, tenant_id, client_id, informe_md) values ($1,$2,$3,$4)`, [
      runA1,
      tenantA,
      clientA1,
      "# Keyword Research — Bella Napoli\n\n### Coste del research\n\n| **TOTAL** | **$0.3125** |\n",
    ]);

    const res = await pedir(`/runs/${runA1}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200);
    const md = await res.text();
    assert.match(md, /Coste del research/, "el informe interno conserva el bloque");
    assert.ok(md.includes(COSTE_IMPRESO));
  });

  // ------------------------------------------------------------------------- quién lo puede pedir

  test("🔴 el rol `cliente` NO puede bajar el entregable de su propio run: 404, no 403", async () => {
    /*
     * El entregable lo envía la agencia (decisión del dueño, 2026-08-07). El 404 —y no un 403— es lo que
     * impide que el `cliente` deduzca que existe un documento que no puede ver. Y no lo decide un `if`:
     * la consulta lleva `app.es_staff()` en su predicado (ADR-15).
     */
    // Precondición: el run SÍ le es visible. Sin esto, el 404 podría venir de que no ve el run y la
    // mutación del predicado no tumbaría nada.
    const suyo = await pedir(`/runs/${runA1}`, { user: duenoA1, tenant: tenantA });
    assert.equal(suyo.status, 200, "el run de su propio negocio le es visible: el brief lo ve");

    const res = await pedir(`/runs/${runA1}/entregable.md`, { user: duenoA1, tenant: tenantA });
    assert.equal(res.status, 404);

    // Y el MISMO cuerpo que un run inexistente: los dos casos son indistinguibles desde afuera.
    const inexistente = await pedir(`/runs/${UUID_INEXISTENTE}/entregable.md`, {
      user: equipoA,
      tenant: tenantA,
    });
    assert.equal(inexistente.status, 404);
    assert.deepEqual(await res.json(), await inexistente.json());
  });

  // ------------------------------------------------------------------------- nada que entregar

  /**
   * 🔴 Sin páginas aprobadas: **409, no una hoja vacía**.
   *
   * El backend hacía lo correcto —generar lo aprobado, que es nada— y salía un documento con dos
   * títulos de sección y nada debajo. El riesgo no es técnico sino **humano**: mandarle ese PDF a un
   * restaurante sin mirarlo. Un documento vacío que se descarga sin protestar parece un documento.
   *
   * El 409 va **además** del link deshabilitado del portal (decisión de Juan, 2026-08-07: las dos
   * cosas). La UI evita el clic inútil; esto impone la regla para quien llame al endpoint directo, que
   * es lo que hace que sea una regla y no una sugerencia de la pantalla.
   */
  test("🔴 un run sin ninguna página aprobada → 409, y NO un documento vacío", async () => {
    const vacio = await mkRun(tenantA, clientA1);
    await mkPagina(tenantA, vacio, clientA1, "/propuesta", { orden: 0, aprobada: false });

    const res = await pedir(`/runs/${vacio}/entregable.md`, { user: equipoA, tenant: tenantA });

    assert.equal(res.status, 409, "409 y no 404: el run existe y quien pregunta puede verlo");
    const cuerpo = (await res.json()) as { error: string; codigo: string };
    assert.equal(cuerpo.codigo, SIN_PAGINAS_APROBADAS, "el portal ramifica sobre el CÓDIGO, no sobre la frase");
    assert.match(cuerpo.error, /página aprobada/i, "y el humano recibe una frase que dice qué hacer");
  });

  /**
   * 🔴 El control positivo del de arriba, y no es ceremonia.
   *
   * Sin él, un 409 devuelto SIEMPRE dejaría el test anterior en verde y rompería el entregable entero.
   * `runA1` tiene dos páginas aprobadas y una sin aprobar, así que además fija que la condición mira
   * las **aprobadas** y no el total.
   */
  test("🔴 con una sola página aprobada el entregable sale igual (el 409 es por CERO, no por 'faltan')", async () => {
    const unaSola = await mkRun(tenantA, clientA1);
    await mkPagina(tenantA, unaSola, clientA1, "/la-unica", { orden: 0, aprobada: true });
    await mkPagina(tenantA, unaSola, clientA1, "/sin-aprobar", { orden: 1, aprobada: false });

    const res = await pedir(`/runs/${unaSola}/entregable.md`, { user: equipoA, tenant: tenantA });

    assert.equal(res.status, 200);
    assert.match(await res.text(), /## Páginas propuestas/);
  });

  /**
   * 🔴 Y el 409 no puede filtrar la existencia de un run que no se puede ver.
   *
   * Es el riesgo que introduce cualquier código de estado nuevo en este endpoint: si un run **de otro
   * tenant** sin páginas aprobadas devolviera 409 en vez de 404, el 409 se convertiría en un oráculo
   * de existencia. Sigue siendo 404 porque el orden importa — `getDatosEntregable` devuelve `null`
   * antes, y esa consulta lleva `app.es_staff()` en el predicado (ADR-15).
   */
  test("🔴 un run sin aprobar de OTRO tenant sigue dando 404, no 409 (el 409 no es un oráculo)", async () => {
    const ajenoVacio = await mkRun(tenantB, clientB1);
    await mkPagina(tenantB, ajenoVacio, clientB1, "/ajena-sin-aprobar", { orden: 0, aprobada: false });

    const res = await pedir(`/runs/${ajenoVacio}/entregable.md`, { user: equipoA, tenant: tenantA });

    assert.equal(res.status, 404, "un 409 acá diría 'este run existe' a quien no puede verlo");
  });

  test("🔴 un run de OTRO tenant → 404, en las dos direcciones", async () => {
    const aVeB = await pedir(`/runs/${runB1}/entregable.md`, { user: equipoA, tenant: tenantA });
    assert.equal(aVeB.status, 404);

    const bVeA = await pedir(`/runs/${runA1}/entregable.md`, { user: equipoB, tenant: tenantB });
    assert.equal(bVeA.status, 404);
  });

  test("sin token → 401: la ruta nueva nace detrás del middleware de autenticación", async () => {
    const res = await pedir(`/runs/${runA1}/entregable.md`, { tenant: tenantA });
    assert.equal(res.status, 401);
  });

  // ------------------------------------------------------------------------- qué lleva el documento

  test("🔴 solo las páginas APROBADAS entran, y en el orden del brief", async () => {
    const res = await pedir(`/runs/${runA1}/entregable.md`, { user: equipoA, tenant: tenantA });
    const md = await res.text();

    // Precondición: la página sin aprobar existe de verdad.
    const sinAprobar = await sql("select id from kr_pages where run_id = $1 and url_slug = '/sin-aprobar'", [
      runA1,
    ]);
    assert.equal(sinAprobar.length, 1, "la página que NO debe salir existe");

    assert.ok(!md.includes("/sin-aprobar"), "el entregable refleja lo que pasó la compuerta, no el brief");
    assert.ok(md.includes("/primera") && md.includes("/segunda"));
    assert.ok(
      md.indexOf("kw /primera") < md.indexOf("kw /segunda"),
      "el orden es el del brief (orden_brief), no el de inserción",
    );
    // Y el recuento del encabezado cuenta lo que el documento MUESTRA (2), no lo que el run propuso (3).
    assert.match(md, /- Páginas propuestas: \*\*2\*\*/);
  });

  test("el `Content-Disposition` dice `entregable-…` y se sanea end-to-end", async () => {
    const limpio = await pedir(`/runs/${runA1}/entregable.md`, { user: equipoA, tenant: tenantA });
    assert.match(limpio.headers.get("content-type") ?? "", /text\/markdown/);
    assert.equal(
      limpio.headers.get("content-disposition"),
      'attachment; filename="entregable-Bella-Napoli.md"',
      "el prefijo distingue el documento: no puede bajar como `informe-…`",
    );

    // El nombre hostil del CRM no puede partir el header ni cerrar el `filename` antes de tiempo.
    const hostil = await pedir(`/runs/${runA2}/entregable.md`, { user: equipoA, tenant: tenantA });
    assert.equal(hostil.status, 200);
    const disp = hostil.headers.get("content-disposition") ?? "";
    assert.doesNotMatch(disp, /[\r\n]/);
    assert.equal(disp, 'attachment; filename="entregable-Bar-El-Bueno-X-Inyectado-si.md"');
    assert.equal(hostil.headers.get("x-inyectado"), null);
  });

  test("🔴 el `Content-Disposition` viaja EXPUESTO por CORS, o el navegador se lo esconde al portal", async () => {
    // Mismo motivo que en la descarga del informe (KR-2b): sin `Access-Control-Expose-Headers`, el
    // `headers.get('content-disposition')` del portal devuelve null y el archivo baja con el runId.
    const res = await pedir(`/runs/${runA1}/entregable.md`, { user: equipoA, tenant: tenantA });
    const expuestos = (res.headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0);
    assert.deepEqual(expuestos, ["content-disposition"]);
  });

  /*
   * ⚠️ Acá vivía «un run SIN ninguna página aprobada da un documento vacío, no un 500», que fijaba el
   * comportamiento viejo: 200 con `- Páginas propuestas: **0**`. Era correcto —el backend generaba lo
   * aprobado, que es nada— y **es justo lo que esta pieza cambia** (decisión de Juan, 2026-08-07).
   *
   * Se reemplaza en vez de borrarse: el caso sigue cubierto, arriba, en «nada que entregar», con el
   * 409 y sus dos controles. Lo que aquel test garantizaba de verdad —que no revienta con un 500—
   * sigue garantizado: 409 tampoco es 500.
   */
});

/* ---------------------------------------------------------------------------------------------------
 * `briefDelEntregable` — función pura. Sin PGlite: lo que se prueba es la traducción de una fila de
 * Postgres al brief del contrato, y ahí lo que importa es qué hace con un dato DEGRADADO.
 *
 * Por qué no van dentro del `describe` de arriba: el `beforeEach` levanta un PGlite y aplica todas las
 * migraciones, y estos no tocan la base.
 * --------------------------------------------------------------------------------------------------- */

/** Una fila de página con los jsonb que el llamador quiera romper. */
function fila(over: Partial<PageRow> = {}): PageRow {
  return {
    cluster_id: "c1",
    tipo: "servicio",
    page_strategy: "single",
    url_slug: "/uno",
    keyword_principal: "pizza napolitana madrid",
    keywords_secundarias: [],
    intencion: "commercial",
    local: false,
    volumen: 480,
    dificultad: 21,
    evidencia: "datos_mercado",
    opportunity_score: 84,
    score_confidence: 0.9,
    seo: { meta_title: "T", meta_description: "D", schema_type: "WebPage", canonical: "/c" },
    content_brief: { h1: "H", secciones_sugeridas: [], word_count_objetivo: 800, enlazado_interno: [] },
    preguntas_frecuentes: [],
    ...over,
  };
}

function datos(over: Partial<DatosEntregable> = {}): DatosEntregable {
  return {
    run_id: "r1",
    schema_version: "kr.v0.5",
    status: "pending_approval",
    cliente: "Bella Napoli",
    market_country: "ES",
    market_language: "es",
    market_location_code: 2724,
    generated_at: "2026-08-07T10:00:00.000Z",
    calidad_datos: { cobertura_volumen: 0.75, cobertura_kd: 0.5, endpoints_degradados: [] },
    coste_micros_usd: 312_500,
    coste_breakdown: {},
    keywords_analizadas: 120,
    paginas: [fila()],
    ...over,
  };
}

const documento = (d: DatosEntregable): string => renderReport(briefDelEntregable(d), { audiencia: "restaurante" });

test("🔴 un `seo`/`content_brief` vacío (el default `{}` de la columna) no revienta ni imprime basura", () => {
  /*
   * `kr_pages.seo` y `content_brief` son `jsonb not null default '{}'`. Sin normalizar, `renderReport`
   * hacía `content_brief.secciones_sugeridas.length` sobre `undefined` → **TypeError**, y el h1 salía
   * literalmente `undefined` en el documento del cliente. Es el mismo `{}` que ya produjo `$NaN` en KR-2a.
   */
  const md = documento(datos({ paginas: [fila({ seo: {}, content_brief: {} })] }));

  assert.doesNotMatch(md, /undefined/, "ningún campo ausente se imprime como la palabra `undefined`");
  assert.doesNotMatch(md, /NaN/);
  // El h1 cae a la keyword principal de la misma página: es dato real, no un encabezado sin título.
  assert.match(md, /### 1\. pizza napolitana madrid/);
});

test("🔴 `calidad_datos` vacío da `n/d`, nunca `0%`: un 0 inventado afirma que no hay demanda", () => {
  const md = documento(datos({ calidad_datos: {} }));

  assert.match(md, /volumen\*\* conocido \| \*\*n\/d\*\*/);
  assert.match(md, /\(KD\)\*\* conocida \| \*\*n\/d\*\*/);
  assert.ok(!md.includes("**0%**"), "0% sería una afirmación con contenido, y no la tenemos");
  // `endpoints_degradados` ausente ≠ `[]`: uno dice "no se registró", el otro "ninguno falló".
  assert.match(md, /No se registró.*si algún endpoint de datos falló/s);
});

test("🔴 una `evidencia` desconocida cae en «sin validar», y la página NO desaparece del documento", () => {
  /*
   * `kr_pages.evidencia` es `text` PELADO: nada en el esquema la ata al vocabulario del contrato.
   * `renderReport` parte las páginas en dos grupos comparando contra `"datos_mercado"`, así que un valor
   * raro no caería en ninguno y la página se esfumaría de las dos tablas en silencio. Se falla hacia
   * `sin_validar`: lo que no se puede demostrar respaldado no se presenta como respaldado.
   */
  const md = documento(datos({ paginas: [fila({ evidencia: "vaya_uno_a_saber" })] }));

  assert.match(md, /### ⚠️ Sin validar \(1\)/);
  assert.doesNotMatch(md, /### ✅ Respaldadas por datos de mercado/);
  assert.ok(md.includes("pizza napolitana madrid"), "la página sigue estando en el documento");
});

test("el desglose de coste se lee de la base, pero el entregable no lo imprime", () => {
  // El coste viaja hasta el brief (ver `getDatosEntregable`) precisamente para que el test de arriba
  // pueda morder. Acá se comprueba lo complementario: viajar no es imprimir.
  const brief = briefDelEntregable(
    datos({
      coste_breakdown: { dataforseo_micros: 250_000, llm_generation_micros: 50_000, llm_embeddings_micros: 12_500 },
    }),
  );
  assert.equal(brief.meta_run.coste_micros_usd, 312_500);
  assert.equal(brief.meta_run.coste_breakdown.dataforseo_micros, 250_000);

  const md = renderReport(brief, { audiencia: "restaurante" });
  assert.doesNotMatch(md, /Coste del research|DataForSEO|0\.3125/);
});

test("un `coste_breakdown` con basura no inventa números: los campos que no son número se omiten", () => {
  const brief = briefDelEntregable(
    datos({ coste_breakdown: { dataforseo_micros: "250000", llm_generation_micros: 50_000 } }),
  );
  assert.equal(brief.meta_run.coste_breakdown.dataforseo_micros, undefined, "un string no es un coste");
  assert.equal(brief.meta_run.coste_breakdown.llm_generation_micros, 50_000);
});

test("`meta_run.paginas_propuestas` cuenta lo que el documento MUESTRA", () => {
  // Si dijera lo que el research propuso y la tabla mostrara lo aprobado, el número desmentiría la tabla.
  const brief = briefDelEntregable(datos({ paginas: [fila({ url_slug: "/a" }), fila({ url_slug: "/b" })] }));
  assert.equal(brief.meta_run.paginas_propuestas, 2);
});

test("🔴 `keywords_analizadas` DECLARADO en calidad_datos gana sobre el conteo de kr_keywords", () => {
  /*
   * Lo encontró mirar el documento del seed de la demo, no un test: ese run declara 55 en
   * `calidad_datos.keywords_analizadas` y tiene CERO filas en `kr_keywords`, así que contando el
   * entregable decía «0 keywords analizadas» mientras el informe interno del MISMO run decía 55.
   * Dos documentos de la agencia contradiciéndose sobre el mismo research.
   */
  const conDeclarado = briefDelEntregable(
    datos({
      calidad_datos: { cobertura_volumen: null, cobertura_kd: null, endpoints_degradados: null, keywords_analizadas: 55 },
      keywords_analizadas: 0, // lo que devuelve el count(*): el seed no siembra kr_keywords
    }),
  );
  assert.equal(conDeclarado.meta_run.keywords_analizadas, 55);
});

test("🔴 y sin el declarado se usa el CONTEO: un run real no guarda ese campo en calidad_datos", () => {
  // `finishRun` escribe en `calidad_datos` solo los tres campos de `DataQuality`. En un run de verdad el
  // número solo existe como filas de `kr_keywords`, y el fallback es lo único que lo encuentra.
  const contando = briefDelEntregable(
    datos({
      calidad_datos: { cobertura_volumen: 0.75, cobertura_kd: 0.5, endpoints_degradados: [] },
      keywords_analizadas: 120,
    }),
  );
  assert.equal(contando.meta_run.keywords_analizadas, 120, "las keywords del run entero: se pagaron todas");

  // Y un valor basura en la columna no gana sobre el conteo: `null`/string caen al fallback.
  const basura = briefDelEntregable(
    datos({ calidad_datos: { keywords_analizadas: "cincuenta" }, keywords_analizadas: 120 }),
  );
  assert.equal(basura.meta_run.keywords_analizadas, 120);
});

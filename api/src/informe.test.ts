import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones, PglitePool, PgStore, PgClientes, PgMembresias, PgIdeas, PgResenas } from "db";
import { createApp } from "./app.js";
import { nombreArchivo } from "./informe-nombre.js";
import { MockGoogleOAuthProvider } from "./google-oauth.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";

/**
 * El `filename` del header de descarga es SUPERFICIE DE INYECCIÓN DE HEADER: sale del nombre del cliente,
 * que es texto que un humano escribe en el CRM. Se sanea con ALLOWLIST, no con lista de prohibidos: una
 * denylist protege de lo que se le ocurrió a quien la escribió.
 *
 * Qué para esta allowlist y qué para el runtime antes que ella —la comilla doble pasa las dos capas; el
 * `\r\n` lo rechazan— está MEDIDO, con fecha y versión, en `informe-nombre.ts`. El nombre del test de acá
 * abajo describe la clase de ataque, no lo que este stack hace con él.
 */
test("🔴 un nombre con CRLF no puede partir la respuesta HTTP", () => {
  const n = nombreArchivo("Bar\r\nX-Inyectado: si", "informe");
  assert.doesNotMatch(n, /[\r\n]/, "ni un solo carácter de control sobrevive");
  assert.equal(n, "informe-Bar-X-Inyectado-si.md");
});

test("🔴 una comilla doble no puede cerrar el header", () => {
  assert.doesNotMatch(nombreArchivo('Bar "El Bueno"', "informe"), /"/);
});

test("los acentos, la Ñ y los emoji se reemplazan, no se cuelan", () => {
  const n = nombreArchivo("Señor Ñandú 🍕", "informe");
  assert.match(n, /^informe-[A-Za-z0-9._-]+\.md$/, "solo caracteres de la allowlist");
  assert.doesNotMatch(n, /[ÑñúÚ🍕]/);
});

test("🔴 si tras sanear no queda nada, cae al fallback `informe.md`", () => {
  // El caso que se olvida. Un nombre entero fuera de la allowlist dejaría `informe-.md`, o peor, `informe-`.
  assert.equal(nombreArchivo("🍕🍕🍕", "informe"), "informe.md");
  assert.equal(nombreArchivo("---", "informe"), "informe.md");
  assert.equal(nombreArchivo("", "informe"), "informe.md");
  assert.equal(nombreArchivo(null, "informe"), "informe.md");
  assert.equal(nombreArchivo(undefined, "informe"), "informe.md");
});

test("🔴 el prefijo distingue los dos documentos, y la función NO lo elige", () => {
  /*
   * `informe` lleva el coste (el margen de la agencia) y `entregable` no. Que el prefijo sea un parámetro
   * OBLIGATORIO y de tipo cerrado es lo que impide dos cosas: que un endpoint nuevo herede el nombre del
   * otro documento por olvido, y que el prefijo se vuelva una segunda vía de inyección en el header —
   * entra crudo, sin pasar por la allowlist que sanea el nombre del cliente.
   */
  assert.equal(nombreArchivo("Bella Napoli", "informe"), "informe-Bella-Napoli.md");
  assert.equal(nombreArchivo("Bella Napoli", "entregable"), "entregable-Bella-Napoli.md");
  // Y el fallback también es del documento: `entregable.md`, no `informe.md`.
  assert.equal(nombreArchivo("🍕🍕🍕", "entregable"), "entregable.md");
});

test("los guiones consecutivos se colapsan y el largo se acota a 60", () => {
  assert.equal(nombreArchivo("A   B", "informe"), "informe-A-B.md");
  const largo = nombreArchivo("a".repeat(200), "informe");
  assert.equal(largo.length, "informe-".length + 60 + ".md".length);
});

/*
 * ---------------------------------------------------------------------------------------------------
 * Los dos endpoints, contra Postgres REAL (PGlite) y con la API entera montada.
 *
 * El montaje y el verificador falso (`valid:<uuid>`) son los MISMOS que `app.test.ts`: lo que se inyecta
 * de mentira es la criptografía del token y el emisor de Inngest, no la autorización. La autorización la
 * hace RLS de verdad, que es justo lo que estos tres resultados (404 / 200-con-null / 200-con-informe)
 * están fijando.
 *
 * Van dentro de un `describe` a propósito: el `beforeEach` levanta un PGlite nuevo y aplica TODAS las
 * migraciones, y los cinco tests de `nombreArchivo` de arriba son función pura — no tienen por qué pagar
 * un esquema entero cada uno.
 * ---------------------------------------------------------------------------------------------------
 */
describe("GET /runs/:id/informe y /informe.md", () => {
  let pg: PGlite;
  let app: ReturnType<typeof createApp>;

  // Sembrado con superusuario: saltea RLS, que es lo que hace la infraestructura, no la app.
  let tenantA: string;
  let tenantB: string;
  let clientA1: string; // "Bella Napoli" — el nombre limpio, para fijar el filename exacto
  let clientA2: string; // nombre HOSTIL (CRLF + comillas): el que prueba el saneo end-to-end
  let equipoA: string; // rol equipo en A: staff, ve el informe
  let duenoA1: string; // rol cliente en A, atado a clientA1: ve el run, NO el informe
  let equipoB: string; // rol equipo en B: no ve nada de A
  let runA1: string; // con informe
  let runA2: string; // con informe, del cliente de nombre hostil
  let runSinInforme: string; // existe, y no tiene informe
  let runB1: string; // con informe, en el OTRO tenant

  const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

  /** El nombre que un humano puede escribir en el CRM y que rompería el header si viajara crudo. */
  const NOMBRE_HOSTIL = 'Bar "El Bueno"\r\nX-Inyectado: si';

  const MD_A1 = "# Keyword Research — Bella Napoli\n\n## Coste\n\nDataForSEO: 1.2 USD\n";
  const MD_A2 = "# Keyword Research — hostil\n";

  const verificar: VerificadorToken = async (token) =>
    token.startsWith("valid:") ? { userId: token.slice(6) } : null;

  async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
    const res = await pg.query<T>(q, params);
    return res.rows;
  }

  /** Un cliente del tenant, devolviendo su id. */
  async function mkCliente(tenantId: string, nombre: string): Promise<string> {
    const filas = await sql<{ id: string }>(
      "insert into clients (tenant_id, nombre) values ($1,$2) returning id",
      [tenantId, nombre],
    );
    return filas[0]!.id;
  }

  async function mkMembresia(tenantId: string, rol: string, clientId: string | null): Promise<string> {
    const filas = await sql<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol, client_id)
       values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
      [tenantId, rol, clientId],
    );
    return filas[0]!.user_id;
  }

  async function mkRun(tenantId: string, clientId: string): Promise<string> {
    const filas = await sql<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code)
       values ($1,$2,'kr.v0.5','pending_approval','prompt','ES','es',2724) returning id`,
      [tenantId, clientId],
    );
    return filas[0]!.id;
  }

  /*
   * El informe se siembra con SUPERUSUARIO y no con `guardarInforme`, por el mismo motivo que
   * `db/src/informe-store.test.ts`: acá lo que se prueba es qué devuelve el ENDPOINT, así que la
   * precondición "la fila existe" tiene que ser independiente de la política que el endpoint atraviesa.
   * Preguntárselo a `getInforme` sería circular.
   */
  async function sembrarInforme(runId: string, tenantId: string, clientId: string, md: string): Promise<void> {
    await sql(
      `insert into kr_informes (run_id, tenant_id, client_id, informe_md) values ($1,$2,$3,$4)`,
      [runId, tenantId, clientId, md],
    );
  }

  /** Igual que en `app.test.ts`: `user` es el uuid y el token bueno se arma solo. */
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
    const clientB1 = await mkCliente(tenantB, "Sushi Zen");

    equipoA = await mkMembresia(tenantA, "equipo", null);
    duenoA1 = await mkMembresia(tenantA, "cliente", clientA1);
    equipoB = await mkMembresia(tenantB, "equipo", null);

    runA1 = await mkRun(tenantA, clientA1);
    runA2 = await mkRun(tenantA, clientA2);
    runSinInforme = await mkRun(tenantA, clientA1);
    runB1 = await mkRun(tenantB, clientB1);

    await sembrarInforme(runA1, tenantA, clientA1, MD_A1);
    await sembrarInforme(runA2, tenantA, clientA2, MD_A2);
    await sembrarInforme(runB1, tenantB, clientB1, "# Keyword Research — del otro tenant\n");
  });

  afterEach(async () => {
    await pg.close();
  });

  // ------------------------------------------------------------------ GET /runs/:id/informe

  test("GET /runs/:id/informe — devuelve el informe al staff", async () => {
    const res = await pedir(`/runs/${runA1}/informe`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { informe_md: string; generado_at: string };
    assert.match(body.informe_md, /^# Keyword Research/);
    assert.ok(body.generado_at);
    // El contrato con el portal: un ISO 8601, no un objeto ni un número. `getInforme` lo garantiza (T2).
    assert.match(body.generado_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test("🔴 un run que existe SIN informe → 200 con null, NO 404", async () => {
    /*
     * Un 404 mentiría: el run existe. El portal necesita distinguir "no hay run" de "hay run sin informe"
     * para decir cuál de las dos cosas pasa, en vez de mostrar un error genérico.
     */
    const res = await pedir(`/runs/${runSinInforme}/informe`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { informe_md: null, generado_at: null });
  });

  test("un run inexistente → 404", async () => {
    const res = await pedir(`/runs/${UUID_INEXISTENTE}/informe`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 404);
  });

  test("🔴 un run de OTRO tenant → 404, con el MISMO cuerpo que uno inexistente", async () => {
    // No se distingue "existe en otro tenant" de "no existe": revelar la existencia ya es información.
    const ajeno = await pedir(`/runs/${runB1}/informe`, { user: equipoA, tenant: tenantA });
    assert.equal(ajeno.status, 404);

    const inexistente = await pedir(`/runs/${UUID_INEXISTENTE}/informe`, { user: equipoA, tenant: tenantA });
    assert.equal(inexistente.status, 404);
    assert.deepEqual(await ajeno.json(), await inexistente.json());
  });

  test("🔴 un run visible para el `cliente` pero cuyo informe no lo es se ve IGUAL que uno sin informe", async () => {
    /*
     * 200 con null, no 403. La API no debe revelar que existe algo que no puede mostrar — y no lo decide
     * con un `if` de rol: la política `informe_staff` (0016) simplemente no le devuelve la fila (ADR-15).
     */
    // Precondición, y no es adorno: si la fila NO existiera, este test pasaría por el motivo equivocado
    // (sería el caso "run sin informe" disfrazado) y la mutación de la política no lo tumbaría.
    const filas = await sql("select run_id from kr_informes where run_id = $1", [runA1]);
    assert.equal(filas.length, 1, "el informe que el cliente NO tiene que ver existe de verdad");

    const res = await pedir(`/runs/${runA1}/informe`, { user: duenoA1, tenant: tenantA });
    assert.equal(res.status, 200);
    const cuerpo = await res.json();
    assert.deepEqual(cuerpo, { informe_md: null, generado_at: null });

    // Y el mismo cuerpo que un run realmente sin informe: los dos casos son indistinguibles desde afuera.
    const sinInforme = await pedir(`/runs/${runSinInforme}/informe`, { user: equipoA, tenant: tenantA });
    assert.deepEqual(cuerpo, await sinInforme.json());
  });

  test("GET /runs/:id/informe sin token → 401 (la ruta nueva nace detrás del middleware)", async () => {
    const res = await pedir(`/runs/${runA1}/informe`, { tenant: tenantA });
    assert.equal(res.status, 401);
  });

  // ------------------------------------------------------------------ GET /runs/:id/informe.md

  test("GET /runs/:id/informe.md — baja como archivo, con el nombre saneado", async () => {
    const res = await pedir(`/runs/${runA1}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /text\/markdown/);
    assert.equal(res.headers.get("content-disposition"), 'attachment; filename="informe-Bella-Napoli.md"');
    assert.match(await res.text(), /^# Keyword Research/);
  });

  test("🔴 el `Content-Disposition` viaja EXPUESTO, o el navegador se lo esconde al portal", async () => {
    /*
     * El test de arriba prueba que el header está BIEN CONSTRUIDO en la respuesta HTTP. Éste prueba algo
     * distinto y que ningún test de la respuesta podía ver: que el navegador se lo deje LEER al JavaScript
     * del portal.
     *
     * Por CORS, un origen cruzado solo puede leer los siete headers de la safelist (`content-type`,
     * `content-length`, `cache-control`, `expires`, `last-modified`, `pragma`, `content-language`).
     * `Content-Disposition` NO está entre ellos, así que sin `Access-Control-Expose-Headers` el
     * `headers.get('content-disposition')` del portal devuelve `null` —medido en Chrome por el
     * implementador del portal— y la descarga cae a su nombre de fallback: todo el saneo por allowlist
     * queda construido y nadie lo recibe.
     *
     * Se comprueba sobre la respuesta REAL y no sobre el preflight a propósito: el navegador lee
     * `Access-Control-Expose-Headers` de la respuesta a la petición de verdad (Fetch §CORS), no del
     * OPTIONS. Hono lo emite en las dos, pero la que gobierna es ésta.
     */
    const res = await pedir(`/runs/${runA1}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200);

    // Case-insensitive: los nombres de header lo son (RFC 9110) y el match de CORS también. Lo que la
    // garantía dice es "está en la lista", no "está en minúsculas".
    const expuestos = (res.headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter((h) => h.length > 0);

    assert.ok(
      expuestos.includes("content-disposition"),
      `el header se construye pero el navegador no lo deja leer; expuestos = ${JSON.stringify(expuestos)}`,
    );

    /*
     * Y es una ALLOWLIST POSITIVA, mismo criterio que `ROLES_ASIGNABLES`: se expone exactamente uno.
     * Esta igualdad exacta es a propósito — exponer un header más (o un `*`) tiene que costar tocar este
     * test y pensar qué se está dejando leer, no colarse en un `push`.
     */
    assert.deepEqual(expuestos, ["content-disposition"], "no se expone ningún header además de ése");
  });

  test("🔴 el nombre del cliente NO llega crudo al header: se sanea end-to-end", async () => {
    /*
     * El test de `nombreArchivo` de arriba prueba la FUNCIÓN; éste prueba que el endpoint la usa. Sin
     * este test, quitar el `nombreArchivo(...)` del handler y poner `cliente?.nombre` crudo dejaría la
     * suite en verde: la función seguiría siendo correcta y nadie la llamaría.
     */
    const res = await pedir(`/runs/${runA2}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 200, "el nombre hostil no puede reventar la respuesta tampoco");
    const disp = res.headers.get("content-disposition") ?? "";
    assert.doesNotMatch(disp, /[\r\n]/, "ni un carácter de control en el header");
    assert.equal(disp, 'attachment; filename="informe-Bar-El-Bueno-X-Inyectado-si.md"');
    // Y el header inyectado no existe como header de verdad.
    assert.equal(res.headers.get("x-inyectado"), null);
  });

  test("🔴 sin informe, el .md es 404: no hay archivo que bajar", async () => {
    const res = await pedir(`/runs/${runSinInforme}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 404);
  });

  test("🔴 el `cliente` no puede bajar el .md, y su 404 es el mismo que 'no hay informe'", async () => {
    // Acá la ausencia SÍ es 404 (no hay archivo), y las dos razones —no lo hay, o no lo puede ver— dan
    // exactamente la misma respuesta.
    const cliente = await pedir(`/runs/${runA1}/informe.md`, { user: duenoA1, tenant: tenantA });
    assert.equal(cliente.status, 404);

    const sinInforme = await pedir(`/runs/${runSinInforme}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(sinInforme.status, 404);
    assert.deepEqual(await cliente.json(), await sinInforme.json());
  });

  test("🔴 el .md de un run de OTRO tenant → 404", async () => {
    const res = await pedir(`/runs/${runB1}/informe.md`, { user: equipoA, tenant: tenantA });
    assert.equal(res.status, 404);
    // Y al revés: B no ve el de A.
    const alReves = await pedir(`/runs/${runA1}/informe.md`, { user: equipoB, tenant: tenantB });
    assert.equal(alReves.status, 404);
  });

  test("GET /runs/:id/informe.md sin token → 401", async () => {
    const res = await pedir(`/runs/${runA1}/informe.md`, { tenant: tenantA });
    assert.equal(res.status, 401);
  });
});

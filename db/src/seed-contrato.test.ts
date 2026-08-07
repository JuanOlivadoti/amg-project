/**
 * El vocabulario de `kr_pages` y el del contrato son EL MISMO — atado por test, en dos direcciones.
 *
 * ## Qué dejó pasar la falta de esto
 *
 * `sembrarDemo` escribía cuatro campos fuera del contrato: `page_strategy` con el papel de la página
 * (`hub`/`spoke`, que el contrato colapsa a `hub_spoke`), `intencion` en español (`comercial`), y `seo`
 * y `content_brief` con la forma del seed (`{title, description}` / `{schema_type}`) en vez de la del
 * contrato. Y no fallaba nada: `tipo`, `intencion`, `page_strategy` y `evidencia` eran `text` PELADO
 * (`0001_init.sql:225-236`), así que la base aceptaba cualquier palabra. El seed y `aPaginaPropuesta()`
 * —130 líneas más arriba, en el mismo archivo— decían cosas distintas del mismo dato.
 *
 * El síntoma no aparecía en `db` ni en `api`: aparecía en el M1, cuando el orquestador reconstruye el
 * brief desde la base (`briefDesdeLaBase`) y `parseBrief` lo rechaza. O sea, en producción.
 *
 * ## Las dos redes, que son de naturaleza distinta y ninguna sustituye a la otra
 *
 *  1. **El check de la 0017** cubre el vocabulario cerrado (cuatro columnas `text`) y lo cubre para
 *     TODA escritura, venga del store, del seed o de un `insert` a mano. Lo que no puede cubrir es la
 *     forma de los dos `jsonb`.
 *  2. **`parseBrief` sobre el brief reconstruido** cubre justamente eso: pasa el dato sembrado por el
 *     MISMO validador que corre en el M1. Es más ancho, pero solo mira las filas que el test siembra.
 *
 * El primer test de acá ata (1) al contrato para que el vocabulario no viva de verdad en dos sitios;
 * el segundo es (2).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { emisionM2, parseBrief } from "contrato";
import { TestDb } from "./testdb.js";
import { PglitePool } from "./pool.js";
import { PgStore } from "./store.js";
import { MIGRATIONS_DIR, asegurarAuthStandIn } from "./migrate.js";
import { ConexionReservada } from "./deploy.js";
import { sembrarDemo, type ResultadoSeed } from "./seed-demo.js";

const FRANK = "11111111-1111-1111-1111-111111111111"; // maestro
const JUAN = "22222222-2222-2222-2222-222222222222"; // equipo

/**
 * Los cuatro checks de vocabulario cerrado de la 0017: el NOMBRE de la constraint → el campo de
 * `paginaM2` del que sale su lista de valores.
 *
 * Se indexa por el nombre de la constraint y no por el de la columna, y eso arregla un fallo real de la
 * primera versión de este test: buscando `<columna> in (…)` sobre el archivo entero, el regex encontró
 * el `where intencion in ('comercial', 'navegacional', 'informacional')` del `update` de REPARACIÓN y
 * comparó el vocabulario viejo contra el del contrato. Anclando en `add constraint <nombre> check (…)`
 * se mira el check y solo el check — y de paso queda atado el nombre, que es lo que los tests de
 * rechazo de más abajo esperan leer dentro del 23514.
 */
const CHECKS_DE_VOCABULARIO = {
  tipo_del_contrato: "tipo",
  intencion_del_contrato: "intencion",
  estrategia_del_contrato: "page_strategy",
  evidencia_del_contrato: "evidencia",
} as const;

const RUTA_0017 = fileURLToPath(new URL("../migrations/0017_vocabulario_kr_pages.sql", import.meta.url));

/*
 * El vocabulario del contrato se saca INTROSPECCIONANDO `emisionM2` en runtime, no de una lista
 * copiada acá ni de una exportación nueva.
 *
 * Los enums de `contrato` (`searchIntent`, `pageType`, …) NO se exportan a propósito —`contrato/src/index.ts`
 * lo dice: "desde afuera el contrato se usa por estos cuatro nombres y por nada más"—, así que
 * exportarlos para este test ampliaría la superficie pública del paquete justo por donde
 * `una-sola-fuente.test.ts` existe para no dejar pasar nada. `emisionM2` ya es público: los valores se
 * leen de ahí.
 *
 * La navegación va sin importar `zod` (`db` no lo tiene como dependencia y no debería): se describe la
 * forma mínima que hace falta. Si Zod cambiara esa forma interna, las aserciones de "no vacío" de más
 * abajo caen — que es el comportamiento correcto, y es la razón de que estén.
 */
interface ConShape {
  shape: Record<string, unknown>;
}

function vocabularioDelContrato(campo: string): string[] {
  const paginas = (emisionM2 as unknown as ConShape).shape["paginas_propuestas"] as
    | { element?: ConShape }
    | undefined;
  const pagina = paginas?.element;
  assert.ok(pagina?.shape, "no pude navegar `emisionM2.paginas_propuestas.element`: ¿cambió Zod?");
  const enumZod = pagina.shape[campo] as { options?: unknown } | undefined;
  const opciones = enumZod?.options;
  assert.ok(
    Array.isArray(opciones) && opciones.length > 0,
    `\`paginaM2.${campo}\` no expuso un enum con opciones: la introspección dejó de funcionar`,
  );
  return [...(opciones as string[])].sort();
}

/**
 * Los literales que la migración escribe DENTRO de un `check` con nombre. Se ancla en
 * `add constraint <nombre> check (…);` y se toman las comillas simples de ahí adentro.
 *
 * Devuelve `[]` cuando no encuentra nada, y eso NO se disimula: el test lo asevera. Dos listas vacías
 * comparadas entre sí son iguales, y un test que compara dos vacíos pasa para siempre sin mirar nada —
 * es el modo de fallo que `una-sola-fuente.test.ts` llama "el cerrojo del cerrojo".
 */
function vocabularioDelSql(sql: string, constraint: string): string[] {
  const m = new RegExp(`add\\s+constraint\\s+${constraint}\\s+check\\s*\\(([\\s\\S]*?)\\);`, "i").exec(sql);
  if (!m?.[1]) return [];
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]!).sort();
}

test("🔴 el vocabulario del check de la 0017 es EXACTAMENTE el del contrato", () => {
  const sql = readFileSync(RUTA_0017, "utf8");

  for (const [constraint, campo] of Object.entries(CHECKS_DE_VOCABULARIO)) {
    const enElSql = vocabularioDelSql(sql, constraint);
    // El control positivo, por constraint y ANTES de comparar: si el regex no matcheó, esta línea cae
    // con el nombre del check en vez de dejar pasar un `deepEqual([], [])`.
    assert.ok(
      enElSql.length > 0,
      `no encontré \`add constraint ${constraint} check (…)\` en la 0017: o el check no está, o se ` +
        "escribió de otra forma y este test dejó de mirarlo (que es peor, porque pasaría en verde)",
    );
    assert.deepEqual(
      enElSql,
      vocabularioDelContrato(campo),
      `el check \`${constraint}\` y \`paginaM2.${campo}\` dejaron de decir lo mismo. El vocabulario ` +
        "vive en dos sitios (el .sql y `contrato`) y este test es lo único que los mantiene atados: " +
        "actualizá el check, no este test.",
    );
  }
});

/**
 * 🔴 El `update` de reparación de la 0017, probado sobre una base que YA TIENE las filas malas.
 *
 * Es la mitad de la migración que ningún otro test puede ver: `aplicarMigraciones` corre sobre una base
 * vacía, así que ahí el `update` no repara nada y quitarlo no tumbaría nada. Pero en producción la base
 * PERSISTE y tiene las 14 páginas del seed viejo — o sea que el `update` es exactamente lo que decide
 * si el `add constraint` de abajo se puede aplicar o el despliegue se detiene con un 23514.
 *
 * Por eso acá se monta el escenario real: migraciones hasta la 0016, se siembran las filas con el
 * vocabulario viejo, y recién entonces se aplica la 0017.
 */
test("🔴 la 0017 repara las filas ya escritas antes de poder ponerles el check", async () => {
  const pg = new PGlite();
  try {
    await asegurarAuthStandIn(pg);
    const archivos = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const hasta0016 = archivos.filter((f) => f < "0017");
    const la0017 = archivos.filter((f) => f.startsWith("0017_"));
    // Control positivo del recorte: si el filtro dejara de matchear, el test aplicaría "nada" y luego
    // "nada", y pasaría en verde sin haber ejercitado la migración.
    assert.ok(hasta0016.length >= 14, `esperaba las migraciones previas y encontré ${hasta0016.length}`);
    assert.equal(la0017.length, 1, "la 0017 tiene que ser exactamente un archivo");

    for (const f of hasta0016) await pg.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

    const [{ id: tenantId }] = (
      await pg.query<{ id: string }>("insert into tenants (nombre, slug) values ('T', 't') returning id")
    ).rows as [{ id: string }];
    const [{ id: clientId }] = (
      await pg.query<{ id: string }>(
        "insert into clients (tenant_id, nombre) values ($1, 'C') returning id",
        [tenantId],
      )
    ).rows as [{ id: string }];
    const [{ id: runId }] = (
      await pg.query<{ id: string }>(
        `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                              market_country, market_language, market_location_code)
         values ($1,$2,'kr.v0.5','pending_approval','p','ES','es',2724) returning id`,
        [tenantId, clientId],
      )
    ).rows as [{ id: string }];

    /*
     * Las CINCO intenciones que el seed viejo pudo dejar escritas, más una fila YA correcta para
     * comprobar que el `update` es idempotente y no la toca.
     *
     * `/e` (`transaccional`) la agregó la 15ª review externa, que midió que faltaba: el fixture
     * cubría las tres que el seed escribía el último día y no la cuarta, que se escribió hasta
     * `f0c1387`. Y la mutación NO es benigna — `intencion` es `not null` (`0001_init.sql:229`), así
     * que un `case` sin esa rama devuelve NULL y el `update` aborta con violación de not-null. O sea
     * que sin esta fila la migración explota **en producción**, contra la base que persiste desde
     * julio, en vez de acá. Que es literalmente para lo que existe este test.
     */
    const viejas: [string, string, string][] = [
      ["/a", "hub", "comercial"],
      ["/b", "spoke", "navegacional"],
      ["/c", "single", "informacional"],
      ["/d", "hub", "comercial"],
      ["/e", "single", "transaccional"],
      ["/ya-correcta", "single", "commercial"],
    ];
    for (const [slug, estrategia, intencion] of viejas) {
      await pg.query(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug,
                               keyword_principal, intencion, evidencia)
         values ($1,$2,$3, gen_random_uuid(), 'landing_local', $4, $5, 'kw', $6, 'datos_mercado')`,
        [tenantId, runId, clientId, estrategia, slug, intencion],
      );
    }

    // Y AHORA la 0017. Sin el `update`, este `exec` lanza 23514 y el despliegue de producción se
    // detiene: es el fallo que este test existe para hacer visible acá y no allá.
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, la0017[0]!), "utf8"));

    const { rows } = await pg.query<{ url_slug: string; page_strategy: string; intencion: string }>(
      "select url_slug, page_strategy, intencion from kr_pages order by url_slug",
    );
    assert.deepEqual(
      rows.map((r) => [r.url_slug, r.page_strategy, r.intencion]),
      [
        ["/a", "hub_spoke", "commercial"],
        ["/b", "hub_spoke", "navigational"],
        ["/c", "single", "informational"],
        ["/d", "hub_spoke", "commercial"],
        ["/e", "single", "transactional"],
        ["/ya-correcta", "single", "commercial"],
      ],
      "el mapeo es determinista y la fila que ya estaba bien no se toca",
    );
  } finally {
    await pg.close();
  }
});

/*
 * ---------------------------------------------------------------------------------------------
 * El test que habría cazado el bug: el brief que se reconstruye desde lo SEMBRADO tiene que pasar el
 * validador del M1. Cubre también los dos `jsonb`, que el check no cubre.
 * ---------------------------------------------------------------------------------------------
 */

let db: TestDb;
let store: PgStore;
let r: ResultadoSeed;

before(async () => {
  db = await TestDb.create();
  r = await sembrarDemo(ConexionReservada.desdePglite(db.pglite), {
    frankUserId: FRANK,
    juanUserId: JUAN,
  });
  // El mismo rol con el que corre la API (`amg_api` → `app_user`): lo que se lee acá es lo que un
  // usuario real ve, con RLS en vigor, no lo que ve el superusuario que sembró.
  store = new PgStore(new PglitePool(db.pglite));
});

after(async () => {
  await db.close();
});

/**
 * 🔴 Lo sembrado sobrevive hasta el validador del M1.
 *
 * **La copia y de dónde salió.** El objeto de abajo reproduce `briefDesdeLaBase`
 * (`orchestrator/src/workflow.ts`, la función homónima), que es la que arma el brief cuando el
 * orquestador va a publicar lo que hay en la base. No se importa porque no está exportada y porque `db`
 * no depende de `orchestrator` (la dirección correcta es la contraria). Es una copia, y puede
 * envejecer: si esa función cambia de forma, este test sigue validando la forma vieja. Lo que no puede
 * envejecer es el validador, que sí es el mismo (`parseBrief`, de `contrato`).
 *
 * **Dos diferencias con el original, las dos a favor del test.** Lee con `getRunPages` y no con
 * `getPublishablePages` —que exigiría aprobar el run y las 14 páginas, o sea sembrar un estado que la
 * demo no tiene— y por eso las páginas llegan con `id`, `approved` y `orden_brief` de más: `consumoM1`
 * los descarta al parsear. Y `approved: true` es literal igual que en el original, donde no es una
 * suposición sino lo que el SQL ya filtró.
 */
test("🔴 el brief reconstruido desde el seed pasa `parseBrief` (el validador del M1)", async () => {
  const ctx = { tenantId: r.tenantId, userId: FRANK };
  const run = await store.getRun(ctx, r.runId);
  assert.ok(run, "precondición: el seed dejó el run visible para el maestro");
  const paginas = await store.getRunPages(ctx, r.runId);
  assert.equal(paginas.length, 14, "precondición: las 14 páginas de la demo, o el test no mira nada");

  const brief = {
    schema_version: run.schema_version,
    run_id: run.id,
    cliente: run.client_id,
    generated_at: run.created_at,
    market: {
      country: run.market_country,
      language_code: run.market_language,
      location_code: run.market_location_code,
    },
    status: "approved",
    paginas_propuestas: paginas.map((p) => ({
      cluster_id: p.cluster_id,
      tipo: p.tipo,
      url_slug: p.url_slug,
      keyword_principal: p.keyword_principal,
      keywords_secundarias: p.keywords_secundarias,
      intencion: p.intencion,
      local: p.local,
      volumen: p.volumen,
      dificultad: p.dificultad,
      evidencia: p.evidencia,
      opportunity_score: p.opportunity_score,
      score_confidence: p.score_confidence,
      seo: p.seo,
      content_brief: p.content_brief,
      preguntas_frecuentes: p.preguntas_frecuentes,
      approved: true,
    })),
    backlog: [],
  };

  // `parseBrief` lanza con el detalle de los campos malos; dejarlo propagar es lo que hace útil el rojo.
  const validado = parseBrief(brief);
  assert.equal(validado.paginas_propuestas.length, 14, "las 14 páginas sobreviven al parseo");

  /*
   * Y la comprobación que el `parseBrief` de arriba NO hace: los campos opcionales de `consumoM1`
   * (`evidencia`, `score_confidence`) sobreviven de verdad. Zod DESCARTA en silencio lo que no está en
   * el esquema —es el bug histórico de `evidencia`— así que un `parseBrief` verde no prueba que el dato
   * llegó: prueba que no molestó.
   */
  assert.ok(
    validado.paginas_propuestas.every((p) => p.evidencia === "datos_mercado" || p.evidencia === "sin_validar"),
    "la evidencia del seed llega al M1 con el vocabulario del contrato",
  );
});

/**
 * 🔴 El check no es decorado: la base RECHAZA el vocabulario viejo del seed.
 *
 * Se prueba con el valor concreto que el seed escribía (`comercial`), no con un `xxx` inventado: el
 * modo de fallo real no era una palabra absurda, era la traducción que faltaba.
 */
test("🔴 la base rechaza la intención en español que sembraba el seed (check de la 0017)", async () => {
  await assert.rejects(
    () =>
      db.asService(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                               keyword_principal, intencion, evidencia)
         values ($1, $2, $3, gen_random_uuid(), 'blog', '/en-espanol', 'kw', 'comercial',
                 'sin_validar')`,
        [r.tenantId, r.runId, r.clientId],
      ),
    /intencion_del_contrato/,
    "lo tira el check nombrado, no un if de TypeScript",
  );
});

/** El otro campo que el seed escribía crudo: el PAPEL de la página en el hub, no la estrategia. */
test("🔴 la base rechaza `page_strategy = 'hub'` (el papel no es la estrategia)", async () => {
  await assert.rejects(
    () =>
      db.asService(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug,
                               keyword_principal, intencion, evidencia)
         values ($1, $2, $3, gen_random_uuid(), 'blog', 'hub', '/papel-de-hub', 'kw', 'commercial',
                 'sin_validar')`,
        [r.tenantId, r.runId, r.clientId],
      ),
    /estrategia_del_contrato/,
    "`hub` y `spoke` son los dos papeles de UNA estrategia: el contrato la llama `hub_spoke`",
  );
});

/**
 * `page_strategy` es la única de las cuatro que admite NULL, y no por descuido: la columna nació
 * nullable en la 0004 y `savePages` escribe `p.page_strategy ?? null`. Un check que la exigiera
 * rompería toda escritura de un brief que no la trae.
 */
test("el check de `page_strategy` deja pasar NULL (la columna es nullable desde la 0004)", async () => {
  await db.asService(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                           keyword_principal, intencion, evidencia)
     values ($1, $2, $3, gen_random_uuid(), 'blog', '/sin-estrategia', 'kw', 'commercial',
             'sin_validar')`,
    [r.tenantId, r.runId, r.clientId],
  );
  // El `finally` no es ceremonia: `db.asService` COMMITEA, así que si el assert falla la fila 15 queda
  // escrita y el próximo test que cuente páginas encuentra 15 donde espera 14 — un fallo en cascada que
  // culpa al test equivocado. Hoy éste es el último del archivo; el `finally` es lo que hace que siga
  // siendo seguro cuando alguien agregue otro detrás.
  try {
    const filas = await db.asService<{ page_strategy: string | null }>(
      "select page_strategy from kr_pages where url_slug = '/sin-estrategia'",
    );
    assert.equal(filas[0]?.page_strategy, null, "sin estrategia no es un dato roto: es un dato ausente");
  } finally {
    await db.asService("delete from kr_pages where url_slug = '/sin-estrategia'");
  }
});

import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PgStore, PLAZO_RUN_COLGADO } from "./store.js";
import { PglitePool } from "./pool.js";
import { aplicarMigraciones, MIGRATIONS_DIR, asegurarAuthStandIn } from "./migrate.js";
import { leerKeywordsCrudo, leerPaginasCrudo, sqlCrudo } from "./testing.js";
import type { KeywordRow, PageRow, TenantContext } from "./store.js";

let pg: PGlite;
let pool: PglitePool;
let store: PgStore;
/** El orquestador: mismo pool en tests, pero asumiendo el rol app_service. */
let storeServicio: PgStore;

let tenantA: string;
let tenantB: string;
let clientA1: string;
let clientA2: string;
let clientB1: string;
/** Usuarios con membresía REAL. El rol sale de ahí, no de lo que declare el que llama. */
let equipoA: string;
let equipoB: string;
let duenoA1: string;

const ctxA = (): TenantContext => ({ tenantId: tenantA, userId: equipoA });
const ctxB = (): TenantContext => ({ tenantId: tenantB, userId: equipoB });
/** El orquestador. Su autoridad es la credencial de Postgres, no un campo de la petición. */
const ctxServicio = (): TenantContext => ({ tenantId: tenantA });

const kw = (over: Partial<KeywordRow> = {}): KeywordRow => ({
  keyword: "pizza napolitana madrid",
  canonical_key: "pizza napolitana madrid",
  source: "seed",
  volume: 390,
  difficulty: 15,
  intent: "local",
  is_local: true,
  business_relevance: 0.9,
  opportunity_score: 84,
  score_confidence: 1,
  discarded: false,
  ...over,
});

const page = (over: Partial<PageRow> = {}): PageRow => ({
  cluster_id: "11111111-1111-4111-8111-111111111111",
  tipo: "landing_local",
  url_slug: "/pizza-napolitana-madrid",
  keyword_principal: "pizza napolitana madrid",
  keywords_secundarias: ["pizza napolitana"],
  intencion: "local",
  local: true,
  volumen: 390,
  dificultad: 15,
  evidencia: "datos_mercado",
  opportunity_score: 84,
  score_confidence: 1,
  seo: { meta_title: "Pizza napolitana en Madrid" },
  content_brief: { h1: "Pizza napolitana" },
  preguntas_frecuentes: ["¿Hacen reservas?"],
  ...over,
});

before(async () => {
  pg = new PGlite();
  await aplicarMigraciones(pg);
  pool = new PglitePool(pg);
  store = new PgStore(pool);
  storeServicio = new PgStore(pool, "app_service");
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  // `clients.asignado_a` (0011) es una FK compuesta a `memberships (tenant_id, user_id)` con
  // `on delete set null` -- si un test de la 0026 (Telegram) deja un cliente con `asignado_a`
  // apuntando a una membresía, borrar esa membresía sin limpiar antes intenta poner en NULL LAS
  // DOS columnas de la FK compuesta, incluida `tenant_id` -- que es NOT NULL en `clients` y hace
  // fallar el `delete from memberships` con 23502. Limpiar `asignado_a` primero deja el `delete`
  // de abajo seguro sin importar qué haya quedado asignado.
  await pg.exec(
    "update clients set asignado_a = null; " +
      "delete from kr_runs; delete from memberships; delete from clients; delete from tenants;",
  );
  const { rows: t } = await pg.query<{ id: string }>(
    "insert into tenants (nombre, slug) values ('A', 'a'), ('B', 'b') returning id",
  );
  tenantA = t[0]!.id;
  tenantB = t[1]!.id;

  const mk = async (tid: string, n: string) => {
    const { rows } = await pg.query<{ id: string }>(
      "insert into clients (tenant_id, nombre) values ($1, $2) returning id",
      [tid, n],
    );
    return rows[0]!.id;
  };
  clientA1 = await mk(tenantA, "Trattoria");
  clientA2 = await mk(tenantA, "Bar Pepe");
  clientB1 = await mk(tenantB, "Sushi Zen");

  // Los usuarios y su ROL viven en `memberships`. Ya no se declaran en la petición (0002_auth.sql).
  const mkMiembro = async (tid: string, rol: string, cid: string | null) => {
    const { rows } = await pg.query<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol, client_id)
       values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
      [tid, rol, cid],
    );
    return rows[0]!.user_id;
  };
  equipoA = await mkMiembro(tenantA, "equipo", null);
  equipoB = await mkMiembro(tenantB, "equipo", null);
  duenoA1 = await mkMiembro(tenantA, "cliente", clientA1);
});

const nuevoRun = (clientId: string) => ({
  clientId,
  schemaVersion: "kr.v0.5",
  prompt: "Restaurante italiano en Madrid centro",
  market: { country: "ES", language_code: "es", location_code: 2724 },
});

const META_FINISH_RUN = {
  costeMicros: 310_800,
  costeBreakdown: { dataforseo_micros: 252_200 },
  calidadDatos: { cobertura_volumen: 0.71, endpoints_degradados: [] },
  modelosSinPrecio: [],
};

/**
 * Un run como los que NACEN DEL PIPELINE: creado bajo RLS, con la marca de que la API consiguió
 * emitir `research/solicitado` (migración 0019, dato histórico) **y** en `pending_approval` —
 * la precondición real que hoy exige `registrarDecision`. Antes de este sub-proyecto bastaba con
 * la marca, porque el `approveRun` retirado no comprobaba el `status`; `registrarDecision` sí, así
 * que este helper suma el `finishRun` que le faltaba (si no, `registrarDecision` devuelve `null`
 * por el `status` y el test de la compuerta que se apoya en él prueba lo que no dice probar).
 */
async function runConWorkflow(ctx: TenantContext, clientId: string): Promise<string> {
  const runId = await store.createRun(ctx, nuevoRun(clientId));
  await store.marcarSolicitudEmitida(ctx, runId);
  await store.finishRun(ctx, runId, META_FINISH_RUN);
  return runId;
}

/**
 * Un run en `pending_approval` con UNA página aprobada — el punto de partida de `registrarDecision`.
 * Más simple que `runConWorkflow`: no marca `solicitud_emitida_at` porque `registrarDecision` no la
 * comprueba (el mecanismo viejo sí la exigía; se retiró en este sub-proyecto, ver Task 4).
 */
async function runPendienteDeAprobacion(ctx: TenantContext, clientId: string): Promise<string> {
  const runId = await store.createRun(ctx, nuevoRun(clientId));
  await store.finishRun(ctx, runId, META_FINISH_RUN);
  await store.savePages(ctx, runId, clientId, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctx, rows[0]!.id);
  return runId;
}

/** Igual que `runPendienteDeAprobacion`, pero sin aprobar ninguna página. */
async function runSinPaginasAprobadas(ctx: TenantContext, clientId: string): Promise<string> {
  const runId = await store.createRun(ctx, nuevoRun(clientId));
  await store.finishRun(ctx, runId, META_FINISH_RUN);
  await store.savePages(ctx, runId, clientId, [page()]);
  return runId;
}

// ---------------------------------------------------------------- ciclo de vida

test("store: un run nace en 'running' (si el proceso muere, se ve que quedó a medias)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  const run = await store.getRun(ctxA(), runId);

  assert.equal(run?.status, "running");
});

test("store: finishRun lo deja en pending_approval con el costo y la calidad de los datos", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  await store.finishRun(ctxA(), runId, {
    costeMicros: 310_800,
    costeBreakdown: { dataforseo_micros: 252_200 },
    calidadDatos: { cobertura_volumen: 0.71, endpoints_degradados: [] },
    modelosSinPrecio: [],
  });

  const run = await store.getRun(ctxA(), runId);
  assert.equal(run?.status, "pending_approval");
  assert.equal(run?.coste_micros_usd, 310_800);
  assert.equal((run?.calidad_datos as { cobertura_volumen: number }).cobertura_volumen, 0.71);
});

test("store: failRun registra el error en vez de dejarlo colgado en 'running'", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  await store.failRun(ctxA(), runId, "Cobertura de volumen 0%");

  const run = await store.getRun(ctxA(), runId);
  assert.equal(run?.status, "failed");
});

/*
 * 🔴 Los dos que atan la MITAD QUE FALTABA de la simetría con `failRun`.
 *
 * `failRun` es compare-and-set desde que se midió que un fallo del workflow podía deshacer una
 * publicación ya hecha. `finishRun` no lo era: `where id = $1` pelado, así que pisaba cualquier estado.
 *
 * Hoy no muerde porque nada más escribe el estado mientras el workflow vive. Pero el barrido de runs
 * colgados del bloque A2 es exactamente eso, y sin esta guarda el escenario es: el barrido marca
 * `failed` un research lento, el workflow termina cinco minutos después y lo devuelve a
 * `pending_approval` — con `finished_at` reescrito. Lo señaló la 15ª review externa sobre el DISEÑO del
 * barrido; verificarlo destapó que la mitad del bug ya estaba en el código.
 */
test("🔴 finishRun NO resucita un run que ya salió de 'running' (el barrido lo marcó failed)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.failRun(ctxA(), runId, "el barrido lo dio por colgado");

  const movio = await store.finishRun(ctxA(), runId, {
    costeMicros: 310_800,
    costeBreakdown: { dataforseo_micros: 252_200 },
    calidadDatos: { cobertura_volumen: 0.71 },
    modelosSinPrecio: [],
  });

  const run = await store.getRun(ctxA(), runId);
  assert.equal(movio, false, "finishRun tiene que DECIR que no movió el estado, no fingir que sí");
  assert.equal(run?.status, "failed", "el estado terminal es un hecho: no se pisa");
  assert.equal(
    run?.coste_micros_usd,
    310_800,
    "pero el COSTE sí se anota: el dinero se gastó de verdad, y no registrarlo lo perdería",
  );
});

test("🔴 finishRun sí mueve el estado por el camino sano (control positivo de la guarda)", async () => {
  // Sin este, una guarda que bloqueara TODO dejaría el test de arriba en verde.
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  const movio = await store.finishRun(ctxA(), runId, {
    costeMicros: 1_000,
    costeBreakdown: {},
    calidadDatos: {},
    modelosSinPrecio: [],
  });

  const run = await store.getRun(ctxA(), runId);
  assert.equal(movio, true);
  assert.equal(run?.status, "pending_approval");
});

test("store: guardar keywords dos veces NO duplica (idempotente ante un reintento)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  await store.saveKeywords(ctxA(), runId, clientA1, [kw()]);
  await store.saveKeywords(ctxA(), runId, clientA1, [kw({ volume: 400 })]);

  const { rows } = await pg.query<{ n: number; volume: number }>(
    "select count(*)::int as n, max(volume)::int as volume from kr_keywords where run_id = $1",
    [runId],
  );
  assert.equal(rows[0]!.n, 1, "una sola fila");
  assert.equal(rows[0]!.volume, 400, "con el valor actualizado");
});

test("store: se guardan TODAS las keywords, también las descartadas y las sin datos", async () => {
  // Son los datos que se le PAGARON a DataForSEO. Tirar las descartadas obliga a pagar otra
  // corrida para reajustar el scoring.
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  await store.saveKeywords(ctxA(), runId, clientA1, [
    kw(),
    kw({ keyword: "sin datos", canonical_key: "sin datos", volume: null, difficulty: null }),
    kw({ keyword: "descartada", canonical_key: "descartada", discarded: true, discard_reason: "irrelevante" }),
  ]);

  const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from kr_keywords where run_id = $1", [
    runId,
  ]);
  assert.equal(rows[0]!.n, 3);
});

test("store: un volumen ausente se guarda como NULL, no como 0", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.saveKeywords(ctxA(), runId, clientA1, [kw({ volume: null, difficulty: null })]);

  const { rows } = await pg.query<{ volume: number | null }>(
    "select volume from kr_keywords where run_id = $1",
    [runId],
  );
  assert.equal(rows[0]!.volume, null, "NULL ≠ 0: 'no sabemos' no es 'cero búsquedas'");
});

// ---------------------------------------------------------------- compuerta (ADR-06)

test("compuerta: las páginas nacen SIEMPRE sin aprobar", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);

  const { rows } = await pg.query<{ approved: boolean }>("select approved from kr_pages where run_id = $1", [
    runId,
  ]);
  assert.equal(rows[0]!.approved, false);
});

test("compuerta: no se puede aprobar un run si NINGUNA página fue aprobada", async () => {
  const runId = await runConWorkflow(ctxA(), clientA1);
  await store.savePages(ctxA(), runId, clientA1, [page()]);

  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.equal(decisionId, null, "ninguna página aprobada: no califica");
});

test("compuerta: aprobar el run NO aprueba sus páginas (la compuerta es doble)", async () => {
  const runId = await runConWorkflow(ctxA(), clientA1);
  await store.savePages(ctxA(), runId, clientA1, [page(), page({ url_slug: "/otra", cluster_id: "22222222-2222-4222-8222-222222222222" })]);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where url_slug = '/pizza-napolitana-madrid'");
  await store.approvePage(ctxA(), rows[0]!.id);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId, "setup: la decisión tiene que calificar");

  const publicables = await store.getPublishablePages(ctxA(), runId);

  assert.equal(publicables.length, 1, "solo sale la página que el humano aprobó");
  assert.equal(publicables[0]!.url_slug, "/pizza-napolitana-madrid");
});

test("compuerta: con el run SIN aprobar, ninguna página es publicable aunque esté aprobada", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);

  // Falta la mitad global de la compuerta: el run sigue en pending_approval.
  const publicables = await store.getPublishablePages(ctxA(), runId);

  assert.equal(publicables.length, 0);
});

// ------------------------------------------- la marca de solicitud emitida (0019)

/*
 * `marcarSolicitudEmitida` sigue existiendo y la API la sigue llamando sin cambios
 * (`api/src/solicitar.ts`): la marca es un hecho real ("¿la API ya emitió `research/solicitado`
 * para este run?") y `tiene_workflow` la sigue exponiendo como dato histórico. Lo que se retiró en
 * este sub-proyecto es el GATE que leía la marca para decidir si el run era aprobable
 * (`approveRun`/`RunSinWorkflowError`, ver Task 4 de
 * `docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`) — `registrarDecision` no la comprueba,
 * así que los tests que ejercitaban ese gate (y el de no-filtración de la marca a otro tenant, que
 * dependía de él) ya no tienen sujeto y se borraron con él. Este test sigue vigente: prueba
 * `marcarSolicitudEmitida` en sí, no el gate retirado.
 */

test("marcarSolicitudEmitida es idempotente y conserva la PRIMERA emisión", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  assert.equal(await store.marcarSolicitudEmitida(ctxA(), runId), true);
  const { rows: primera } = await pg.query<{ t: Date }>(
    "select solicitud_emitida_at as t from kr_runs where id = $1",
    [runId],
  );

  assert.equal(await store.marcarSolicitudEmitida(ctxA(), runId), false, "ya estaba marcado");
  const { rows: segunda } = await pg.query<{ t: Date }>(
    "select solicitud_emitida_at as t from kr_runs where id = $1",
    [runId],
  );
  assert.deepEqual(segunda[0]!.t, primera[0]!.t, "el hecho es cuándo EMPEZÓ a haber alguien escuchando");
});

test("🔴 `tiene_workflow` viaja por los TRES lectores de runs (es UNA definición de columnas)", async () => {
  // `RUN_SUMMARY_COLS` es una sola constante para getRun / listRuns / listAllRuns. Este test impide
  // que alguien agregue el campo en uno y deje los otros dos mintiendo con `undefined`.
  const sinMarca = await store.createRun(ctxA(), nuevoRun(clientA1));
  const conMarca = await runConWorkflow(ctxA(), clientA2);

  assert.equal((await store.getRun(ctxA(), sinMarca))?.tiene_workflow, false);
  assert.equal((await store.getRun(ctxA(), conMarca))?.tiene_workflow, true);

  const porCliente = await store.listRuns(ctxA(), clientA2);
  assert.equal(porCliente.find((r) => r.id === conMarca)?.tiene_workflow, true);

  const todos = await store.listAllRuns(ctxA());
  assert.equal(todos.find((r) => r.id === sinMarca)?.tiene_workflow, false);
  assert.equal(todos.find((r) => r.id === conMarca)?.tiene_workflow, true);
});

/**
 * 🔴 La 0019 NO rellena las filas que ya existen, y esa mitad ningún otro test la puede ver:
 * `aplicarMigraciones` corre sobre una base vacía, así que ahí no hay nada que rellenar y agregarle
 * un `update ... set solicitud_emitida_at = created_at` a la migración no tumbaría nada.
 *
 * Pero en producción la base PERSISTE y tiene el run de la demo en `pending_approval`. Un relleno lo
 * volvería aprobable en silencio — exactamente el bug que la 0019 cierra. Mismo patrón que
 * `seed-contrato.test.ts` usa con la 0017: migraciones hasta la N-1, sembrar, aplicar la N.
 */
test("🔴 la 0019 deja NULAS las filas que ya existían (rellenarlas las volvería publicables)", async () => {
  const otra = new PGlite();
  try {
    await asegurarAuthStandIn(otra);
    const archivos = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const hasta0018 = archivos.filter((f) => f < "0019");
    const la0019 = archivos.filter((f) => f.startsWith("0019_"));
    // Control positivo del recorte: si el filtro dejara de matchear, el test aplicaría "nada" y
    // luego "nada", y pasaría en verde sin haber ejercitado la migración.
    assert.ok(hasta0018.length >= 16, `esperaba las migraciones previas y encontré ${hasta0018.length}`);
    assert.equal(la0019.length, 1, "la 0019 tiene que ser exactamente un archivo");

    for (const f of hasta0018) await otra.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

    const { rows: t } = await otra.query<{ id: string }>(
      "insert into tenants (nombre, slug) values ('T', 't') returning id",
    );
    const { rows: c } = await otra.query<{ id: string }>(
      "insert into clients (tenant_id, nombre) values ($1, 'C') returning id",
      [t[0]!.id],
    );
    // Un run VIEJO, como el de la demo en producción: creado hace un mes y ya en la compuerta.
    const { rows: r } = await otra.query<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code, created_at)
       values ($1,$2,'kr.v0.5','pending_approval','el run sembrado de la demo','ES','es',2724,
               now() - interval '30 days')
       returning id`,
      [t[0]!.id, c[0]!.id],
    );

    await otra.exec(readFileSync(join(MIGRATIONS_DIR, la0019[0]!), "utf8"));

    const { rows } = await otra.query<{ marca: string | null }>(
      "select solicitud_emitida_at as marca from kr_runs where id = $1",
      [r[0]!.id],
    );
    assert.equal(rows.length, 1, "la fila sigue ahí");
    assert.equal(rows[0]!.marca, null, "la 0019 no puede inventar que alguien esperaba este run");
  } finally {
    await otra.close();
  }
});

// ---------------------------------------------------------------- aislamiento

/**
 * El Store escribe BAJO RLS (como `app_user`), no con la service-role. Podría haber usado la
 * service-role y "confiar" en que el código pone bien el tenant_id — pero entonces el aislamiento
 * dependería de que yo no me equivoque nunca. Estos tests prueban que lo frena Postgres.
 */
test("aislamiento: el tenant B NO ve el run del tenant A", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  const run = await store.getRun(ctxB(), runId);

  assert.equal(run, null);
});

test("aislamiento: el tenant B no puede aprobar una página del tenant A", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);

  const ok = await store.approvePage(ctxB(), rows[0]!.id);

  assert.equal(ok, false, "el update no alcanza ninguna fila");
  const { rows: after } = await pg.query<{ approved: boolean }>("select approved from kr_pages where id = $1", [
    rows[0]!.id,
  ]);
  assert.equal(after[0]!.approved, false, "y de verdad no se aprobó");
});

test("aislamiento: crear un run para un cliente de OTRO tenant falla", async () => {
  // clientB1 pertenece al tenant B. El tenant A no debería poder colgarle un run.
  await assert.rejects(() => store.createRun(ctxA(), nuevoRun(clientB1)));
});

test("aislamiento: listRuns de un cliente ajeno devuelve vacío", async () => {
  await store.createRun(ctxB(), nuevoRun(clientB1));

  const runs = await store.listRuns(ctxA(), clientB1);

  assert.equal(runs.length, 0);
});

test("RBAC: el rol 'cliente' no ve los runs de otro cliente del mismo tenant", async () => {
  const runA1 = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.createRun(ctxA(), nuevoRun(clientA2));

  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };
  const visible = await store.getRun(comoCliente, runA1);
  const runs = await store.listRuns(comoCliente, clientA2);

  assert.equal(visible?.id, runA1, "ve el suyo");
  assert.equal(runs.length, 0, "no ve el del otro cliente de la misma agencia");
});

/**
 * El bug clásico de multi-tenancy con pool de conexiones: la conexión reciclada conserva el tenant
 * del usuario anterior y el siguiente ve datos ajenos. `set local` ata el contexto a la
 * transacción, así que no sobrevive al commit.
 */
test("aislamiento: el contexto NO se filtra a la operación siguiente", async () => {
  const runA = await store.createRun(ctxA(), nuevoRun(clientA1));

  // Justo después de operar como tenant A, el tenant B no debe arrastrar su contexto.
  const visto = await store.getRun(ctxB(), runA);
  assert.equal(visto, null);

  // Y una consulta sin contexto tampoco ve nada.
  await pg.exec("begin; set local role app_user;");
  const { rows } = await pg.query("select id from kr_runs");
  await pg.exec("rollback");
  assert.equal(rows.length, 0, "sin tenant seteado no se ve NADA");
});

// ================================================================
// Regresiones de la 3ª review — tres brechas multi-tenant CRÍTICAS
// ================================================================

/**
 * OBS-02, cerrado (migración 0002).
 *
 * Antes, el rol venía en el contexto de la petición y la base le creía. Estos tres tests probaban
 * que un rol *ausente* o *inventado* no diera acceso — una allowlist positiva. Estaba bien, pero
 * seguía aceptando que un rol VÁLIDO se declarara: con un portal HTTP del otro lado, mandar
 * `role: "maestro"` era escalada de privilegios directa.
 *
 * Ahora el rol se DERIVA de `memberships` y el GUC `app.role` no lo lee nadie. Estos tests prueban
 * lo más fuerte: **declarar un rol ya no sirve absolutamente para nada.**
 */
test("🔴 OBS-02: un usuario SIN membresía no ve nada, aunque el tenant sea válido", async () => {
  await store.createRun(ctxA(), nuevoRun(clientA1));

  const intruso: TenantContext = { tenantId: tenantA, userId: "99999999-9999-4999-8999-999999999999" };
  const runs = await store.listRuns(intruso, clientA1);

  assert.equal(runs.length, 0, "sin membresía no hay rol, y sin rol no hay acceso");
});

test("🔴 OBS-02: declararse 'maestro' en la petición NO tiene ningún efecto", async () => {
  await store.createRun(ctxA(), nuevoRun(clientA1));

  // El ataque exacto que antes funcionaba: el llamador se inventa el rol.
  const seDeclaraMaestro = {
    tenantId: tenantA,
    userId: "99999999-9999-4999-8999-999999999999",
    role: "maestro",
    clientId: null,
  } as unknown as TenantContext;

  const runs = await store.listRuns(seDeclaraMaestro, clientA1);

  assert.equal(runs.length, 0, "el rol declarado se IGNORA: la base ya no lo lee");
});

test("🔴 OBS-02: un usuario del tenant A no puede mirar dentro del tenant B", async () => {
  await store.createRun(ctxB(), nuevoRun(clientB1));

  // Identidad real y válida… pero de otra agencia. No hay membresía en B.
  const cruzado: TenantContext = { tenantId: tenantB, userId: equipoA };
  const runs = await store.listRuns(cruzado, clientB1);

  assert.equal(runs.length, 0);
});

/**
 * El orquestador SÍ puede escribir los resultados — y su autoridad es la CREDENCIAL con la que se
 * conecta (`amg_orquestador` → rol `app_service`), no un campo en la petición.
 *
 * Fijate en la firma: `new PgStore(pool, "app_service")`. El rol es del STORE, no del contexto.
 * Antes venía en el `TenantContext` (`servicio: true`) y era una mentira: había un solo login, y el
 * código elegía con qué rol vestirse. Con `NOINHERIT` y un solo rol concedido por login, el login de
 * la API **no puede** hacer `set role app_service`: lo rechaza Postgres.
 */
test("el servicio (app_service) sí escribe los resultados del research", async () => {
  const runId = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));

  const run = await store.getRun(ctxA(), runId);
  assert.equal(run?.status, "running", "el orquestador abrió el run y el equipo lo ve");
});

/**
 * 🔴 LA GARANTÍA, VERIFICADA EN LA BASE.
 *
 * ADR-15 afirmaba que la autoridad del servicio era "una credencial de base de datos". Era falso:
 * `app_service` es NOLOGIN, había UN `DATABASE_URL`, y `SET ROLE` no pide contraseña — Postgres lo
 * autoriza según el `session_user`. El mismo login podía ponerse `app_user` **o** `app_service`.
 *
 * Ahora cada login está autorizado a UN SOLO rol. Este test lo comprueba contra `pg_auth_members`,
 * que es la fuente de verdad: no basta con que el código no lo intente, tiene que ser IMPOSIBLE.
 */
test("🔴 credenciales: el login de la API NO puede asumir el rol del servicio", async () => {
  /*
   * Se le pregunta a POSTGRES si puede, en vez de deducirlo yo de `pg_auth_members`.
   *
   * La versión anterior de este test leía `pg_auth_members` y comprobaba que cada login tuviera
   * exactamente un rol DIRECTO. Era insuficiente, y la mutación que lo demuestra es de una línea:
   *
   *     grant app_service to app_user;
   *
   * `pg_auth_members` seguiría diciendo exactamente lo mismo —`amg_api → app_user`,
   * `amg_orquestador → app_service`— y el test pasaría. Pero `amg_api` tendría un camino
   * TRANSITIVO hasta `app_service`.
   *
   * `pg_has_role(..., 'SET')` responde la pregunta que de verdad importa —*¿puede este login
   * asumir ese rol?*— e incluye los caminos transitivos. Es la diferencia entre comprobar mi modelo
   * del grafo de roles y comprobar **el grafo**.
   */
  const { rows: capacidad } = await pg.query<{
    api_a_servicio: boolean;
    orq_a_usuario: boolean;
    api_a_usuario: boolean;
    orq_a_servicio: boolean;
    cache_a_usuario: boolean;
    cache_a_servicio: boolean;
  }>(
    `select
       pg_has_role('amg_api',         'app_service', 'SET') as api_a_servicio,
       pg_has_role('amg_orquestador', 'app_user',    'SET') as orq_a_usuario,
       pg_has_role('amg_api',         'app_user',    'SET') as api_a_usuario,
       pg_has_role('amg_orquestador', 'app_service', 'SET') as orq_a_servicio,
       pg_has_role('amg_cache',       'app_user',    'SET') as cache_a_usuario,
       pg_has_role('amg_cache',       'app_service', 'SET') as cache_a_servicio`,
  );
  const c = capacidad[0]!;

  // Lo que TIENE que ser imposible — por cualquier camino, directo o transitivo.
  assert.equal(c.api_a_servicio, false, "🔴 la API NO puede asumir el rol del servicio");
  assert.equal(c.orq_a_usuario, false, "🔴 el orquestador NO puede asumir el rol del humano");
  assert.equal(c.cache_a_usuario, false, "🔴 el login de la cache no toca datos de tenant");
  assert.equal(c.cache_a_servicio, false, "🔴 el login de la cache no toca datos de tenant");

  // Y lo que tiene que SÍ funcionar: si no, la separación sería inútil (nadie podría trabajar).
  assert.equal(c.api_a_usuario, true, "la API sí puede ser app_user");
  assert.equal(c.orq_a_servicio, true, "el orquestador sí puede ser app_service");

  // NOINHERIT: sin él, el login tendría los privilegios sin siquiera hacer `set role`, y
  // `reset role` se los devolvería.
  const { rows: inherit } = await pg.query<{ rolname: string; rolinherit: boolean }>(
    "select rolname, rolinherit from pg_roles where rolname in ('amg_api','amg_orquestador','amg_cache')",
  );
  assert.equal(inherit.length, 3, "los tres logins existen");
  for (const r of inherit) {
    assert.equal(r.rolinherit, false, `${r.rolname} debe ser NOINHERIT`);
  }
});

/**
 * RLS es POR TABLA: la política del padre NO protege al hijo. `kr_runs` filtraba por cliente pero
 * `kr_keywords` y `kr_pages` solo por tenant, así que el dueño de un restaurante podía hacer
 * `select * from kr_keywords` y leerse el research, la estrategia y el contenido de TODOS los
 * negocios de la agencia. El test viejo solo probaba tenant A contra tenant B.
 */
test("🔴 el rol 'cliente' NO puede leer keywords de otro cliente del MISMO tenant", async () => {
  const runOtro = await store.createRun(ctxA(), nuevoRun(clientA2));
  await store.saveKeywords(ctxA(), runOtro, clientA2, [kw()]);

  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };
  const filas = await leerKeywordsCrudo(pool, comoCliente);

  assert.equal(filas.length, 0, "el research del vecino NO se ve");
});

test("🔴 el rol 'cliente' NO puede leer páginas de otro cliente del MISMO tenant", async () => {
  const runOtro = await store.createRun(ctxA(), nuevoRun(clientA2));
  await store.savePages(ctxA(), runOtro, clientA2, [page()]);

  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };
  const filas = await leerPaginasCrudo(pool, comoCliente);

  assert.equal(filas.length, 0, "el contenido y los claims del vecino NO se ven");
});

/**
 * `app_user` tenía `insert/update/delete` sobre `memberships`: un usuario con rol 'cliente' podía
 * insertarse una membresía de 'maestro' y escalar privilegios. Ahora memberships es SOLO LECTURA
 * desde la app (crear membresías es administración: va por el backend con service-role).
 */
test("🔴 escalada de privilegios: un 'cliente' NO puede crearse una membresía de maestro", async () => {
  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };

  await assert.rejects(
    () =>
      sqlCrudo(
        pool,
        comoCliente,
        "insert into memberships (tenant_id, user_id, rol) values ($1, gen_random_uuid(), 'maestro')",
        [tenantA],
      ),
    /permission denied/i,
  );
});

test("🔴 el rol 'cliente' es de SOLO LECTURA: no puede crear runs facturables", async () => {
  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };

  await assert.rejects(() => store.createRun(comoCliente, nuevoRun(clientA1)));
});

test("🔴 no se puede crear un run facturable a nombre de OTRO cliente del tenant", async () => {
  // Con rol 'cliente' atado a clientA1, intentar cargarle un run a clientA2.
  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };

  await assert.rejects(() => store.createRun(comoCliente, nuevoRun(clientA2)));
});

// ---------------------------------------------------------------- #9 aprobación

test("compuerta: un upsert que CAMBIA el contenido REVOCA la aprobación", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);

  // El orquestador reescribe la página con contenido distinto (recalibración, reintento tardío).
  await store.savePages(ctxA(), runId, clientA1, [page({ keyword_principal: "otra keyword" })]);

  const { rows: after } = await pg.query<{ approved: boolean }>(
    "select approved from kr_pages where run_id = $1",
    [runId],
  );
  assert.equal(after[0]!.approved, false, "el humano aprobó OTRA cosa: hay que volver a revisar");
});

// ================================================================
// #4 (HIGH, 3ª review) — el contexto de tenant y la conexión
// ================================================================

/**
 * El escenario que el orquestador CREA por diseño: dos runs de tenants distintos a la vez.
 *
 * La versión anterior hacía `begin`, tres `set_config` y el `insert` como cuatro llamadas sueltas a
 * un `Db` compartido. Con dos operaciones solapadas, el `set_config` de B pisaba el contexto de A
 * antes de que A insertara: el `with check` de RLS comparaba el `tenant_id` de la fila (A) contra el
 * contexto vigente (B) y reventaba — o, con otro entrelazado, escribía en el tenant equivocado.
 * Contra un `pg.Pool` real es peor todavía: el `insert` se va a OTRA conexión, sin transacción,
 * sin tenant y sin `set local role app_user`, o sea con el rol del pool, que SALTA RLS.
 *
 * Con `DbPool.transaction()` cada operación reserva su conexión: no hay contexto que pisar.
 */
test("🔴 concurrencia: 20 runs de dos tenants a la vez, cada uno cae donde debe", async () => {
  const trabajos = Array.from({ length: 20 }, (_, i) =>
    i % 2 === 0
      ? store.createRun(ctxA(), nuevoRun(clientA1)).then((id) => ({ id, tenant: tenantA, client: clientA1 }))
      : store.createRun(ctxB(), nuevoRun(clientB1)).then((id) => ({ id, tenant: tenantB, client: clientB1 })),
  );

  const creados = await Promise.all(trabajos);

  for (const c of creados) {
    const { rows } = await pg.query<{ tenant_id: string; client_id: string }>(
      "select tenant_id, client_id from kr_runs where id = $1",
      [c.id],
    );
    assert.equal(rows[0]?.tenant_id, c.tenant, "el run cayó en el tenant de OTRO");
    assert.equal(rows[0]?.client_id, c.client);
  }
});

/**
 * El contexto es `set local`: muere con la transacción. Si sobreviviera al commit, la conexión que
 * vuelve al pool llevaría pegado el tenant del usuario anterior y la petición siguiente —de otro
 * cliente— leería sus datos.
 */
test("🔴 el contexto no sobrevive al commit: la conexión vuelve al pool limpia", async () => {
  await store.createRun(ctxA(), nuevoRun(clientA1));

  // Misma conexión (PGlite tiene una sola), transacción nueva, sin setear contexto.
  const huerfano = await pg.transaction(async (tx) => {
    await tx.exec("set local role app_user");
    const r = await tx.query<{ id: string }>("select id from kr_runs");
    return r.rows;
  });

  assert.equal(huerfano.length, 0, "sin contexto no se ve NADA: el tenant anterior no quedó pegado");
});

test("compuerta: un reintento IDÉNTICO conserva la aprobación (no molesta al revisor)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);

  await store.savePages(ctxA(), runId, clientA1, [page()]); // exactamente lo mismo

  const { rows: after } = await pg.query<{ approved: boolean }>(
    "select approved from kr_pages where run_id = $1",
    [runId],
  );
  assert.equal(after[0]!.approved, true, "nada cambió: la aprobación sigue valiendo");
});

// ================================================================
// Regresiones de la 4ª review
// ================================================================

/**
 * 🔴 UNA PÁGINA QUE EL RESEARCH YA NO PROPONE SEGUÍA SIENDO PUBLICABLE.
 *
 * `savePages()` solo hacía upsert de las páginas PRESENTES. Si una recalibración del clustering
 * disolvía una página —o le cambiaba el slug—, la fila vieja se quedaba **con su aprobación
 * intacta**, y `getPublishablePages()` la devolvía. Se publicaba contenido aprobado para una versión
 * anterior del brief, que el research actual ya no respalda.
 */
test("🔴 una página que desaparece del research deja de ser publicable (se retira)", async () => {
  const runId = await runConWorkflow(ctxA(), clientA1);
  await store.savePages(ctxA(), runId, clientA1, [
    page(),
    page({ url_slug: "/menu-del-dia", cluster_id: "22222222-2222-4222-8222-222222222222" }),
  ]);

  // El humano aprueba las dos, y el run.
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctxA(), r.id);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId, "setup: la decisión tiene que calificar");

  // Recalibración: el research ya NO propone /menu-del-dia.
  await store.savePages(ctxA(), runId, clientA1, [page()]);

  const publicables = await store.getPublishablePages(ctxA(), runId);

  assert.equal(publicables.length, 1, "la página retirada NO sale, aunque estuviera aprobada");
  assert.equal(publicables[0]!.url_slug, "/pizza-napolitana-madrid");
});

/** Un research que no propone NADA tiene que retirar todo, no dejar lo viejo publicable. */
test("🔴 un research sin páginas RETIRA las anteriores (no las deja aprobadas)", async () => {
  const runId = await runConWorkflow(ctxA(), clientA1);
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId, "setup: la decisión tiene que calificar");

  await store.savePages(ctxA(), runId, clientA1, []); // el research ya no propone nada

  assert.equal((await store.getPublishablePages(ctxA(), runId)).length, 0);
});

/**
 * El `where` del upsert comparaba solo 9 campos: faltaban cluster_id, keywords_secundarias, local,
 * opportunity_score y score_confidence. Un cambio SOLO en esos campos no se persistía (la fila
 * quedaba vieja) NI revocaba la aprobación.
 */
test("🔴 un cambio en el score también revoca la aprobación (el WHERE estaba incompleto)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);

  await store.savePages(ctxA(), runId, clientA1, [page({ opportunity_score: 12 })]);

  const { rows: after } = await pg.query<{ approved: boolean; opportunity_score: string }>(
    "select approved, opportunity_score from kr_pages where run_id = $1",
    [runId],
  );
  assert.equal(Number(after[0]!.opportunity_score), 12, "el cambio SÍ se persiste");
  assert.equal(after[0]!.approved, false, "y revoca la aprobación: el humano aprobó otro score");
});

/**
 * 🔴 `onFailure` PODÍA MARCAR `failed` UN RUN YA PUBLICADO.
 *
 * Escenario real: Storyblok publica, la respuesta se pierde, el step se reintenta y acaba fallando.
 * `failRun()` ponía el run en `failed`… con las páginas ya visibles en internet. Un fallo del
 * workflow no puede deshacer un hecho del mundo: solo se pisa el estado si SEGUÍA corriendo.
 */
test("🔴 failRun NO pisa un run ya aprobado (el fallo no deshace lo publicado)", async () => {
  const runId = await runConWorkflow(ctxA(), clientA1);
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId, "setup: la decisión tiene que calificar");

  const cambio = await store.failRun(ctxA(), runId, "Storyblok devolvió 500 al reintentar");

  assert.equal(cambio, false, "no se cambió el estado");
  const run = await store.getRun(ctxA(), runId);
  assert.equal(run?.status, "approved", "la aprobación humana sobrevive al fallo del workflow");
});

test("failRun SÍ marca failed un run que seguía corriendo", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  const cambio = await store.failRun(ctxA(), runId, "Cobertura de volumen 0%");

  assert.equal(cambio, true);
  assert.equal((await store.getRun(ctxA(), runId))?.status, "failed");
});

// ================================================================
// KR-3 — el ORDEN del brief (migración 0015)
//
// `kr-service` ordena en dos niveles (evidencia primero, después el score ponderado por
// `score_confidence`) y ese orden gobierna QUÉ páginas existen. La base lo deshacía: `order by
// opportunity_score desc`. Un criterio de orden que no está en una columna se pierde al pasar por
// Postgres.
//
// El contrato: **el orden ES la posición en el array que recibe `savePages`.**
// ================================================================

/**
 * Un brief cuyo orden CONTRADICE el `opportunity_score`, que es el caso real: una página sin validar
 * puede tener un score alto y aun así no puede presentarse por encima de una respaldada por datos de
 * mercado. Si los dos órdenes coincidieran, el test pasaría igual con el `order by` viejo.
 */
const briefDosNiveles = (): PageRow[] => [
  page({
    url_slug: "/respaldada-score-bajo",
    cluster_id: "aaaaaaaa-1111-4111-8111-111111111111",
    evidencia: "datos_mercado",
    opportunity_score: 40,
  }),
  page({
    url_slug: "/sin-validar-score-alto",
    cluster_id: "aaaaaaaa-2222-4222-8222-222222222222",
    evidencia: "sin_validar",
    opportunity_score: 90,
    score_confidence: 0.25,
  }),
  page({
    url_slug: "/sin-validar-score-medio",
    cluster_id: "aaaaaaaa-3333-4333-8333-333333333333",
    evidencia: "sin_validar",
    opportunity_score: 70,
    score_confidence: 0.25,
  }),
];

const ORDEN_DEL_BRIEF = [
  "/respaldada-score-bajo",
  "/sin-validar-score-alto",
  "/sin-validar-score-medio",
];

test("🔴 getRunPages devuelve el orden DEL BRIEF, no el del opportunity_score", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, briefDosNiveles());

  const pages = await store.getRunPages(ctxA(), runId);

  assert.deepEqual(
    pages.map((p) => p.url_slug),
    ORDEN_DEL_BRIEF,
    "por score sería 90/70/40: la base estaría deshaciendo el orden de dos niveles del M2",
  );
  assert.deepEqual(pages.map((p) => p.orden_brief), [0, 1, 2], "0 = primera");
  assert.equal(typeof pages[0]!.orden_brief, "number", "un entero, no el string de un numeric");
});

test("🔴 getPublishablePages también publica en el orden del brief", async () => {
  const runId = await runConWorkflow(ctxA(), clientA1);
  await store.savePages(ctxA(), runId, clientA1, briefDosNiveles());
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctxA(), r.id);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(decisionId, "setup: la decisión tiene que calificar");

  const publicables = await store.getPublishablePages(ctxA(), runId);

  assert.deepEqual(publicables.map((p) => p.url_slug), ORDEN_DEL_BRIEF);
});

/**
 * 🔴 LA RESTRICCIÓN DURA DE KR-3: `orden_brief` **no es material**.
 *
 * Revocar una aprobación porque una página subió del puesto 2 al 1 sería absurdo — el humano aprobó
 * ESA página, no su posición. Pero el `where` del upsert bloquea el update entero cuando nada
 * material cambió, así que meter `orden_brief` en el `set` no habría bastado: el orden nuevo no se
 * escribiría. Y meterlo en el `where` revocaría aprobaciones por un cambio de orden.
 *
 * Las dos mitades se prueban acá, y las dos mutaciones son de una línea (ver el informe).
 */
test("🔴 un reintento que SOLO cambia el orden actualiza el orden y NO revoca la aprobación", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  const [primera, segunda, tercera] = briefDosNiveles() as [PageRow, PageRow, PageRow];
  await store.savePages(ctxA(), runId, clientA1, [primera, segunda, tercera]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctxA(), r.id);

  // Mismísimas páginas, permutadas: es lo que produce un recalibrado del orden sin tocar contenido.
  await store.savePages(ctxA(), runId, clientA1, [tercera, primera, segunda]);

  const pages = await store.getRunPages(ctxA(), runId);
  assert.deepEqual(
    pages.map((p) => p.url_slug),
    ["/sin-validar-score-medio", "/respaldada-score-bajo", "/sin-validar-score-alto"],
    "el orden nuevo SÍ se persiste, aunque nada material haya cambiado",
  );
  assert.ok(
    pages.every((p) => p.approved),
    "y ninguna aprobación se revoca: la posición no es lo que el humano certificó",
  );
});

/** La otra mitad del contrato: lo material sigue revocando, y el orden se actualiza igual. */
test("🔴 un reintento con contenido material distinto SÍ revoca, y el orden se actualiza igual", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  const [primera, segunda] = briefDosNiveles() as [PageRow, PageRow, PageRow];
  await store.savePages(ctxA(), runId, clientA1, [primera, segunda]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctxA(), r.id);

  // La segunda cambia de keyword (material). El orden que se guarda sigue contradiciendo al score
  // (40 antes que 90), para que la mitad de orden de este test no pase por casualidad.
  await store.savePages(ctxA(), runId, clientA1, [
    primera,
    { ...segunda, keyword_principal: "otra keyword" },
  ]);

  const pages = await store.getRunPages(ctxA(), runId);
  assert.deepEqual(pages.map((p) => p.url_slug), ["/respaldada-score-bajo", "/sin-validar-score-alto"]);
  assert.equal(pages[0]!.approved, true, "la que no cambió conserva su aprobación");
  assert.equal(pages[1]!.approved, false, "cambió el contenido: hay que volver a mirarla");
});

/**
 * La reconciliación: una página que el research dejó de proponer no tiene posición en el brief, y si
 * vuelve a proponerse recupera la que le toque — no la que tenía en el brief anterior.
 */
test("una página retirada pierde su posición, y al volver a proponerse recupera una coherente", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  const [primera, segunda, tercera] = briefDosNiveles() as [PageRow, PageRow, PageRow];
  await store.savePages(ctxA(), runId, clientA1, [primera, segunda, tercera]);

  // El clustering disuelve la primera: quedan dos, renumeradas.
  await store.savePages(ctxA(), runId, clientA1, [segunda, tercera]);
  const { rows: retirada } = await pg.query<{ orden_brief: number | null; retirada: boolean }>(
    "select orden_brief, retirada from kr_pages where run_id = $1 and url_slug = $2",
    [runId, "/respaldada-score-bajo"],
  );
  assert.equal(retirada[0]!.retirada, true);
  assert.equal(retirada[0]!.orden_brief, null, "retirada = no está en el brief, así que no tiene posición");
  assert.deepEqual(
    (await store.getRunPages(ctxA(), runId)).map((p) => p.orden_brief),
    [0, 1],
    "las que quedan se renumeran desde 0: la posición es del brief actual",
  );

  // Vuelve a proponerse, ahora en el medio.
  await store.savePages(ctxA(), runId, clientA1, [segunda, primera, tercera]);

  const pages = await store.getRunPages(ctxA(), runId);
  assert.deepEqual(pages.map((p) => p.url_slug), [
    "/sin-validar-score-alto",
    "/respaldada-score-bajo",
    "/sin-validar-score-medio",
  ]);
  assert.deepEqual(pages.map((p) => p.orden_brief), [0, 1, 2]);
});

/**
 * Las filas escritas ANTES de la 0015 (el seed ya sembrado, la base desplegada) tienen `orden_brief`
 * NULL, y tienen que caer al final. Y sin un desempate total, dos filas viejas con el mismo score
 * saldrían en orden indefinido: un test intermitente esperando a pasar.
 *
 * **Qué muerde y qué no**, medido: **quitar el `nulls last` de `ORDEN_DEL_BRIEF` no tumba este test**,
 * porque `nulls last` ya es el default de Postgres para `asc`. Lo que sí lo tumba es cambiarlo por
 * `nulls first`, y esa es la mutación con la que se verifica. El test es válido —detecta que los NULL
 * se ordenen mal— pero no prueba que ese texto haga falta: prueba el comportamiento, no la línea.
 */
test("🔴 las filas sin orden_brief (previas a la 0015) caen al final, y el desempate es total", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [briefDosNiveles()[0]!]);

  // Dos filas "viejas": sin orden_brief y con el MISMO score, para que el desempate tenga que
  // resolverlo url_slug y no el azar del plan de ejecución.
  for (const slug of ["/vieja-b", "/vieja-a"]) {
    await pg.query(
      `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                             keyword_principal, intencion, evidencia, opportunity_score)
       values ($1, $2, $3, gen_random_uuid(), 'blog', $4, 'kw', 'informational', 'sin_validar', 99)`,
      [tenantA, runId, clientA1, slug],
    );
  }

  const pages = await store.getRunPages(ctxA(), runId);

  assert.deepEqual(
    pages.map((p) => p.url_slug),
    ["/respaldada-score-bajo", "/vieja-a", "/vieja-b"],
    "la que tiene posición va primera aunque su score sea 40 contra 99; el empate lo rompe el slug",
  );
});

/** Una posición negativa no es un dato raro, es un dato roto: lo rechaza la base, no la aplicación. */
test("🔴 la base rechaza una posición negativa (check de la 0015)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  await assert.rejects(
    () =>
      pg.query(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                               keyword_principal, intencion, evidencia, orden_brief)
         values ($1, $2, $3, gen_random_uuid(), 'blog', '/negativa', 'kw', 'informational',
                 'sin_validar', -1)`,
        [tenantA, runId, clientA1],
      ),
    /orden_brief/,
    "el 23514 lo tira el check, no un if de TypeScript",
  );
});

/**
 * 🔴 Una página RETIRADA no puede tener posición, y lo impone el esquema — no la sentencia que la retira.
 *
 * `savePages` anula `orden_brief` en la misma sentencia que pone `retirada = true`, así que hoy el
 * invariante se cumple. Pero eso es una garantía que sostiene UN sitio del código: cualquier `update`
 * futuro que retire una página por otra vía (una purga, un endpoint de "descartar") lo rompería sin que
 * nada avisara, y el síntoma sería una retirada ocupando el puesto de una página viva.
 *
 * Es decidible mirando UNA fila, así que va en un `check` — el mismo criterio con el que la 0015 razona
 * el `>= 0`.
 */
test("🔴 la base rechaza una retirada CON posición (check de la 0015)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));

  await assert.rejects(
    () =>
      pg.query(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                               keyword_principal, intencion, evidencia, retirada, orden_brief)
         values ($1, $2, $3, gen_random_uuid(), 'blog', '/retirada-con-puesto', 'kw', 'informational',
                 'sin_validar', true, 3)`,
        [tenantA, runId, clientA1],
      ),
    /retirada_sin_posicion/,
    "lo tira el check nombrado, no un if de TypeScript",
  );
});

/**
 * 🔴 `savePages` bloquea la fila del run antes de escribir, y si no puede, no escribe nada.
 *
 * El motivo de fondo es la **serialización** de dos `savePages` concurrentes del mismo run (13ª review
 * externa): en READ COMMITTED ninguna reconciliación ve las filas no confirmadas de la otra, así que
 * quedaría la unión de dos briefs con posiciones repetidas. **Esa propiedad no se puede probar acá** —
 * PGlite serializa todas sus transacciones sobre una conexión, así que la carrera es invisible para
 * esta batería, y decirlo es parte del arreglo: un test que no puede fallar es peor que ninguno.
 *
 * Lo que este test sí fija es el contrato observable del bloqueo: **si el run no se puede bloquear, no
 * se escribe nada, y el error lo dice.** Antes esto fallaba más abajo con el 23503 de la FK compuesta,
 * que la API traduce a "revisá clientId, market y los campos obligatorios": un 400 que culpa al
 * payload cuando el problema es el run.
 */
test("🔴 savePages no escribe nada si el run no existe o es de otro tenant", async () => {
  const inexistente = "99999999-9999-4999-8999-999999999999";
  await assert.rejects(
    () => store.savePages(ctxA(), inexistente, clientA1, [page()]),
    /no existe o no es visible/,
    "falla nombrando el run, no el payload",
  );

  // Un run REAL de otro tenant: bajo RLS no se ve, así que da el MISMO error. Que no se distinga es
  // deliberado — decir "existe pero no es tuyo" ya es filtrar información.
  const { rows: otroTenant } = await pg.query<{ id: string }>(
    `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country,
                          market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'ajeno', 'ES', 'es', 2724) returning id`,
    [tenantB, clientB1],
  );
  await assert.rejects(
    () => store.savePages(ctxA(), otroTenant[0]!.id, clientA1, [page()]),
    /no existe o no es visible/,
  );

  // Y no quedó ni una página escrita en el run ajeno.
  const { rows: n } = await pg.query<{ n: string }>(
    "select count(*)::text as n from kr_pages where run_id = $1",
    [otroTenant[0]!.id],
  );
  assert.equal(n[0]!.n, "0");
});

/**
 * 🔴 Un brief con DOS páginas al mismo `url_slug` se rechaza entero, y no se colapsa en silencio.
 *
 * Medido antes de imponerlo: con `[{/dup}, {/otra}, {/dup}]` el resultado era
 * `[['/otra', 1], ['/dup', 2]]` — **tres cosas mal a la vez**. No existía la posición 0; el brief
 * arrancaba en 1; y `/dup`, que era el índice 0 del array, terminaba DESPUÉS de `/otra`, que era el 1.
 * La causa es que `update … from unnest(...)` matchea la fila dos veces y Postgres usa una de las dos
 * filas de origen **sin garantizar cuál**: ni siquiera es reproducible por contrato.
 *
 * Y el síntoma es el invariante que KR-3 vino a proteger: una página `datos_mercado` puede acabar por
 * debajo de una `sin_validar`.
 *
 * Se rechaza en vez de deduplicar porque **no hay una respuesta correcta que adivinar**: dos páginas al
 * mismo slug se pisarían una a la otra al publicar (`url_slug` es la URL). Un brief así está roto en
 * origen, y un run `failed` con el motivo escrito es mejor que publicar en silencio una página menos de
 * las que el revisor aprobó. La precondición vivía sin dueño en otro paquete (`kr-service` genera los
 * slugs); ahora la impone quien la necesita.
 */
test("🔴 savePages rechaza un brief con url_slug repetido, en vez de perder una posición", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  const [primera, segunda] = briefDosNiveles();

  await assert.rejects(
    () =>
      store.savePages(ctxA(), runId, clientA1, [
        primera!,
        segunda!,
        page({ url_slug: primera!.url_slug, cluster_id: "bbbbbbbb-9999-4999-8999-999999999999" }),
      ]),
    /url_slug repetido/,
    "el brief se rechaza entero: nada a medias",
  );

  // Y no dejó nada escrito: el rechazo es antes de tocar la base.
  assert.deepEqual(await store.getRunPages(ctxA(), runId), []);
});

/**
 * El rol que corre en PRODUCCIÓN es `app_service` (el orquestador: `orchestrator/src/deps.ts` construye
 * `new PgStore(cx.orquestador, "app_service")`), no el `app_user` con el que corren los demás tests de
 * este archivo. Sin este test, todo KR-3 estaría probado con un rol que en prod no escribe briefs
 * nunca — y los grants de `app_service` son de tabla, no por columna, así que la columna nueva podría
 * haber quedado fuera sin que nada avisara.
 *
 * Incluye una PERMUTACIÓN pura, que es el caso que un `unique (run_id, orden_brief)` habría reventado.
 */
test("🔴 savePages escribe el orden también como app_service, el rol que corre en producción", async () => {
  const servicio = new PgStore(new PglitePool(pg), "app_service");
  const runId = await servicio.createRun(ctxA(), nuevoRun(clientA1));

  const [primera, segunda] = briefDosNiveles();
  await servicio.savePages(ctxA(), runId, clientA1, [primera!, segunda!]);
  assert.deepEqual(
    (await servicio.getRunPages(ctxA(), runId)).map((p) => [p.url_slug, p.orden_brief]),
    [[primera!.url_slug, 0], [segunda!.url_slug, 1]],
  );

  // Permutación pura: las dos cambian de puesto en UNA sentencia.
  await servicio.savePages(ctxA(), runId, clientA1, [segunda!, primera!]);
  assert.deepEqual(
    (await servicio.getRunPages(ctxA(), runId)).map((p) => [p.url_slug, p.orden_brief]),
    [[segunda!.url_slug, 0], [primera!.url_slug, 1]],
    "permutar posiciones no puede fallar: es por qué la 0015 no lleva unique (run_id, orden_brief)",
  );
});

/** Publicar es un hecho externo: queda registrado por página, con su id de story. */
test("marcarPublicadas registra el hecho externo (story_id + cuándo)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);

  await store.marcarPublicadas(ctxA(), runId, [
    { slug: "/pizza-napolitana-madrid", storyId: "story-123" },
  ]);

  const { rows } = await pg.query<{ storyblok_story_id: string; published_at: string }>(
    "select storyblok_story_id, published_at from kr_pages where run_id = $1",
    [runId],
  );
  assert.equal(rows[0]!.storyblok_story_id, "story-123");
  assert.ok(rows[0]!.published_at, "queda la marca temporal");
});

// =============================================================================
// El barrido de runs colgados (migración 0018)
//
// El modelo de amenaza acá no es un atacante: es el silencio. Un run que se queda en `running` para
// siempre no da error en ningún lado — el portal muestra "en curso" y nadie se entera. Por eso los
// tests que importan son los NEGATIVOS (qué NO toca el barrido) y el cross-tenant (que de verdad
// cruza), no el camino feliz.
// =============================================================================

/** Envejece un run a mano: `createRun` siempre lo pone en `now()`, y acá la edad es el dato. */
const envejecer = async (runId: string, edad: string) => {
  await pg.query("update kr_runs set created_at = now() - $2::interval where id = $1", [runId, edad]);
};

const estadoDe = async (runId: string) => {
  const { rows } = await pg.query<{ status: string; error: string | null; fin: boolean }>(
    "select status, error, finished_at is not null as fin from kr_runs where id = $1",
    [runId],
  );
  return rows[0]!;
};

test("barrido: un run 'running' VIEJO se marca failed y sale en la lista", async () => {
  const runId = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  await envejecer(runId, "5 hours");

  const expirados = await storeServicio.expirarRunsColgados("3 hours");

  assert.deepEqual(
    expirados,
    [{ id: runId, tenantId: tenantA }],
    "devuelve el id CON su tenant: el orquestador no tiene contexto para deducirlo",
  );
  const run = await estadoDe(runId);
  assert.equal(run.status, "failed");
  assert.equal(run.fin, true, "finished_at es el sello de la transición");
  assert.match(run.error ?? "", /barrido/i, "el error dice QUIÉN lo mató, o hay que adivinarlo");
});

/*
 * El test que de verdad puede caer. Sin `created_at <` en la función, el barrido mata cualquier run
 * vivo — incluido el research que arrancó hace un minuto y ya se le pagó a DataForSEO.
 */
test("barrido: un run 'running' RECIENTE no se toca", async () => {
  const viejo = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  await envejecer(viejo, "5 hours");
  const reciente = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA2));
  await envejecer(reciente, "2 minutes");

  const expirados = await storeServicio.expirarRunsColgados("3 hours");

  // Control positivo: si el barrido no expirara NADA, este assert de abajo pasaría solo.
  assert.deepEqual(expirados.map((e) => e.id), [viejo], "expira el viejo y SOLO el viejo");
  assert.equal((await estadoDe(reciente)).status, "running", "el run vivo sigue vivo");
});

/*
 * Un estado terminal NO es un run colgado. `pending_approval` es un run que TERMINÓ y espera a un
 * humano (hasta `PLAZO_APROBACION`, 7 días): expirarlo por antigüedad borraría la compuerta humana.
 */
test("barrido: los estados que NO son 'running' quedan intactos aunque sean viejísimos", async () => {
  const esperando = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  await storeServicio.finishRun(ctxServicio(), esperando, {
    costeMicros: 310_800,
    costeBreakdown: {},
    calidadDatos: {},
    modelosSinPrecio: [],
  });
  await envejecer(esperando, "9 days");

  const aprobado = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA2));
  await pg.query("update kr_runs set status = 'approved' where id = $1", [aprobado]);
  await envejecer(aprobado, "9 days");

  const expirados = await storeServicio.expirarRunsColgados("3 hours");

  assert.deepEqual(expirados, [], "ni el que espera aprobación ni el aprobado son runs colgados");
  assert.equal((await estadoDe(esperando)).status, "pending_approval");
  assert.equal((await estadoDe(aprobado)).status, "approved");
});

/**
 * 🔴 LO ÚNICO QUE PRUEBA QUE LA `security definer` SIRVE PARA LO QUE EXISTE.
 *
 * RLS en `kr_runs` exige `tenant_id = app.current_tenant_id()`, y un barrido es cross-tenant por
 * naturaleza. Sin este test, la función podría estar filtrando por tenant —o el `security definer`
 * podría estar frenado por FORCE RLS, que es lo que pasaría en producción si la función perteneciera
 * al dueño de la tabla— y todos los tests de arriba seguirían en verde: usan un solo tenant.
 */
test("🔴 barrido: expira los runs colgados de TODOS los tenants, no solo los del contexto", async () => {
  const runA = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  const runB = await storeServicio.createRun({ tenantId: tenantB }, nuevoRun(clientB1));
  await envejecer(runA, "5 hours");
  await envejecer(runB, "5 hours");

  const expirados = await storeServicio.expirarRunsColgados("3 hours");

  // Comparar dos listas vacías pasa y no prueba nada: primero se exige que haya DOS.
  assert.equal(expirados.length, 2, "los dos tenants tienen un run colgado y los dos se expiran");
  assert.deepEqual(
    [...expirados].sort((x, y) => x.id.localeCompare(y.id)),
    [{ id: runA, tenantId: tenantA }, { id: runB, tenantId: tenantB }].sort((x, y) =>
      x.id.localeCompare(y.id),
    ),
    "cada id viaja con SU tenant",
  );
  assert.equal((await estadoDe(runA)).status, "failed");
  assert.equal((await estadoDe(runB)).status, "failed", "🔴 el run del OTRO tenant también se expira");
});

/**
 * 🔴 El grant, probado. `app.expirar_runs_colgados` es el ÚNICO privilegio cross-tenant del sistema:
 * si la API pudiera llamarlo, cualquier bug de ruta se convertiría en "marcar failed los runs de toda
 * la plataforma".
 *
 * Se exige el RECHAZO del motor (42501), no cero filas: en Postgres `execute` es de PUBLIC por
 * defecto, así que sin el `revoke execute ... from public` de la 0018 esto pasa. Medido.
 */
test("🔴 barrido: la API (app_user) NO puede ejecutar la función del barrido", async () => {
  const runId = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  await envejecer(runId, "5 hours");

  await assert.rejects(
    () => store.expirarRunsColgados("3 hours"),
    /permission denied for function/i,
    "🔴 el rol de la API no tiene execute sobre el barrido",
  );
  assert.equal((await estadoDe(runId)).status, "running", "y no llegó a tocar nada");
});

/**
 * 🔴 `app_barrido` existe solo como DUEÑO de la función. Si algún login pudiera asumirlo, el rol
 * dejaría de ser "el cuerpo de una función" y pasaría a ser una credencial cross-tenant.
 *
 * Se le pregunta a Postgres con `pg_has_role(..., 'SET')` y no a `pg_auth_members`, por lo mismo que
 * el test de credenciales de más arriba: la pregunta es sobre el GRAFO, no sobre mi modelo del grafo.
 */
test("🔴 barrido: ningún login puede asumir app_barrido, y el rol no ve datos de cliente", async () => {
  const { rows } = await pg.query<{ login: string; puede: boolean }>(
    `select rolname as login, pg_has_role(rolname, 'app_barrido', 'SET') as puede
       from pg_roles where rolname in ('amg_api','amg_orquestador','amg_cache','amg_render')`,
  );
  assert.equal(rows.length, 4, "los cuatro logins existen (si no, este test no comprueba nada)");
  for (const r of rows) assert.equal(r.puede, false, `🔴 ${r.login} NO puede asumir app_barrido`);

  const { rows: attr } = await pg.query<{ rolcanlogin: boolean; rolbypassrls: boolean; rolsuper: boolean }>(
    "select rolcanlogin, rolbypassrls, rolsuper from pg_roles where rolname = 'app_barrido'",
  );
  assert.deepEqual(
    attr[0],
    { rolcanlogin: false, rolbypassrls: false, rolsuper: false },
    "🔴 sin login y sin bypassrls: su permiso es una POLÍTICA auditable, no un privilegio implícito",
  );

  // Y lo que el rol puede leer por su cuenta: nada del negocio. `prompt` es dato del cliente.
  await pg.exec("begin");
  await pg.exec("set local role app_barrido");
  await assert.rejects(
    () => pg.query("select prompt from kr_runs"),
    /permission denied/i,
    "🔴 el grant por columna deja fuera el prompt del cliente",
  );
  await pg.exec("rollback");
});

/**
 * 🔴 LA GARANTÍA QUE ESTE PAQUETE NO PUEDE PROBAR EJECUTANDO NADA. Se prueba mirando el catálogo, y
 * ése es el único modo honesto.
 *
 * En PGlite las migraciones corren como `postgres`, que ahí **sí es superusuario**, y un superusuario
 * salta RLS pase lo que pase. Así que si la función quedara con el dueño por defecto, todos los tests
 * del barrido de arriba **seguirían en verde** — medido: quitar el `alter function ... owner to
 * app_barrido` no tumba ninguno.
 *
 * En Supabase alojado, en cambio, `postgres` NO es superusuario (este repo ya lo pagó con
 * `app.migraciones_aplicadas`), y `kr_runs` lleva `force row level security`: el dueño de la tabla
 * queda sujeto a las políticas, así que el barrido devolvería CERO FILAS en silencio. Verde acá, roto
 * allá — el modo de fallo que este proyecto persigue.
 *
 * Por eso lo que se exige es el CONTRATO ESTRUCTURAL: de quién es la función, si es definer, y que
 * tenga `search_path` fijado (una `security definer` sin él es la escalada de privilegios clásica:
 * el llamador antepone un schema propio y le hace ejecutar SU código al dueño).
 */
test("🔴 barrido: la función es SECURITY DEFINER de app_barrido, con search_path fijado", async () => {
  const { rows } = await pg.query<{
    owner: string;
    prosecdef: boolean;
    proconfig: string[] | null;
  }>(
    `select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'expirar_runs_colgados'`,
  );
  assert.equal(rows.length, 1, "la función existe (si no, el resto no comprueba nada)");
  const fn = rows[0]!;

  assert.equal(
    fn.owner,
    "app_barrido",
    "🔴 NO puede pertenecer a quien corre la migración: en producción ese rol está sujeto a FORCE RLS",
  );
  assert.equal(fn.prosecdef, true, "🔴 sin security definer no hay barrido cross-tenant");
  assert.ok(
    (fn.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    "🔴 una security definer sin search_path fijado es una escalada de privilegios",
  );
});

/*
 * El índice del barrido, comprobado en el catálogo porque no hay otra forma: quitarlo no rompe NADA
 * funcionalmente (medido — los 59 tests siguen verdes sin él), solo convierte cada pasada del barrido
 * en un seq scan sobre todos los runs que la plataforma haya hecho jamás. Un coste que crece solo y
 * que no avisa es exactamente lo que este test existe para que alguien note al borrarlo.
 *
 * Lo que se exige es el PREDICADO, no el nombre: sin `where status = 'running'` el índice indexaría el
 * histórico entero y dejaría de ser barato, que es su única razón de ser.
 */
test("barrido: el índice parcial existe y es PARCIAL (si no, no compra nada)", async () => {
  const { rows } = await pg.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where tablename = 'kr_runs' and indexname = 'kr_runs_colgados'",
  );
  assert.equal(rows.length, 1, "el índice del barrido existe");
  assert.match(rows[0]!.indexdef, /WHERE \(status = 'running'/i, "es parcial: solo los runs vivos");
  assert.match(rows[0]!.indexdef, /created_at/, "y ordena por la columna que el barrido filtra");
});

/**
 * 🔴 El piso del plazo, impuesto por la BASE.
 *
 * Con `'0 seconds'` la función mataría todos los runs vivos de la plataforma, y sería una llamada
 * perfectamente válida. El piso está en la función y no en TypeScript porque el privilegio también
 * está ahí: un `if` en el llamador lo tendría que repetir el próximo llamador.
 */
test("🔴 barrido: la base RECHAZA un plazo por debajo de una hora (y NULL)", async () => {
  const runId = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  await envejecer(runId, "5 hours");

  for (const plazo of ["0 seconds", "30 minutes"]) {
    await assert.rejects(
      () => storeServicio.expirarRunsColgados(plazo),
      /plazo demasiado corto/i,
      `🔴 '${plazo}' no puede expirar nada`,
    );
  }
  assert.equal((await estadoDe(runId)).status, "running", "ningún run vivo murió por el intento");

  // El plazo de producción sí pasa el piso: sin esto, el piso podría estar rompiendo el caso real.
  assert.equal((await storeServicio.expirarRunsColgados(PLAZO_RUN_COLGADO)).length, 1);
});

/**
 * El escenario que la 15ª review anticipó: el barrido mata un workflow lento y el workflow, al
 * terminar, lo resucita. No pasa porque `finishRun` es compare-and-set (`where status = 'running'`),
 * y este test es quien lo ata al barrido — sin él, quitar esa guarda no rompería nada de esta sección.
 */
test("🔴 barrido: un run ya expirado NO vuelve a pending_approval cuando el workflow termina tarde", async () => {
  const runId = await storeServicio.createRun(ctxServicio(), nuevoRun(clientA1));
  await envejecer(runId, "5 hours");
  await storeServicio.expirarRunsColgados("3 hours");

  const movio = await storeServicio.finishRun(ctxServicio(), runId, {
    costeMicros: 310_800,
    costeBreakdown: { dataforseo_micros: 252_200 },
    calidadDatos: {},
    modelosSinPrecio: [],
  });

  assert.equal(movio, false, "finishRun avisa de que NO movió el estado");
  assert.equal((await estadoDe(runId)).status, "failed", "🔴 el barrido gana: el run sigue muerto");
  // Pero el gasto se anota igual: ese dinero se pagó de verdad.
  const run = await storeServicio.getRun(ctxServicio(), runId);
  assert.equal(run?.coste_micros_usd, 310_800, "el coste se registra aunque el estado no se mueva");
});

/**
 * 🔴 EL DEFAULT DE PRODUCCIÓN. Lo consume la función programada del orquestador; si el test eligiera
 * el valor, no estaría fijando el que corre en prod.
 *
 * Los dos asserts prueban cosas distintas a propósito: el primero fija el literal, el segundo fija la
 * DECISIÓN (que el umbral esté muy por encima de la duración real de un research). Cambiar el literal
 * a algo defendible tumba solo el primero; cambiarlo a "20 minutes" tumba los dos.
 */
test("🔴 PLAZO_RUN_COLGADO: el default de producción son 3 horas, ~11x el research más largo medido", async () => {
  assert.equal(PLAZO_RUN_COLGADO, "3 hours");

  const { rows } = await pg.query<{ seg: number }>(
    "select extract(epoch from $1::interval)::int as seg",
    [PLAZO_RUN_COLGADO],
  );
  const segundos = rows[0]!.seg;

  // La única duración real medida de un research: 16m15s (2026-07-30, DataForSEO producción).
  const RESEARCH_MEDIDO_SEG = 16 * 60 + 15;
  assert.ok(
    segundos >= 10 * RESEARCH_MEDIDO_SEG,
    `el umbral (${segundos}s) tiene que dejar margen de sobra sobre ${RESEARCH_MEDIDO_SEG}s`,
  );
  // Y NO puede ser el plazo de la espera posterior (PLAZO_APROBACION = 7d): un run colgado una
  // semana es una semana sin que nadie se entere.
  assert.ok(segundos < 24 * 3600, "un run colgado se detecta el mismo día, no a los 7");
});

/**
 * 🔴 La `0018` se aplica con un rol que **NO es superusuario** — la condición de producción.
 *
 * ## Por qué existe este test, que es la parte que importa
 *
 * El primer despliegue real de la `0018` murió:
 *
 *     ✖ La migración 0018 falló y se revirtió: must be able to SET ROLE "app_barrido"
 *
 * con **238 tests en verde**. Ninguno lo vio, y no por descuido: en PGlite las migraciones corren
 * como `postgres`, que ahí **sí** es superusuario, y un superusuario puede asumir cualquier rol y
 * crear en cualquier schema. En Supabase alojado `postgres` no es superusuario. O sea que el arnés
 * entero estaba midiendo un motor con un permiso que producción no tiene.
 *
 * Es exactamente el modo de fallo que la cabecera de la `0018` argumenta para elegir el dueño de la
 * función — *"daría verde en los tests y cero filas en producción"*— **un piso más arriba**: el
 * razonamiento era correcto y el entorno donde se comprobó, no.
 *
 * ## Qué reproduce, y por qué esto es fiel y no un montaje
 *
 * Un rol `createrole` **sin** superusuario que **es dueño del schema `app`** — que es lo que pasa en
 * producción, donde el mismo rol que corre esta migración creó ese schema en la `0001`. Se le pasa la
 * propiedad del schema y de `kr_runs` (lo que la `0018` necesita poder conceder) y se aplica la
 * migración con `set role`.
 *
 * Sin los dos `grant` temporales que la `0018` hace antes del `alter … owner`, este test falla con el
 * mensaje literal de producción. Es la única forma honesta de fijar esa garantía desde acá.
 */
test("🔴 barrido: la 0018 se aplica con un rol NO superusuario (la condición de producción)", async () => {
  const pg = new PGlite();
  try {
    await asegurarAuthStandIn(pg);
    const archivos = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const previas = archivos.filter((f) => f < "0018_");
    const la0018 = archivos.filter((f) => f.startsWith("0018_"));
    // Control positivo del recorte: sin él, un filtro roto aplicaría "nada" y el test pasaría sin
    // haber ejercitado la migración — el mismo cuidado que el test de la 0017.
    assert.ok(previas.length >= 15, `esperaba las migraciones previas y encontré ${previas.length}`);
    assert.equal(la0018.length, 1, "la 0018 tiene que ser exactamente un archivo");

    for (const f of previas) await pg.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));

    // El rol que migra en producción: puede crear roles, NO es superusuario, y es dueño de lo que
    // la 0018 va a tocar.
    /*
     * La lista es explícita y **completa**: la `0018` concede sobre cuatro cosas de distinto dueño (los
     * schemas `public` y `app`, `kr_runs` y `memberships`), y conceder exige ser dueño. Este test ya
     * falló dos veces por reproducir la condición a medias — primero con solo el schema y `kr_runs`
     * (`permission denied for table memberships`), y `reassign owned by` no sirve porque el rol de
     * PGlite posee además objetos del sistema. Si la `0018` empieza a conceder sobre algo más, este
     * test se pone rojo con el nombre de lo que falta, que es el comportamiento correcto.
     */
    await pg.exec(`
      create role migrador_no_super createrole;
      alter schema app owner to migrador_no_super;
      alter schema public owner to migrador_no_super;
      alter table kr_runs owner to migrador_no_super;
      alter table memberships owner to migrador_no_super;
    `);

    const { rows: antes } = await pg.query<{ super: boolean }>(
      "select rolsuper as super from pg_roles where rolname = 'migrador_no_super'",
    );
    assert.equal(antes[0]?.super, false, "el rol de la prueba NO puede ser superusuario, o no prueba nada");

    await pg.exec("set role migrador_no_super");
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, la0018[0]!), "utf8"));
    await pg.exec("reset role");

    // Y quedó como el diseño quería: la función es de `app_barrido`…
    const { rows: dueno } = await pg.query<{ rolname: string }>(
      `select r.rolname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
         join pg_roles r on r.oid = p.proowner
        where n.nspname = 'app' and p.proname = 'expirar_runs_colgados'`,
    );
    assert.equal(dueno[0]?.rolname, "app_barrido", "el dueño es lo único que hace que la función sirva");

    // …y los dos permisos temporales NO quedaron puestos. Si se olvidara el revoke, el rol del barrido
    // se quedaría con `create` sobre el schema `app`, y quien migra, como miembro suyo.
    const { rows: sobras } = await pg.query<{ crea: boolean; miembro: boolean }>(
      `select has_schema_privilege('app_barrido', 'app', 'CREATE') as crea,
              pg_has_role('migrador_no_super', 'app_barrido', 'USAGE') as miembro`,
    );
    assert.equal(sobras[0]?.crea, false, "quedó `create on schema app` para app_barrido");
    assert.equal(sobras[0]?.miembro, false, "quien migró quedó como miembro de app_barrido");
  } finally {
    await pg.close();
  }
});

// =============================================================================
// El polling de reseñas de Google (migración 0022) — segunda `security definer`, mismo molde
// que `app_barrido`. La amenaza acá no es el silencio (0018): es que el rol cross-tenant, o el
// grant preexistente de `app_service` sobre `clients`, filtren el refresh token de OAuth de un
// cliente. Ver `.superpowers/sdd/task-1-report.md` — el hallazgo que la Task 1 dejó anotado para
// esta migración.
// =============================================================================

test("🔴 credenciales: app_resenas no tiene login concedible (SET) a ningún rol con login", async () => {
  const { rows } = await pg.query<{ login: string; puede: boolean }>(
    `select rolname as login, pg_has_role(rolname, 'app_resenas', 'SET') as puede
       from pg_roles where rolname in ('amg_api','amg_orquestador','amg_cache','amg_render')`,
  );
  assert.equal(rows.length, 4, "los cuatro logins existen (si no, este test no comprueba nada)");
  for (const r of rows) assert.equal(r.puede, false, `🔴 ${r.login} NO puede asumir app_resenas`);
});

test("🔴 app_user NO puede ejecutar clientes_conectados_google (42501)", async () => {
  await assert.rejects(
    () => store.clientesConectadosGoogle(),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre la función del polling",
  );
});

test("🔴 app_user NO puede ejecutar registrar_resena_google (42501)", async () => {
  await assert.rejects(
    () =>
      store.registrarResenaGoogle({
        clientId: clientA1,
        tenantId: tenantA,
        googleReviewId: "gr-intento-api",
        puntuacion: 5,
        autor: "Alguien",
        texto: null,
        publicadaEn: new Date().toISOString(),
      }),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre el registro de reseñas",
  );
});

test("clientesConectadosGoogle solo devuelve clientes con refresh_token no nulo, de todos los tenants", async () => {
  await pg.query(
    "update clients set google_refresh_token = 'tok-a1', google_location_id = 'loc-a1' where id = $1",
    [clientA1],
  );
  await pg.query(
    "update clients set google_refresh_token = 'tok-b1', google_location_id = 'loc-b1' where id = $1",
    [clientB1],
  );
  // clientA2 se queda sin conectar.

  const conectados = await storeServicio.clientesConectadosGoogle();
  const ids = conectados.map((c) => c.clientId);

  assert.ok(ids.includes(clientA1) && ids.includes(clientB1), "🔴 cruza los dos tenants");
  assert.ok(!ids.includes(clientA2), "el que no conectó no aparece");

  const a1 = conectados.find((c) => c.clientId === clientA1);
  assert.deepEqual(
    a1 && { tenantId: a1.tenantId, locationId: a1.locationId, refreshToken: a1.refreshToken },
    { tenantId: tenantA, locationId: "loc-a1", refreshToken: "tok-a1" },
    "trae el tenant, el location_id y el token -- lo que el polling necesita para pedir reseñas",
  );
});

/**
 * Lleva control positivo A PROPÓSITO: `clientA2` queda conectado y SIN archivar. Sin él, este test
 * pasaría también con la visibilidad de `app_resenas` totalmente rota (cero filas siempre, el modo
 * de fallo silencioso que el comentario de la 0022 describe) -- `!includes(clientA1)` es trivialmente
 * cierto si la lista está vacía. Medido: quitar la política `client_ve_app_resenas` tumba el test de
 * arriba (el que exige que clientA1/clientB1 SÍ aparezcan) pero NO este, si este no tuviera el control.
 */
test("clientesConectadosGoogle ignora un cliente archivado aunque tenga token", async () => {
  await pg.query(
    "update clients set google_refresh_token = 'tok-archivado', archived_at = now() where id = $1",
    [clientA1],
  );
  await pg.query(
    "update clients set google_refresh_token = 'tok-a2', google_location_id = 'loc-a2' where id = $1",
    [clientA2],
  );

  const conectados = await storeServicio.clientesConectadosGoogle();
  const ids = conectados.map((c) => c.clientId);

  assert.ok(!ids.includes(clientA1), "archivado: el polling no lo toca");
  assert.ok(ids.includes(clientA2), "control positivo: el conectado SIN archivar sí tiene que aparecer");
});

test("🔴 registrarResenaGoogle es idempotente: la segunda llamada con el mismo google_review_id no duplica", async () => {
  const resena = {
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-1",
    puntuacion: 4,
    autor: "Ana",
    texto: "Bien",
    publicadaEn: new Date().toISOString(),
  };

  const primera = await storeServicio.registrarResenaGoogle(resena);
  const segunda = await storeServicio.registrarResenaGoogle(resena);

  assert.equal(primera, true, "la primera inserta");
  assert.equal(segunda, false, "🔴 ya existía: no se duplica");
  const { rows } = await pg.query<{ n: string }>(
    "select count(*)::text as n from resenas_google where google_review_id = 'gr-1'",
  );
  assert.equal(rows[0]?.n, "1");
});

test("🔴 registrarResenaGoogle escribe bajo el tenant que se le pasa, no el que decida el motor", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientB1,
    tenantId: tenantB,
    googleReviewId: "gr-cruzado",
    puntuacion: 3,
    autor: "B",
    texto: null,
    publicadaEn: new Date().toISOString(),
  });

  const { rows } = await pg.query<{ tenant_id: string }>(
    "select tenant_id from resenas_google where google_review_id = 'gr-cruzado'",
  );
  assert.equal(rows[0]?.tenant_id, tenantB, "la fila queda bajo el tenant del CLIENTE, no de quien migró");
});

/**
 * 🔴 EL HALLAZGO DE LA TASK 1, CERRADO ACÁ. `app_service` ya tenía `select` de TABLA sobre
 * `clients` desde la 0002 (`grant select, insert, update, delete on clients, ... to app_service`).
 * Sin el `revoke select on clients from app_service` + `grant select (columnas)` de la 0022, el
 * orquestador podría leer `google_refresh_token` con un `select` pelado, sin pasar nunca por
 * `app.clientes_conectados_google()` -- exactamente el mismo bypass que la 0021 cerró para
 * `app_user`, aplicado al otro rol con login que toca `clients`.
 *
 * Se exige el RECHAZO del motor (`permission denied`), no cero filas: `clients` no tiene ninguna
 * política que oculte la columna -- lo único que existía para pararla era el grant, y es
 * exactamente eso lo que se está probando.
 */
test("🔴 app_service NO puede leer clients.google_refresh_token por SQL directo (el bypass que la Task 1 dejó señalado)", async () => {
  await pg.query("update clients set google_refresh_token = 'secreto-oauth' where id = $1", [clientA1]);

  // Dos transacciones separadas: un `permission denied` aborta la transacción entera, así que un
  // segundo intento en la MISMA transacción solo vería "current transaction is aborted" -- que no
  // es la garantía que este test fija.
  await pg.exec("begin");
  await pg.exec("set local role app_service");
  try {
    await assert.rejects(
      () => pg.query("select google_refresh_token from clients where id = $1", [clientA1]),
      /permission denied/i,
      "🔴 app_service no tiene select de tabla ni de columna sobre google_refresh_token",
    );
  } finally {
    await pg.exec("rollback");
  }

  await pg.exec("begin");
  await pg.exec("set local role app_service");
  try {
    await assert.rejects(
      () => pg.query("select * from clients where id = $1", [clientA1]),
      /permission denied/i,
      "🔴 select * exige TODAS las columnas: con una faltante, el motor rechaza la sentencia entera",
    );
  } finally {
    await pg.exec("rollback");
  }
});

/**
 * Control positivo del test de arriba: `app_service` SIGUE pudiendo leer, por columna explícita,
 * exactamente lo que `getClient()` pide en producción (`db/src/store.ts`). Sin este test, el de
 * arriba podría estar pasando porque se le cerró TODO a `app_service`, no solo el token -- que
 * rompería `getClient()` en silencio para el orquestador real.
 *
 * Pasa por `storeServicio.getClient` (el método real, con `withTenant`) y no por un `select`
 * crudo: sin el contexto de tenant que `withTenant` fija (`set_config('app.tenant_id', ...)`), la
 * política `client_select` (`tenant_id = app.current_tenant_id()`) no ve la fila aunque el grant de
 * columna esté -- y eso probaría RLS, no el grant, que es lo que este test fija.
 */
test("app_service SÍ puede leer las columnas de clients que getClient() usa en producción", async () => {
  const viaApiUser = await store.getClient(ctxA(), clientA1);
  assert.ok(viaApiUser, "getClient sigue funcionando bajo app_user");

  const viaOrquestador = await storeServicio.getClient(ctxA(), clientA1);
  assert.deepEqual(
    viaOrquestador,
    viaApiUser,
    "app_service sigue leyendo exactamente las cuatro columnas de ClientRow",
  );
});

test("getClient incluye archived_at", async () => {
  await sqlCrudo(pool, ctxA(), "update clients set archived_at = now() where id = $1", [clientA1]);
  const cliente = await store.getClient(ctxA(), clientA1);
  assert.ok(cliente);
  assert.ok(cliente!.archived_at !== undefined, "archived_at tiene que venir en la fila, aunque sea null");
  assert.notEqual(cliente!.archived_at, null);
});

/**
 * La lectura es la garantía nueva de esta migración: NINGÚN rol con login lee el token, ni de
 * tabla ni de columna.
 *
 * La escritura es asimétrica A PROPÓSITO, y por dos motivos distintos:
 *  · `app_user` la tiene por columna (0021): el callback de OAuth corre con su identidad.
 *  · `app_service` la tiene todavía, pero de TABLA y sin tocar (0002, `grant ... update ... on
 *    clients to app_service`) -- esta migración deliberadamente NO la angostó. El hallazgo de la
 *    Task 1 era sobre LECTURA (un token que se puede exfiltrar); ningún código de producción del
 *    orquestador escribe `clients` hoy, así que cerrar un privilegio no ejercitado sin evidencia de
 *    uso es una decisión de diseño que esta migración no toma (ver el comentario de la 0022). Si
 *    algún día se decide angostarlo, este assert es el que hay que voltear.
 */
test("🔴 los grants de clients.google_refresh_token: LECTURA cerrada para los DOS roles con login", async () => {
  const { rows } = await pg.query<{ rol: string; puede_leer: boolean; puede_escribir_columna: boolean; puede_escribir_tabla: boolean }>(
    `select r.rolname as rol,
            has_column_privilege(r.rolname, 'clients', 'google_refresh_token', 'select') as puede_leer,
            has_column_privilege(r.rolname, 'clients', 'google_refresh_token', 'update') as puede_escribir_columna,
            has_table_privilege(r.rolname, 'clients', 'update') as puede_escribir_tabla
       from pg_roles r where r.rolname in ('app_user', 'app_service')`,
  );
  assert.equal(rows.length, 2, "los dos roles existen (si no, este test no comprueba nada)");
  for (const r of rows) {
    assert.equal(r.puede_leer, false, `🔴 ${r.rol} NO puede leer google_refresh_token`);
  }
  const appUser = rows.find((r) => r.rol === "app_user");
  assert.equal(appUser?.puede_escribir_columna, true, "app_user SÍ puede escribirlo por columna: el callback de OAuth corre con su identidad");
  const appService = rows.find((r) => r.rol === "app_service");
  assert.equal(
    appService?.puede_escribir_tabla,
    true,
    "app_service conserva su UPDATE de tabla preexistente (0002) -- fuera del alcance de esta migración, ver el comentario",
  );
});

/**
 * 🔴 Mismo control estructural que el barrido: dueño, `security definer` y `search_path` fijado
 * para LAS DOS funciones nuevas.
 */
test("🔴 resenas: las dos funciones son SECURITY DEFINER de app_resenas, con search_path fijado", async () => {
  const { rows } = await pg.query<{
    nombre: string; owner: string; prosecdef: boolean; proconfig: string[] | null;
  }>(
    `select p.proname as nombre, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname in ('clientes_conectados_google', 'registrar_resena_google')
      order by p.proname`,
  );
  assert.equal(rows.length, 2, "las dos funciones existen (si no, el resto no comprueba nada)");
  for (const fn of rows) {
    assert.equal(fn.owner, "app_resenas", `🔴 ${fn.nombre}: NO puede pertenecer a quien corre la migración`);
    assert.equal(fn.prosecdef, true, `🔴 ${fn.nombre}: sin security definer no hay cruce de tenants`);
    assert.ok(
      (fn.proconfig ?? []).some((c) => c.startsWith("search_path=")),
      `🔴 ${fn.nombre}: sin search_path fijado es una escalada de privilegios`,
    );
  }
});

// =============================================================================
// Borrador de IA (migración 0024) — la tercera función security definer del módulo de reseñas.
// La amenaza acá NO es el silencio (0018): es que la función escriba sobre una fila que no debía
// (1-3★, o una que ya tenía borrador). Ver la spec, sección "Modelo de datos" — hallazgo de la
// revisión externa.
// =============================================================================

test("🔴 app_user NO puede ejecutar guardar_borrador_resena (42501)", async () => {
  await assert.rejects(
    () =>
      store.guardarBorradorResena({
        clientId: clientA1,
        tenantId: tenantA,
        googleReviewId: "gr-intento-api",
        borrador: "Gracias por tu reseña",
      }),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre el guardado del borrador",
  );
});

test("guardarBorradorResena escribe el borrador de una reseña 5★ elegible", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-borrador-1",
    puntuacion: 5,
    autor: "Ana",
    texto: "Buenísimo",
    publicadaEn: new Date().toISOString(),
  });

  const ok = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-borrador-1",
    borrador: "¡Gracias, Ana!",
  });
  assert.equal(ok, true);

  const { rows } = await pg.query<{ borrador_respuesta: string; borrador_generado_en: string }>(
    "select borrador_respuesta, borrador_generado_en from resenas_google where google_review_id = 'gr-borrador-1'",
  );
  assert.equal(rows[0]?.borrador_respuesta, "¡Gracias, Ana!");
  assert.ok(rows[0]?.borrador_generado_en, "borrador_generado_en queda puesto");
});

test("🔴 guardarBorradorResena NO escribe sobre una reseña de 1-3★ (defensa en profundidad)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-negativa",
    puntuacion: 2,
    autor: "Carlos",
    texto: "Mal",
    publicadaEn: new Date().toISOString(),
  });

  const ok = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-negativa",
    borrador: "IA no debería poder escribir esto",
  });
  assert.equal(ok, false, "🔴 el WHERE de la función rechaza puntuacion fuera de 4-5");

  const { rows } = await pg.query<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where google_review_id = 'gr-negativa'",
  );
  assert.equal(rows[0]?.borrador_respuesta, null, "la reseña negativa sigue sin ningún borrador de IA");
});

test("🔴 guardarBorradorResena NO pisa un borrador que ya existe (defensa en profundidad)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-tiene",
    puntuacion: 5,
    autor: "Diana",
    texto: "Excelente",
    publicadaEn: new Date().toISOString(),
  });
  const primera = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-tiene",
    borrador: "Edición del staff, guardada primero",
  });
  assert.equal(primera, true);

  const segunda = await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-tiene",
    borrador: "Un segundo llamado no debería pisar esto",
  });
  assert.equal(segunda, false, "🔴 el WHERE rechaza borrador_respuesta is null cuando ya hay uno");

  const { rows } = await pg.query<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where google_review_id = 'gr-ya-tiene'",
  );
  assert.equal(rows[0]?.borrador_respuesta, "Edición del staff, guardada primero", "no se sobrescribió");
});

test("🔴 guardarBorradorResena escribe bajo el tenant que se le pasa, no el que decida el motor", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientB1,
    tenantId: tenantB,
    googleReviewId: "gr-cruzado-borrador",
    puntuacion: 5,
    autor: "B",
    texto: null,
    publicadaEn: new Date().toISOString(),
  });
  await storeServicio.guardarBorradorResena({
    clientId: clientB1,
    tenantId: tenantB,
    googleReviewId: "gr-cruzado-borrador",
    borrador: "Gracias",
  });

  const { rows } = await pg.query<{ tenant_id: string }>(
    "select tenant_id from resenas_google where google_review_id = 'gr-cruzado-borrador'",
  );
  assert.equal(rows[0]?.tenant_id, tenantB);
});

test("🔴 la función nueva es SECURITY DEFINER de app_resenas, con search_path fijado", async () => {
  const { rows } = await pg.query<{
    owner: string; prosecdef: boolean; proconfig: string[] | null;
  }>(
    `select pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'app' and p.proname = 'guardar_borrador_resena'`,
  );
  assert.equal(rows.length, 1, "la función existe (si no, el resto no comprueba nada)");
  assert.equal(rows[0]?.owner, "app_resenas", "🔴 NO puede pertenecer a quien corre la migración");
  assert.equal(rows[0]?.prosecdef, true, "🔴 sin security definer no hay cruce de tenants");
  assert.ok(
    (rows[0]?.proconfig ?? []).some((c) => c.startsWith("search_path=")),
    "🔴 sin search_path fijado es una escalada de privilegios",
  );
});

test("🔴 los grants de update sobre borrador_respuesta son EXACTAMENTE app_user y app_resenas", async () => {
  const { rows } = await pg.query<Record<string, boolean>>(`
    select
      has_column_privilege('app_user',    'resenas_google', 'borrador_respuesta', 'update') as user_update,
      has_column_privilege('app_resenas', 'resenas_google', 'borrador_respuesta', 'update') as resenas_update,
      has_column_privilege('app_service', 'resenas_google', 'borrador_respuesta', 'update') as service_update,
      has_column_privilege('app_render',  'resenas_google', 'borrador_respuesta', 'update') as render_update
  `);
  assert.deepEqual(rows[0], {
    user_update: true,
    resenas_update: true,
    // El orquestador (app_service) sigue sin grant directo: pasa por la función security definer.
    service_update: false,
    // ADR-19: el renderizador anónimo, jamás.
    render_update: false,
  });
});

// =============================================================================
// Publicar la respuesta de vuelta a Google (migración 0025) — Bloque F, fase 2, segunda pieza.
// La amenaza acá es la misma familia que 0024: que la confirmación pise una fila que nadie pidió
// publicar, o que una carrera (dos corridas del mismo evento) publique dos veces.
// =============================================================================

test("🔴 app_user NO puede ejecutar resena_para_publicar (42501)", async () => {
  await assert.rejects(
    () => store.resenaParaPublicar(crypto.randomUUID()),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre la lectura cross-tenant del orquestador",
  );
});

test("🔴 app_user NO puede ejecutar publicar_respuesta_resena (42501)", async () => {
  await assert.rejects(
    () =>
      store.marcarRespuestaPublicada({
        clientId: clientA1,
        tenantId: tenantA,
        googleReviewId: "gr-intento-api-publicar",
      }),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre la confirmación de publicación",
  );
});

test("resenaParaPublicar devuelve los seis campos correctos para una fila solicitada, con borrador y sin publicar", async () => {
  await pg.query(
    "update clients set google_location_id = 'loc-pub-1', google_refresh_token = 'tok-pub-1' where id = $1",
    [clientA1],
  );
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-para-publicar",
    puntuacion: 5,
    autor: "Ana",
    texto: "Buenísimo",
    publicadaEn: new Date().toISOString(),
  });
  await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-para-publicar",
    borrador: "¡Gracias, Ana!",
  });
  const { rows: filaRows } = await pg.query<{ id: string }>(
    "select id from resenas_google where google_review_id = 'gr-para-publicar'",
  );
  const resenaId = filaRows[0]!.id;
  await pg.query("update resenas_google set respuesta_solicitada_en = now() where id = $1", [resenaId]);

  const info = await storeServicio.resenaParaPublicar(resenaId);
  assert.deepEqual(info, {
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-para-publicar",
    borrador: "¡Gracias, Ana!",
    locationId: "loc-pub-1",
    refreshToken: "tok-pub-1",
  });
});

test("resenaParaPublicar devuelve null si nadie pidió publicar (respuesta_solicitada_en NULL)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-no-solicitada",
    puntuacion: 5,
    autor: "Ana",
    texto: null,
    publicadaEn: new Date().toISOString(),
  });
  await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-no-solicitada",
    borrador: "Gracias",
  });
  const { rows: filaRows } = await pg.query<{ id: string }>(
    "select id from resenas_google where google_review_id = 'gr-no-solicitada'",
  );

  const info = await storeServicio.resenaParaPublicar(filaRows[0]!.id);
  assert.equal(info, null, "🔴 el WHERE rechaza respuesta_solicitada_en is null");
});

test("resenaParaPublicar devuelve null si ya está publicada", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-publicada-2",
    puntuacion: 5,
    autor: "Ana",
    texto: null,
    publicadaEn: new Date().toISOString(),
  });
  await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-ya-publicada-2",
    borrador: "Gracias",
  });
  const { rows: filaRows } = await pg.query<{ id: string }>(
    "select id from resenas_google where google_review_id = 'gr-ya-publicada-2'",
  );
  const resenaId = filaRows[0]!.id;
  await pg.query(
    "update resenas_google set respuesta_solicitada_en = now(), respuesta_publicada_en = now() where id = $1",
    [resenaId],
  );

  const info = await storeServicio.resenaParaPublicar(resenaId);
  assert.equal(info, null, "🔴 el WHERE rechaza respuesta_publicada_en is not null");
});

test("🔴 marcarRespuestaPublicada es idempotente: la segunda llamada da false (no publica dos veces)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-confirmar",
    puntuacion: 5,
    autor: "Ana",
    texto: null,
    publicadaEn: new Date().toISOString(),
  });
  await storeServicio.guardarBorradorResena({
    clientId: clientA1,
    tenantId: tenantA,
    googleReviewId: "gr-confirmar",
    borrador: "Gracias",
  });
  const { rows: filaRows } = await pg.query<{ id: string }>(
    "select id from resenas_google where google_review_id = 'gr-confirmar'",
  );
  await pg.query("update resenas_google set respuesta_solicitada_en = now() where id = $1", [filaRows[0]!.id]);

  const args = { clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-confirmar" };
  const primera = await storeServicio.marcarRespuestaPublicada(args);
  assert.equal(primera, true);

  const segunda = await storeServicio.marcarRespuestaPublicada(args);
  assert.equal(segunda, false, "🔴 el WHERE rechaza respuesta_publicada_en is not null en la segunda corrida");

  const { rows: check } = await pg.query<{ respuesta_publicada_en: string }>(
    "select respuesta_publicada_en from resenas_google where google_review_id = 'gr-confirmar'",
  );
  assert.ok(check[0]?.respuesta_publicada_en, "quedó marcada publicada por la primera llamada");
});

// =============================================================================
// Alertas por Telegram (migración 0026, Bloque F fase 2) — la mitad cross-tenant que usa el
// orquestador para el retry automático (decisión de Juan, hallazgo 4 de la revisión de Codex) y
// para resolver el chat_id del CM asignado a cada cliente.
// =============================================================================

test("🔴 app_user NO puede ejecutar telegram_del_asignado (42501)", async () => {
  await assert.rejects(
    () => store.telegramDelAsignado(clientA1),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre la resolución cross-tenant del asignado",
  );
});

test("🔴 app_user NO puede ejecutar vincular_telegram (42501)", async () => {
  await assert.rejects(
    () => store.vincularTelegramPorCodigo("codigo-cualquiera", "chat-cualquiera"),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre la confirmación de vinculación",
  );
});

test("🔴 app_user NO puede leer/escribir app.telegram_polling_estado (42501)", async () => {
  await assert.rejects(() => store.offsetTelegramActual(), /permission denied|42501/);
  await assert.rejects(() => store.avanzarOffsetTelegram(5), /permission denied|42501/);
});

test("🔴 app_user NO puede ejecutar resenas_pendientes_alerta_telegram ni marcar_alerta_telegram_enviada (42501)", async () => {
  await assert.rejects(
    () => store.resenasPendientesAlertaTelegram(clientA1),
    /permission denied for function|42501/,
  );
  await assert.rejects(
    () =>
      store.marcarAlertaTelegramEnviada({ clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-x" }),
    /permission denied for function|42501/,
  );
});

test("clientesConectadosGoogle incluye el nombre del negocio (para el texto de la alerta)", async () => {
  await pg.query(
    "update clients set google_refresh_token = 'tok-nombre', google_location_id = 'loc-nombre' where id = $1",
    [clientA1],
  );
  const conectados = await storeServicio.clientesConectadosGoogle();
  const fila = conectados.find((c) => c.clientId === clientA1);
  assert.equal(fila?.nombre, "Trattoria", "el nombre sembrado en el beforeEach para clientA1");
});

test("telegramDelAsignado devuelve el chat_id del CM asignado y vinculado", async () => {
  await pg.query("update clients set asignado_a = $1 where id = $2", [equipoA, clientA1]);
  await pg.query("update memberships set telegram_chat_id = $1 where user_id = $2", ["chat-cm-1", equipoA]);

  const chatId = await storeServicio.telegramDelAsignado(clientA1);
  assert.equal(chatId, "chat-cm-1");
});

test("telegramDelAsignado da null si el CM asignado NO vinculó Telegram", async () => {
  await pg.query("update clients set asignado_a = $1 where id = $2", [equipoA, clientA1]);
  // equipoA sigue sin telegram_chat_id acá -- el beforeEach lo siembra en NULL.
  const chatId = await storeServicio.telegramDelAsignado(clientA1);
  assert.equal(chatId, null);
});

test("telegramDelAsignado da null si el cliente NO tiene asignado_a", async () => {
  const chatId = await storeServicio.telegramDelAsignado(clientA1);
  assert.equal(chatId, null);
});

test("vincularTelegramPorCodigo: código válido vincula, y el MISMO código ya no sirve una segunda vez", async () => {
  // El trigger `membresias_guardia_telegram` (0026) IGNORA el valor de `telegram_link_code` que
  // mande este UPDATE y escribe el suyo (`gen_random_uuid()`) -- por eso el código real se lee de
  // vuelta con `RETURNING` en vez de asumir el literal que se mandó (mismo motivo que
  // `PgMembresias.generarCodigoTelegram`, que hace exactamente esto).
  const { rows: escrito } = await pg.query<{ telegram_link_code: string }>(
    `update memberships set telegram_link_code = 'valor-cualquiera',
       telegram_link_code_expira = now() + interval '10 minutes'
     where user_id = $1
     returning telegram_link_code`,
    [equipoA],
  );
  const codigo = escrito[0]!.telegram_link_code;

  const primera = await storeServicio.vincularTelegramPorCodigo(codigo, "chat-1");
  assert.equal(primera, true);

  const { rows } = await pg.query<{ telegram_chat_id: string | null; telegram_link_code: string | null }>(
    "select telegram_chat_id, telegram_link_code from memberships where user_id = $1",
    [equipoA],
  );
  assert.equal(rows[0]?.telegram_chat_id, "chat-1");
  assert.equal(rows[0]?.telegram_link_code, null, "el código se consume: queda en NULL");

  const segunda = await storeServicio.vincularTelegramPorCodigo(codigo, "chat-2");
  assert.equal(segunda, false, "🔴 el mismo código ya consumido no vuelve a vincular");
});

test("vincularTelegramPorCodigo: código VENCIDO no vincula", async () => {
  // Igual que el test de arriba: el código real lo genera el trigger, no el literal que se manda.
  const { rows: escrito } = await pg.query<{ telegram_link_code: string }>(
    `update memberships set telegram_link_code = 'valor-cualquiera' where user_id = $1
     returning telegram_link_code`,
    [equipoA],
  );
  const codigo = escrito[0]!.telegram_link_code;
  // Un SEGUNDO update, que NO toca `telegram_link_code`: el trigger solo fuerza el vencimiento
  // cuando el CÓDIGO cambia (bloque b de `membresias_guardia_telegram`) -- dejarlo intacto acá es
  // lo que permite backdatear la expiración sin que el trigger la vuelva a pisar a +10 minutos.
  await pg.query(
    "update memberships set telegram_link_code_expira = now() - interval '1 minute' where user_id = $1",
    [equipoA],
  );
  const ok = await storeServicio.vincularTelegramPorCodigo(codigo, "chat-1");
  assert.equal(ok, false, "🔴 el WHERE exige telegram_link_code_expira > now()");
});

test("offsetTelegramActual/avanzarOffsetTelegram: el offset persiste entre llamadas", async () => {
  assert.equal(await storeServicio.offsetTelegramActual(), 0, "arranca en 0 (default de la 0026)");
  await storeServicio.avanzarOffsetTelegram(42);
  assert.equal(await storeServicio.offsetTelegramActual(), 42);
  await storeServicio.avanzarOffsetTelegram(43);
  assert.equal(await storeServicio.offsetTelegramActual(), 43, "un segundo avance sigue quedando persistido");
});

test("resenasPendientesAlertaTelegram: devuelve una 1-3★ sin alerta, no devuelve la ya confirmada ni una 4-5★", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-pendiente",
    puntuacion: 2, autor: "Carlos", texto: "Mal", publicadaEn: new Date().toISOString(),
  });
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-ya-confirmada",
    puntuacion: 1, autor: "Diana", texto: "Pésimo", publicadaEn: new Date().toISOString(),
  });
  await pg.query(
    "update resenas_google set alerta_telegram_enviada_en = now() where google_review_id = 'gr-ya-confirmada'",
  );
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-positiva",
    puntuacion: 5, autor: "Ana", texto: "Buenísimo", publicadaEn: new Date().toISOString(),
  });

  const pendientes = await storeServicio.resenasPendientesAlertaTelegram(clientA1);
  const ids = pendientes.map((r) => r.googleReviewId);
  assert.ok(ids.includes("gr-pendiente"), "la 1-3★ sin alerta SÍ aparece");
  assert.ok(!ids.includes("gr-ya-confirmada"), "la que ya tiene alerta confirmada NO aparece (no se reintenta)");
  assert.ok(!ids.includes("gr-positiva"), "una 4-5★ NO es candidata a alerta");
});

test("marcarAlertaTelegramEnviada: true la primera vez, false la segunda (no reenvía la confirmación)", async () => {
  await storeServicio.registrarResenaGoogle({
    clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-marcar",
    puntuacion: 3, autor: "Bruno", texto: "Regular", publicadaEn: new Date().toISOString(),
  });
  const args = { clientId: clientA1, tenantId: tenantA, googleReviewId: "gr-marcar" };
  assert.equal(await storeServicio.marcarAlertaTelegramEnviada(args), true);
  assert.equal(await storeServicio.marcarAlertaTelegramEnviada(args), false, "🔴 el WHERE exige que siga en NULL");
});

// ---------------------------------------------------------------- registrarDecision / cerrarDecision (0027)

test("registrarDecision: primera decisión sobre un run pending_approval califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(decisionId);
  const { rows } = await pg.query<{ status: string }>("select status from kr_runs where id = $1", [runId]);
  assert.equal(rows[0]!.status, "approved", "la primera decisión promueve el run");
});

test("registrarDecision: repetir el mismo destino no califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const primera = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(primera);
  await store.cerrarDecision(ctxA(), primera!, { resultado: "completado" });
  const segunda = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.equal(segunda, null);
});

test("registrarDecision: retomable — solo_informe completado → crear_web califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const d1 = await store.registrarDecision(ctxA(), runId, "solo_informe");
  await store.cerrarDecision(ctxA(), d1!, { resultado: "completado" });
  const d2 = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.ok(d2);
  assert.notEqual(d2, d1);
});

test("🔴 registrarDecision: retomar DESPUÉS de crear_web no califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const d1 = await store.registrarDecision(ctxA(), runId, "crear_web");
  await store.cerrarDecision(ctxA(), d1!, { resultado: "completado" });
  const d2 = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.equal(d2, null, "crear_web ya publicado no es retomable hacia solo_informe");
});

// Hallazgo de la ronda de Codex sobre el plan (Major #6, ver "Historial de revisión"): el viejo
// approveRun exigía "al menos una página aprobada" (ADR-06, compuerta doble) y registrarDecision no
// había heredado ese chequeo. Confirmado con el usuario: se aplica SOLO a crear_web — solo_informe
// no lo necesita, porque el informe ya existe desde el research sin depender de páginas aprobadas.
test("🔴 registrarDecision: crear_web SIN ninguna página aprobada no califica", async () => {
  const runId = await runSinPaginasAprobadas(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_web");
  assert.equal(decisionId, null);
});

test("registrarDecision: solo_informe SIN ninguna página aprobada SÍ califica", async () => {
  const runId = await runSinPaginasAprobadas(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(decisionId, "el informe no depende de páginas aprobadas");
});

// Agregado al escribir el plan del sub-proyecto 3 (publicar posts en blog externo): mismo criterio
// que crear_web — no tiene sentido generar posts de un run sin ninguna página aprobada.
test("🔴 registrarDecision: crear_posts SIN ninguna página aprobada no califica", async () => {
  const runId = await runSinPaginasAprobadas(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_posts");
  assert.equal(decisionId, null);
});

test("registrarDecision: crear_posts CON al menos una página aprobada califica", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "crear_posts");
  assert.ok(decisionId);
});

test("cerrarDecision: guard de reproceso — cerrar dos veces no pisa el resultado", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const decisionId = await store.registrarDecision(ctxA(), runId, "solo_informe");
  const primera = await store.cerrarDecision(ctxA(), decisionId!, { resultado: "completado" });
  const segunda = await store.cerrarDecision(ctxA(), decisionId!, {
    resultado: "error",
    detalleError: "no debería aplicar",
  });
  assert.equal(primera, true);
  assert.equal(segunda, false, "ya no está 'pendiente': el segundo cierre es un no-op");
  const decision = await store.getDecision(ctxA(), decisionId!);
  assert.equal(decision!.resultado, "completado", "el resultado de la primera NO se pisó");
});

/*
 * Hallazgo Major de la ronda de Codex: PGlite serializa TODAS sus transacciones sobre una única
 * conexión (`db/src/pool.ts:69-71`, `PglitePool.transaction()` es exclusiva) — dos llamadas por
 * `Promise.all` NUNCA se solapan de verdad ahí adentro, así que un test así puede quedar verde sin
 * haber ejercitado la colisión del índice. Este test es DETERMINISTA en su lugar: fuerza la
 * colisión insertando directo (sin pasar por `registrarDecision`) una segunda fila 'pendiente' para
 * el mismo run, y confirma que el índice la rechaza con `ON CONFLICT ... DO NOTHING` (0 filas) en
 * vez de una excepción 23505 sin manejar.
 *
 * La concurrencia REAL (dos conexiones Postgres solapadas de verdad) queda fuera de lo que este
 * arnés puede probar — no se afirma que este test la cubra.
 */
test("🔴 dos decisiones 'pendiente' para el mismo run: el índice único parcial bloquea la segunda", async () => {
  const runId = await runPendienteDeAprobacion(ctxA(), clientA1);
  const primera = await store.registrarDecision(ctxA(), runId, "solo_informe");
  assert.ok(primera);
  // Segunda decisión "pendiente" simulando la carrera SIN pasar por registrarDecision (que ya
  // bloquearía por status='approved' tras la primera) — ejercita directamente el índice, no el
  // WHERE de más arriba.
  const { rows } = await pg.query<{ id: string }>(
    `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
     values ($1, $2, $3, 'crear_web')
     on conflict (run_id) where resultado = 'pendiente' do nothing
     returning id`,
    [runId, tenantA, clientA1],
  );
  assert.equal(rows.length, 0, "la segunda 'pendiente' no se insertó — el índice la bloqueó en silencio, no con una excepción");
});

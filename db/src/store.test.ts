import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgStore } from "./store.js";
import { PglitePool } from "./pool.js";
import { aplicarMigraciones } from "./migrate.js";
import type { KeywordRow, PageRow, TenantContext } from "./store.js";

let pg: PGlite;
let store: PgStore;

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
const ctxServicio = (): TenantContext => ({ tenantId: tenantA, servicio: true });

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
  store = new PgStore(new PglitePool(pg));
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("delete from kr_runs; delete from memberships; delete from clients; delete from tenants;");
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
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);

  await assert.rejects(() => store.approveRun(ctxA(), runId), /ninguna página aprobada/i);
});

test("compuerta: aprobar el run NO aprueba sus páginas (la compuerta es doble)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page(), page({ url_slug: "/otra", cluster_id: "22222222-2222-4222-8222-222222222222" })]);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where url_slug = '/pizza-napolitana-madrid'");
  await store.approvePage(ctxA(), rows[0]!.id);
  await store.approveRun(ctxA(), runId);

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

/** El orquestador SÍ puede: su autoridad es la credencial de Postgres, no un campo de la petición. */
test("el servicio (app_service) sí escribe los resultados del research", async () => {
  const runId = await store.createRun(ctxServicio(), nuevoRun(clientA1));

  const run = await store.getRun(ctxA(), runId);
  assert.equal(run?.status, "running", "el orquestador abrió el run y el equipo lo ve");
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
  const filas = await store.leerKeywordsCrudo(comoCliente);

  assert.equal(filas.length, 0, "el research del vecino NO se ve");
});

test("🔴 el rol 'cliente' NO puede leer páginas de otro cliente del MISMO tenant", async () => {
  const runOtro = await store.createRun(ctxA(), nuevoRun(clientA2));
  await store.savePages(ctxA(), runOtro, clientA2, [page()]);

  const comoCliente: TenantContext = { tenantId: tenantA, userId: duenoA1 };
  const filas = await store.leerPaginasCrudo(comoCliente);

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
      store.sqlCrudo(
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

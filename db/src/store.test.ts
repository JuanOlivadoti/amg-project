import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PgStore } from "./store.js";
import { PglitePool } from "./pool.js";
import { aplicarMigraciones } from "./migrate.js";
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
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [
    page(),
    page({ url_slug: "/menu-del-dia", cluster_id: "22222222-2222-4222-8222-222222222222" }),
  ]);

  // El humano aprueba las dos, y el run.
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctxA(), r.id);
  await store.approveRun(ctxA(), runId);

  // Recalibración: el research ya NO propone /menu-del-dia.
  await store.savePages(ctxA(), runId, clientA1, [page()]);

  const publicables = await store.getPublishablePages(ctxA(), runId);

  assert.equal(publicables.length, 1, "la página retirada NO sale, aunque estuviera aprobada");
  assert.equal(publicables[0]!.url_slug, "/pizza-napolitana-madrid");
});

/** Un research que no propone NADA tiene que retirar todo, no dejar lo viejo publicable. */
test("🔴 un research sin páginas RETIRA las anteriores (no las deja aprobadas)", async () => {
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);
  await store.approveRun(ctxA(), runId);

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
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, [page()]);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(ctxA(), rows[0]!.id);
  await store.approveRun(ctxA(), runId);

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
  const runId = await store.createRun(ctxA(), nuevoRun(clientA1));
  await store.savePages(ctxA(), runId, clientA1, briefDosNiveles());
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctxA(), r.id);
  await store.approveRun(ctxA(), runId);

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
       values ($1, $2, $3, gen_random_uuid(), 'blog', $4, 'kw', 'informacional', 'sin_validar', 99)`,
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
         values ($1, $2, $3, gen_random_uuid(), 'blog', '/negativa', 'kw', 'informacional',
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
         values ($1, $2, $3, gen_random_uuid(), 'blog', '/retirada-con-puesto', 'kw', 'informacional',
                 'sin_validar', true, 3)`,
        [tenantA, runId, clientA1],
      ),
    /retirada_sin_posicion/,
    "lo tira el check nombrado, no un if de TypeScript",
  );
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

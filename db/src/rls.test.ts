import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * Tests de RLS (ADR-10: "policy RLS de aislamiento en TODAS las tablas de tenant, con tests RLS
 * antes de F1").
 *
 * El aislamiento entre tenants es la garantía que se le vende al cliente: los datos de un
 * restaurante no los ve la agencia de al lado. Si eso se rompe, no es un bug — es una brecha.
 *
 * Corren contra Postgres 18 real (PGlite en WASM), no contra un mock: el aislamiento depende de la
 * semántica exacta de Postgres (FORCE vs ENABLE, USING vs WITH CHECK, el cast de un GUC vacío), y
 * un mock reproduciría mis suposiciones en vez de la realidad.
 */

let db: TestDb;
let s: Seed;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
});

after(async () => {
  await db.close();
});

const UUID_CUALQUIERA = "99999999-9999-9999-9999-999999999999";

// ---------------------------------------------------------------- lectura

test("RLS: un tenant NO ve los clientes de otro", async () => {
  const rows = await db.asUser(
    { tenantId: s.tenantA, role: "equipo" },
    "select id, nombre from clients order by nombre",
  );

  assert.equal(rows.length, 2, "el tenant A tiene 2 clientes propios");
  const ids = rows.map((r) => (r as { id: string }).id);
  assert.ok(!ids.includes(s.clientB1), "NO puede ver el cliente del tenant B");
});

test("RLS: un tenant NO ve los runs de otro", async () => {
  const rows = await db.asUser({ tenantId: s.tenantB, role: "equipo" }, "select id from kr_runs");

  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { id: string }).id, s.runB1);
});

test("RLS: pedir explícitamente el id de otro tenant devuelve VACÍO, no el dato", async () => {
  // El ataque obvio: conozco el UUID del cliente ajeno y lo pido por id.
  const rows = await db.asUser({ tenantId: s.tenantA, role: "equipo" }, "select * from clients where id = $1", [
    s.clientB1,
  ]);

  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------- falla cerrado

test("RLS: SIN tenant en el contexto no se ve NADA (falla cerrado, no revienta)", async () => {
  // Sin el `nullif` en app.current_tenant_id(), un GUC ausente es '' y `''::uuid` LANZA un error:
  // la petición no devolvería "cero filas", reventaría la query. Un control de acceso tiene que
  // fallar cerrado y en silencio.
  const rows = await db.asUser({ tenantId: null, role: null }, "select id from clients");

  assert.equal(rows.length, 0);
});

test("RLS: un tenant_id inexistente no ve nada", async () => {
  const rows = await db.asUser({ tenantId: UUID_CUALQUIERA, role: "maestro" }, "select id from clients");

  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------- escritura

test("RLS: un tenant NO puede INSERTAR una fila marcada con el tenant de otro", async () => {
  // Sin `with check`, el `using` solo filtra lecturas: se podría escribir dentro del tenant ajeno.
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, role: "maestro" },
        "insert into clients (tenant_id, nombre) values ($1, 'inyectado')",
        [s.tenantB],
      ),
    /row-level security/i,
  );
});

test("RLS: un tenant NO puede ACTUALIZAR filas de otro", async () => {
  const rows = await db.asUser(
    { tenantId: s.tenantA, role: "maestro" },
    "update clients set nombre = 'hackeado' where id = $1 returning id",
    [s.clientB1],
  );

  assert.equal(rows.length, 0, "el update no debe alcanzar ninguna fila ajena");

  // Y de verdad no cambió nada.
  const [victima] = await db.asService<{ nombre: string }>("select nombre from clients where id = $1", [
    s.clientB1,
  ]);
  assert.equal(victima!.nombre, "Sushi Zen");
});

test("RLS: un tenant NO puede BORRAR filas de otro", async () => {
  const rows = await db.asUser(
    { tenantId: s.tenantA, role: "maestro" },
    "delete from clients where id = $1 returning id",
    [s.clientB1],
  );

  assert.equal(rows.length, 0);

  const restantes = await db.asService("select id from clients where id = $1", [s.clientB1]);
  assert.equal(restantes.length, 1, "el cliente ajeno sigue existiendo");
});

test("RLS: no se puede reasignar una fila propia a otro tenant (fuga por UPDATE)", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, role: "maestro" },
        "update clients set tenant_id = $1 where id = $2",
        [s.tenantB, s.clientA1],
      ),
    /row-level security/i,
  );
});

// ---------------------------------------------------------------- RBAC: rol "cliente"

test("RBAC: el rol 'cliente' solo ve SU cliente, no la cartera del tenant", async () => {
  // El dueño del restaurante entra al portal: no puede ver los otros clientes de la agencia.
  const rows = await db.asUser(
    { tenantId: s.tenantA, role: "cliente", clientId: s.clientA1 },
    "select id from clients",
  );

  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { id: string }).id, s.clientA1);
});

test("RBAC: el rol 'cliente' no ve los runs de otro cliente del MISMO tenant", async () => {
  await db.asService(
    `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country, market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'otro negocio', 'ES', 'es', 2724)`,
    [s.tenantA, s.clientA2],
  );

  const rows = await db.asUser(
    { tenantId: s.tenantA, role: "cliente", clientId: s.clientA1 },
    "select id from kr_runs",
  );

  assert.equal(rows.length, 1, "solo el run de SU cliente");
  assert.equal((rows[0] as { id: string }).id, s.runA1);
});

test("RBAC: 'equipo' SÍ ve todos los clientes de su tenant", async () => {
  const rows = await db.asUser({ tenantId: s.tenantA, role: "equipo" }, "select id from clients");

  assert.equal(rows.length, 2);
});

// ---------------------------------------------------------------- caches: deny-all

test("caches: app_user NO puede leer kr_metrics_cache (deny-all + sin grant)", async () => {
  // Las caches no tienen tenant_id (el volumen de una keyword es un dato del MERCADO, se comparte
  // entre tenants y por eso la 2ª corrida sale gratis). Justamente por eso NO pueden quedar
  // expuestas a la política de tenant: van deny-all y solo las toca la service-role.
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, role: "maestro" }, "select * from kr_metrics_cache"),
    /permission denied|row-level security/i,
  );
});

test("caches: app_user NO puede leer kr_serp_cache", async () => {
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, role: "maestro" }, "select * from kr_serp_cache"),
    /permission denied|row-level security/i,
  );
});

test("caches: app_user NO puede leer kr_provider_tasks", async () => {
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, role: "maestro" }, "select * from kr_provider_tasks"),
    /permission denied|row-level security/i,
  );
});

test("caches: la service-role SÍ puede (es la que las usa)", async () => {
  await db.asService(
    `insert into kr_metrics_cache (cache_key, endpoint, canonical_key, location_code, language_code, payload, expires_at)
     values ('k1', 'search_volume', 'pizza napolitana madrid', 2724, 'es', '{"volume":390}', now() + interval '30 days')`,
  );

  const rows = await db.asService("select cache_key from kr_metrics_cache");
  assert.equal(rows.length, 1);
});

// ---------------------------------------------------------------- hijos del run

test("RLS: las keywords y páginas heredan el aislamiento", async () => {
  await db.asService(
    `insert into kr_keywords (tenant_id, run_id, client_id, keyword, canonical_key, source)
     values ($1, $2, $3, 'pizza napolitana madrid', 'pizza napolitana madrid', 'seed')`,
    [s.tenantB, s.runB1, s.clientB1],
  );
  await db.asService(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal, intencion, evidencia)
     values ($1, $2, $3, gen_random_uuid(), 'landing_local', '/pizza', 'pizza napolitana madrid', 'local', 'datos_mercado')`,
    [s.tenantB, s.runB1, s.clientB1],
  );

  const kws = await db.asUser({ tenantId: s.tenantA, role: "maestro" }, "select id from kr_keywords");
  const pages = await db.asUser({ tenantId: s.tenantA, role: "maestro" }, "select id from kr_pages");

  assert.equal(kws.length, 0, "el tenant A no ve las keywords del B");
  assert.equal(pages.length, 0, "el tenant A no ve las páginas del B");
});

// ---------------------------------------------------------------- el agujero clásico

test("RLS: FORCE está activo — ni el dueño de la tabla salta las políticas", async () => {
  // ADR-10 lo marca explícitamente: "policy RLS ... (no solo `enable`)". Con `enable` a secas, el
  // DUEÑO de la tabla ignora las políticas, y en Supabase el owner es quien corre las migraciones.
  const rows = await db.asService<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    `select relname, relrowsecurity, relforcerowsecurity from pg_class
     where relname in ('tenants','memberships','clients','kr_runs','kr_keywords','kr_pages',
                       'kr_metrics_cache','kr_serp_cache','kr_provider_tasks')
     order by relname`,
  );

  assert.equal(rows.length, 9);
  for (const r of rows) {
    assert.equal(r.relrowsecurity, true, `${r.relname}: RLS no está habilitado`);
    assert.equal(r.relforcerowsecurity, true, `${r.relname}: falta FORCE (el owner saltaría RLS)`);
  }
});

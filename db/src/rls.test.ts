import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * Tests de RLS (ADR-10) contra Postgres 18 real (PGlite en WASM), no contra un mock: el aislamiento
 * depende de la semántica exacta de Postgres (FORCE vs ENABLE, USING vs WITH CHECK, el cast de un
 * GUC vacío), y un mock reproduciría mis suposiciones en vez de la realidad.
 *
 * El aislamiento entre tenants es la garantía que se le vende al cliente: los datos de un
 * restaurante no los ve la agencia de al lado. Si eso se rompe, no es un bug — es una brecha.
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
    { tenantId: s.tenantA, userId: s.equipoA },
    "select id, nombre from clients order by nombre",
  );

  assert.equal(rows.length, 2, "el tenant A tiene 2 clientes propios");
  const ids = rows.map((r) => (r as { id: string }).id);
  assert.ok(!ids.includes(s.clientB1), "NO puede ver el cliente del tenant B");
});

test("RLS: un tenant NO ve los runs de otro", async () => {
  const rows = await db.asUser({ tenantId: s.tenantB, userId: s.equipoB }, "select id from kr_runs");

  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { id: string }).id, s.runB1);
});

test("RLS: pedir explícitamente el id de otro tenant devuelve VACÍO, no el dato", async () => {
  // El ataque obvio: conozco el UUID del cliente ajeno y lo pido por id.
  const rows = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select * from clients where id = $1",
    [s.clientB1],
  );

  assert.equal(rows.length, 0);
});

// ================================================================
// OBS-02 cerrado: el rol ya no se declara, se DERIVA de memberships
// ================================================================

/**
 * EL TEST QUE JUSTIFICA LA MIGRACIÓN 0002.
 *
 * Antes, el rol venía en el contexto de la petición. Con un portal HTTP del otro lado, cualquiera
 * podía mandar `role: maestro` y la base le creía. Ahora el rol sale de una membresía real: un
 * usuario **sin membresía** no es nadie, por más que reclame un tenant válido.
 */
test("🔴 un usuario SIN membresía no ve NADA, aunque reclame un tenant válido", async () => {
  const rows = await db.asUser({ tenantId: s.tenantA, userId: s.intruso }, "select id from clients");

  assert.equal(rows.length, 0, "sin membresía no hay rol, y sin rol no hay acceso");
});

/**
 * El GUC `app.role` ya no lo lee nadie. Este test lo SETEA a mano —simulando exactamente el ataque
 * que antes funcionaba— y comprueba que no sirve para nada.
 */
test("🔴 declararse 'maestro' a mano NO da acceso: el GUC app.role ya no se lee", async () => {
  await db.exec("begin");
  await db.exec(`select set_config('app.tenant_id', '${s.tenantA}', true)`);
  await db.exec(`select set_config('app.user_id', '${s.intruso}', true)`);
  await db.exec("select set_config('app.role', 'maestro', true)"); // ← el ataque
  await db.exec("set local role app_user");

  const rows = await db.queryEnTx("select id from clients");
  await db.exec("rollback");

  assert.equal(rows.length, 0, "el rol declarado no tiene NINGÚN efecto");
});

/** Un usuario del tenant A no puede usar su identidad para mirar dentro del tenant B. */
test("🔴 reclamar el tenant de otro no sirve: no hay membresía allí", async () => {
  const rows = await db.asUser({ tenantId: s.tenantB, userId: s.equipoA }, "select id from clients");

  assert.equal(rows.length, 0, "equipoA no es miembro del tenant B");
});

test("RLS: el rol sale de memberships — 'equipo' SÍ ve todos los clientes de SU tenant", async () => {
  const rows = await db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select id from clients");

  assert.equal(rows.length, 2);
});

// ---------------------------------------------------------------- falla cerrado

test("RLS: SIN identidad no se ve NADA (falla cerrado, no revienta)", async () => {
  // Sin el `nullif` en app.current_tenant_id(), un GUC ausente es '' y `''::uuid` LANZA un error:
  // la petición no devolvería "cero filas", reventaría la query. Un control de acceso tiene que
  // fallar cerrado y en silencio.
  const rows = await db.asUser({ tenantId: null, userId: null }, "select id from clients");

  assert.equal(rows.length, 0);
});

test("RLS: un tenant_id inexistente no ve nada", async () => {
  const rows = await db.asUser(
    { tenantId: UUID_CUALQUIERA, userId: s.equipoA },
    "select id from clients",
  );

  assert.equal(rows.length, 0);
});

// ---------------------------------------------------------------- escritura

test("RLS: un tenant NO puede INSERTAR una fila marcada con el tenant de otro", async () => {
  // Sin `with check`, el `using` solo filtra lecturas: se podría escribir dentro del tenant ajeno.
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "insert into clients (tenant_id, nombre) values ($1, 'inyectado')",
        [s.tenantB],
      ),
    /row-level security/i,
  );
});

test("RLS: un tenant NO puede ACTUALIZAR filas de otro", async () => {
  const rows = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update clients set nombre = 'hackeado' where id = $1 returning id",
    [s.clientB1],
  );

  assert.equal(rows.length, 0, "el update no debe alcanzar ninguna fila ajena");

  const [victima] = await db.asService<{ nombre: string }>("select nombre from clients where id = $1", [
    s.clientB1,
  ]);
  assert.equal(victima!.nombre, "Sushi Zen");
});

test("RLS: un tenant NO puede BORRAR filas de otro", async () => {
  const rows = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
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
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set tenant_id = $1 where id = $2",
        [s.tenantB, s.clientA1],
      ),
    /row-level security/i,
  );
});

// ---------------------------------------------------------------- RBAC: rol "cliente"

test("RBAC: el rol 'cliente' solo ve SU cliente, no la cartera del tenant", async () => {
  // El dueño del restaurante entra al portal: no puede ver los otros clientes de la agencia.
  const rows = await db.asUser({ tenantId: s.tenantA, userId: s.duenoA1 }, "select id from clients");

  assert.equal(rows.length, 1);
  assert.equal((rows[0] as { id: string }).id, s.clientA1);
});

test("RBAC: el rol 'cliente' no ve los runs de otro cliente del MISMO tenant", async () => {
  await db.asService(
    `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country,
                          market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'otro negocio', 'ES', 'es', 2724)`,
    [s.tenantA, s.clientA2],
  );

  const rows = await db.asUser({ tenantId: s.tenantA, userId: s.duenoA1 }, "select id from kr_runs");

  assert.equal(rows.length, 1, "solo el run de SU cliente");
  assert.equal((rows[0] as { id: string }).id, s.runA1);
});

// ---------------------------------------------------------------- caches: deny-all

test("caches: app_user NO puede leer kr_metrics_cache (deny-all + sin grant)", async () => {
  // Las caches no tienen tenant_id (el volumen de una keyword es un dato del MERCADO, se comparte
  // entre tenants y por eso la 2ª corrida sale gratis). Justamente por eso NO pueden quedar
  // expuestas a la política de tenant: van deny-all y solo las toca la service-role.
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select * from kr_metrics_cache"),
    /permission denied|row-level security/i,
  );
});

test("caches: app_user NO puede leer kr_serp_cache", async () => {
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select * from kr_serp_cache"),
    /permission denied|row-level security/i,
  );
});

test("caches: app_user NO puede leer kr_provider_tasks", async () => {
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select * from kr_provider_tasks"),
    /permission denied|row-level security/i,
  );
});

/** Ni siquiera el orquestador: el registro de tareas revelaría qué investigó cada tenant. */
test("caches: ni app_service puede leerlas (solo la service-role de infraestructura)", async () => {
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, servicio: true }, "select * from kr_provider_tasks"),
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

  const kws = await db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select id from kr_keywords");
  const pages = await db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select id from kr_pages");

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

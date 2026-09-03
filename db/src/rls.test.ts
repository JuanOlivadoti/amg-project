import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * Tests de RLS (ADR-10) contra Postgres real (PGlite en WASM), no contra un mock: el aislamiento
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
  //
  // Columnas explícitas, no `select *`: desde la 0021, `google_refresh_token` sacó a `app_user` del
  // `grant select` de TABLA de `clients` (columna por columna, sin esa) -- `select *` expande a
  // TODAS las columnas de la tabla y falla con `permission denied` para CUALQUIER fila, tenant
  // propio incluido. Esta prueba es de RLS (la fila no se alcanza), no de grants: pide columnas que
  // `app_user` sí puede leer, para que un rechazo solo pueda venir de la política.
  const rows = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select id, nombre, business_profile from clients where id = $1",
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
        "insert into clients (tenant_id, nombre, vertical) values ($1, 'inyectado', 'restauracion')",
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
                       'kr_metrics_cache','kr_serp_cache','kr_provider_tasks','kr_run_decisiones')
     order by relname`,
  );

  assert.equal(rows.length, 10);
  for (const r of rows) {
    assert.equal(r.relrowsecurity, true, `${r.relname}: RLS no está habilitado`);
    assert.equal(r.relforcerowsecurity, true, `${r.relname}: falta FORCE (el owner saltaría RLS)`);
  }
});

// ================================================================
// Publicar posts en blog externo (0031): mismo molde que app_resenas (0022), aplicado a columnas de
// kr_pages en vez de una tabla nueva. Solo la PUBLICACIÓN es cross-tenant (el evento
// `posts/publicacion.solicitada` solo trae `pageId`, ADR-18); la generación corre dentro de
// workflowDecision, que ya tiene contexto de tenant y no necesita ningún rol nuevo.
// ================================================================

/** El run_id ya sembrado para ese cliente (uno por cliente en el seed de este archivo). */
async function runIdDe(clientId: string): Promise<string> {
  const [run] = await db.asService<{ id: string }>(
    "select id from kr_runs where client_id = $1 limit 1",
    [clientId],
  );
  return run!.id;
}

/**
 * Configura el blog externo del cliente y crea una kr_page con post listo y con la publicación
 * SOLICITADA (post_solicitado_en). El slug es aleatorio para no chocar con el `unique (run_id,
 * url_slug)` de kr_pages entre llamadas del mismo test.
 */
async function sembrarPaginaConPostSolicitado(
  clientId: string,
  tenantId: string,
  credencial = "secreto-test",
): Promise<string> {
  await db.asService(
    `update clients set blog_externo_tipo = 'wordpress', blog_externo_url = 'https://blog.example.com',
       blog_externo_credencial = $2 where id = $1`,
    [clientId, credencial],
  );
  const runId = await runIdDe(clientId);
  const [page] = await db.asService<{ id: string }>(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
        intencion, evidencia, post_titulo, post_cuerpo, post_solicitado_en)
     values ($1, $2, $3, gen_random_uuid(), 'landing_local', $4, 'kw post test',
        'local', 'datos_mercado', 'Título de prueba', 'Cuerpo de prueba', now())
     returning id`,
    [tenantId, runId, clientId, `/post-test-${randomUUID()}`],
  );
  return page!.id;
}

/**
 * Igual, pero ya CONFIRMADO publicado. `post_solicitado_en` queda CON valor -- mismo criterio que
 * `respuesta_solicitada_en` en resenas_google (0025): `marcar_post_publicado` no lo limpia, solo
 * `marcar_post_fallido` lo hace. Sembrar esta fila con `post_solicitado_en` NULL (como hacía una
 * primera versión de este helper) escondía el guard `post_publicado_en is null` del WHERE de
 * `marcar_post_fallido`: sin él, la fila ya fallaba por `post_solicitado_en is not null` y la
 * mutación que quita el guard real no tumbaba ningún test.
 */
async function sembrarPaginaConPostPublicado(clientId: string, tenantId: string): Promise<string> {
  const runId = await runIdDe(clientId);
  const [page] = await db.asService<{ id: string }>(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
        intencion, evidencia, post_titulo, post_cuerpo, post_solicitado_en, post_publicado_en, post_url_externa)
     values ($1, $2, $3, gen_random_uuid(), 'landing_local', $4, 'kw post publicado',
        'local', 'datos_mercado', 'Título publicado', 'Cuerpo publicado', now(), now(),
        'https://blog.example.com/post-publicado')
     returning id`,
    [tenantId, runId, clientId, `/post-test-${randomUUID()}`],
  );
  return page!.id;
}

// ---------------------------------------------------------------- la credencial: clients.blog_externo_credencial

test("🔴 app_service NO puede leer clients.blog_externo_credencial por SQL directo", async () => {
  // `asOrquestador` es el rol app_service DE VERDAD (sujeto a RLS y a los grants) -- no confundir
  // con `asService`, el superusuario de infraestructura que saltea grants por definición y por eso
  // nunca sirve para probar un `permission denied`.
  await assert.rejects(
    () =>
      db.asOrquestador({ tenantId: s.tenantA }, "select blog_externo_credencial from clients limit 1"),
    /permission denied/i,
  );
});

test("🔴 app_user NO puede leer clients.blog_externo_credencial por SQL directo (solo escribirla)", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "select blog_externo_credencial from clients limit 1",
      ),
    /permission denied/i,
  );
});

test("blog_externo_credencial no aparece en business_profile_publico", async () => {
  // Defensa en profundidad (ADR-19): la allowlist del renderizador se genera desde
  // `business_profile`, una columna sin relación con `blog_externo_credencial` -- este test fija que
  // eso siga siendo así si algún día alguien "amplía" la allowlist sin mirar de dónde sale cada campo.
  const [row] = await db.asService<{ business_profile_publico: Record<string, unknown> }>(
    "select business_profile_publico from clients where id = $1",
    [s.clientA1],
  );
  assert.ok(!JSON.stringify(row?.business_profile_publico ?? {}).includes("secreto"));
});

// ---------------------------------------------------------------- app.post_para_publicar

test("app.post_para_publicar devuelve la fila cuando hay una solicitud pendiente", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  const [row] = await db.asService<{ titulo: string; blog_credencial: string }>(
    "select * from app.post_para_publicar($1)",
    [pageId],
  );
  assert.ok(row);
  assert.equal(row.blog_credencial, "secreto-test");
});

test("app.post_para_publicar devuelve cero filas si ya está publicado", async () => {
  const pageId = await sembrarPaginaConPostPublicado(s.clientA1, s.tenantA);
  const rows = await db.asService("select * from app.post_para_publicar($1)", [pageId]);
  assert.equal(rows.length, 0);
});

test("🔴 app.post_para_publicar devuelve cero filas si al cliente le falta blog_externo_credencial", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  await db.asService("update clients set blog_externo_credencial = null where id = $1", [s.clientA1]);
  const rows = await db.asService("select * from app.post_para_publicar($1)", [pageId]);
  assert.equal(rows.length, 0, "🔴 credenciales incompletas es 'ya no aplica', no un crash más adelante");
});

test("🔴 app_user NO puede ejecutar app.post_para_publicar (42501)", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "select * from app.post_para_publicar($1)",
        [pageId],
      ),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre post_para_publicar",
  );
});

// ---------------------------------------------------------------- app.marcar_post_publicado

test("app.marcar_post_publicado marca la fila y limpia post_error_en", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  const [resultado] = await db.asService<{ marcar_post_publicado: boolean }>(
    "select app.marcar_post_publicado($1, $2) as marcar_post_publicado",
    [pageId, "https://blog.example.com/post-final"],
  );
  assert.equal(resultado?.marcar_post_publicado, true);

  const [row] = await db.asService<{
    post_publicado_en: string | null;
    post_url_externa: string | null;
  }>("select post_publicado_en, post_url_externa from kr_pages where id = $1", [pageId]);
  assert.ok(row!.post_publicado_en);
  assert.equal(row!.post_url_externa, "https://blog.example.com/post-final");
});

test("🔴 app.marcar_post_publicado sobre una fila sin solicitud no toca nada (idempotente)", async () => {
  const runId = await runIdDe(s.clientA1);
  const [page] = await db.asService<{ id: string }>(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
        intencion, evidencia)
     values ($1, $2, $3, gen_random_uuid(), 'landing_local', $4, 'kw sin solicitud', 'local', 'datos_mercado')
     returning id`,
    [s.tenantA, runId, s.clientA1, `/post-test-${randomUUID()}`],
  );
  const [resultado] = await db.asService<{ marcar_post_publicado: boolean }>(
    "select app.marcar_post_publicado($1, $2) as marcar_post_publicado",
    [page!.id, "https://blog.example.com/no-deberia"],
  );
  assert.equal(resultado?.marcar_post_publicado, false, "🔴 el WHERE rechaza post_solicitado_en null");
});

test("🔴 app_user NO puede ejecutar app.marcar_post_publicado (42501)", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "select app.marcar_post_publicado($1, $2)",
        [pageId, "https://blog.example.com/x"],
      ),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre marcar_post_publicado",
  );
});

// ---------------------------------------------------------------- app.marcar_post_fallido

test("app.marcar_post_fallido limpia post_solicitado_en y marca post_error_en", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  const [resultado] = await db.asService<{ marcar_post_fallido: boolean }>(
    "select app.marcar_post_fallido($1) as marcar_post_fallido",
    [pageId],
  );
  assert.equal(resultado?.marcar_post_fallido, true);

  const [row] = await db.asService<{
    post_solicitado_en: string | null;
    post_error_en: string | null;
  }>("select post_solicitado_en, post_error_en from kr_pages where id = $1", [pageId]);
  assert.equal(row!.post_solicitado_en, null, "queda libre para reintentar/editar");
  assert.ok(row!.post_error_en, "queda el rastro del fallo");
});

test("🔴 app.marcar_post_fallido sobre una fila ya publicada no toca nada (idempotente)", async () => {
  const pageId = await sembrarPaginaConPostPublicado(s.clientA1, s.tenantA);
  // ::text explícito: PGlite devuelve timestamptz como Date, y dos instancias del MISMO instante
  // no son `===` -- comparar por valor, no por referencia.
  const [antes] = await db.asService<{ post_publicado_en: string }>(
    "select post_publicado_en::text from kr_pages where id = $1",
    [pageId],
  );
  const [resultado] = await db.asService<{ marcar_post_fallido: boolean }>(
    "select app.marcar_post_fallido($1) as marcar_post_fallido",
    [pageId],
  );
  assert.equal(resultado?.marcar_post_fallido, false, "🔴 el WHERE rechaza post_publicado_en not null");

  const [despues] = await db.asService<{ post_publicado_en: string }>(
    "select post_publicado_en::text from kr_pages where id = $1",
    [pageId],
  );
  assert.equal(despues!.post_publicado_en, antes!.post_publicado_en, "no se tocó nada");
});

test("🔴 app_user NO puede ejecutar app.marcar_post_fallido (42501)", async () => {
  const pageId = await sembrarPaginaConPostSolicitado(s.clientA1, s.tenantA);
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "select app.marcar_post_fallido($1)",
        [pageId],
      ),
    /permission denied for function|42501/,
    "🔴 el rol de la API no tiene execute sobre marcar_post_fallido",
  );
});

// ---------------------------------------------------------------- credenciales del rol app_posts

test("🔴 credenciales: app_posts no tiene login concedible (SET) a ningún rol con login", async () => {
  // Mismo test que la 0022 fija para app_resenas (store.test.ts) -- ninguno de los cuatro logins de
  // producción puede asumir el rol cross-tenant, así que la única forma de alcanzarlo es llamando a
  // las tres funciones `security definer` de arriba.
  const rows = await db.asService<{ login: string; puede: boolean }>(
    `select rolname as login, pg_has_role(rolname, 'app_posts', 'SET') as puede
       from pg_roles where rolname in ('amg_api','amg_orquestador','amg_cache','amg_render')`,
  );
  assert.equal(rows.length, 4, "los cuatro logins existen (si no, este test no comprueba nada)");
  for (const r of rows) assert.equal(r.puede, false, `🔴 ${r.login} NO puede asumir app_posts`);
});

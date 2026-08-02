import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones, PglitePool, PgStore, PgClientes, PgMembresias } from "db";
import type { TenantContext } from "db";
import { createApp } from "./app.js";
import type { EmisorEventos } from "./solicitar.js";
import { NO_DISPONIBLE, type VerificadorToken } from "./auth.js";

/**
 * La API entera contra Postgres REAL (PGlite), sin red y sin Supabase.
 *
 * El verificador de token y el emisor de Inngest se INYECTAN de mentira: así se prueba lo único que
 * la API decide de verdad —afirmar quién es y ordenar escritura-antes-de-evento— mientras la
 * autorización la hace RLS de verdad. Un test que mockeara RLS no probaría nada: el bug siempre está
 * en la semántica exacta de Postgres.
 *
 * El foco es el CONTRATO de seguridad, no la mecánica de Hono:
 *  · un comando compuesto rechazado por RLS **no puede** haber emitido el evento;
 *  · el rol `cliente` lee pero no escribe (ADR-20), y eso lo impone la base;
 *  · un tenant no ve los runs de otro.
 */

let pg: PGlite;
let store: PgStore;
let clientes: PgClientes;
let membresias: PgMembresias;
let eventos: Array<{ name: string; data: Record<string, unknown> }>;
let app: ReturnType<typeof createApp>;

// Datos sembrados (superusuario: saltea RLS, es lo que hace la infra, no la app).
let tenantA: string;
let tenantB: string;
let clientA1: string;
let equipoA: string; // rol equipo en A: puede escribir
let duenoA1: string; // rol cliente en A, atado a clientA1: SOLO lectura
let equipoB: string; // rol equipo en B
let maestroA: string; // rol maestro en A: el único que puede cambiar roles (pieza 2 — Usuarios)
let intruso: string; // uuid sin ninguna membresía
let runA1: string;
let pageA1: string;

/** Verificador falso: `valid:<uuid>` es un token bueno para ese usuario; cualquier otra cosa, 401. */
const verificar: VerificadorToken = async (token) =>
  token.startsWith("valid:") ? { userId: token.slice(6) } : null;

async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const res = await pg.query<T>(q, params);
  return res.rows;
}

beforeEach(async () => {
  pg = new PGlite();
  await aplicarMigraciones(pg);
  const pool = new PglitePool(pg);
  store = new PgStore(pool); // amg_api → app_user
  clientes = new PgClientes(pool); // mismo login/rol
  membresias = new PgMembresias(pool); // mismo login/rol
  eventos = [];
  const emisor: EmisorEventos = {
    send: async (e) => {
      eventos.push(e);
      return {};
    },
  };
  app = createApp({ store, clientes, membresias, emisor, verificar });

  // --- seed (superusuario) ---
  [tenantA, tenantB] = (
    await sql<{ id: string }>(
      `insert into tenants (nombre, slug)
       values ('Agencia A','agencia-a'), ('Agencia B','agencia-b') returning id`,
    )
  ).map((r) => r.id) as [string, string];

  [clientA1] = (
    await sql<{ id: string }>("insert into clients (tenant_id, nombre) values ($1,'Bella Napoli') returning id", [
      tenantA,
    ])
  ).map((r) => r.id) as [string];

  const mkMembresia = async (tenantId: string, rol: string, clientId: string | null) =>
    (
      await sql<{ user_id: string }>(
        `insert into memberships (tenant_id, user_id, rol, client_id)
         values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
        [tenantId, rol, clientId],
      )
    )[0]!.user_id;

  equipoA = await mkMembresia(tenantA, "equipo", null);
  duenoA1 = await mkMembresia(tenantA, "cliente", clientA1);
  maestroA = await mkMembresia(tenantA, "maestro", null);
  equipoB = await mkMembresia(tenantB, "equipo", null);
  intruso = (await sql<{ id: string }>("select gen_random_uuid() as id"))[0]!.id;

  // `membresias_perfil` (0012) cruza `memberships` con `auth.users` por INNER JOIN -- sin una fila
  // acá, GET /members los dejaría afuera aunque la membresía exista. `auth.users` no es nuestra
  // tabla (stand-in de `migrate.ts`), así que se completa a mano, mismo criterio que
  // `membresias.test.ts` (Etapa 1).
  await sql(
    `insert into auth.users (id, email, raw_app_meta_data) values
       ($1, 'equipoA@agencia-a.test', '{}'::jsonb),
       ($2, 'dueno.a1@bellanapoli.test', '{}'::jsonb),
       ($3, 'maestroA@agencia-a.test', '{}'::jsonb)`,
    [equipoA, duenoA1, maestroA],
  );

  runA1 = (
    await sql<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code)
       values ($1,$2,'kr.v0.5','pending_approval','prompt', 'ES','es',2724) returning id`,
      [tenantA, clientA1],
    )
  )[0]!.id;

  pageA1 = (
    await sql<{ id: string }>(
      `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                             keyword_principal, keywords_secundarias, intencion, local, volumen,
                             dificultad, evidencia, opportunity_score, score_confidence, seo,
                             content_brief, preguntas_frecuentes, approved, retirada)
       values ($1,$2,$3, gen_random_uuid(), 'landing_local', '/pizza-napolitana',
               'pizza napolitana madrid', array['pizza napolitana'], 'local', true, 390,
               15, 'datos_mercado', 84, 1, '{}'::jsonb, '{}'::jsonb, array['¿Reservan?'],
               false, false) returning id`,
      [tenantA, runA1, clientA1],
    )
  )[0]!.id;
});

afterEach(async () => {
  await pg.close();
});

/** Construye una request para la app. `user` es el uuid; el token bueno se arma solo. */
async function req(
  method: string,
  path: string,
  opts: { user?: string; tenant?: string; body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.token !== undefined) headers["authorization"] = `Bearer ${opts.token}`;
  else if (opts.user) headers["authorization"] = `Bearer valid:${opts.user}`;
  if (opts.tenant) headers["x-amg-tenant"] = opts.tenant;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return app.request(path, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

const ctxServicio = (): TenantContext => ({ tenantId: tenantA });

// ---------------------------------------------------------------- autenticación

test("GET /health responde 200 SIN token (lo sondea el PaaS)", async () => {
  const res = await app.request("/health");
  assert.equal(res.status, 200, "el health-check no exige JWT: si no, no serviría de health-check");
  assert.deepEqual(await res.json(), { status: "ok" });
});

test("sin token → 401", async () => {
  const res = await req("GET", "/runs", { tenant: tenantA });
  assert.equal(res.status, 401);
});

test("token inválido → 401", async () => {
  const res = await req("GET", "/runs", { token: "basura", tenant: tenantA });
  assert.equal(res.status, 401);
});

test("token válido pero sin header de tenant → 400", async () => {
  const res = await req("GET", "/runs", { user: equipoA });
  assert.equal(res.status, 400);
});

test("tenant que no es un uuid → 400 (y no llega a la base)", async () => {
  const res = await req("GET", "/runs", { user: equipoA, tenant: "no-soy-uuid" });
  assert.equal(res.status, 400);
});

test("CORS: el preflight (OPTIONS) responde con allow-origin y SIN exigir token", async () => {
  // El navegador manda el preflight antes del request real. Si auth corriera primero, lo bloquearía
  // y el portal nunca podría llamar a la API.
  const res = await app.request("/runs", {
    method: "OPTIONS",
    headers: {
      origin: "http://localhost:4200",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization,x-amg-tenant",
    },
  });
  assert.ok(res.status === 204 || res.status === 200);
  assert.ok(res.headers.get("access-control-allow-origin"));
});

// ---------------------------------------------------------------- POST /runs (comando compuesto)

test("POST /runs: el equipo crea la fila y SE EMITE el evento, en ese orden", async () => {
  const res = await req("POST", "/runs", {
    user: equipoA,
    tenant: tenantA,
    body: { clientId: clientA1, prompt: "Restaurante italiano en Madrid" },
  });
  assert.equal(res.status, 201);
  const { runId } = (await res.json()) as { runId: string };

  // La fila existe de verdad (creada bajo RLS como el humano).
  const filas = await sql<{ id: string; status: string }>("select id, status from kr_runs where id = $1", [runId]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.status, "running");

  // Y se emitió EXACTAMENTE un evento, con solo coordenadas (ADR-18): ni prompt ni cliente.
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0], { name: "research/solicitado", data: { runId, tenantId: tenantA } });
});

test("🔴 POST /runs de un intruso: RLS lo frena → 403 y NO se emite NINGÚN evento", async () => {
  // El corazón del comando compuesto: si el insert no se autorizó, el orquestador NO puede arrancar.
  const res = await req("POST", "/runs", {
    user: intruso,
    tenant: tenantA,
    body: { clientId: clientA1, prompt: "research ajeno" },
  });
  assert.equal(res.status, 403);
  assert.equal(eventos.length, 0, "un comando compuesto rechazado no puede haber emitido el evento");

  const filas = await sql("select id from kr_runs where prompt = 'research ajeno'");
  assert.equal(filas.length, 0, "no se creó ninguna fila");
});

test("🔴 POST /runs de un CLIENTE: es solo-lectura (ADR-20) → 403, sin evento", async () => {
  const res = await req("POST", "/runs", {
    user: duenoA1,
    tenant: tenantA,
    body: { clientId: clientA1, prompt: "el cliente no lanza research" },
  });
  assert.equal(res.status, 403);
  assert.equal(eventos.length, 0);
});

test("POST /runs sin clientId/prompt → 400 (y no toca la base ni emite)", async () => {
  const res = await req("POST", "/runs", { user: equipoA, tenant: tenantA, body: { prompt: "falta clientId" } });
  assert.equal(res.status, 400);
  assert.equal(eventos.length, 0);
});

test("POST /runs con clientId que no es uuid → 400 (no 500)", async () => {
  const res = await req("POST", "/runs", {
    user: equipoA,
    tenant: tenantA,
    body: { clientId: "no-soy-uuid", prompt: "x" },
  });
  assert.equal(res.status, 400);
  assert.equal(eventos.length, 0);
});

// ---------------------------------------------------------------- lectura + aislamiento

test("GET /runs: cada quien ve lo suyo — B no ve el run de A", async () => {
  const propios = (await (await req("GET", "/runs", { user: equipoA, tenant: tenantA })).json()) as {
    runs: Array<{ id: string }>;
  };
  assert.ok(propios.runs.some((r) => r.id === runA1), "A ve su run");

  const ajenos = (await (await req("GET", "/runs", { user: equipoB, tenant: tenantB })).json()) as {
    runs: Array<{ id: string }>;
  };
  assert.equal(ajenos.runs.some((r) => r.id === runA1), false, "B no ve el run de A");
});

test("GET /runs/:id: el equipo ve el brief con sus páginas propuestas", async () => {
  const res = await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { run: { id: string }; pages: Array<{ id: string; approved: boolean }> };
  assert.equal(body.run.id, runA1);
  assert.equal(body.pages.length, 1);
  assert.equal(body.pages[0]!.id, pageA1);
  assert.equal(body.pages[0]!.approved, false);
});

test("🔴 aislamiento: el equipo de B NO ve el run de A → 404", async () => {
  const res = await req("GET", `/runs/${runA1}`, { user: equipoB, tenant: tenantB });
  assert.equal(res.status, 404);
});

test("el cliente SÍ puede leer su propio brief (ADR-20: lee, no escribe)", async () => {
  const res = await req("GET", `/runs/${runA1}`, { user: duenoA1, tenant: tenantA });
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------- compuerta (ADR-06)

test("POST /runs/:id/approve sin ninguna página aprobada → 409 y NO despierta al workflow", async () => {
  const res = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 409);
  assert.equal(eventos.length, 0, "no se emite research/aprobado si la compuerta no se cumplió");
});

test("aprobar página y run: recién ahí se emite research/aprobado", async () => {
  const a = await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(a.status, 200);

  const b = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(b.status, 200);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.name, "research/aprobado");
  assert.deepEqual(eventos[0]!.data, { runId: runA1, aprobadoPor: equipoA });
});

test("🔴 PATCH /pages/:id REVOCA la aprobación (ADR-06)", async () => {
  // Aprobar, editar, y confirmar que la aprobación ya no vale: la compuerta certifica ESTO, no otra cosa.
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  let brief = (await (await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA })).json()) as {
    pages: Array<{ approved: boolean }>;
  };
  assert.equal(brief.pages[0]!.approved, true);

  const patch = await req("PATCH", `/pages/${pageA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { keyword_principal: "pizza napolitana madrid centro" },
  });
  assert.equal(patch.status, 200);

  brief = (await (await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA })).json()) as {
    pages: Array<{ approved: boolean }>;
  };
  assert.equal(brief.pages[0]!.approved, false, "editar tras aprobar tiene que revocar");
});

test("🔴 un CLIENTE no puede aprobar el RUN aunque vea una página aprobada → 403, sin evento", async () => {
  // El equipo aprueba una página; el cliente ve el run (RLS de lectura) pero NO puede actualizarlo.
  // Sin el booleano de approveRun, esto daría 200 y despertaría al workflow con un update de 0 filas.
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0; // ignorar lo anterior; medimos SOLO el approve-run del cliente

  const res = await req("POST", `/runs/${runA1}/approve`, { user: duenoA1, tenant: tenantA });
  assert.equal(res.status, 403);
  assert.equal(eventos.length, 0, "el cliente no puede despertar el workflow");

  const [r] = await sql<{ status: string }>("select status from kr_runs where id = $1", [runA1]);
  assert.equal(r!.status, "pending_approval", "el run NO quedó aprobado");
});

test("🔴 un CLIENTE no puede aprobar una página (ADR-20) → 404 bajo RLS, sin efecto", async () => {
  const res = await req("POST", `/pages/${pageA1}/approve`, { user: duenoA1, tenant: tenantA });
  // El update no matchea ninguna fila escribible para el cliente → approvePage devuelve false → 404.
  assert.equal(res.status, 404);
  const [p] = await sql<{ approved: boolean }>("select approved from kr_pages where id = $1", [pageA1]);
  assert.equal(p!.approved, false, "la página sigue sin aprobar");
});

test("approvePage de una página inexistente → 404", async () => {
  const res = await req("POST", `/pages/00000000-0000-4000-8000-000000000000/approve`, {
    user: equipoA,
    tenant: tenantA,
  });
  assert.equal(res.status, 404);
});

// Guarda contra un futuro refactor que rompa el seed: el servicio ve el run que sembramos.
test("sanity: el store de servicio ve la fila sembrada", async () => {
  const servicio = new PgStore(new PglitePool(pg), "app_service");
  const run = await servicio.getRun(ctxServicio(), runA1);
  assert.equal(run?.id, runA1);
});

// ---------------------------------------------------------------- clientes (CRM)

test("GET /clients sin token → 401", async () => {
  const res = await req("GET", "/clients", { tenant: tenantA });
  assert.equal(res.status, 401);
});

test("GET /clients: cada tenant ve solo los suyos — B no ve el cliente de A", async () => {
  const propios = (await (await req("GET", "/clients", { user: equipoA, tenant: tenantA })).json()) as {
    clientes: Array<{ id: string }>;
  };
  assert.ok(propios.clientes.some((cl) => cl.id === clientA1), "A ve su cliente");

  const ajenos = (await (await req("GET", "/clients", { user: equipoB, tenant: tenantB })).json()) as {
    clientes: Array<{ id: string }>;
  };
  assert.equal(ajenos.clientes.some((cl) => cl.id === clientA1), false, "B no ve el cliente de A");
});

test("POST /clients: el equipo crea el cliente en su tenant", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Nuevo Cliente" },
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  const filas = await sql<{ tenant_id: string; nombre: string }>(
    "select tenant_id, nombre from clients where id = $1",
    [id],
  );
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.tenant_id, tenantA);
  assert.equal(filas[0]!.nombre, "Nuevo Cliente");
});

test("🔴 POST /clients con tenant_id en el body: el cliente nace en el tenant del TOKEN, no del body", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Intento de fuga de tenant", tenant_id: tenantB },
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };

  // La fila real, no solo el status: confirma que el tenant_id de la BASE es el del header/token.
  const filas = await sql<{ tenant_id: string }>("select tenant_id from clients where id = $1", [id]);
  assert.equal(filas.length, 1);
  assert.equal(filas[0]!.tenant_id, tenantA, "nace en el tenant del contexto, no en el que venía en el body");

  const comoB = (await (await req("GET", "/clients", { user: equipoB, tenant: tenantB })).json()) as {
    clientes: Array<{ id: string }>;
  };
  assert.equal(comoB.clientes.some((cl) => cl.id === id), false, "el tenant B no lo ve: no nació ahí");
});

test("POST /clients con rol en el body: no tiene ningún efecto, el cliente se crea igual", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Con rol colado", rol: "maestro" },
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  const filas = await sql<{ nombre: string }>("select nombre from clients where id = $1", [id]);
  assert.equal(filas.length, 1, "el rol colado no impidió ni cambió el alta");
  assert.equal(filas[0]!.nombre, "Con rol colado");
});

test("POST /clients sin nombre → 400 (no 500)", async () => {
  const res = await req("POST", "/clients", { user: equipoA, tenant: tenantA, body: { tipo: "empresa" } });
  assert.equal(res.status, 400);
});

test("🔴 un CLIENTE (rol) no puede crear clientes → 403, no 500", async () => {
  const res = await req("POST", "/clients", {
    user: duenoA1,
    tenant: tenantA,
    body: { nombre: "El cliente no da de alta" },
  });
  assert.equal(res.status, 403);
  const filas = await sql("select id from clients where nombre = 'El cliente no da de alta'");
  assert.equal(filas.length, 0, "no se creó ninguna fila");
});

test("🔴 un CLIENTE (rol) no puede modificar clientes → 404 bajo RLS, sin efecto (mismo patrón que approvePage)", async () => {
  // El `using` de `client_write` filtra la fila para el rol `cliente` (puede_escribir() es falso):
  // el UPDATE no matchea ninguna fila (0 rows, sin excepción de Postgres) → actualizarCliente
  // devuelve false → 404. Es el MISMO mecanismo, ya probado arriba, de "un CLIENTE no puede aprobar
  // una página" (línea ~331): para un UPDATE, RLS deniega filtrando filas, no lanzando 42501 — eso
  // solo pasa en el INSERT (ver el test de arriba, "no puede crear clientes" → 403).
  const res = await req("PATCH", `/clients/${clientA1}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { score: 10 },
  });
  assert.equal(res.status, 404);
  const filas = await sql<{ score: number | null }>("select score from clients where id = $1", [clientA1]);
  assert.equal(filas[0]!.score, null, "el cliente-rol no pudo cambiar el score");
});

test("GET /clients/:id: el equipo ve su cliente", async () => {
  const res = await req("GET", `/clients/${clientA1}`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { cliente: { id: string; nombre: string } };
  assert.equal(body.cliente.id, clientA1);
  assert.equal(body.cliente.nombre, "Bella Napoli");
});

test("🔴 GET /clients/:id de OTRO tenant → 404", async () => {
  const res = await req("GET", `/clients/${clientA1}`, { user: equipoB, tenant: tenantB });
  assert.equal(res.status, 404);
});

test("GET /clients/:id inexistente → 404", async () => {
  const res = await req("GET", "/clients/00000000-0000-4000-8000-000000000000", {
    user: equipoA,
    tenant: tenantA,
  });
  assert.equal(res.status, 404);
});

test("PATCH /clients/:id del mismo tenant aplica los cambios de verdad", async () => {
  const res = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { score: 77, industria: "restauracion" },
  });
  assert.equal(res.status, 200);
  const filas = await sql<{ score: number; industria: string }>(
    "select score, industria from clients where id = $1",
    [clientA1],
  );
  assert.equal(filas[0]!.score, 77);
  assert.equal(filas[0]!.industria, "restauracion");
});

test("🔴 PATCH /clients/:id de OTRO tenant → 404 con el MISMO mensaje que un id inexistente (no revela existencia)", async () => {
  const resOtroTenant = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoB,
    tenant: tenantB,
    body: { score: 5 },
  });
  assert.equal(resOtroTenant.status, 404);
  const cuerpoOtroTenant = await resOtroTenant.json();

  const resInexistente = await req("PATCH", "/clients/00000000-0000-4000-8000-000000000000", {
    user: equipoA,
    tenant: tenantA,
    body: { score: 5 },
  });
  assert.equal(resInexistente.status, 404);
  const cuerpoInexistente = await resInexistente.json();

  assert.deepEqual(cuerpoOtroTenant, cuerpoInexistente, "el 404 no distingue 'de otro tenant' de 'no existe'");

  // Y de verdad no cambió nada en la fila de A: el 404 no es solo apariencia.
  const filas = await sql<{ score: number | null }>("select score from clients where id = $1", [clientA1]);
  assert.equal(filas[0]!.score, null, "el tenant B no pudo tocar el cliente de A");
});

test("🔴 POST /clients con asignado_a que no es miembro del tenant → 400 (no 500)", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Con asignado ajeno", asignado_a: equipoB },
  });
  assert.equal(res.status, 400);
  const filas = await sql("select id from clients where nombre = 'Con asignado ajeno'");
  assert.equal(filas.length, 0, "no se creó ninguna fila con un asignado_a inválido");
});

test("POST /clients/:id/archive: el equipo archiva su cliente (archived_at pasa a no-null)", async () => {
  const res = await req("POST", `/clients/${clientA1}/archive`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const filas = await sql<{ archived_at: string | null }>("select archived_at from clients where id = $1", [
    clientA1,
  ]);
  assert.notEqual(filas[0]!.archived_at, null, "archived_at tiene que quedar seteado");
});

test("POST /clients/:id/desarchivar: reabre un cliente ya archivado (archived_at vuelve a null)", async () => {
  await req("POST", `/clients/${clientA1}/archive`, { user: equipoA, tenant: tenantA });

  const res = await req("POST", `/clients/${clientA1}/desarchivar`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const filas = await sql<{ archived_at: string | null }>("select archived_at from clients where id = $1", [
    clientA1,
  ]);
  assert.equal(filas[0]!.archived_at, null, "archived_at tiene que volver a null");
});

test("🔴 POST /clients/:id/archive de OTRO tenant → 404 (no revela que existe)", async () => {
  const res = await req("POST", `/clients/${clientA1}/archive`, { user: equipoB, tenant: tenantB });
  assert.equal(res.status, 404);

  const filas = await sql<{ archived_at: string | null }>("select archived_at from clients where id = $1", [
    clientA1,
  ]);
  assert.equal(filas[0]!.archived_at, null, "el tenant B no pudo archivar el cliente de A");
});

// ---------------------------------------------------------------- miembros (pieza 2 — Usuarios, Etapa 2)

test("GET /members sin token → 401", async () => {
  const res = await req("GET", "/members", { tenant: tenantA });
  assert.equal(res.status, 401);
});

test("GET /members: equipoA (staff) ve TODAS las membresías de su tenant", async () => {
  const res = await req("GET", "/members", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { miembros: Array<{ user_id: string }> };
  const userIds = body.miembros.map((m) => m.user_id);
  assert.ok(userIds.includes(equipoA));
  assert.ok(userIds.includes(duenoA1));
  assert.ok(userIds.includes(maestroA));
  assert.ok(!userIds.includes(equipoB), "no ve al equipo de OTRO tenant");
});

test("GET /members: duenoA1 (rol cliente) ve SOLO su propia fila", async () => {
  const res = await req("GET", "/members", { user: duenoA1, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { miembros: Array<{ user_id: string }> };
  assert.equal(body.miembros.length, 1);
  assert.equal(body.miembros[0]!.user_id, duenoA1);
});

test("PATCH /members/:userId: el maestro cambia el rol de equipoA a cliente, con un client_id del mismo tenant", async () => {
  const res = await req("PATCH", `/members/${equipoA}`, {
    user: maestroA,
    tenant: tenantA,
    body: { rol: "cliente", client_id: clientA1 },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const filas = await sql<{ rol: string; client_id: string }>("select rol, client_id from memberships where user_id = $1", [
    equipoA,
  ]);
  assert.equal(filas[0]!.rol, "cliente");
  assert.equal(filas[0]!.client_id, clientA1);
});

test("🔴 PATCH /members/:userId: rol 'servicio' → 400, sin tocar la base", async () => {
  const res = await req("PATCH", `/members/${equipoA}`, {
    user: maestroA,
    tenant: tenantA,
    body: { rol: "servicio" },
  });
  assert.equal(res.status, 400);
  const filas = await sql<{ rol: string }>("select rol from memberships where user_id = $1", [equipoA]);
  assert.equal(filas[0]!.rol, "equipo", "servicio no tuvo ningún efecto");
});

test("🔴 PATCH /members/:userId: rol inválido/desconocido → 400", async () => {
  const res = await req("PATCH", `/members/${equipoA}`, {
    user: maestroA,
    tenant: tenantA,
    body: { rol: "superadmin" },
  });
  assert.equal(res.status, 400);
});

test("🔴 PATCH /members/:userId: auto-degradación (el maestro cambiando SU PROPIO rol) → 403", async () => {
  const res = await req("PATCH", `/members/${maestroA}`, {
    user: maestroA,
    tenant: tenantA,
    body: { rol: "equipo" },
  });
  assert.equal(res.status, 403);
  const filas = await sql<{ rol: string }>("select rol from memberships where user_id = $1", [maestroA]);
  assert.equal(filas[0]!.rol, "maestro", "no se pudo auto-degradar");
});

test("🔴 PATCH /members/:userId: un 'equipo' (no maestro) intentando cambiar el rol de otro → 403, sin efecto", async () => {
  const res = await req("PATCH", `/members/${duenoA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { rol: "equipo" },
  });
  assert.equal(res.status, 403);
  const filas = await sql<{ rol: string }>("select rol from memberships where user_id = $1", [duenoA1]);
  assert.equal(filas[0]!.rol, "cliente", "equipoA no pudo repartir roles");
});

test("🔴 PATCH /members/:userId: un rol 'cliente' intentando cambiar un rol → 404 (ni siquiera VE la fila ajena)", async () => {
  // Distinto del 403 de "equipo" de arriba, y a propósito: `membership_select_staff` (0012) le da a
  // maestro/equipo/servicio visibilidad de TODO el tenant sobre `memberships` (por eso un equipo
  // "ve" la fila y el rechazo es un 403 real de RLS) -- un `cliente` NO está en esa lista, así que
  // ni siquiera pasa el `using` combinado: la fila de otro se filtra en silencio, 0 filas, 404. Es
  // el mismo mecanismo, ya probado en este archivo, de "un CLIENTE no puede aprobar una página".
  const res = await req("PATCH", `/members/${equipoA}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { rol: "maestro" },
  });
  assert.equal(res.status, 404);
  const filas = await sql<{ rol: string }>("select rol from memberships where user_id = $1", [equipoA]);
  assert.equal(filas[0]!.rol, "equipo", "duenoA1 no pudo tocar la membresía de equipoA");
});

test("🔴 PATCH /members/:userId: client_id de OTRO tenant → 400 (FK compuesta), sin efecto", async () => {
  const [clientB1] = await sql<{ id: string }>("insert into clients (tenant_id, nombre) values ($1,'Sushi Zen') returning id", [
    tenantB,
  ]);
  const res = await req("PATCH", `/members/${equipoA}`, {
    user: maestroA,
    tenant: tenantA,
    body: { rol: "cliente", client_id: clientB1!.id },
  });
  assert.equal(res.status, 400);
  const filas = await sql<{ rol: string }>("select rol from memberships where user_id = $1", [equipoA]);
  assert.equal(filas[0]!.rol, "equipo", "el intento con un client_id ajeno no tuvo ningún efecto");
});

test("🔴 PATCH /members/:userId: token de OTRO tenant no ve ni modifica (404, silencioso)", async () => {
  // equipoB (tenantB) intenta cambiar el rol de equipoA (tenantA) — membership_update.using filtra
  // por tenant ANTES de mirar el rol: 0 filas, sin excepción, la API lo traduce como 404.
  const res = await req("PATCH", `/members/${equipoA}`, {
    user: equipoB,
    tenant: tenantB,
    body: { rol: "maestro" },
  });
  assert.equal(res.status, 404);
  const filas = await sql<{ rol: string }>("select rol from memberships where user_id = $1", [equipoA]);
  assert.equal(filas[0]!.rol, "equipo", "el tenant B no pudo tocar la membresía de A");
});

test("PATCH /members/:userId de un userId inexistente → 404", async () => {
  const res = await req("PATCH", "/members/00000000-0000-4000-8000-000000000000", {
    user: maestroA,
    tenant: tenantA,
    body: { rol: "equipo" },
  });
  assert.equal(res.status, 404);
});

test("🔴 si el verificador no puede comprobar, la API responde 503 y no 401", async () => {
  // Un 401 acá haría que el portal dé la sesión por muerta y queme el refresh token por una caída
  // de Supabase. Sigue sin dejar pasar a nadie.
  const caido: VerificadorToken = async () => NO_DISPONIBLE;
  const emisorInerte: EmisorEventos = { send: async () => ({}) };
  const appCaida = createApp({ store, clientes, membresias, emisor: emisorInerte, verificar: caido });
  const res = await appCaida.request("/runs", {
    headers: { authorization: "Bearer lo-que-sea", "x-amg-tenant": tenantA },
  });
  assert.equal(res.status, 503);
});

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones, PglitePool, PgStore } from "db";
import type { TenantContext } from "db";
import { createApp } from "./app.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";

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
let eventos: Array<{ name: string; data: Record<string, unknown> }>;
let app: ReturnType<typeof createApp>;

// Datos sembrados (superusuario: saltea RLS, es lo que hace la infra, no la app).
let tenantA: string;
let tenantB: string;
let clientA1: string;
let equipoA: string; // rol equipo en A: puede escribir
let duenoA1: string; // rol cliente en A, atado a clientA1: SOLO lectura
let equipoB: string; // rol equipo en B
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
  eventos = [];
  const emisor: EmisorEventos = {
    send: async (e) => {
      eventos.push(e);
      return {};
    },
  };
  app = createApp({ store, emisor, verificar });

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
  equipoB = await mkMembresia(tenantB, "equipo", null);
  intruso = (await sql<{ id: string }>("select gen_random_uuid() as id"))[0]!.id;

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

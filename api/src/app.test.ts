import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones, PglitePool, PgStore, PgClientes, PgMembresias, PgIdeas, PgResenas } from "db";
import type { TenantContext } from "db";
import { createApp } from "./app.js";
import { solicitarResearch, type EmisorEventos } from "./solicitar.js";
import { NO_DISPONIBLE, type VerificadorToken } from "./auth.js";
import { TRANSICION_INVALIDA } from "./codigos.js";
import { MockGoogleOAuthProvider } from "./google-oauth.js";
import { firmarEstado, type EstadoOAuth } from "./oauth-state.js";
import { menuItemSchema, parseProfile } from "web-builder/contract";

/** Origen del portal para los tests del callback OAuth (`GET .../google/callback`). */
const PORTAL_URL_TEST = "http://localhost:4200";

/** Secreto de test para firmar/verificar el `state` de OAuth — nunca el de producción. */
const OAUTH_STATE_SECRET_TEST = "secreto-de-test-oauth-state-no-es-el-de-produccion";

/** `@username` de test para el deep link de Telegram (`POST /me/telegram/vincular`). */
const TELEGRAM_BOT_USERNAME_TEST = "AMGReviewsBotTest";

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
let ideas: PgIdeas;
let resenas: PgResenas;
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
  ideas = new PgIdeas(pool); // sin parámetro de rol: la clase fija app_user (0013 no da grants a app_service)
  resenas = new PgResenas(pool); // ídem: app_service no tiene grants sobre resenas_google (0021)
  eventos = [];
  const emisor: EmisorEventos = {
    send: async (e) => {
      eventos.push(e);
      return {};
    },
  };
  app = createApp({
    store,
    clientes,
    membresias,
    ideas,
    resenas,
    googleOAuth: new MockGoogleOAuthProvider(),
    oauthStateSecret: OAUTH_STATE_SECRET_TEST,
    telegramBotUsername: TELEGRAM_BOT_USERNAME_TEST,
    emisor,
    verificar,
    portalUrl: PORTAL_URL_TEST,
  });

  // --- seed (superusuario) ---
  [tenantA, tenantB] = (
    await sql<{ id: string }>(
      `insert into tenants (nombre, slug)
       values ('Agencia A','agencia-a'), ('Agencia B','agencia-b') returning id`,
    )
  ).map((r) => r.id) as [string, string];

  [clientA1] = (
    await sql<{ id: string }>(
      "insert into clients (tenant_id, nombre, vertical) values ($1,'Bella Napoli','restauracion') returning id",
      [tenantA],
    )
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

/**
 * Un run **nacido del pipeline**: creado por `POST /runs`, o sea con el `send()` de
 * `research/solicitado` cumplido y la marca `solicitud_emitida_at` escrita (migración 0019), y
 * después llevado a `pending_approval` — el estado que `registrarDecision` (Task 3) exige en su
 * `where` para calificar cualquier transición. Es lo ÚNICO que se puede aprobar.
 *
 * Se pasa por el endpoint a propósito y no por `store.marcarSolicitudEmitida`: lo que hay que fijar
 * es que **el camino real** deja el run aprobable. Escribiendo la marca a mano, el test seguiría
 * verde aunque `solicitarResearch` se olvidara de escribirla — que es justo el fallo que dejaría el
 * botón muerto en producción.
 *
 * La página y el paso a `pending_approval` se insertan con el superusuario porque el research de
 * verdad los escribe el orquestador (`app_service`, `finishRun`), que acá no corre. Lo que este
 * helper monta es el ESTADO, no el camino — mismo criterio para las dos cosas.
 */
async function runNacidoDelPipeline(): Promise<{ runId: string; pageId: string }> {
  const res = await req("POST", "/runs", {
    user: equipoA,
    tenant: tenantA,
    body: { clientId: clientA1, prompt: "Restaurante italiano en Madrid centro" },
  });
  assert.equal(res.status, 201, "el control positivo empieza por poder crear el run");
  const { runId } = (await res.json()) as { runId: string };
  eventos.length = 0; // el `research/solicitado` de recién no es lo que se mide después

  const pageId = (
    await sql<{ id: string }>(
      `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                             keyword_principal, keywords_secundarias, intencion, local, volumen,
                             dificultad, evidencia, opportunity_score, score_confidence, seo,
                             content_brief, preguntas_frecuentes, approved, retirada)
       values ($1,$2,$3, gen_random_uuid(), 'landing_local', '/pizza-del-pipeline',
               'pizza napolitana madrid', array['pizza napolitana'], 'local', true, 390,
               15, 'datos_mercado', 84, 1, '{}'::jsonb, '{}'::jsonb, array['¿Reservan?'],
               false, false) returning id`,
      [tenantA, runId, clientA1],
    )
  )[0]!.id;

  // El research "terminó": mismo efecto que `finishRun` (db/src/store.ts), que acá no corre porque
  // el orquestador no está presente en este harness.
  await sql("update kr_runs set status = 'pending_approval', finished_at = now() where id = $1", [runId]);

  return { runId, pageId };
}

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

/*
 * ------------------------------------------------- el evento falla DESPUÉS de que la fila ya existe
 *
 * ADR-18 obliga a este orden —fila primero, evento después— y no se invierte. Pero el orden tiene un
 * hueco propio: si el `send()` lanza, la fila **ya está creada** y nadie la va a procesar. El run
 * queda en `running` para siempre, el portal lo pollea eternamente, y el usuario ve un error sin
 * enterarse de que su run existe.
 *
 * No es hipotético: en Railway el SDK de Inngest infiere modo `cloud`, y `Inngest.send()` LANZA si no
 * hay `INNGEST_EVENT_KEY` (`components/Inngest.js`: `if (this.mode.isCloud && !this.eventKeySet())
 * throw`). Esa variable no estaba declarada en ninguna parte del repo.
 */

/** Emisor que siempre falla, con el error EXACTO que tira el SDK sin event key. */
function emisorQueLanza(fallo: Error): EmisorEventos {
  return {
    send: async () => {
      throw fallo;
    },
  };
}

test("🔴 POST /runs: si el evento no se puede emitir, el run NO queda huérfano en `running`", async () => {
  const fallo = new Error("Failed to send event: we couldn't find an event key");
  const appSinInngest = createApp({
    store,
    clientes,
    membresias,
    ideas,
    resenas,
    googleOAuth: new MockGoogleOAuthProvider(),
    oauthStateSecret: OAUTH_STATE_SECRET_TEST,
    telegramBotUsername: TELEGRAM_BOT_USERNAME_TEST,
    verificar,
    emisor: emisorQueLanza(fallo),
    portalUrl: PORTAL_URL_TEST,
  });
  const res = await appSinInngest.request("/runs", {
    method: "POST",
    headers: {
      authorization: `Bearer valid:${equipoA}`,
      "x-amg-tenant": tenantA,
      "content-type": "application/json",
    },
    body: JSON.stringify({ clientId: clientA1, prompt: "run que nadie va a procesar" }),
  });

  // El usuario se entera: un 201 mentiría diciendo que el research arrancó.
  assert.equal(res.status, 500, "el fallo del evento se propaga, no se traga");

  const filas = await sql<{ status: string; error: string | null; marca: string | null }>(
    "select status, error, solicitud_emitida_at as marca from kr_runs where prompt = 'run que nadie va a procesar'",
    [],
  );
  assert.equal(filas.length, 1, "la fila se creó bajo RLS: ADR-18 no se invierte");
  assert.equal(
    filas[0]!.status,
    "failed",
    "quedó en `running` esperando a un orquestador que nunca fue avisado",
  );
  assert.match(filas[0]!.error ?? "", /event key/, "el motivo real queda escrito en la fila");
  // 🔴 Y SIN MARCA (0019): el orden es fila → evento → marca. Si la marca se escribiera antes del
  // `send()`, este run —que nadie va a procesar— quedaría marcado como "tiene workflow", y el bug de
  // C0 volvería con una columna respaldándolo.
  assert.equal(filas[0]!.marca, null, "el send() falló: no hay ninguna ejecución esperando este run");
});

test("🔴 POST /runs escribe la marca DESPUÉS del send(): fila → evento → marca (0019)", async () => {
  const res = await req("POST", "/runs", {
    user: equipoA,
    tenant: tenantA,
    body: { clientId: clientA1, prompt: "run que sí arranca" },
  });
  assert.equal(res.status, 201);
  const { runId } = (await res.json()) as { runId: string };

  assert.equal(eventos.length, 1, "el evento salió");
  assert.equal(eventos[0]!.name, "research/solicitado");

  const [fila] = await sql<{ marca: string | null }>(
    "select solicitud_emitida_at as marca from kr_runs where id = $1",
    [runId],
  );
  assert.notEqual(fila!.marca, null, "sin esto el botón de aprobar quedaría muerto para SIEMPRE");
});

test("🔴 POST /runs: si TAMBIÉN falla el marcado, se propaga el error del EVENTO, no el del marcado", async () => {
  // El error original es el que explica qué pasó ("falta la event key"). Si se propagara el del
  // marcado, el operador leería un síntoma de segundo orden y perdería la causa.
  const fallo = new Error("Failed to send event: we couldn't find an event key");
  const delMarcado = new Error("la base tampoco responde");

  const storeSinMarcado = new PgStore(new PglitePool(pg)); // amg_api → app_user, como en producción
  storeSinMarcado.failRun = async () => {
    throw delMarcado;
  };

  await assert.rejects(
    () =>
      solicitarResearch(storeSinMarcado, emisorQueLanza(fallo), { tenantId: tenantA, userId: equipoA }, {
        clientId: clientA1,
        prompt: "run con doble fallo",
      }),
    (e: unknown) => e === fallo,
    "tiene que salir el error del evento, por identidad — no el del marcado",
  );
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
  const res = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(res.status, 409);
  const cuerpo = (await res.json()) as { codigo: string };
  assert.equal(cuerpo.codigo, TRANSICION_INVALIDA, "sin página aprobada, crear_web no calificó en registrarDecision (Task 3)");
  assert.equal(eventos.length, 0, "no se emite research/aprobado si la compuerta no se cumplió");
});

/**
 * EL CONTROL POSITIVO de la 0019, y es obligatorio: sin él, una condición que bloqueara TODA
 * aprobación dejaría verdes a los tests de más abajo (que solo exigen que no se apruebe).
 *
 * El run nace de `POST /runs`, así que lleva la marca de `solicitud_emitida_at`.
 */
test("aprobar página y run: recién ahí se emite research/aprobado", async () => {
  const { runId, pageId } = await runNacidoDelPipeline();

  const a = await req("POST", `/pages/${pageId}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(a.status, 200);

  const b = await req("POST", `/runs/${runId}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(b.status, 200);
  const cuerpo = (await b.json()) as { decisionId: string };
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0]!.name, "research/aprobado");
  assert.deepEqual(eventos[0]!.data, { tenantId: tenantA, decisionId: cuerpo.decisionId, aprobadoPor: equipoA });
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
  // `registrarDecision` corre bajo RLS (`decision_write`, 0027): un rol `cliente` no cumple
  // `app.puede_escribir()`, así que el `insert` viola el `with check` y Postgres LANZA 42501 — el
  // `onError` ya lo mapea a 403 (nota del Step 4 del brief: "registrarDecision puede lanzar por RLS").
  const { runId, pageId } = await runNacidoDelPipeline();
  await req("POST", `/pages/${pageId}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0; // ignorar lo anterior; medimos SOLO el approve-run del cliente

  const res = await req("POST", `/runs/${runId}/approve`, {
    user: duenoA1, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(res.status, 403);
  assert.equal(eventos.length, 0, "el cliente no puede despertar el workflow");

  const [r] = await sql<{ status: string }>("select status from kr_runs where id = $1", [runId]);
  assert.equal(r!.status, "pending_approval", "el run NO quedó aprobado");
});

/**
 * El bug histórico del bloque C0 (un run sembrado directo en la base, sin `research/solicitado`,
 * quedaba inaprobable con un 409 `RUN_SIN_WORKFLOW`) se cerró retirando el mecanismo viejo
 * (`approveRun`/`RunSinWorkflowError`, Task 4): `registrarDecision` ya no comprueba `tiene_workflow`,
 * así que un run sembrado directo SÍ califica ahora, igual que uno nacido del pipeline.
 */
test("aprobar un run insertado DIRECTO en la base (sin solicitud_emitida_at) SÍ califica ahora", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0;
  const res = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "solo_informe" },
  });
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as { ok: boolean; decisionId: string };
  assert.ok(cuerpo.decisionId);
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0]!.data, { tenantId: tenantA, decisionId: cuerpo.decisionId, aprobadoPor: equipoA });
});

test("🔴 aprobar con un destino que no califica → 409 TRANSICION_INVALIDA", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "crear_web" } });
  eventos.length = 0;
  const res = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "solo_informe" } });
  assert.equal(res.status, 409);
  const cuerpo = (await res.json()) as { codigo: string };
  assert.equal(cuerpo.codigo, TRANSICION_INVALIDA);
  assert.equal(eventos.length, 0);
});

test("aprobar con destino crear_posts registra la decisión y emite research/aprobado (ya no 501)", async () => {
  // Sub-proyecto 3, Task 10 Step 0.1: el 501 temporal que dejó el sub-proyecto 2 se retiró — con las
  // Tasks 1-9 de este sub-proyecto ya implementadas, `crear_posts` tiene un camino real para activarse.
  const { runId, pageId } = await runNacidoDelPipeline();
  await req("POST", `/pages/${pageId}/approve`, { user: equipoA, tenant: tenantA });
  eventos.length = 0;

  const res = await req("POST", `/runs/${runId}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_posts" },
  });
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as { ok: boolean; decisionId: string };
  assert.ok(cuerpo.decisionId);

  const [decision] = await sql<{ destino: string }>(
    "select destino from kr_run_decisiones where run_id = $1",
    [runId],
  );
  assert.equal(decision!.destino, "crear_posts");
  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0]!.data, { tenantId: tenantA, decisionId: cuerpo.decisionId, aprobadoPor: equipoA });
});

// Hallazgo Minor de la ronda de Codex: agregar cobertura de body ausente/malformado.
test("🔴 aprobar sin body → 400, sin tocar la base", async () => {
  const res = await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 400);
  const [row] = await sql<{ n: string }>("select count(*)::text as n from kr_run_decisiones where run_id = $1", [runA1]);
  assert.equal(row!.n, "0");
});

test("🔴 aprobar con destino inválido → 400", async () => {
  const res = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "publicar_ya" },
  });
  assert.equal(res.status, 400);
});

/*
 * Hallazgo Critical de la ronda de Codex: si `emisor.send()` falla DESPUÉS de que `registrarDecision`
 * ya insertó la fila, sin compensación esa decisión queda 'pendiente' PARA SIEMPRE — el índice único
 * parcial (Task 1) impide registrar cualquier otra decisión sobre el mismo run.
 *
 * El mecanismo para simular el fallo es el mismo que ya usa el bloque de "POST /runs" más arriba
 * (`emisorQueLanza` + un `createApp` propio, en vez de un flag mutable sobre el emisor compartido del
 * `beforeEach`): así el resto de los tests de este archivo, que SÍ dependen del emisor que empuja a
 * `eventos`, no corren el riesgo de heredar un fallo que quedó prendido.
 */
test("🔴 si emisor.send() falla, la decisión se cierra en 'error' — no queda bloqueada", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });

  const fallo = new Error("Failed to send event: we couldn't find an event key");
  const appSinInngest = createApp({
    store,
    clientes,
    membresias,
    ideas,
    resenas,
    googleOAuth: new MockGoogleOAuthProvider(),
    oauthStateSecret: OAUTH_STATE_SECRET_TEST,
    telegramBotUsername: TELEGRAM_BOT_USERNAME_TEST,
    verificar,
    emisor: emisorQueLanza(fallo),
    portalUrl: PORTAL_URL_TEST,
  });

  const res = await appSinInngest.request(`/runs/${runA1}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer valid:${equipoA}`,
      "x-amg-tenant": tenantA,
      "content-type": "application/json",
    },
    body: JSON.stringify({ destino: "crear_web" }),
  });
  assert.equal(res.status, 500);

  const [row] = await sql<{ resultado: string }>(
    "select resultado from kr_run_decisiones where run_id = $1", [runA1],
  );
  assert.equal(row!.resultado, "error", "la fila NO queda 'pendiente' — el índice único la liberó");

  // Y una segunda aprobación normal, después del fallo, SÍ puede calificar:
  const segundo = await req("POST", `/runs/${runA1}/approve`, {
    user: equipoA, tenant: tenantA, body: { destino: "crear_web" },
  });
  assert.equal(segundo.status, 200, "el índice único ya no bloquea: la primera decisión quedó 'error', no 'pendiente'");
});

test("GET /runs/:id devuelve ultimaDecision null cuando todavía no se aprobó", async () => {
  const res = await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA });
  const cuerpo = (await res.json()) as { run: { ultimaDecision: unknown } };
  assert.equal(cuerpo.run.ultimaDecision, null);
});

test("GET /runs/:id devuelve ultimaDecision con destino y resultado tras aprobar", async () => {
  await req("POST", `/pages/${pageA1}/approve`, { user: equipoA, tenant: tenantA });
  await req("POST", `/runs/${runA1}/approve`, { user: equipoA, tenant: tenantA, body: { destino: "solo_informe" } });
  const res = await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA });
  const cuerpo = (await res.json()) as { run: { ultimaDecision: { destino: string } | null } };
  assert.equal(cuerpo.run.ultimaDecision?.destino, "solo_informe");
});

test("🔴 GET /runs/:id dice si el run es aprobable (`tiene_workflow`), para el botón del portal", async () => {
  // Sin este campo, la única forma de enterarse sería apretar el botón y comerse el 409 — justo la
  // experiencia que C0 existe para evitar. Los dos casos, en la misma respuesta del mismo endpoint.
  const sembrado = await req("GET", `/runs/${runA1}`, { user: equipoA, tenant: tenantA });
  const { run: rSembrado } = (await sembrado.json()) as { run: { tiene_workflow: boolean } };
  assert.equal(rSembrado.tiene_workflow, false, "el run del seed no lo espera nadie");

  const { runId } = await runNacidoDelPipeline();
  const delPipeline = await req("GET", `/runs/${runId}`, { user: equipoA, tenant: tenantA });
  const { run: rPipeline } = (await delPipeline.json()) as { run: { tiene_workflow: boolean } };
  assert.equal(rPipeline.tiene_workflow, true);
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
    body: { nombre: "Nuevo Cliente", vertical: "restauracion" },
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

test("POST /clients sin vertical → 400", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Sin vertical" },
  });
  assert.equal(res.status, 400);
  const filas = await sql("select id from clients where nombre = 'Sin vertical'");
  assert.equal(filas.length, 0, "no se creó ninguna fila sin vertical");
});

test("POST /clients con vertical inválida → 400", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Vertical rara", vertical: "peluqueria" },
  });
  assert.equal(res.status, 400);
  const filas = await sql("select id from clients where nombre = 'Vertical rara'");
  assert.equal(filas.length, 0, "no se creó ninguna fila con una vertical fuera de la allowlist");
});

test("POST /clients con vertical 'correduria_seguros' crea el cliente con ese rubro", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Corredores X", vertical: "correduria_seguros" },
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  const filas = await sql<{ vertical: string }>("select vertical from clients where id = $1", [id]);
  assert.equal(filas[0]!.vertical, "correduria_seguros");
});

test("🔴 POST /clients con tenant_id en el body: el cliente nace en el tenant del TOKEN, no del body", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { nombre: "Intento de fuga de tenant", tenant_id: tenantB, vertical: "restauracion" },
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
    body: { nombre: "Con rol colado", rol: "maestro", vertical: "restauracion" },
  });
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  const filas = await sql<{ nombre: string }>("select nombre from clients where id = $1", [id]);
  assert.equal(filas.length, 1, "el rol colado no impidió ni cambió el alta");
  assert.equal(filas[0]!.nombre, "Con rol colado");
});

test("POST /clients sin nombre → 400 (no 500)", async () => {
  const res = await req("POST", "/clients", {
    user: equipoA,
    tenant: tenantA,
    body: { tipo: "empresa", vertical: "restauracion" },
  });
  assert.equal(res.status, 400);
});

test("🔴 un CLIENTE (rol) no puede crear clientes → 403, no 500", async () => {
  const res = await req("POST", "/clients", {
    user: duenoA1,
    tenant: tenantA,
    body: { nombre: "El cliente no da de alta", vertical: "restauracion" },
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
    body: { nombre: "Con asignado ajeno", asignado_a: equipoB, vertical: "restauracion" },
  });
  assert.equal(res.status, 400);
  const filas = await sql("select id from clients where nombre = 'Con asignado ajeno'");
  assert.equal(filas.length, 0, "no se creó ninguna fila con un asignado_a inválido");
});

test("PATCH /clients/:id ignora vertical en el body — inmutable en el borde HTTP", async () => {
  // clientA1 nace 'restauracion' en el seed (línea ~107). El PATCH intenta cambiarla a
  // 'correduria_seguros'; `filtrarCamposCliente` no conoce `vertical` (no está en `CambiosCliente`),
  // así que la clave se ignora en silencio, mismo comportamiento que cualquier otra clave desconocida
  // — ver el comentario de `POST /clients` más arriba.
  const res = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vertical: "correduria_seguros" },
  });
  assert.equal(res.status, 404, "sin ningún campo editable válido, es el mismo 404 de 'sin cambios válidos'");

  const filas = await sql<{ vertical: string }>("select vertical from clients where id = $1", [clientA1]);
  assert.equal(filas[0]!.vertical, "restauracion", "vertical no cambió: PATCH la ignoró en silencio");
});

// ---------------------------------------------------------------- blog externo del cliente (0031, sub-proyecto 3)

test("PATCH /clients/:id con blog_externo_tipo/url/credencial: 200, credencial NO vuelve en el GET", async () => {
  const res = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: {
      blog_externo_tipo: "wordpress",
      blog_externo_url: "https://blog.cliente.com",
      blog_externo_credencial: "sek",
    },
  });
  assert.equal(res.status, 200);

  const getRes = await req("GET", `/clients/${clientA1}`, { user: equipoA, tenant: tenantA });
  assert.equal(getRes.status, 200);
  const cuerpo = (await getRes.json()) as { cliente: Record<string, unknown> };
  assert.equal(cuerpo.cliente["blog_externo_tipo"], "wordpress");
  assert.equal(cuerpo.cliente["blog_externo_url"], "https://blog.cliente.com");
  assert.equal(
    "blog_externo_credencial" in cuerpo.cliente,
    false,
    "la credencial nunca vuelve por GET — app_user no puede leerla (Task 1 / 0031)",
  );

  // Y de verdad quedó escrita en la base (no solo omitida del GET): sqlCrudo de test, superusuario.
  const [fila] = await sql<{ blog_externo_credencial: string | null }>(
    "select blog_externo_credencial from clients where id = $1",
    [clientA1],
  );
  assert.equal(fila!.blog_externo_credencial, "sek", "la credencial SÍ se escribió, solo no se lee de vuelta");
});

test("PATCH /clients/:id acepta cualquier etiqueta de texto en blog_externo_tipo (no solo 'wordpress')", async () => {
  // `blog_externo_tipo` es informativo, no un enum cerrado (ver el comentario del handler,
  // api/src/app.ts): "wix" es un ejemplo cualquiera, no el único valor alternativo soportado.
  const res = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { blog_externo_tipo: "wix" },
  });
  assert.equal(res.status, 200);
});

test("🔴 PATCH /clients/:id con blog_externo_tipo vacío o demasiado largo: 400", async () => {
  const vacio = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { blog_externo_tipo: "" },
  });
  assert.equal(vacio.status, 400);

  const demasiadoLargo = await req("PATCH", `/clients/${clientA1}`, {
    user: equipoA,
    tenant: tenantA,
    body: { blog_externo_tipo: "x".repeat(101) },
  });
  assert.equal(demasiadoLargo.status, 400);

  const filas = await sql<{ blog_externo_tipo: string | null }>(
    "select blog_externo_tipo from clients where id = $1",
    [clientA1],
  );
  assert.equal(filas[0]!.blog_externo_tipo, null, "ninguno de los dos bodies inválidos escribió nada");
});

// ---------------------------------------------------------------- menú (editor del portal)

test("GET /clients/:id/menu de un cliente sin carta devuelve arrays vacíos", async () => {
  const res = await req("GET", `/clients/${clientA1}/menu`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { menu: [], menu_categorias: [] });
});

test("GET /clients/:id/menu de OTRO tenant → 404", async () => {
  const res = await req("GET", `/clients/${clientA1}/menu`, { user: equipoB, tenant: tenantB });
  assert.equal(res.status, 404);
});

test("PATCH /clients/:id/menu guarda un plato válido y GET lo devuelve igual", async () => {
  const carta = {
    menu: [{ name: "Margherita", precios: [{ etiqueta: "Media", importe: "9,00 €" }] }],
    menu_categorias: [{ nombre: "Pizzas" }],
  };
  const resPatch = await req("PATCH", `/clients/${clientA1}/menu`, { user: equipoA, tenant: tenantA, body: carta });
  assert.equal(resPatch.status, 200);
  assert.deepEqual(await resPatch.json(), { ok: true });

  const resGet = await req("GET", `/clients/${clientA1}/menu`, { user: equipoA, tenant: tenantA });
  assert.deepEqual(await resGet.json(), carta);
});

test("PATCH /clients/:id/menu sin menu_categorias → 400 (las dos claves son obligatorias)", async () => {
  const res = await req("PATCH", `/clients/${clientA1}/menu`, {
    user: equipoA,
    tenant: tenantA,
    body: { menu: [{ name: "Margherita" }] },
  });
  assert.equal(res.status, 400);
  const cuerpo = (await res.json()) as { campos: Array<{ ruta: string; mensaje: string }> };
  assert.ok(cuerpo.campos.some((c) => c.ruta === "menu_categorias"));
});

test("PATCH /clients/:id/menu con un plato sin nombre → 400 con la ruta exacta del campo", async () => {
  const res = await req("PATCH", `/clients/${clientA1}/menu`, {
    user: equipoA,
    tenant: tenantA,
    body: { menu: [{ description: "Sin nombre" }], menu_categorias: [] },
  });
  assert.equal(res.status, 400);
  const cuerpo = (await res.json()) as { error: string; campos: Array<{ ruta: string; mensaje: string }> };
  assert.ok(cuerpo.campos.some((c) => c.ruta === "menu.0.name"));
});

test("🔴 PATCH /clients/:id/menu de OTRO tenant → 404 con el MISMO mensaje que un id inexistente (no revela existencia)", async () => {
  const carta = { menu: [{ name: "Fuga" }], menu_categorias: [] };
  const resOtroTenant = await req("PATCH", `/clients/${clientA1}/menu`, { user: equipoB, tenant: tenantB, body: carta });
  assert.equal(resOtroTenant.status, 404);
  const cuerpoOtroTenant = await resOtroTenant.json();

  const resInexistente = await req("PATCH", "/clients/00000000-0000-4000-8000-000000000000/menu", {
    user: equipoA,
    tenant: tenantA,
    body: carta,
  });
  assert.equal(resInexistente.status, 404);
  const cuerpoInexistente = await resInexistente.json();

  assert.deepEqual(cuerpoOtroTenant, cuerpoInexistente, "el 404 no distingue 'de otro tenant' de 'no existe'");

  const filas = await sql<{ business_profile: Record<string, unknown> | null }>(
    "select business_profile from clients where id = $1",
    [clientA1],
  );
  assert.equal(filas[0]?.business_profile, null, "el tenant B no pudo tocar el cliente de A");
});

test("equivalencia: el mismo set de casos límite se acepta/rechaza igual en menuItemSchema, parseProfile() y el endpoint", async () => {
  const casos: Array<{ plato: unknown; valido: boolean }> = [
    { plato: { name: "Margherita" }, valido: true },
    { plato: { name: "" }, valido: false }, // nombre vacío
    { plato: { name: "Sin precio con importe vacío", precios: [{ etiqueta: "Media", importe: "" }] }, valido: false },
    { plato: { name: "P", alergenos: Array(15).fill("gluten") }, valido: false }, // 15 > MAX_ALERGENOS (14)
  ];

  for (const { plato, valido } of casos) {
    assert.equal(
      menuItemSchema.safeParse(plato).success,
      valido,
      `menuItemSchema discrepa para ${JSON.stringify(plato)}`,
    );

    const perfilOk = (() => {
      try {
        parseProfile({ name: "X", menu: [plato] });
        return true;
      } catch {
        return false;
      }
    })();
    assert.equal(perfilOk, valido, `parseProfile() discrepa para ${JSON.stringify(plato)}`);

    const res = await req("PATCH", `/clients/${clientA1}/menu`, {
      user: equipoA,
      tenant: tenantA,
      body: { menu: [plato], menu_categorias: [] },
    });
    assert.equal(res.status === 200, valido, `el endpoint discrepa para ${JSON.stringify(plato)}`);
  }
});

// ---------------------------------------------------------------- perfil de seguros (editor del portal)

test("GET /clients/:id/seguros de un cliente sin la clave cargada devuelve seguros: null", async () => {
  const res = await req("GET", `/clients/${clientA1}/seguros`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { seguros: null });
});

test("🔴 GET /clients/:id/seguros de OTRO tenant → 404 (mismo criterio que GET /clients/:id/menu)", async () => {
  const res = await req("GET", `/clients/${clientA1}/seguros`, { user: equipoB, tenant: tenantB });
  assert.equal(res.status, 404);
});

test("GET /clients/:id/seguros inexistente → 404", async () => {
  const res = await req("GET", "/clients/00000000-0000-4000-8000-000000000000/seguros", {
    user: equipoA,
    tenant: tenantA,
  });
  assert.equal(res.status, 404);
});

test("PATCH /clients/:id/seguros guarda los tres campos, y GET los devuelve igual", async () => {
  const datos = { numeroLicencia: "J-1479", anosExperiencia: 35, redAfiliacion: "E2K" };
  const resPatch = await req("PATCH", `/clients/${clientA1}/seguros`, {
    user: equipoA,
    tenant: tenantA,
    body: datos,
  });
  assert.equal(resPatch.status, 200);
  assert.deepEqual(await resPatch.json(), { ok: true });

  const resGet = await req("GET", `/clients/${clientA1}/seguros`, { user: equipoA, tenant: tenantA });
  assert.deepEqual(await resGet.json(), { seguros: datos });
});

test("PATCH /clients/:id/seguros con anosExperiencia negativo → 400 con la ruta exacta del campo", async () => {
  const res = await req("PATCH", `/clients/${clientA1}/seguros`, {
    user: equipoA,
    tenant: tenantA,
    body: { anosExperiencia: -1 },
  });
  assert.equal(res.status, 400);
  const cuerpo = (await res.json()) as { campos: Array<{ ruta: string; mensaje: string }> };
  assert.ok(cuerpo.campos.some((c) => c.ruta === "anosExperiencia"));
});

test("🔴 PATCH /clients/:id/seguros de OTRO tenant → 404 con el MISMO mensaje que un id inexistente (no revela existencia)", async () => {
  const datos = { numeroLicencia: "Fuga" };
  const resOtroTenant = await req("PATCH", `/clients/${clientA1}/seguros`, {
    user: equipoB,
    tenant: tenantB,
    body: datos,
  });
  assert.equal(resOtroTenant.status, 404);
  const cuerpoOtroTenant = await resOtroTenant.json();

  const resInexistente = await req("PATCH", "/clients/00000000-0000-4000-8000-000000000000/seguros", {
    user: equipoA,
    tenant: tenantA,
    body: datos,
  });
  assert.equal(resInexistente.status, 404);
  const cuerpoInexistente = await resInexistente.json();

  assert.deepEqual(cuerpoOtroTenant, cuerpoInexistente, "el 404 no distingue 'de otro tenant' de 'no existe'");

  const filas = await sql<{ business_profile: Record<string, unknown> | null }>(
    "select business_profile from clients where id = $1",
    [clientA1],
  );
  assert.equal(filas[0]?.business_profile, null, "el tenant B no pudo tocar el cliente de A");
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
  const [clientB1] = await sql<{ id: string }>(
    "insert into clients (tenant_id, nombre, vertical) values ($1,'Sushi Zen','restauracion') returning id",
    [tenantB],
  );
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
  const appCaida = createApp({
    store,
    clientes,
    membresias,
    ideas,
    resenas,
    googleOAuth: new MockGoogleOAuthProvider(),
    oauthStateSecret: OAUTH_STATE_SECRET_TEST,
    telegramBotUsername: TELEGRAM_BOT_USERNAME_TEST,
    emisor: emisorInerte,
    verificar: caido,
    portalUrl: PORTAL_URL_TEST,
  });
  const res = await appCaida.request("/runs", {
    headers: { authorization: "Bearer lo-que-sea", "x-amg-tenant": tenantA },
  });
  assert.equal(res.status, 503);
});

// ---------------------------------------------------------------- /me/telegram (Bloque F, fase 2 — alertas)
//
// Los tres cuelgan de `ctx.userId` (identidad ya autenticada): no hay ningún `:userId` de ruta que
// comparar contra nadie, así que no hay un caso "OTRO tenant"/"OTRO usuario" que probar acá — eso
// ya lo cubre `membresias.test.ts` (RLS: `membership_vincular_telegram`, el trigger `membresias_
// guardia_telegram`). Lo que este bloque prueba es el CONTRATO HTTP: forma de la respuesta y que el
// endpoint refleje lo que la base decidió, no una autorización nueva.

test("POST /me/telegram/vincular sin token → 401", async () => {
  const res = await req("POST", "/me/telegram/vincular", {});
  assert.equal(res.status, 401);
});

test("POST /me/telegram/vincular devuelve una URL cuyo código matchea lo que quedó en la base", async () => {
  const res = await req("POST", "/me/telegram/vincular", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { url: string };
  assert.ok(
    body.url.startsWith(`https://t.me/${TELEGRAM_BOT_USERNAME_TEST}?start=`),
    `la URL usa el bot configurado: ${body.url}`,
  );
  const codigo = body.url.split("?start=")[1];

  const [fila] = await sql<{ telegram_link_code: string | null }>(
    "select telegram_link_code from memberships where user_id = $1",
    [equipoA],
  );
  assert.equal(fila?.telegram_link_code, codigo, "el código de la URL es el que quedó guardado");
});

test("POST /me/telegram/vincular dos veces seguidas: el segundo invalida el código del primero", async () => {
  const primero = (await (
    await req("POST", "/me/telegram/vincular", { user: equipoA, tenant: tenantA })
  ).json()) as { url: string };
  const segundo = (await (
    await req("POST", "/me/telegram/vincular", { user: equipoA, tenant: tenantA })
  ).json()) as { url: string };

  const codigoPrimero = primero.url.split("?start=")[1];
  const codigoSegundo = segundo.url.split("?start=")[1];
  assert.notEqual(codigoPrimero, codigoSegundo, "cada pedido genera un código nuevo");

  const [fila] = await sql<{ telegram_link_code: string | null }>(
    "select telegram_link_code from memberships where user_id = $1",
    [equipoA],
  );
  assert.equal(fila?.telegram_link_code, codigoSegundo, "solo el código del segundo pedido sigue vigente");
});

test("GET /me/telegram da {vinculado:false} antes de vincular", async () => {
  const res = await req("GET", "/me/telegram", { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { vinculado: false });
});

test("GET /me/telegram da {vinculado:true} una vez que la fila tiene telegram_chat_id (control positivo)", async () => {
  await sql("update memberships set telegram_chat_id = $1 where user_id = $2", ["chat-http-1", equipoA]);
  const res = await req("GET", "/me/telegram", { user: equipoA, tenant: tenantA });
  assert.deepEqual(await res.json(), { vinculado: true });
});

test("POST /me/telegram/desvincular: {ok:false} si no había nada, {ok:true} si había, {ok:false} de nuevo", async () => {
  const antes = await req("POST", "/me/telegram/desvincular", { user: equipoA, tenant: tenantA });
  assert.deepEqual(await antes.json(), { ok: false }, "false NO es un error: no había nada que desvincular");

  await sql("update memberships set telegram_chat_id = $1 where user_id = $2", ["chat-http-2", equipoA]);

  const primera = await req("POST", "/me/telegram/desvincular", { user: equipoA, tenant: tenantA });
  assert.deepEqual(await primera.json(), { ok: true });

  const segunda = await req("POST", "/me/telegram/desvincular", { user: equipoA, tenant: tenantA });
  assert.deepEqual(await segunda.json(), { ok: false }, "ya no había nada que desvincular la segunda vez");
});

// ---------------------------------------------------------------- conexión OAuth con Google (Bloque F, fase 1)

test("POST /clients/:id/google/conectar devuelve una URL absoluta que apunta al propio callback (mock)", async () => {
  const res = await req("POST", `/clients/${clientA1}/google/conectar`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { url: string };
  assert.ok(body.url.includes(`/clients/${clientA1}/google/callback`), "apunta al propio callback, no a Google");
  assert.ok(body.url.includes("code=mock-code"));
});

test("GET /clients/:id/google/callback sin code o sin state → 400", async () => {
  // Sin headers: esta ruta es ANÓNIMA (corre antes de `autenticar()`), así que ningún `user`/`tenant`
  // viaja en una llamada real — mandarlos no cambiaría nada, pero omitirlos es fiel al camino real.
  const res = await req("GET", `/clients/${clientA1}/google/callback`, {});
  assert.equal(res.status, 400);
});

/**
 * Firma un `state` como lo haría `POST /clients/:id/google/conectar`, sin pasar por HTTP — para los
 * tests que necesitan un `state` VÁLIDAMENTE firmado pero con un `clientId` que no es el de la ruta
 * (el ataque que `estado.clientId !== clientId` está para frenar). Mismo secreto que `createApp`
 * recibió en el `beforeEach`.
 */
function firmarStateDeTest(estado: Partial<EstadoOAuth> & { clientId: string }): string {
  return firmarEstado(
    {
      tenantId: tenantA,
      userId: equipoA,
      nonce: "nonce-de-test",
      emitidoEn: Date.now(),
      ...estado,
    },
    OAUTH_STATE_SECRET_TEST,
  );
}

test("🔴 GET /clients/:id/google/callback con state de OTRO cliente → 400, no escribe nada", async () => {
  // El state está firmado de VERDAD (con el secreto del proceso) -- lo que está mal es que apunta a
  // un cliente distinto del de la ruta. Antes del fix esto se podía forjar a mano (JSON en base64url
  // plano); ahora ni siquiera un state genuino de OTRO cliente sirve para éste.
  const stateAjeno = firmarStateDeTest({ clientId: "00000000-0000-4000-8000-000000000099" });
  const res = await req("GET", `/clients/${clientA1}/google/callback?code=abc&state=${stateAjeno}`, {});
  assert.equal(res.status, 400);
  const [fila] = await sql<{ google_conectado_en: string | null }>(
    "select google_conectado_en from clients where id = $1",
    [clientA1],
  );
  assert.equal(fila!.google_conectado_en, null, "un state que apunta a otro cliente no puede haber escrito nada");
});

/** Firma el state pasando por el endpoint REAL (`POST .../conectar`), como lo hace el portal. */
async function obtenerStateFirmado(clientId: string, user: string, tenant: string): Promise<string> {
  const res = await req("POST", `/clients/${clientId}/google/conectar`, { user, tenant });
  assert.equal(res.status, 200, "el control positivo empieza por poder pedir la URL de consentimiento");
  const { url } = (await res.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  assert.ok(state, "la URL de consentimiento tiene que traer un state");
  return state as string;
}

test("🔴 GET /clients/:id/google/callback SIN Authorization completa el flujo (bug real de Task 7)", async () => {
  // Esta es la reproducción del bug que Task 7 encontró en un navegador real: una navegación de nivel
  // superior (`window.location.href`) NUNCA lleva el header `Authorization` -- no es un detalle de
  // esta implementación. Antes del fix, este endpoint vivía detrás de `autenticar()` y esta misma
  // llamada daba 401 "Falta el token Bearer.", rompiendo el flujo de punta a punta.
  const state = await obtenerStateFirmado(clientA1, equipoA, tenantA);
  const res = await req("GET", `/clients/${clientA1}/google/callback?code=verificacion&state=${state}`, {});
  assert.equal(res.status, 302, "el callback anónimo tiene que completar el flujo, no pedir un token que nunca llega");
  assert.ok(res.headers.get("location")?.startsWith(PORTAL_URL_TEST));

  const [fila] = await sql<{ google_refresh_token: string | null }>(
    "select google_refresh_token from clients where id = $1",
    [clientA1],
  );
  assert.equal(fila!.google_refresh_token, "mock-refresh-verificacion");
});

test("🔴 el flujo completo conecta (redirect 302 de vuelta al portal) y desconectar limpia las tres columnas", async () => {
  const state = await obtenerStateFirmado(clientA1, equipoA, tenantA);
  const conectar = await req("GET", `/clients/${clientA1}/google/callback?code=xyz&state=${state}`, {});
  assert.equal(conectar.status, 302);
  assert.ok(conectar.headers.get("location")?.startsWith(PORTAL_URL_TEST), "vuelve al ORIGEN del portal");
  assert.ok(conectar.headers.get("location")?.includes(`/clientes/${clientA1}/resenas`));

  const [conectado] = await sql<{
    google_refresh_token: string | null;
    google_location_id: string | null;
    google_conectado_en: string | null;
  }>("select google_refresh_token, google_location_id, google_conectado_en from clients where id = $1", [
    clientA1,
  ]);
  assert.equal(conectado!.google_refresh_token, "mock-refresh-xyz");
  assert.equal(conectado!.google_location_id, "mock-location-xyz");
  assert.notEqual(conectado!.google_conectado_en, null);

  const desconectar = await req("POST", `/clients/${clientA1}/google/desconectar`, {
    user: equipoA,
    tenant: tenantA,
  });
  assert.equal(desconectar.status, 200);
  assert.deepEqual(await desconectar.json(), { ok: true });

  const [desconectado] = await sql<{
    google_refresh_token: string | null;
    google_location_id: string | null;
    google_conectado_en: string | null;
  }>("select google_refresh_token, google_location_id, google_conectado_en from clients where id = $1", [
    clientA1,
  ]);
  assert.equal(desconectado!.google_refresh_token, null);
  assert.equal(desconectado!.google_location_id, null);
  assert.equal(desconectado!.google_conectado_en, null);
});

test("🔴 con rol 'cliente', desconectar no afecta ninguna fila (ADR-20: solo lee)", async () => {
  // Se conecta de antemano con el superusuario (infraestructura), para que el intento del cliente
  // tenga algo que fallar en desconectar y no un simple "no había nada que hacer".
  await sql(
    `update clients set google_refresh_token = 'secreto', google_location_id = 'loc-1',
                        google_conectado_en = now() where id = $1`,
    [clientA1],
  );

  const res = await req("POST", `/clients/${clientA1}/google/desconectar`, { user: duenoA1, tenant: tenantA });
  assert.equal(res.status, 404, "el update de RLS no afectó filas: el endpoint lo reporta como no encontrado");

  const [fila] = await sql<{ google_refresh_token: string | null }>(
    "select google_refresh_token from clients where id = $1",
    [clientA1],
  );
  assert.equal(fila!.google_refresh_token, "secreto", "el rol cliente no pudo desconectar: la fila no cambió");
});

test("🔴 GET /clients/:id/google/callback de OTRO tenant → 404, sin escribir (RLS, no un `if` de rol)", async () => {
  // El `state` viaja HONESTAMENTE firmado para la identidad REAL de equipoB (tenantB) -- `POST
  // .../conectar` no comprueba a quién pertenece `clientId` (esa decisión es deliberada, ver el
  // comentario del bloque en app.ts): equipoB puede pedir un state para el cliente de OTRO tenant sin
  // que nada se lo impida acá. Lo que sí lo frena es RLS al escribir: `conectarGoogle` hace el UPDATE
  // con `ctx.tenantId = tenantB`, y la fila de `clientA1` vive en `tenantA` -- cero filas, 404. No es
  // el ataque de state cruzado (eso ya lo cubre el test de arriba): acá el clientId SÍ coincide con
  // la ruta, lo que no coincide es el tenant.
  const state = await obtenerStateFirmado(clientA1, equipoB, tenantB);
  const res = await req("GET", `/clients/${clientA1}/google/callback?code=xyz2&state=${state}`, {});
  assert.equal(res.status, 404);
  const [fila] = await sql<{ google_conectado_en: string | null }>(
    "select google_conectado_en from clients where id = $1",
    [clientA1],
  );
  assert.equal(fila!.google_conectado_en, null, "el tenant B no pudo conectar el cliente de A");
});

// ---------------------------------------------------------------- GET/PATCH de reseñas (Bloque F, fase 1)

/**
 * Siembra una reseña de Google directamente (superusuario, salta RLS): así el test de LECTURA
 * ejercita el camino real -- `listarResenas` bajo `app_user` -- contra un dato que no pasó por la
 * API para entrar. El polling real las escribe con `app_resenas` (0022), que acá no corre.
 */
async function sembrarResena(
  clientId: string,
  opts: {
    googleReviewId: string;
    puntuacion?: number;
    autor?: string;
    texto?: string | null;
    publicadaEn?: string;
  },
): Promise<Array<{ id: string }>> {
  const [fila] = await sql<{ tenant_id: string }>("select tenant_id from clients where id = $1", [clientId]);
  return sql<{ id: string }>(
    `insert into resenas_google (tenant_id, client_id, google_review_id, puntuacion, autor, texto, publicada_en)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      fila!.tenant_id,
      clientId,
      opts.googleReviewId,
      opts.puntuacion ?? 5,
      opts.autor ?? "Cliente Anónimo",
      opts.texto ?? null,
      opts.publicadaEn ?? new Date().toISOString(),
    ],
  );
}

test("GET /clients/:id/resenas devuelve solo las del cliente, ordenadas 1-3★ sin ver primero", async () => {
  await sembrarResena(clientA1, { puntuacion: 5, googleReviewId: "buena" });
  await sembrarResena(clientA1, { puntuacion: 2, googleReviewId: "mala" });

  const res = await req("GET", `/clients/${clientA1}/resenas`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200);
  const body = (await res.json()) as { resenas: Array<{ id: string; puntuacion: number; borradorRespuesta: string | null }> };
  assert.equal(body.resenas.length, 2);
  assert.equal(body.resenas[0]?.puntuacion, 2, "la de 2★ sin ver va primero (orden ya fijado en listarResenas)");
  assert.ok(
    "borradorRespuesta" in body.resenas[0]!,
    "el borrador de IA también tiene que viajar en la respuesta HTTP, no solo en PgResenas (Fix 2, #7)",
  );
});

test("🔴 GET /clients/:id/resenas de OTRO tenant devuelve lista vacía, no un error (RLS)", async () => {
  const [clientB1] = await sql<{ id: string }>(
    "insert into clients (tenant_id, nombre, vertical) values ($1,'Sushi Zen','restauracion') returning id",
    [tenantB],
  );
  await sembrarResena(clientB1!.id, { googleReviewId: "de-otro-tenant" });

  const res = await req("GET", `/clients/${clientB1!.id}/resenas`, { user: equipoA, tenant: tenantA });
  assert.equal(res.status, 200, "no un error: mismo criterio que GET /runs?clientId= de otro tenant");
  const body = (await res.json()) as { resenas: unknown[] };
  assert.deepEqual(body.resenas, []);
});

test("PATCH .../resenas/:id marca vista=true, escribe de verdad, y una segunda vez da 404", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-marcar" });
  const primera = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: true },
  });
  assert.equal(primera.status, 200);
  assert.deepEqual(await primera.json(), { ok: true });

  const [fila] = await sql<{ vista_en: string | null }>("select vista_en from resenas_google where id = $1", [
    r!.id,
  ]);
  assert.notEqual(fila!.vista_en, null, "la fila quedó marcada de verdad, no solo la respuesta");

  const segunda = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: true },
  });
  assert.equal(segunda.status, 404, "ya estaba vista: el `where vista_en is null` no matchea de nuevo");
});

test("PATCH .../resenas/:id con un body distinto de {vista:true} → 400", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-body-malo" });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: false },
  });
  assert.equal(res.status, 400);

  const [fila] = await sql<{ vista_en: string | null }>("select vista_en from resenas_google where id = $1", [
    r!.id,
  ]);
  assert.equal(fila!.vista_en, null, "un body inválido no tuvo ningún efecto");
});

test("🔴 con rol 'cliente', PATCH .../resenas/:id da 404 (ADR-20: solo lee)", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-solo-lectura" });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { vista: true },
  });
  assert.equal(res.status, 404);

  const [fila] = await sql<{ vista_en: string | null }>("select vista_en from resenas_google where id = $1", [
    r!.id,
  ]);
  assert.equal(fila!.vista_en, null, "el rol cliente no pudo escribir: la fila no cambió");
});

test("PATCH .../resenas/:id con {borrador_respuesta} guarda el texto y responde 200", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-borrador", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { borrador_respuesta: "Gracias por tu reseña" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const [fila] = await sql<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [r!.id],
  );
  assert.equal(fila!.borrador_respuesta, "Gracias por tu reseña");
});

test("PATCH .../resenas/:id se puede repetir sobre el borrador (a diferencia de vista)", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-borrador-2x", puntuacion: 5 });
  await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA, tenant: tenantA, body: { borrador_respuesta: "Primero" },
  });
  const segunda = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA, tenant: tenantA, body: { borrador_respuesta: "Corregido" },
  });
  assert.equal(segunda.status, 200, "editar el borrador no es de una sola vez, a diferencia de vista=true");

  const [fila] = await sql<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [r!.id],
  );
  assert.equal(fila!.borrador_respuesta, "Corregido");
});

test("🔴 PATCH .../resenas/:id con las DOS llaves a la vez → 400, no ignora una en silencio", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-body-doble", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: true, borrador_respuesta: "no debería aplicarse" },
  });
  assert.equal(res.status, 400);

  const [fila] = await sql<{ vista_en: string | null; borrador_respuesta: string | null }>(
    "select vista_en, borrador_respuesta from resenas_google where id = $1",
    [r!.id],
  );
  assert.equal(fila!.vista_en, null, "el body inválido no tuvo NINGÚN efecto");
  assert.equal(fila!.borrador_respuesta, null);
});

test("🔴 PATCH .../resenas/:id con una clave desconocida sumada a una válida → 400", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-clave-extra", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { vista: true, otraCosa: 1 },
  });
  assert.equal(res.status, 400);
});

test("🔴 con rol 'cliente', PATCH .../resenas/:id con borrador_respuesta da 404 (ADR-20: solo lee)", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-borrador-cliente", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { borrador_respuesta: "intento del rol cliente" },
  });
  assert.equal(res.status, 404);
});

// ============================================================== {"publicar": true} (Bloque F, fase 2, segunda pieza)

test("PATCH .../resenas/:id con {publicar:true}, con borrador y sin publicar: 200 y emite EXACTAMENTE resenas/respuesta.solicitada", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-publicar-1", puntuacion: 5 });
  await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { borrador_respuesta: "Gracias por tu reseña" },
  });

  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { publicar: true },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const [fila] = await sql<{ respuesta_solicitada_en: string | null }>(
    "select respuesta_solicitada_en from resenas_google where id = $1",
    [r!.id],
  );
  assert.ok(fila!.respuesta_solicitada_en, "la fila quedó marcada de verdad, no solo la respuesta");

  assert.equal(eventos.length, 1, "se emitió exactamente un evento");
  assert.deepEqual(eventos[0], {
    name: "resenas/respuesta.solicitada",
    data: { resenaId: r!.id, solicitadoPor: equipoA },
  });
});

test("PATCH .../resenas/:id con {publicar:true} sin borrador: 404 y NINGÚN evento emitido", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-publicar-sin-borrador", puntuacion: 5 });

  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { publicar: true },
  });
  assert.equal(res.status, 404);
  assert.equal(eventos.length, 0, "un comando compuesto rechazado no puede haber emitido el evento");
});

test("🔴 con rol 'cliente', PATCH .../resenas/:id con {publicar:true} da 404 (ADR-20: solo lee), sin evento", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-publicar-cliente", puntuacion: 5 });
  await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { borrador_respuesta: "Gracias" },
  });
  eventos.length = 0; // ignorar lo anterior; medimos SOLO el intento del rol cliente

  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: duenoA1,
    tenant: tenantA,
    body: { publicar: true },
  });
  assert.equal(res.status, 404);
  assert.equal(eventos.length, 0, "el rol cliente no pudo escribir: no se despertó al orquestador");
});

test("🔴 PATCH .../resenas/:id con {publicar: \"sí\"} (string, no boolean) → 400", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-publicar-string", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { publicar: "sí" },
  });
  assert.equal(res.status, 400);
  assert.equal(eventos.length, 0);
});

test("🔴 PATCH .../resenas/:id con {publicar:true, vista:true} (dos claves a la vez) → 400", async () => {
  const [r] = await sembrarResena(clientA1, { googleReviewId: "r-publicar-doble", puntuacion: 5 });
  const res = await req("PATCH", `/clients/${clientA1}/resenas/${r!.id}`, {
    user: equipoA,
    tenant: tenantA,
    body: { publicar: true, vista: true },
  });
  assert.equal(res.status, 400);
  assert.equal(eventos.length, 0);
});

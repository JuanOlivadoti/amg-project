import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PgStore, CambiosPagina } from "db";
import { solicitarResearch, type EmisorEventos } from "./solicitar.js";
import { autenticar, type VerificadorToken, type Variables } from "./auth.js";

/**
 * Todo lo que la API necesita, INYECTADO. Ni el store, ni el emisor, ni la verificación del token se
 * construyen acá dentro: así los tests corren la API entera contra PGlite, un emisor de mentira y un
 * verificador falso, sin red y sin Supabase. La construcción real vive en `deps.ts`.
 */
export interface ApiDeps {
  /** Store atado al login `amg_api` → rol `app_user`. NO puede asumir `app_service` (ADR-17). */
  store: PgStore;
  emisor: EmisorEventos;
  verificar: VerificadorToken;
  /**
   * Orígenes permitidos para CORS. El portal corre en otro origen (localhost:4200, o su dominio),
   * así que sin esto el navegador bloquea cada llamada. Default `*`: es seguro porque la API
   * autentica por **header `Authorization`**, no por cookies —no hay credenciales que un origen
   * ajeno pueda robar—; el token igual hay que tenerlo. En producción se acota a los dominios reales.
   */
  corsOrigins?: string | string[];
}

export function createApp(deps: ApiDeps): Hono<{ Variables: Variables }> {
  const app = new Hono<{ Variables: Variables }>();

  // CORS primero: el preflight (OPTIONS) tiene que responder ANTES de exigir token, o el navegador
  // ni siquiera llega a mandar el request real.
  app.use(
    "*",
    cors({
      origin: deps.corsOrigins ?? "*",
      allowMethods: ["GET", "POST", "PATCH", "OPTIONS"],
      allowHeaders: ["authorization", "content-type", "x-amg-tenant"],
    }),
  );

  // Toda la superficie exige token. No hay ruta pública: seguro por defecto.
  app.use("*", autenticar(deps.verificar));

  /*
   * POST /runs — COMANDO COMPUESTO (ADR-18).
   *
   * `solicitarResearch` crea la fila bajo RLS (ahí se autoriza) y SOLO SI no lanzó emite el evento.
   * Si el humano no puede crear el run, RLS lanza y no se emite nada: el orquestador nunca arranca a
   * nombre de un run que la base no autorizó.
   */
  app.post("/runs", async (c) => {
    const ctx = c.get("ctx");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body.clientId !== "string" || typeof body.prompt !== "string") {
      return c.json({ error: "Se requieren clientId (uuid) y prompt (string)." }, 400);
    }
    const runId = await solicitarResearch(deps.store, deps.emisor, ctx, {
      clientId: body.clientId,
      prompt: body.prompt,
      ...(body.market ? { market: body.market } : {}),
      ...(typeof body.maxCostMicros === "number" ? { maxCostMicros: body.maxCostMicros } : {}),
      ...(typeof body.maxPages === "number" ? { maxPages: body.maxPages } : {}),
    });
    return c.json({ runId }, 201);
  });

  /** GET /runs — los runs visibles. RLS decide el conjunto según el rol; `?clientId=` los filtra. */
  app.get("/runs", async (c) => {
    const ctx = c.get("ctx");
    const clientId = c.req.query("clientId");
    const runs = clientId
      ? await deps.store.listRuns(ctx, clientId)
      : await deps.store.listAllRuns(ctx);
    return c.json({ runs });
  });

  /** GET /runs/:id — el brief: el run + sus páginas propuestas (con evidencia y estado de aprobación). */
  app.get("/runs/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const run = await deps.store.getRun(ctx, id);
    if (!run) return c.json({ error: "Run no encontrado." }, 404);
    const pages = await deps.store.getRunPages(ctx, id);
    return c.json({ run, pages });
  });

  /** POST /pages/:id/approve — media compuerta: aprueba UNA página (ADR-06). */
  app.post("/pages/:id/approve", async (c) => {
    const ctx = c.get("ctx");
    const ok = await deps.store.approvePage(ctx, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "Página no encontrada." }, 404);
  });

  /** PATCH /pages/:id — corrige una página propuesta. Editar REVOCA la aprobación, siempre (ADR-06). */
  app.patch("/pages/:id", async (c) => {
    const ctx = c.get("ctx");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "Body inválido." }, 400);
    const ok = await deps.store.editPage(ctx, c.req.param("id"), filtrarCambios(body));
    return ok
      ? c.json({ ok: true })
      : c.json({ error: "Página no encontrada, retirada, o sin cambios válidos." }, 404);
  });

  /*
   * POST /runs/:id/approve — la otra mitad, y también COMANDO COMPUESTO.
   *
   * `approveRun` aprueba bajo RLS (y se niega si ninguna página está aprobada, ADR-06). Solo si no
   * lanzó, se despierta al workflow. El evento NO porta autoridad: el orquestador vuelve a preguntar
   * a la base qué publicar (`getPublishablePages`, compuerta doble). Ver ADR-12/18.
   */
  app.post("/runs/:id/approve", async (c) => {
    const ctx = c.get("ctx");
    const runId = c.req.param("id");
    // Solo si la base REALMENTE lo aprobó se despierta al workflow. Un lector-no-escritor (rol
    // `cliente`) puede pasar el conteo de páginas pero no actualizar el run: ahí `ok` es false y no
    // se emite nada (si no, el cliente despertaría el workflow con un 200 falso). Ver `approveRun`.
    const ok = await deps.store.approveRun(ctx, runId);
    if (!ok) return c.json({ error: "No autorizado para aprobar este run." }, 403);
    await deps.emisor.send({
      name: "research/aprobado",
      data: ctx.userId ? { runId, aprobadoPor: ctx.userId } : { runId },
    });
    return c.json({ ok: true });
  });

  app.onError((err, c) => {
    const code = (err as { code?: string }).code;
    // RLS rechazó la escritura (WITH CHECK): el usuario no tiene acceso a ese tenant/cliente.
    if (code === "42501") return c.json({ error: "No autorizado para esta operación." }, 403);
    // Entrada malformada (uuid inválido, falta un NOT NULL, FK o CHECK que no cierra): es del
    // cliente, no del servidor. Se mapea a 400 en vez de un 500 que mentiría sobre de quién es la culpa.
    if (code && ["22P02", "23502", "23503", "23514"].includes(code)) {
      return c.json({ error: "Petición inválida: revisá clientId, market y los campos obligatorios." }, 400);
    }
    // Reglas de negocio del store que no son un 500: son estados, no fallas.
    if (err.message.includes("ninguna página aprobada")) return c.json({ error: err.message }, 409);
    if (err.message.includes("ya existe y no pertenece")) return c.json({ error: err.message }, 409);
    console.error("[api] error no manejado:", err);
    return c.json({ error: "Error interno." }, 500);
  });

  return app;
}

/**
 * Allowlist de la edición, en el borde HTTP. `PgStore.editPage` YA tiene su propia allowlist (no se
 * confía en el llamador), pero filtrar acá también evita cargar la base con basura y es defensa en
 * profundidad: `approved`, `run_id`, `tenant_id` no tienen ni por dónde entrar.
 */
function filtrarCambios(body: Record<string, unknown>): CambiosPagina {
  const cambios: CambiosPagina = {};
  if (typeof body["url_slug"] === "string") cambios.url_slug = body["url_slug"];
  if (typeof body["keyword_principal"] === "string") cambios.keyword_principal = body["keyword_principal"];
  if (esObjeto(body["seo"])) cambios.seo = body["seo"];
  if (esObjeto(body["content_brief"])) cambios.content_brief = body["content_brief"];
  if (Array.isArray(body["preguntas_frecuentes"])) {
    cambios.preguntas_frecuentes = body["preguntas_frecuentes"].filter((x): x is string => typeof x === "string");
  }
  return cambios;
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

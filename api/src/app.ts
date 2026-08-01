import { Hono } from "hono";
import { cors } from "hono/cors";
import type { PgStore, CambiosPagina, PgClientes, NuevoCliente, CambiosCliente } from "db";
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
  /** CRM de clientes, mismo login/rol que `store` (ADR-17) — ver `db/src/clientes.ts`. */
  clientes: PgClientes;
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

  /*
   * Chequeo de salud, SIN auth y ANTES del middleware que exige token. Es la única ruta pública, y a
   * propósito: el PaaS (Railway) la sondea para saber si el proceso está vivo, y un health-check que
   * necesitara un JWT válido no serviría para eso. No toca la base ni revela nada: responde `ok` y ya.
   */
  app.get("/health", (c) => c.json({ status: "ok" }));

  // Del resto de la superficie, todo exige token. Seguro por defecto.
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

  /*
   * Los cuatro endpoints de clientes son COMANDOS SIMPLES (no compuestos, ADR-18 no aplica): no hay
   * ningún workflow que despertar al crear/editar un cliente, así que no emiten ningún evento — solo
   * escritura bajo RLS. El rol NO se chequea acá (ADR-15): la política `client_write` de `clients`
   * (0001_init.sql) ya bloquea insert/update para el rol `cliente`, y el `onError` de abajo ya mapea
   * el 42501 resultante a 403. Lo mismo con `asignado_a`: la FK compuesta de la 0011 lo rechaza con
   * 23503, que el `onError` ya traduce a 400 — no se valida a mano acá.
   */

  /** GET /clients — todos los clientes del tenant del contexto. RLS ya aísla. */
  app.get("/clients", async (c) => {
    const ctx = c.get("ctx");
    const clientes = await deps.clientes.listarClientes(ctx);
    return c.json({ clientes });
  });

  /** POST /clients — alta. El `tenant_id` sale del contexto (header/token), nunca del body. */
  app.post("/clients", async (c) => {
    const ctx = c.get("ctx");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "Body inválido." }, 400);
    const campos = filtrarCamposCliente(body);
    if (typeof campos.nombre !== "string") {
      return c.json({ error: "Se requiere nombre (string)." }, 400);
    }
    const id = await deps.clientes.crearCliente(ctx, { ...campos, nombre: campos.nombre });
    return c.json({ id }, 201);
  });

  /** GET /clients/:id — un cliente. 404 genérico si no existe o es de otro tenant (no distingue). */
  app.get("/clients/:id", async (c) => {
    const ctx = c.get("ctx");
    const cliente = await deps.clientes.obtenerCliente(ctx, c.req.param("id"));
    if (!cliente) return c.json({ error: "Cliente no encontrado." }, 404);
    return c.json({ cliente });
  });

  /** PATCH /clients/:id — allowlist de campos en el borde HTTP, mismo criterio que PATCH /pages/:id. */
  app.patch("/clients/:id", async (c) => {
    const ctx = c.get("ctx");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "Body inválido." }, 400);
    const ok = await deps.clientes.actualizarCliente(ctx, c.req.param("id"), filtrarCamposCliente(body));
    return ok
      ? c.json({ ok: true })
      : c.json({ error: "Cliente no encontrado, o sin cambios válidos." }, 404);
  });

  app.onError((err, c) => {
    const code = (err as { code?: string }).code;

    /*
     * 42501 = `insufficient_privilege`. Llega por RLS (el usuario no tiene acceso) **y** por un GRANT
     * roto, y Postgres **no los distingue por código**.
     *
     * La versión anterior los separaba mirando si el mensaje decía `row-level security`. Eso está
     * mal y la 9ª review lo cazó: Postgres **traduce** los mensajes según `lc_messages`, así que en
     * un servidor no-inglés un rechazo legítimo de RLS **dejaba de coincidir** y salía como **500 en
     * vez de 403**. Parsear texto de errores es una dependencia del idioma disfrazada de lógica.
     *
     * Ahora no se adivina: al cliente **siempre 403 sin detalle** (que es lo correcto para los dos
     * casos — no se le filtra si fue RLS o un GRANT), y al log el error completo, que es donde un
     * operador puede ver si en realidad hay una credencial mal configurada (ADR-17).
     */
    if (code === "42501") {
      console.error("[api] 42501 insufficient_privilege (RLS o GRANT mal configurado):", err.message);
      return c.json({ error: "No autorizado para esta operación." }, 403);
    }
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

/**
 * Allowlist de la edición/alta de clientes, en el borde HTTP (defensa en profundidad: `PgClientes`
 * ya tiene la suya). Se comparte entre POST y PATCH porque ambos leen exactamente las mismas
 * columnas de `NuevoCliente`/`CambiosCliente` — la única diferencia es que POST exige `nombre`
 * después de llamar a esto. `tenant_id`, `rol`, `id` no están en esta lista: un body que los traiga
 * nunca los toca, no hace falta ignorarlos explícitamente.
 */
function filtrarCamposCliente(body: Record<string, unknown>): CambiosCliente {
  const campos: CambiosCliente = {};
  if (typeof body["nombre"] === "string") campos.nombre = body["nombre"];
  if (typeof body["tipo"] === "string" || body["tipo"] === null) campos.tipo = body["tipo"] as string | null;
  if (typeof body["industria"] === "string" || body["industria"] === null) {
    campos.industria = body["industria"] as string | null;
  }
  if (Array.isArray(body["etiquetas"])) {
    campos.etiquetas = body["etiquetas"].filter((x): x is string => typeof x === "string");
  }
  if (typeof body["nivel_actividad"] === "string" || body["nivel_actividad"] === null) {
    campos.nivel_actividad = body["nivel_actividad"] as string | null;
  }
  if (typeof body["estado_contrato"] === "string") campos.estado_contrato = body["estado_contrato"];
  if (typeof body["contrato_vence_en"] === "string" || body["contrato_vence_en"] === null) {
    campos.contrato_vence_en = body["contrato_vence_en"] as string | null;
  }
  if (typeof body["score"] === "number" || body["score"] === null) campos.score = body["score"] as number | null;
  if (typeof body["asignado_a"] === "string" || body["asignado_a"] === null) {
    campos.asignado_a = body["asignado_a"] as string | null;
  }
  if (esObjeto(body["contacto"])) campos.contacto = body["contacto"];
  if (typeof body["origen"] === "string" || body["origen"] === null) campos.origen = body["origen"] as string | null;
  return campos;
}

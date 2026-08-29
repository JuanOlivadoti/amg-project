import { Hono } from "hono";
import { cors } from "hono/cors";
import { renderReport } from "contrato";
import { esEstadoIdea, ESTADOS_IDEA } from "db";
import type {
  PgStore,
  CambiosPagina,
  PgClientes,
  NuevoCliente,
  CambiosCliente,
  PgMembresias,
  PgIdeas,
  FiltrosIdeas,
  PgResenas,
} from "db";
import { menuPatchSchema } from "web-builder/contract";
import { validarCambiosIdea, serializarResumen, serializarDetalle } from "./ideas-http.js";
import { solicitarResearch, type EmisorEventos } from "./solicitar.js";
import { autenticar, type VerificadorToken, type Variables } from "./auth.js";
import type { GoogleOAuthProvider } from "./google-oauth.js";
import { firmarEstado, verificarEstado, type EstadoOAuth } from "./oauth-state.js";
import { nombreArchivo } from "./informe-nombre.js";
import { briefDelEntregable } from "./entregable.js";
import { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA, NO_IMPLEMENTADO } from "./codigos.js";

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
  /** Miembros del tenant (pieza 2 — Usuarios), mismo login/rol — ver `db/src/membresias.ts`. */
  membresias: PgMembresias;
  /**
   * Ideas (pieza 3). Su constructor NO recibe rol, al revés que los tres de arriba: `app_service` no
   * tiene ningún grant sobre `ideas` (0013), así que la clase fija `app_user` y no hay parámetro que
   * alguien pueda pasar mal — ver `db/src/ideas.ts`.
   */
  ideas: PgIdeas;
  /**
   * Reseñas de Google (Bloque F, fase 1). Sin parámetro de rol, como `ideas`: `app_service` no
   * tiene ningún grant sobre `resenas_google` ni sobre las columnas de conexión de `clients` — ver
   * `db/src/resenas.ts`.
   */
  resenas: PgResenas;
  /** Conexión OAuth con Google (mock/live) — ver `google-oauth.ts`. Bloque F fase 1 es mock-first. */
  googleOAuth: GoogleOAuthProvider;
  /**
   * Secreto con el que se firma/verifica el `state` de OAuth (`oauth-state.ts`). `POST
   * /clients/:id/google/conectar` (autenticado) FIRMA la identidad de quien conecta dentro del
   * `state`; `GET .../google/callback` (anónimo, fuera de `autenticar()`) la VERIFICA — es lo único
   * que le permite a una ruta que ningún header puede alcanzar confiar en el `tenantId`/`userId` que
   * trae. Sin este secreto cualquiera podría escribir `google_refresh_token` en un cliente ajeno
   * fabricando un `state` a mano.
   */
  oauthStateSecret: string;
  emisor: EmisorEventos;
  verificar: VerificadorToken;
  /**
   * Orígenes permitidos para CORS. El portal corre en otro origen (localhost:4200, o su dominio),
   * así que sin esto el navegador bloquea cada llamada. Default `*`: es seguro porque la API
   * autentica por **header `Authorization`**, no por cookies —no hay credenciales que un origen
   * ajeno pueda robar—; el token igual hay que tenerlo. En producción se acota a los dominios reales.
   */
  corsOrigins?: string | string[];
  /**
   * Origen del PORTAL (no de la API), para el redirect final de `GET /clients/:id/google/callback`.
   * Ese endpoint lo pega el NAVEGADOR con una navegación completa (no un `fetch` del portal), así que
   * tiene que devolver un redirect real de vuelta a una pantalla — no JSON. Es el mismo dato que hoy
   * arma `corsOrigins`: quien construye `ApiDeps` (`deps.ts`/`dev-server.ts`) lo deriva de ahí, no es
   * una variable de entorno conceptualmente nueva.
   */
  portalUrl: string;
  /**
   * `@username` del bot de Telegram (sin el `@`), para armar el deep link `t.me/<bot>?start=<código>`
   * de `POST /me/telegram/vincular` (Bloque F, fase 2, migración 0026). Config pública, no secreta.
   *
   * **Obligatoria al arrancar** (`leerConfig`, mismo criterio que `DATABASE_URL_RENDER` en el
   * renderizador): sin ella, el endpoint devolvería en silencio una URL rota
   * (`t.me/undefined?start=...`) -- el arranque tiene que fallar antes, no el endpoint en runtime.
   */
  telegramBotUsername: string;
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
      /*
       * Sin esto, el saneo del `filename` de la descarga del informe se construye y NADIE lo recibe.
       *
       * Un origen cruzado solo puede LEER los siete headers de la safelist de CORS (`content-type`,
       * `content-length`, `cache-control`, `expires`, `last-modified`, `pragma`, `content-language`).
       * `Content-Disposition` no está, así que el `headers.get('content-disposition')` del portal daba
       * `null` (medido en Chrome) y la descarga caía a su nombre de fallback. El header estaba bien
       * construido y bien saneado: el navegador se lo escondía a quien lo necesitaba.
       *
       * Es una ALLOWLIST POSITIVA y se expone exactamente uno: `hono/cors` emite el valor tal cual
       * (`opts.exposeHeaders.join(",")`) y defaultea a `[]`, así que agregar éste no habilita ningún
       * otro. No amplía quién puede leerlo: para recibir esta respuesta ya hay que haber pasado el JWT
       * y la política `informe_staff`, y quien la recibe ya tiene el CUERPO del informe —el desglose
       * del coste— en las manos. El nombre del cliente es estrictamente menos que eso.
       */
      exposeHeaders: ["content-disposition"],
    }),
  );

  /*
   * Chequeo de salud, SIN auth y ANTES del middleware que exige token. Es la única ruta pública, y a
   * propósito: el PaaS (Railway) la sondea para saber si el proceso está vivo, y un health-check que
   * necesitara un JWT válido no serviría para eso. No toca la base ni revela nada: responde `ok` y ya.
   */
  app.get("/health", (c) => c.json({ status: "ok" }));

  /*
   * GET /clients/:id/google/callback — SIN auth y ANTES del middleware que exige token, mismo
   * mecanismo que `/health` arriba (y por el mismo motivo del comentario ahí: en Hono el orden de
   * registro decide qué handlers componen la cadena de una request, y una ruta registrada antes de
   * `app.use("*", autenticar(...))` nunca pasa por ese middleware).
   *
   * Esto NO es una relajación de seguridad: la ruta la pega una NAVEGACIÓN DE NIVEL SUPERIOR real del
   * navegador (`window.location.href` desde el portal) — ninguna navegación `href` lleva el header
   * `Authorization`, no es un detalle de esta implementación sino de cómo funciona la plataforma web.
   * Exigirle `autenticar()` a esta ruta no la protege: la vuelve inalcanzable (401 `Falta el token
   * Bearer.` en el 100% de los casos, confirmado en un navegador real).
   *
   * La identidad de quien conecta viaja DENTRO del `state`, y ese `state` está FIRMADO con HMAC-SHA256
   * (`oauth-state.ts`) por el mismo proceso que lo firmó al armar la URL de consentimiento (`POST
   * /clients/:id/google/conectar`, más abajo, SÍ autenticado). `verificarEstado` es lo que impide que
   * cualquiera golpee esta URL a mano con un `tenantId`/`userId` inventado: sin la firma correcta (y
   * sin que `emitidoEn` esté dentro de la ventana), el callback ni siquiera llega a construir un `ctx`.
   */
  app.get("/clients/:id/google/callback", async (c) => {
    const clientId = c.req.param("id");
    const code = c.req.query("code");
    const stateCrudo = c.req.query("state");

    if (!code || !stateCrudo) {
      return c.json({ error: "Falta code o state en el callback de Google." }, 400);
    }

    const estado = verificarEstado(stateCrudo, deps.oauthStateSecret);
    if (!estado) {
      return c.json({ error: "state inválido, alterado o vencido." }, 400);
    }
    if (estado.clientId !== clientId) {
      return c.json({ error: "El state no corresponde a este cliente." }, 400);
    }

    // El ctx sale ENTERO del state firmado: acá no hay `c.get("ctx")` porque esta ruta corre ANTES
    // del middleware de auth y nunca lo va a tener. Lo que autoriza la escritura sigue siendo RLS
    // (`conectarGoogle`, ADR-20) — este `ctx` es solo la identidad que el state trajo verificada.
    const ctx = { tenantId: estado.tenantId, userId: estado.userId };
    const { refreshToken, locationId } = await deps.googleOAuth.intercambiarCode(code);

    const ok = await deps.resenas.conectarGoogle(ctx, clientId, { refreshToken, locationId });
    if (!ok) return c.json({ error: "Cliente no encontrado o sin permiso para conectar." }, 404);

    // Redirect real: este endpoint lo pega el NAVEGADOR (window.location.href del portal), no un
    // fetch, así que la respuesta tiene que ser una navegación de vuelta, no JSON.
    return c.redirect(`${deps.portalUrl}/clientes/${clientId}/resenas`);
  });

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

  /** GET /runs/:id — el run + sus páginas propuestas, y la última decisión (si hay), en UN snapshot. */
  app.get("/runs/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const run = await deps.store.getRunConUltimaDecision(ctx, id);
    if (!run) return c.json({ error: "Run no encontrado." }, 404);
    const pages = await deps.store.getRunPages(ctx, id);
    return c.json({ run, pages });
  });

  /*
   * GET /runs/:id/informe — el informe de keyword research para la pantalla (KR-2b).
   *
   * Tres resultados y son tres a propósito: 404 si el run no existe o no es visible; 200 con `null` si el
   * run existe y no hay informe; 200 con el informe si hay y quien pregunta puede verlo. Un `cliente` cae
   * en el segundo caso, porque la política `informe_staff` (0016) no le devuelve la fila — y esto NO se
   * decide acá con un `if` de rol: lo decide Postgres (ADR-15). La API no debe revelar que existe algo que
   * no puede mostrar, y el informe lleva el desglose de lo que la agencia le paga a DataForSEO.
   *
   * El 404 se decide con `getRun` y no con `getInforme` porque son dos preguntas distintas: "¿existe este
   * run para mí?" y "¿hay informe?". Colapsarlas en un 404 haría que el portal no pueda decir cuál de las
   * dos cosas pasa, y mostraría un error genérico donde debería decir "todavía no hay informe".
   */
  app.get("/runs/:id/informe", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const run = await deps.store.getRun(ctx, id);
    if (!run) return c.json({ error: "Run no encontrado." }, 404);
    const informe = await deps.store.getInforme(ctx, id);
    return c.json({
      informe_md: informe?.informe_md ?? null,
      generado_at: informe?.generado_at ?? null,
    });
  });

  /*
   * GET /runs/:id/informe.md — la descarga. Acá la ausencia de informe SÍ es 404: no hay archivo que
   * bajar. Las DOS razones por las que puede faltar —no se generó, o quien pide no puede verlo— dan
   * exactamente la misma respuesta, por lo mismo que arriba.
   *
   * El `filename` sale del nombre del cliente y se sanea con ALLOWLIST (`nombreArchivo`), porque es texto
   * que un humano escribe en el CRM y termina dentro de un header HTTP. Lo que esa allowlist para de
   * verdad acá es la **comilla doble**, que undici y node:http aceptan tal cual y que cierra el `filename`
   * antes de tiempo. El `\r\n` lo rechaza el runtime antes de llegar a la respuesta. Las dos cosas están
   * MEDIDAS, con fecha y versión, en `informe-nombre.ts` — y viven solo ahí a propósito: dos copias de un
   * hecho medido se desincronizan, que es exactamente cómo este comentario se había vuelto engañoso.
   */
  app.get("/runs/:id/informe.md", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const informe = await deps.store.getInforme(ctx, id);
    if (!informe) return c.json({ error: "Informe no encontrado." }, 404);

    // Dos lecturas más, bajo el MISMO contexto, solo para nombrar el archivo. Si alguna no devolviera
    // fila, `nombreArchivo` cae a `informe.md` y la descarga sigue sirviendo: el nombre es comodidad,
    // no autorización — lo que autoriza ya pasó en el `getInforme` de arriba.
    const run = await deps.store.getRun(ctx, id);
    const cliente = run ? await deps.store.getClient(ctx, run.client_id) : null;

    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${nombreArchivo(cliente?.nombre, "informe")}"`);
    return c.body(informe.informe_md);
  });

  /*
   * GET /runs/:id/entregable.md — el documento que la agencia le manda al RESTAURANTE.
   *
   * Es el informe de keyword research **sin el bloque de coste**, que es el margen de la agencia. Tres
   * decisiones, y ninguna vive en este handler:
   *
   *  · **El coste no se oculta: NO SE GENERA.** Lo decide `renderReport(brief, { audiencia: "restaurante" })`
   *    en `contrato`, donde está probado por mutación. Si la exclusión se hiciera acá —tapando el bloque,
   *    o recortando el Markdown ya renderizado— el margen dependería de que un encabezado no cambie de
   *    nombre, y en la variante de pantalla ya habría viajado al navegador.
   *
   *  · **El 404 del no-staff NO es un `if`.** `getDatosEntregable` lleva `app.es_staff()` en el predicado
   *    de su consulta (ADR-15), así que para el rol `cliente` devuelve cero filas y este endpoint no
   *    puede distinguir ese caso de un run inexistente ni de uno de otro tenant. Los tres dan el MISMO
   *    404, que es lo que impide filtrar que el run existe.
   *
   *  · **Se genera al vuelo, no se guarda.** El informe interno (`kr_informes`) se congela al terminar el
   *    run y para él está bien. El entregable tiene que reflejar lo que pasó la compuerta —las páginas
   *    aprobadas, con las ediciones que un humano les hizo—; congelarlo mandaría el brief original. Por
   *    eso no hay tabla ni migración nueva. (El comentario de la 0016 preveía que una variante para el
   *    cliente exigiría migración: la exigiría si se GUARDARA, y no se guarda.)
   *
   * El `filename` reusa la allowlist de `nombreArchivo`, con el prefijo `entregable`. El
   * `Content-Disposition` viaja gracias al `exposeHeaders` del CORS de arriba: sin él el navegador se lo
   * esconde al JavaScript del portal y el archivo baja nombrado con el uuid del run.
   */
  app.get("/runs/:id/entregable.md", async (c) => {
    const ctx = c.get("ctx");
    const datos = await deps.store.getDatosEntregable(ctx, c.req.param("id"));
    if (!datos) return c.json({ error: "Run no encontrado." }, 404);

    /*
     * Sin páginas aprobadas NO se genera el documento: 409.
     *
     * El backend hacía lo correcto —generar lo aprobado, que es nada— y salía una hoja con dos títulos
     * de sección vacíos. El riesgo no es técnico: es **humano**, mandarle ese PDF a un restaurante sin
     * mirarlo. Un documento vacío que se descarga sin protestar parece un documento.
     *
     * Va acá **además** del link deshabilitado del portal (decisión de Juan, 2026-08-07: las dos
     * cosas), y la división es la de siempre: la UI evita el clic inútil, el backend impone la regla
     * para quien llame al endpoint directo. Una regla que solo vive en la pantalla no es una regla.
     *
     * **409 y no 404**: el run existe, quien pregunta puede verlo, y la petición es legítima — lo que
     * falla es el estado del recurso. Un 404 acá mentiría sobre la existencia y mandaría al portal a
     * la rama de "este run no existe". Y no 422: no hay nada malformado en la petición.
     */
    if (datos.paginas.length === 0) {
      return c.json(
        {
          error:
            "Este research no tiene ninguna página aprobada, así que el entregable saldría vacío. " +
            "Aprobá al menos una página antes de generarlo.",
          codigo: SIN_PAGINAS_APROBADAS,
        },
        409,
      );
    }

    const md = renderReport(briefDelEntregable(datos), { audiencia: "restaurante" });

    c.header("Content-Type", "text/markdown; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${nombreArchivo(datos.cliente, "entregable")}"`);
    return c.body(md);
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
   * `registrarDecision` inserta la decisión Y promueve el run a 'approved' en la misma sentencia,
   * bajo RLS (Tx). Solo si calificó y devolvió un id, se emite el evento — que no lleva el destino:
   * `workflowDecision` lo relee de la fila (ADR-12/18, y el comentario de cabecera de `events.ts`).
   *
   * Corrección Critical de la ronda de Codex: si `send()` falla DESPUÉS de que `registrarDecision` ya
   * insertó la fila, sin compensación esa decisión queda 'pendiente' PARA SIEMPRE — el índice único
   * parcial (Task 1) bloquearía cualquier otra decisión sobre el mismo run. Mismo patrón que
   * `solicitar.ts:83-95` (fila → evento → si el evento falla, marcar y relanzar).
   */
  app.post("/runs/:id/approve", async (c) => {
    const ctx = c.get("ctx");
    const runId = c.req.param("id");
    // `.catch(() => null)`, mismo criterio que el resto de los POST/PATCH del archivo: un body
    // ausente o que no es JSON válido es un 400 del cliente, no un 500 — sin esto, `c.req.json()`
    // lanza un `SyntaxError` sin `.code` que el `onError` no sabe mapear y cae al 500 genérico.
    const body = await c.req.json<{ destino?: string }>().catch(() => null);
    const destino = body?.destino;

    // TEMPORAL — retirado por el sub-proyecto 3 (docs/superpowers/plans/2026-08-26-publicar-posts-blog-externo.md,
    // Task 10 Step 0.1), agregado durante la revisión conjunta de los tres sub-proyectos (2026-08-26):
    // sin ese Step, crear_posts queda inalcanzable para siempre pese a que el sub-proyecto 3 implementa
    // el resto del mecanismo (hallazgo Critical de Codex sobre esa revisión). Si estás implementando
    // ESTE sub-proyecto (el 2) en aislamiento, dejalo así — el bloque se retira cuando le toque el
    // turno al sub-proyecto 3, no antes.
    if (destino === "crear_posts") {
      return c.json(
        { error: "Destino 'crear_posts' todavía no está implementado.", codigo: NO_IMPLEMENTADO },
        501,
      );
    }
    if (destino !== "crear_web" && destino !== "solo_informe") {
      return c.json({ error: "destino tiene que ser 'crear_web' o 'solo_informe'." }, 400);
    }

    const decisionId = await deps.store.registrarDecision(ctx, runId, destino, ctx.userId ?? undefined);
    if (!decisionId) {
      return c.json(
        { error: "Esta transición no está permitida para el estado actual del run.", codigo: TRANSICION_INVALIDA },
        409,
      );
    }

    try {
      await deps.emisor.send({
        name: "research/aprobado",
        data: { tenantId: ctx.tenantId, decisionId, ...(ctx.userId ? { aprobadoPor: ctx.userId } : {}) },
      });
    } catch (fallo) {
      try {
        // `compensarAprobacionFallida` y no `cerrarDecision`: además de cerrar la decisión en
        // 'error', revierte la promoción del run a 'pending_approval' cuando corresponde — sin eso
        // el índice único deja de bloquear pero `registrarDecision` seguiría sin recalificar (ver el
        // comentario de cabecera del método, `db/src/store.ts`).
        await deps.store.compensarAprobacionFallida(
          ctx,
          decisionId,
          `No se pudo emitir research/aprobado: ${(fallo as Error).message}`,
        );
      } catch (fallaElCierre) {
        console.error("[api] no se pudo cerrar la decisión tras el fallo de send():", fallaElCierre);
      }
      throw fallo;
    }
    return c.json({ ok: true, decisionId });
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

  /** GET /clients/:id/menu — la carta del cliente (platos + categorías), tal como vive en business_profile. */
  app.get("/clients/:id/menu", async (c) => {
    const ctx = c.get("ctx");
    const resultado = await deps.clientes.obtenerMenu(ctx, c.req.param("id"));
    if (!resultado) return c.json({ error: "Cliente no encontrado." }, 404);
    return c.json(resultado);
  });

  /**
   * PATCH /clients/:id/menu — reemplaza la carta completa (`menu` + `menu_categorias`).
   *
   * Las dos claves del body son OBLIGATORIAS (`menuPatchSchema`, `web-builder/contract`): el portal
   * manda siempre su copia completa de ambos arrays, `[]` si no hay categorías. Un body con una
   * clave ausente es 400, no "se conserva lo que había" — ver el spec.
   */
  app.patch("/clients/:id/menu", async (c) => {
    const ctx = c.get("ctx");
    const body = await c.req.json().catch(() => null);
    const parsed = menuPatchSchema.safeParse(body);
    if (!parsed.success) {
      const campos = parsed.error.issues.map((i) => ({ ruta: i.path.join("."), mensaje: i.message }));
      return c.json({ error: "El menú no es válido.", campos }, 400);
    }
    const ok = await deps.clientes.actualizarMenu(ctx, c.req.param("id"), parsed.data);
    return ok ? c.json({ ok: true }) : c.json({ error: "Cliente no encontrado." }, 404);
  });

  /** POST /clients/:id/archive — archiva (soft-delete). Mismo criterio de 404 que PATCH /clients/:id. */
  app.post("/clients/:id/archive", async (c) => {
    const ctx = c.get("ctx");
    const ok = await deps.clientes.archivarCliente(ctx, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "Cliente no encontrado." }, 404);
  });

  /** POST /clients/:id/desarchivar — reabre un cliente archivado. */
  app.post("/clients/:id/desarchivar", async (c) => {
    const ctx = c.get("ctx");
    const ok = await deps.clientes.desarchivarCliente(ctx, c.req.param("id"));
    return ok ? c.json({ ok: true }) : c.json({ error: "Cliente no encontrado." }, 404);
  });

  /*
   * Los dos endpoints de conexión OAuth con Google que quedan DETRÁS de `autenticar()` (Bloque F,
   * fase 1) — el tercero, el callback, vive ANTES del middleware (ver el bloque junto a `/health`,
   * más arriba, con el porqué). Lo que decide este bloque, y no es autorización:
   *
   *  1. **`conectar` FIRMA la identidad de quien conecta dentro del `state`.** `ctx.tenantId` y
   *     `ctx.userId` (ya autenticados acá) viajan firmados con HMAC (`oauth-state.ts`) para que el
   *     callback anónimo pueda confiar en ellos sin poder ser falsificados por cualquiera que golpee
   *     la URL a mano. El `clientId` también viaja adentro y ata el callback al cliente correcto —sin
   *     eso, dos conexiones en simultáneo (dos pestañas, dos clientes) podrían mezclar el token del
   *     uno con la fila del otro.
   *  2. **ADR-20 por RLS, no por un `if`.** `conectarGoogle`/`desconectarGoogle` (`db/src/resenas.ts`)
   *     escriben `clients` bajo la política `client_write` (0001), que exige `app.puede_escribir()`
   *     en su `using` — el rol `cliente` nunca afecta filas, así que el 404 de acá es EXACTAMENTE el
   *     mismo mecanismo que "un CLIENTE no puede aprobar una página" o "no puede modificar clientes",
   *     ya probados en `app.test.ts`. Este handler no sabe qué rol es quien llama.
   */

  /** POST /clients/:id/google/conectar — arma la URL de consentimiento (mock: apunta al propio callback). */
  app.post("/clients/:id/google/conectar", async (c) => {
    const ctx = c.get("ctx");
    const clientId = c.req.param("id");
    const estado: EstadoOAuth = {
      clientId,
      tenantId: ctx.tenantId,
      // `ctx.userId` puede faltar en teoría (el tipo lo permite para el orquestador), pero esta ruta
      // vive detrás de `autenticar()` y siempre lo deja puesto para un humano — nunca llega vacío.
      userId: ctx.userId ?? "",
      nonce: crypto.randomUUID(),
      emitidoEn: Date.now(),
    };
    const state = firmarEstado(estado, deps.oauthStateSecret);
    // El origen de ESTA request, no un valor fijo: en dev la API vive en :3000, en producción en su
    // propio dominio — `urlDeConsentimiento` (mock) lo necesita para armar un callback absoluto.
    const origen = new URL(c.req.url).origin;
    return c.json({ url: deps.googleOAuth.urlDeConsentimiento(clientId, state, origen) });
  });

  /** POST /clients/:id/google/desconectar — limpia las tres columnas. Mismo criterio de 404 que arriba. */
  app.post("/clients/:id/google/desconectar", async (c) => {
    const ctx = c.get("ctx");
    const clientId = c.req.param("id");
    const ok = await deps.resenas.desconectarGoogle(ctx, clientId);
    if (!ok) return c.json({ error: "Cliente no encontrado o sin permiso para desconectar." }, 404);
    return c.json({ ok: true });
  });

  /*
   * Los tres endpoints de `/me/telegram` (Bloque F, fase 2 — alertas por reseñas 1-3★, migración
   * 0026). Auto-servicio, mismo espíritu que los dos de arriba: los tres cuelgan de `ctx.userId`
   * (identidad ya autenticada) -- ninguno recibe un `:userId` de ruta, a propósito: no existe
   * "vincular Telegram de OTRO", así que no hay nada que autorizar por rol acá (ADR-15 sigue
   * intacto: no hay ningún `role` ni identidad ajena que este código decida). Quién puede escribir
   * su propio código, y qué valor queda guardado, lo deciden la política `membership_vincular_
   * telegram` y el trigger `membresias_guardia_telegram` (0026) -- no este handler.
   */

  /** POST /me/telegram/vincular — genera un código de un solo uso y arma el deep link de Telegram. */
  app.post("/me/telegram/vincular", async (c) => {
    const ctx = c.get("ctx");
    const { codigo } = await deps.membresias.generarCodigoTelegram(ctx);
    return c.json({ url: `https://t.me/${deps.telegramBotUsername}?start=${codigo}` });
  });

  /** GET /me/telegram — si la propia cuenta ya vinculó Telegram. */
  app.get("/me/telegram", async (c) => {
    const ctx = c.get("ctx");
    const vinculado = await deps.membresias.telegramVinculado(ctx);
    return c.json({ vinculado });
  });

  /**
   * POST /me/telegram/desvincular — limpia la vinculación de la propia cuenta.
   *
   * `{ ok: boolean }`, NO `{ ok: true }` fijo: `false` es una respuesta VÁLIDA (no había nada que
   * desvincular), no un error — mismo criterio que el resto de los comandos idempotentes de la API
   * (`registrarResenaGoogle`, `marcarAlertaTelegramEnviada`, etc.).
   */
  app.post("/me/telegram/desvincular", async (c) => {
    const ctx = c.get("ctx");
    const ok = await deps.membresias.desvincularTelegram(ctx);
    return c.json({ ok });
  });

  /*
   * Los dos endpoints de RESEÑAS (Bloque F, fase 1). Igual que arriba, ninguno de los dos decide
   * autorización acá:
   *
   *  · **GET no distingue "cliente de otro tenant" de "cliente sin reseñas".** `listarResenas` hace
   *    `where client_id = $1` bajo RLS (`resena_select`, 0021), así que un `clientId` ajeno da CERO
   *    FILAS, no un error — mismo criterio que `GET /runs?clientId=`. No hay un `getClient` previo
   *    para decidir 404: sería una consulta extra solo para llegar al mismo resultado observable.
   *  · **El orden ya lo impone el SQL de `listarResenas`** (1-3★ sin ver primero, más nueva
   *    después): este handler no reordena nada — reordenar acá sería el mismo error que ya corrigió
   *    la migración 0015 para `kr_pages`, con el mismo síntoma (el array pierde su forma al pasar por
   *    otra capa).
   *  · **PATCH: `{"vista": true}` es el ÚNICO cambio soportado.** No es una allowlist de columnas
   *    (como `filtrarCambios`/`filtrarCamposCliente`): es una forma fija, así que se compara el body
   *    entero contra esa forma en vez de filtrar campo por campo.
   *  · **ADR-20 por RLS, no por un `if` de rol.** `marcarVista` hace el `update` bajo `app_user`; la
   *    política `resena_marcar_vista` (0021) exige `app.puede_escribir()` en el `using`, así que para
   *    el rol `cliente` el `update` no matchea ninguna fila y `marcarVista` devuelve `false` sin que
   *    este handler sepa qué rol es quien llama — mismo mecanismo que `PATCH /pages/:id` o
   *    `PATCH /ideas/:id`. El mismo 404 cubre además "no existe", "es de otro tenant" y "ya estaba
   *    vista" (el `where vista_en is null` de `marcarVista`): distinguirlos revelaría la fila.
   */

  /** GET /clients/:id/resenas — las reseñas del cliente, en el orden que ya fija `listarResenas`. */
  app.get("/clients/:id/resenas", async (c) => {
    const ctx = c.get("ctx");
    const clientId = c.req.param("id");
    const resenas = await deps.resenas.listarResenas(ctx, clientId);
    return c.json({ resenas });
  });

  /**
   * PATCH /clients/:id/resenas/:resenaId — acepta EXACTAMENTE una de TRES formas fijas, nunca dos
   * juntas ni una clave desconocida: `{"vista": true}` (marca vista), `{"borrador_respuesta":
   * string}` (edita el borrador, Bloque F fase 2 primera pieza), o `{"publicar": true}` (pide
   * publicar de vuelta en Google, Bloque F fase 2 segunda pieza). No es una allowlist de columnas:
   * cada forma se compara entera, mismo criterio que ya regía cuando solo existía la primera.
   */
  app.patch("/clients/:id/resenas/:resenaId", async (c) => {
    const ctx = c.get("ctx");
    const clientId = c.req.param("id");
    const resenaId = c.req.param("resenaId");
    const body = await c.req.json().catch(() => null);
    const claves = body && typeof body === "object" ? Object.keys(body) : [];

    if (claves.length === 1 && (body as Record<string, unknown>)["vista"] === true) {
      const ok = await deps.resenas.marcarVista(ctx, clientId, resenaId);
      if (!ok) return c.json({ error: "Reseña no encontrada, ya vista, o sin permiso." }, 404);
      return c.json({ ok: true });
    }

    if (claves.length === 1 && typeof (body as Record<string, unknown>)["borrador_respuesta"] === "string") {
      const texto = (body as Record<string, unknown>)["borrador_respuesta"] as string;
      const ok = await deps.resenas.editarBorrador(ctx, clientId, resenaId, texto);
      if (!ok) return c.json({ error: "Reseña no encontrada, o sin permiso." }, 404);
      return c.json({ ok: true });
    }

    /*
     * `{"publicar": true}` — COMANDO COMPUESTO (ADR-18): la fila se marca bajo RLS primero, y SOLO
     * SI cambió se emite el evento que despierta al orquestador. El evento no porta autoridad: lleva
     * únicamente el `id` de la reseña — el orquestador vuelve a preguntarle a la base qué publicar
     * (`resenaParaPublicar`, Task 2) en vez de confiar en nada más de acá.
     */
    if (claves.length === 1 && (body as Record<string, unknown>)["publicar"] === true) {
      const ok = await deps.resenas.solicitarPublicacion(ctx, clientId, resenaId);
      if (!ok) {
        return c.json(
          { error: "Reseña no encontrada, sin borrador, ya publicada, o sin permiso." },
          404,
        );
      }
      await deps.emisor.send({
        name: "resenas/respuesta.solicitada",
        data: ctx.userId ? { resenaId, solicitadoPor: ctx.userId } : { resenaId },
      });
      return c.json({ ok: true });
    }

    return c.json(
      { error: 'El body tiene que ser {"vista": true}, {"borrador_respuesta": string} o {"publicar": true}.' },
      400,
    );
  });

  /*
   * Los dos endpoints de miembros (pieza 2 — Usuarios, Etapa 2). `GET` reusa
   * `listarMiembros` (Etapa 1): la visibilidad por rol (staff ve el tenant, cliente ve solo su
   * fila) vive ENTERA en la vista `membresias_perfil` (0012) — este handler no filtra nada.
   *
   * `PATCH` es la pieza nueva. El ROL no se chequea acá con un `if` (ADR-15): la política
   * `membership_update` (0012) es la que de verdad decide si el caller puede escribir esta fila —
   * este handler solo hace DOS cosas que sí son legítimas en TypeScript:
   *   1) una ALLOWLIST de valores de entrada (qué `rol` es un valor aceptable), mismo criterio que
   *      `filtrarCamposCliente` — no es una decisión de autorización, es una restricción de forma;
   *   2) la comparación de IDENTIDAD ya autenticada (`:userId` de la ruta vs. `ctx.userId`, el `sub`
   *      del JWT) para la auto-degradación — también reforzada en la base (`membership_update`
   *      exige `user_id <> current_user_id()`), pero repetirla acá evita pagar un viaje a la base
   *      por algo que ya se puede descartar con lo que el middleware de auth dejó en `ctx`.
   */

  /** GET /members — los miembros visibles para quien pregunta (staff: todo el tenant; cliente: su fila). */
  app.get("/members", async (c) => {
    const ctx = c.get("ctx");
    const miembros = await deps.membresias.listarMiembros(ctx);
    return c.json({ miembros });
  });

  /** PATCH /members/:userId — cambia el rol (y, si corresponde, el client_id) de un miembro. */
  app.patch("/members/:userId", async (c) => {
    const ctx = c.get("ctx");
    const userId = c.req.param("userId");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ error: "Body inválido." }, 400);

    const rol = body["rol"];
    if (typeof rol !== "string" || !ROLES_ASIGNABLES.has(rol)) {
      return c.json({ error: "rol debe ser uno de: maestro, equipo, cliente." }, 400);
    }

    // Auto-degradación: identidad ya autenticada, no una decisión de rol (ver el comentario de
    // arriba). `ctx.userId` puede faltar en teoría (el tipo lo permite para el orquestador, que
    // nunca llega hasta acá) — con `ctx.userId` ausente esta comparación nunca es cierta, y la
    // política de la base (`user_id <> current_user_id()`) sigue como última palabra.
    if (ctx.userId && userId === ctx.userId) {
      return c.json({ error: "No podés cambiar tu propio rol." }, 403);
    }

    const clientId = typeof body["client_id"] === "string" ? body["client_id"] : null;
    const ok = await deps.membresias.cambiarRol(ctx, userId, { rol, clientId });
    return ok
      ? c.json({ ok: true })
      : c.json({ error: "Miembro no encontrado, o sin cambios válidos." }, 404);
  });

  /*
   * Los tres endpoints de IDEAS (pieza 3 del portal, Etapa 3).
   *
   * Una idea guarda la VOZ de un cliente real (la transcripción de un audio de WhatsApp) y lo que un
   * LLM dedujo de ella: es el dato más sensible del esquema después de las credenciales. Tres cosas
   * que este bloque decide, y ninguna es autorización:
   *
   *  1. **DOS recortes, y el del listado no se puede ampliar desde acá.** `GET /ideas` devuelve cinco
   *     campos y el recorte ya lo hace el `select` de `listarIdeas` (0013/Etapa 2): lo que no sale de
   *     Postgres no se puede olvidar de filtrar después. `GET /ideas/:id` sí trae transcripción y
   *     análisis — una idea a la vez, abierta a propósito por quien la está revisando. Mandar 200
   *     transcripciones al navegador para pintar un contador es filtrar el dato más sensible del
   *     sistema por comodidad.
   *  2. **La transición inválida es 400 con motivo, no 500.** `cambiarEstado` valida ANTES de escribir
   *     y devuelve el estado de origen. La GARANTÍA no es esa validación sino el trigger
   *     `ideas_transicion_estado` (0013), que lanza `23514` venga el update de donde venga; lo de acá
   *     es para poder explicar el rechazo en vez de escupir un error de Postgres.
   *  3. **Quién ve y quién escribe lo decide la base.** No hay ni un `if` de rol: `idea_select` y
   *     `idea_update` (0013) hacen que un rol `cliente` vea solo las ideas de su negocio y no alcance
   *     ninguna para escribir (ADR-20 — la agencia revisa). Ver el 404 del PATCH, más abajo.
   *
   * Y lo que NO hay: ningún POST. `app_user` no tiene grant de `insert` sobre `ideas` porque el
   * ingreso real (el flujo de audio de n8n) todavía no existe; cuando exista será un endpoint con
   * secreto propio, no el token de un usuario. Tampoco se emite ningún evento al aprobar: hoy aprobar
   * una idea no dispara nada, y no se inventa un evento que nadie consume (ADR-18 cuando lo haya).
   */

  /** GET /ideas — el listado RECORTADO. Filtros `estado`, `clientId` y `limite`, todos opcionales. */
  app.get("/ideas", async (c) => {
    const ctx = c.get("ctx");

    // Un estado con typo ('aprovada') se rechaza acá, no en la base: sin esto el cast
    // `$1::idea_estado` daría 22P02 → 400 igual, pero con un mensaje genérico que habla de `market`.
    // Lo que NO puede pasar es ignorarlo en silencio, que devolvería el listado entero como si no
    // hubiera filtro.
    const estado = filtroVacioEsAusente(c.req.query("estado"));
    if (estado !== undefined && !esEstadoIdea(estado)) {
      return c.json({ error: `estado debe ser uno de: ${ESTADOS_IDEA.join(", ")}.` }, 400);
    }
    const clientId = filtroVacioEsAusente(c.req.query("clientId"));
    const limite = filtroVacioEsAusente(c.req.query("limite"));

    const filtros: FiltrosIdeas = {
      ...(estado !== undefined ? { estado } : {}),
      ...(clientId !== undefined ? { clientId } : {}),
      // Un `limite` que no es número queda en NaN y `listarIdeas` cae a su default (200) en vez de
      // devolver cero filas, que parecería "no hay ideas". Ver `acotarLimite` en db/src/ideas.ts.
      ...(limite !== undefined ? { limite: Number.parseInt(limite, 10) } : {}),
    };

    const ideas = await deps.ideas.listarIdeas(ctx, filtros);
    return c.json({ ideas: ideas.map(serializarResumen) });
  });

  /** GET /ideas/:id — el detalle completo. 404 igual si no existe, es de otro tenant, o no es visible. */
  app.get("/ideas/:id", async (c) => {
    const ctx = c.get("ctx");
    const idea = await deps.ideas.obtenerIdea(ctx, c.req.param("id"));
    if (!idea) return c.json({ error: "Idea no encontrada." }, 404);
    return c.json({ idea: serializarDetalle(idea) });
  });

  /*
   * PATCH /ideas/:id — el contenido **o** el estado, nunca los dos a la vez.
   *
   * Se rechaza la mezcla, y es una decisión con motivo: son dos escrituras (`cambiarEstado` y
   * `editarIdea`) en dos transacciones distintas, así que aceptarlas juntas podría dejar la primera
   * aplicada y fallar la segunda — un PATCH que aplica la mitad y contesta error. Hacerlo atómico
   * exigiría un método nuevo en la capa de datos; mientras no exista, es mejor rechazar que mentir
   * sobre la atomicidad. La pantalla no lo necesita: aprobar es un botón y editar es un formulario.
   *
   * El **404** cubre cuatro casos que al llamador le dan igual, y eso es deliberado: la idea no
   * existe, es de otro tenant, es de otro negocio del mismo tenant, o quien pide es un rol `cliente`
   * (que la VE pero no la alcanza para escribir). Distinguirlos revelaría que la fila existe. Que sea
   * 404 y no 403 lo decide la BASE, no este handler: `app.puede_escribir()` está en el `using` de
   * `idea_update`, así que el `select … for update` de `cambiarEstado` devuelve 0 filas. Si el
   * producto quisiera un 403, hay que mover esa condición al `with check` de la política (0013) y
   * cambiar el test que hoy afirma "0 filas" — no es un detalle de la API.
   */
  app.patch("/ideas/:id", async (c) => {
    const ctx = c.get("ctx");
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return c.json({ error: "Body inválido." }, 400);
    }

    const validacion = validarCambiosIdea(body as Record<string, unknown>);
    if (!validacion.ok) return c.json({ error: validacion.error }, 400);
    const cambios = validacion.valor;

    const pideEstado = (body as Record<string, unknown>)["estado"] !== undefined;
    const pideContenido = Object.keys(cambios).length > 0;

    if (pideEstado && pideContenido) {
      return c.json({ error: "El cambio de estado va solo: mandá el contenido en otro PATCH." }, 400);
    }

    if (pideEstado) {
      const hacia = (body as Record<string, unknown>)["estado"];
      if (!esEstadoIdea(hacia)) {
        return c.json({ error: `estado debe ser uno de: ${ESTADOS_IDEA.join(", ")}.` }, 400);
      }
      const r = await deps.ideas.cambiarEstado(ctx, id, hacia);
      if (r.ok) return c.json({ ok: true, estado: r.estado });
      if (r.motivo === "transicion_invalida") {
        // 400 y con el estado de ORIGEN: la pantalla puede decir "esta idea está en `nueva`, primero
        // pasala a revisión" en vez de un error genérico.
        return c.json(
          { error: `Transición de estado inválida: ${r.desde} → ${hacia}.`, desde: r.desde, hacia },
          400,
        );
      }
      return c.json({ error: "Idea no encontrada." }, 404);
    }

    // Sin estado y sin ningún campo editable: 400 y no 404. Se puede decidir SIN mirar la base, así
    // que no revela nada sobre la existencia de la fila — al revés que el 404 de `PATCH /clients/:id`,
    // que tiene que ser ambiguo porque ahí las dos causas solo se distinguen consultando.
    if (!pideContenido) {
      return c.json({ error: "No hay ningún campo editable en el body." }, 400);
    }

    const ok = await deps.ideas.editarIdea(ctx, id, cambios);
    return ok ? c.json({ ok: true }) : c.json({ error: "Idea no encontrada." }, 404);
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
    //
    // El branch de "ninguna página aprobada" que vivía acá se retiró (revisión final del
    // sub-proyecto 2, Finding 5 menor): `registrarDecision` devuelve `null` en vez de lanzar esa
    // cadena desde que el guard de páginas aprobadas se movió al `where` del insert (Task 3) — nada
    // en el repo la tira ya (confirmado por grep). El único caso de esta lista con un `throw` real
    // sigue siendo el de abajo.
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
 * Un filtro presente pero VACÍO (`?clientId=`) es un filtro **ausente**, no un valor.
 *
 * Los tres parámetros de `GET /ideas` se comportaban distinto ante `""`, y está medido: `limite=`
 * caía al default, `estado=` daba 400 con su mensaje, y `clientId=` daba 400 con el mensaje genérico
 * del `onError` (que además menciona `market`, que no existe en ideas — el `where client_id = ''`
 * revienta con 22P02). Tres comportamientos para el mismo gesto.
 *
 * El gesto es concreto y va a llegar: un `<select>` de "todos los clientes" en Angular con
 * `[(ngModel)]` sobre `''` emite exactamente `clientId=`. Un formulario que no filtra manda la clave
 * vacía; interpretarla como "buscá el cliente cuyo id es la cadena vacía" es leerle otra intención.
 *
 * Se aplica a los TRES por uniformidad: la inconsistencia era el problema, así que arreglar solo uno
 * dejaría dos comportamientos en vez de tres. El `trim` cubre `?clientId=%20`, que es el mismo gesto
 * con un espacio de más y reventaría igual.
 */
function filtroVacioEsAusente(v: string | undefined): string | undefined {
  return v === undefined || v.trim() === "" ? undefined : v;
}

/**
 * Allowlist POSITIVA de roles asignables por `PATCH /members/:userId`, en el borde HTTP — mismo
 * criterio que `filtrarCamposCliente`. `servicio` es un `user_role` válido (0001) pero NO es un rol
 * que un humano pueda recibir por este endpoint: es la identidad del orquestador, atada a una
 * CREDENCIAL de Postgres (`app_service`), no a una fila de `memberships` (0003:
 * `membresia_no_es_servicio` ya lo rechazaría con 23514/400 aunque esto no existiera — esto además
 * lo hace explícito, sin gastar un viaje a la base para descartar un valor que nunca fue válido).
 */
const ROLES_ASIGNABLES = new Set(["maestro", "equipo", "cliente"]);

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

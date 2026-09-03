import { Inngest } from "inngest";
import type { ModoPublicacion } from "web-builder";

/**
 * La configuración del orquestador, **validada al arrancar**.
 *
 * Mismo patrón que `renderer/src/deps.ts` y `api/src/deps.ts`: un `leerConfig()` que lee el entorno,
 * falla cerrado y devuelve algo ya decidido. Un servicio a medio configurar no arranca.
 *
 * ## El motivo real de que este archivo exista
 *
 * El orquestador caía a **PGlite en memoria** cuando no encontraba `DATABASE_URL_ORQUESTADOR`. En
 * desarrollo eso es una virtud del proyecto —el sistema entero corre sin una sola credencial— y no se
 * toca. En producción es un desastre silencioso: una variable mal escrita en Railway arranca un
 * proceso que se declara sano, acepta el evento, **paga el research de verdad** y lo escribe en una
 * base que se evapora al reiniciar. Sin un solo error.
 *
 * Es el mismo modo de fallo que mató el despliegue del 2026-08-07: una afirmación sobre cómo se
 * comportaba algo en el único camino que ningún test recorre. Acá el camino sí lo recorre un test
 * (`config.test.ts`), y lo hace por el lado que importa: **en producción, ninguna combinación de
 * variables puede producir una base efímera**.
 */

export type Persistencia =
  | {
      readonly tipo: "postgres";
      /** Login `amg_orquestador` → rol `app_service` (ADR-17). */
      readonly urlOrquestador: string;
      /** Login `amg_cache`: solo caches y registro de tareas, sin acceso a tablas de tenant. */
      readonly urlCache: string;
    }
  | { readonly tipo: "pglite-en-memoria" };

/**
 * Qué se está corriendo de verdad: `mock` no le paga a nadie, `live` sí.
 *
 * **No enciende nada** — quien decide el proveedor es `DATAFORSEO_MODE`, dentro de `kr-service`. Esto
 * es la DECLARACIÓN del operador, y `leerConfig` la contrasta contra la configuración real. Existe
 * porque lo declarado y lo configurado podían discrepar en silencio: ver {@link verificarCoherencia}.
 */
export type ModoPipeline = "mock" | "live";

export interface ConfigOrquestador {
  /** Puerto donde se expone `/api/inngest` y `/_health`. Railway inyecta `PORT`. */
  readonly puerto: number;
  /**
   * ¿El SDK de Inngest cree que corre contra Inngest **Cloud**? Lo decide el SDK, no nosotros — ver
   * {@link esModoProduccion}. De acá salen todas las exigencias duras.
   */
  readonly esProduccion: boolean;
  readonly persistencia: Persistencia;
  /**
   * La clave de firma **ya validada**, lista para viajar a `serve({ signingKey })`.
   *
   * Que esté acá no es cosmético: es la diferencia entre validar y proteger. Ver
   * `opcionesDeServe` en `app.ts`.
   */
  readonly inngestSigningKey?: string;
  /** Lo declarado por el operador (cloud) o lo derivado de `DATAFORSEO_MODE` (dev). */
  readonly pipeline: ModoPipeline;
  /**
   * En qué modo lee reseñas de Google. **A diferencia de `pipeline`, esta variable NO es obligatoria
   * en producción y SÍ tiene default** (`mock`): Bloque F fase 1 no tiene acceso real a la Business
   * Profile API todavía — `live` ni siquiera está implementado (lanza un error explícito, ver
   * `google/provider.ts`). Exigirle la variable a un despliegue que no tiene un `live` real que
   * ofrecer sería pedirle al desplegador un valor que no puede usar. Ver {@link leerModoResenasGoogle}.
   */
  readonly resenasGoogle: ModoResenasGoogle;
  /**
   * En qué modo se genera el borrador de respuesta con IA. **Opcional, con default derivado**: mismo
   * criterio que `PROSE_MODE` en `web-builder/src/config.ts:40` — `openai` si hay `OPENAI_API_KEY`,
   * `mock` si no. Un despliegue en modo mock nunca produce un research falso (a diferencia de
   * `PIPELINE_MODO`), pero SÍ podía producir un borrador de relleno indistinguible de uno de OpenAI
   * para quien lo edita en el portal — por eso `MockBorradorProvider` lleva un prefijo inconfundible
   * (ver `borrador/mock-provider.ts`) en vez de replicar la máquina de `verificarCoherencia` acá.
   */
  readonly borradorResenas: ModoBorrador;
  /**
   * En qué modo se pollea `getUpdates` y se manda `sendMessage` a la API de Telegram (Bloque F, fase
   * 2, alertas por reseñas 1-3★). Mismo criterio EXACTO que `resenasGoogle`: opcional, con default
   * fijo `mock` (no derivado de si `TELEGRAM_BOT_TOKEN` está puesta, a diferencia de
   * `borradorResenas`) porque enviar un mensaje de Telegram no cuesta dinero -- no hay una dirección
   * cara que proteger con un default derivado. `live` SÍ está implementado (a diferencia de
   * `resenasGoogle`): si falta el token, `getTelegramProvider` lanza al construir el provider, no acá.
   */
  readonly telegram: ModoTelegram;
  /**
   * En qué modo se genera el post de blog con IA (sub-proyecto 3, publicar posts en blog externo).
   * **Opcional, con default derivado**: mismo criterio EXACTO que `borradorResenas` — `openai` si hay
   * `OPENAI_API_KEY`, `mock` si no. Un despliegue en modo mock nunca produce un research falso (a
   * diferencia de `PIPELINE_MODO`), pero SÍ podía producir un post de relleno indistinguible de uno
   * de OpenAI para quien lo edita en el portal — por eso `MockPostProvider` lleva un prefijo
   * inconfundible (ver `post-blog/mock-provider.ts`) en vez de replicar la máquina de
   * `verificarCoherencia` acá.
   */
  readonly postBlog: ModoPostBlog;
}

const PUERTO_DEFECTO = 3100;
const MODOS_PIPELINE: readonly string[] = ["mock", "live"];

/** Igual forma que `ModoPipeline`, pero es un módulo distinto (Bloque F): ver `google/provider.ts`. */
export type ModoResenasGoogle = "mock" | "live";
const MODOS_RESENAS_GOOGLE: readonly string[] = ["mock", "live"];

/**
 * Igual forma que `ModoResenasGoogle`, pero un módulo distinto (Bloque F, fase 2): el borrador de
 * respuesta con IA. `openai` es la única implementación real (a diferencia de `resenasGoogle`, cuyo
 * `live` todavía no existe) — ver `borrador/provider.ts`.
 */
export type ModoBorrador = "mock" | "openai";
const MODOS_BORRADOR: readonly string[] = ["mock", "openai"];

/**
 * Igual forma que `ModoResenasGoogle`: `live` SÍ tiene implementación real (a diferencia de
 * `resenasGoogle`) — ver `telegram/provider.ts`.
 */
export type ModoTelegram = "mock" | "live";
const MODOS_TELEGRAM: readonly string[] = ["mock", "live"];

/**
 * Igual forma que `ModoBorrador`: `openai` es la única implementación real, con default derivado de
 * `OPENAI_API_KEY` — ver `post-blog/provider.ts`.
 */
export type ModoPostBlog = "mock" | "openai";
const MODOS_POST_BLOG: readonly string[] = ["mock", "openai"];

/**
 * ¿Estamos en producción? **Se le pregunta al SDK; no se reimplementa su heurística.**
 *
 * Medido en `inngest@3.54.2`, no deducido de los tipos ni del README:
 *
 *  1. El SDK infiere "cloud" desde una lista de señales (`prodChecks`, en `inngest/helpers/env.js`):
 *     `NODE_ENV`/`ENVIRONMENT`/`CONTEXT`/`VERCEL_ENV` que empiecen con `prod`, y **`RAILWAY_GIT_BRANCH`
 *     con cualquier valor**, entre otras. `INNGEST_DEV` la fija explícitamente y gana sobre todas.
 *  2. Sus funciones `getMode`/`Mode` **no son importables**: `inngest/helpers/env` no está en el mapa
 *     `exports` del paquete (`import("inngest/helpers/env")` → `ERR_PACKAGE_PATH_NOT_EXPORTED`), y la
 *     entrada principal no las reexporta.
 *  3. Pero el **cliente** sí guarda el veredicto ya calculado, y `cliente["mode"]` es exactamente el
 *     escape que el propio SDK usa por dentro (`client?.["mode"].isExplicit`, en `getMode`). En
 *     TypeScript `mode` es privado, así que se lee por índice — no por pereza: es la única vía.
 *
 * Por qué importa no duplicar: Railway **no define `NODE_ENV`**, define `RAILWAY_GIT_BRANCH`. Un
 * `NODE_ENV.startsWith("prod")` escrito a mano diría "desarrollo" mientras el SDK habla con Inngest
 * Cloud — o sea, el proceso procesaría runs reales contra PGlite en memoria. Las dos mitades tienen
 * que salir de la misma fuente, y los tests de `config.test.ts` lo atan caso por caso.
 *
 * La sonda es un cliente **desechable**, construido acá y ahora: el SDK congela el modo al construir,
 * y `leerConfig()` corre al arrancar. Tiene que construirse con las **mismas opciones** que el cliente
 * real de `functions.ts` o los veredictos se separan; hay un test que compara los dos.
 */
export function esModoProduccion(): boolean {
  const sonda = new Inngest({ id: "amg-os-sonda-modo", schemas: undefined as never });
  const modo = sonda["mode"] as unknown as { isCloud?: unknown } | undefined;

  /*
   * Si el SDK cambia de forma, **no se asume desarrollo**. La asimetría manda: equivocarse hacia
   * "producción" aborta el arranque (ruidoso y gratis); equivocarse hacia "desarrollo" es justamente
   * la base efímera silenciosa que este archivo existe para impedir. Ante la duda, se detiene.
   */
  if (typeof modo?.isCloud !== "boolean") {
    throw new Error(
      "No se pudo leer el modo del SDK de Inngest (`cliente['mode'].isCloud`). Es una API privada " +
        "que usamos a propósito para no duplicar su heurística; si el SDK cambió, hay que revisar " +
        "`esModoProduccion()` en orchestrator/src/config.ts (y su test).",
    );
  }
  return modo.isCloud;
}

/**
 * Lee el entorno y **falla cerrado**. Se llama una vez, al arrancar — no en la primera petición.
 *
 * `obtenerModoPublicacion` viaja como parámetro y NO como `import` de `web-builder`: ese paquete hace
 * `import "dotenv/config"` al cargarse, y `config.ts` lo importan los tests — un `web-builder/.env`
 * en la máquina de quien corre `config.test.ts` le metería variables reales al suite (el mismo motivo
 * por el que `server.ts` carga el `.env` del orquestador ahí y no acá). `server.ts`, el único punto
 * real que arranca en producción, ya importa `modoPublicacion` de `web-builder` (para `/_health`) y
 * la pasa acá — ver {@link verificarPublicacion}.
 */
export function leerConfig(
  opciones: { obtenerModoPublicacion?: () => ModoPublicacion } = {},
): ConfigOrquestador {
  const esProduccion = esModoProduccion();
  const puerto = leerPuerto();
  const resenasGoogle = leerModoResenasGoogle();
  const borradorResenas = leerModoBorrador();
  const telegram = leerModoTelegram();
  const postBlog = leerModoPostBlog();

  const urlOrquestador = process.env["DATABASE_URL_ORQUESTADOR"]?.trim();
  const urlCache = process.env["DATABASE_URL_CACHE"]?.trim();
  const signingKey = process.env["INNGEST_SIGNING_KEY"]?.trim();

  if (esProduccion) {
    /*
     * En producción el fallback `DATABASE_URL` NO cuenta, y es deliberado.
     *
     * En dev es una comodidad sobre una base descartable. En Railway, `DATABASE_URL` es el nombre que
     * el plugin de Postgres inyecta solo, y apunta al **dueño** de la base — no a `amg_orquestador`.
     * Aceptarlo dejaría al orquestador corriendo con un login capaz de asumir cualquier rol: el
     * `set local role app_service` funcionaría igual, nada fallaría, y "un proceso, un login, un rol"
     * (ADR-17) pasaría a ser una coincidencia de nombres. No hay error que lo delate; solo esta línea.
     */
    const pipelineCrudo = process.env["PIPELINE_MODO"]?.trim();

    const faltan = [
      !urlOrquestador &&
        "DATABASE_URL_ORQUESTADOR (login amg_orquestador → rol app_service; `DATABASE_URL` NO sirve acá)",
      !urlCache &&
        "DATABASE_URL_CACHE (login amg_cache: solo caches y registro de tareas, sin tablas de tenant)",
      !signingKey &&
        "INNGEST_SIGNING_KEY (con ella el SDK verifica que quien invoca las funciones es Inngest Cloud)",
      /*
       * `PIPELINE_MODO` es obligatoria y **no tiene default**, a propósito.
       *
       * Sin ella, un despliegue al que le falta `DATAFORSEO_MODE=live` corre entero sin un solo
       * error: `getProvider()` devuelve `MockProvider`, las keywords y los volúmenes son
       * **inventados**, se escriben en la base REAL del cliente y el run llega a
       * `pending_approval` con su informe. Mirando el portal no hay forma de distinguirlo de un
       * research legítimo. Un default —cualquiera de los dos— volvería a convertir esa decisión
       * en un olvido; por eso hay que escribirla.
       */
      !pipelineCrudo &&
        "PIPELINE_MODO (`mock` o `live`; sin default: declará qué está corriendo este despliegue)",
    ].filter((x): x is string => Boolean(x));

    if (faltan.length > 0) {
      throw new Error(
        `Faltan variables de entorno del orquestador (modo producción):\n  - ${faltan.join("\n  - ")}\n` +
          "Sin ellas el proceso arrancaría contra una base EFÍMERA y pagaría el research igual. " +
          "Ver docs/proyecto/12-credenciales.md.",
      );
    }

    const pipeline = validarModoPipeline(pipelineCrudo as string);
    verificarCoherencia(pipeline);
    verificarPublicacion(pipeline, opciones.obtenerModoPublicacion);

    return {
      puerto,
      esProduccion,
      persistencia: {
        tipo: "postgres",
        urlOrquestador: urlOrquestador as string,
        urlCache: urlCache as string,
      },
      inngestSigningKey: signingKey as string,
      pipeline,
      resenasGoogle,
      borradorResenas,
      telegram,
      postBlog,
    };
  }

  /*
   * Fuera de producción, todo sigue como antes: sin credenciales, PGlite y providers mock.
   *
   * `PIPELINE_MODO` no se exige acá —si está, se valida— y cuando falta se DERIVA de lo que de
   * verdad va a pasar. Poner `"mock"` fijo sería más simple y mentiría: un dev que corre con
   * `DATAFORSEO_MODE=live` está gastando, y `/_health` tiene que decirlo.
   *
   * Y por eso la coherencia se comprueba **acá también**, no solo en producción. Cuando el valor se
   * deriva, el contraste es trivialmente cierto —sale de la misma función— y no le cuesta nada al
   * loop sin credenciales. Cuando alguien la escribe a mano es donde hace falta: un
   * `PIPELINE_MODO=mock` con `DATAFORSEO_MODE=live` en local arrancaba callado, con `/_health`
   * diciendo `"mock"` y **el aviso `⚠️ GASTA DINERO` del log silenciado por la propia declaración
   * falsa**, a ~$0.31 el research. Restringir la comprobación a producción dejaba la dirección cara
   * sin guard justo donde se prueban las cosas.
   */
  const pipeline = process.env["PIPELINE_MODO"]?.trim()
    ? validarModoPipeline(process.env["PIPELINE_MODO"].trim())
    : modoDataForSeo();
  verificarCoherencia(pipeline);
  verificarPublicacion(pipeline, opciones.obtenerModoPublicacion);

  const comun = {
    puerto,
    esProduccion,
    pipeline,
    resenasGoogle,
    borradorResenas,
    telegram,
    postBlog,
    ...(signingKey ? { inngestSigningKey: signingKey } : {}),
  };

  const urlDev = urlOrquestador ?? process.env["DATABASE_URL"]?.trim();
  if (!urlDev) return { ...comun, persistencia: { tipo: "pglite-en-memoria" } };

  /*
   * Con Postgres real, `DATABASE_URL_CACHE` es OBLIGATORIA y NO hereda de la del orquestador. El
   * fallback que tenía era imposible de cumplir: `amg_orquestador`, por diseño, no tiene permiso
   * sobre las caches ni sobre el registro de tareas (`0003_credenciales.sql`). Fallaba cerrado, sí,
   * pero **en el primer research**, con una configuración que parecía válida (5ª review, #9).
   */
  if (!urlCache) {
    throw new Error(
      "Falta DATABASE_URL_CACHE. Con Postgres real es obligatoria y NO hereda de " +
        "DATABASE_URL_ORQUESTADOR: el login del orquestador no puede tocar las caches ni el " +
        "registro de tareas (un proceso, un login, un rol — ADR-17). " +
        "Ver docs/proyecto/12-credenciales.md.",
    );
  }

  return { ...comun, persistencia: { tipo: "postgres", urlOrquestador: urlDev, urlCache } };
}

/** El modo que DataForSEO va a usar de verdad. Ver el comentario de {@link verificarCoherencia}. */
function modoDataForSeo(): ModoPipeline {
  return process.env["DATAFORSEO_MODE"]?.trim() === "live" ? "live" : "mock";
}

function validarModoPipeline(crudo: string): ModoPipeline {
  if (!MODOS_PIPELINE.includes(crudo)) {
    throw new Error(
      `PIPELINE_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`live\`. ` +
        "`mock` es un despliegue legítimo y explícito: el circuito entero corre gratis.",
    );
  }
  return crudo as ModoPipeline;
}

function validarModoResenasGoogle(crudo: string): ModoResenasGoogle {
  if (!MODOS_RESENAS_GOOGLE.includes(crudo)) {
    throw new Error(
      `GOOGLE_REVIEWS_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`live\`.`,
    );
  }
  return crudo as ModoResenasGoogle;
}

/**
 * `GOOGLE_REVIEWS_MODO`, con default — a propósito distinto de `PIPELINE_MODO` (sin default, exigida
 * en producción). Ese exige la variable porque `live` gasta dinero real y un olvido paga sin que
 * nadie lo haya decidido; acá no hay nada real que `live` pueda hacer todavía (fase 1 del Bloque F es
 * mock-first), así que exigirla le pediría al desplegador un valor que no puede usar. Se valida
 * también fuera de producción: un typo silencioso no debe pasar inadvertido en dev.
 */
function leerModoResenasGoogle(): ModoResenasGoogle {
  const crudo = process.env["GOOGLE_REVIEWS_MODO"]?.trim();
  return crudo ? validarModoResenasGoogle(crudo) : "mock";
}

function validarModoBorrador(crudo: string): ModoBorrador {
  if (!MODOS_BORRADOR.includes(crudo)) {
    throw new Error(
      `BORRADOR_RESENAS_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`openai\`.`,
    );
  }
  return crudo as ModoBorrador;
}

/**
 * `BORRADOR_RESENAS_MODO`, con default DERIVADO de si hay `OPENAI_API_KEY` — a diferencia de
 * `GOOGLE_REVIEWS_MODO` (default fijo `mock`, porque `live` ni siquiera está implementado). Acá
 * `openai` SÍ está implementado, así que cargar la key sin declarar la variable ya empieza a gastar
 * — mismo comportamiento, a propósito, que `PROSE_MODE` en `web-builder`.
 */
function leerModoBorrador(): ModoBorrador {
  const crudo = process.env["BORRADOR_RESENAS_MODO"]?.trim();
  if (crudo) return validarModoBorrador(crudo);
  return process.env["OPENAI_API_KEY"]?.trim() ? "openai" : "mock";
}

function validarModoPostBlog(crudo: string): ModoPostBlog {
  if (!MODOS_POST_BLOG.includes(crudo)) {
    throw new Error(
      `POST_BLOG_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`openai\`.`,
    );
  }
  return crudo as ModoPostBlog;
}

/**
 * `POST_BLOG_MODO`, con default DERIVADO de si hay `OPENAI_API_KEY` — mismo molde EXACTO que
 * `leerModoBorrador`: `openai` SÍ está implementado, así que cargar la key sin declarar la variable
 * ya empieza a gastar.
 */
function leerModoPostBlog(): ModoPostBlog {
  const crudo = process.env["POST_BLOG_MODO"]?.trim();
  if (crudo) return validarModoPostBlog(crudo);
  return process.env["OPENAI_API_KEY"]?.trim() ? "openai" : "mock";
}

function validarModoTelegram(crudo: string): ModoTelegram {
  if (!MODOS_TELEGRAM.includes(crudo)) {
    throw new Error(`TELEGRAM_MODO inválido: "${crudo}". Los únicos valores son \`mock\` y \`live\`.`);
  }
  return crudo as ModoTelegram;
}

/**
 * `TELEGRAM_MODO`, con default FIJO `mock` — a propósito distinto de `BORRADOR_RESENAS_MODO` (default
 * derivado de si hay `OPENAI_API_KEY`): ahí un default derivado protege contra gastar sin haberlo
 * declarado, pero enviar un mensaje de Telegram no cuesta nada, así que no hay gasto silencioso que
 * evitar con esa derivación. Mismo criterio de FORMA que `leerModoResenasGoogle` (default fijo, se
 * valida también fuera de producción). Si falta `TELEGRAM_BOT_TOKEN` con `live` declarado, quien
 * revienta es `getTelegramProvider` al construir el provider -- no esta función.
 */
function leerModoTelegram(): ModoTelegram {
  const crudo = process.env["TELEGRAM_MODO"]?.trim();
  return crudo ? validarModoTelegram(crudo) : "mock";
}

/**
 * Lo declarado contra lo configurado. Discrepar **aborta**, en las dos direcciones y en los dos
 * entornos (producción y dev — ver la rama de no producción de `leerConfig`).
 *
 * Por qué el contraste es contra `DATAFORSEO_MODE` y no contra el LLM o Storyblok: de las tres
 * dependencias que gastan, DataForSEO es la única cuya versión mock es **invisible en el producto**.
 * La prosa mock se lee como mock en el portal. Storyblok es más sutil de lo que este comentario decía
 * hasta el 2026-08-18: el publisher en **dry-run** reporta `published: false` a propósito —la base no
 * miente—, pero el DEFAULT sin `WEB_PUBLISH_MODE` no es dry-run, es **mock**, y ESE sí miente
 * (`MockPublisher` reporta `published: true` para páginas que nunca salieron del contenedor). Medido:
 * la omisión sí mordía. Por eso existe {@link verificarPublicacion}, la misma comprobación que esta
 * función, del lado de la publicación. Un volumen de búsqueda inventado, en cambio, es un número
 * plausible en una columna que nadie puede auditar a ojo, y es además el 81% del costo
 * (`pipeline-gasto`) — motivos suficientes para que DataForSEO tenga su propia función.
 *
 * Las dos direcciones fallan, y no por simetría estética:
 *
 *  · `live` declarado + DataForSEO en mock → un research **falso** presentado como real. Es el motivo
 *    por el que existe esta variable.
 *  · `mock` declarado + DataForSEO en live → **se gasta plata en un despliegue que alguien anotó como
 *    gratuito** (~$0.31 por research). Es el error caro e irreversible de `pipeline-gasto`.
 *
 * `PIPELINE_MODO` **no enciende ni apaga nada**: `DATAFORSEO_MODE` lo lee `kr-service` de su propio
 * entorno, y su config se congela al importarse. Esto es una compuerta de coherencia, no un
 * interruptor — y decirlo importa, porque una variable que parece un interruptor y no lo es sería
 * exactamente la clase de promesa falsa que esta etapa vino a sacar.
 */
function verificarCoherencia(declarado: ModoPipeline): void {
  const real = modoDataForSeo();
  if (declarado === real) return;

  const crudo = process.env["DATAFORSEO_MODE"]?.trim();
  throw new Error(
    `PIPELINE_MODO=${declarado} contradice DATAFORSEO_MODE=${crudo ? `"${crudo}"` : "(sin definir)"}.\n` +
      (declarado === "live"
        ? "  Declaraste un despliegue REAL y DataForSEO daría datos INVENTADOS: las keywords y los\n" +
          "  volúmenes se escribirían en la base del cliente sin que nada los distinga de un research\n" +
          "  legítimo. Poné DATAFORSEO_MODE=live (exactamente `live`), o declará PIPELINE_MODO=mock."
        : "  Declaraste un despliegue GRATUITO y DataForSEO cobraría de verdad (~$0.31 por research).\n" +
          "  Quitá DATAFORSEO_MODE=live, o declará PIPELINE_MODO=live si eso es lo que querés."),
  );
}

/**
 * La otra mitad de `verificarCoherencia`: `PIPELINE_MODO=live` promete un research real, pero un
 * research real que la publicación nunca deja salir de verdad es la misma mentira, solo que del otro
 * lado del pipeline.
 *
 * Sin `WEB_PUBLISH_MODE`, `config.publishMode` de `web-builder` cae a `mock`
 * (`web-builder/src/config.ts:24`) y `MockPublisher` reporta `published: true`
 * (`web-builder/src/publish/mock-publisher.ts:31`) para páginas que nunca salieron del contenedor: la
 * base anotaría `published_at` sobre contenido que sigue en un `out/` efímero, indistinguible de una
 * publicación real mirando el portal. Es exactamente el fallo que `PIPELINE_MODO` existe para cerrar
 * —un mock presentado como real— por la puerta que había quedado sin cerrar.
 *
 * `dry-run` NO cae acá: `StoryblokDryRunPublisher` reporta `published: false` a propósito — es un
 * research real que decide, con honestidad, no publicar (sin token de Storyblok, o el cliente sin
 * space todavía). Abortar por eso rompería el despliegue legítimo de "live, pero sin credenciales de
 * Storyblok configuradas" — la confusión que un comentario viejo de `verificarCoherencia` cometía
 * (dry-run vs. el DEFAULT sin `WEB_PUBLISH_MODE`, que es mock y sí miente).
 *
 * Solo se comprueba cuando `pipeline === "live"`: con `mock` no hay research real que publicar, así
 * que la pregunta no aplica — mismo corte que ya usa `verificarCoherencia`.
 *
 * Corre en los DOS entornos, igual que `verificarCoherencia`: restringirla a producción dejaría la
 * dirección cara sin guardia justo donde se prueban las cosas (mismo razonamiento, ver su docblock).
 */
function verificarPublicacion(
  pipeline: ModoPipeline,
  obtenerModoPublicacion: (() => ModoPublicacion) | undefined,
): void {
  if (pipeline !== "live") return;

  if (!obtenerModoPublicacion) {
    throw new Error(
      "BUG interno: con PIPELINE_MODO=live, leerConfig() necesita que quien la llama le pase " +
        "`obtenerModoPublicacion` (server.ts ya lo hace, con `modoPublicacion` de web-builder). Sin " +
        "esto, la comprobación de que la publicación esté armada de verdad no puede correr — y eso " +
        "sería exactamente el mismo olvido silencioso que PIPELINE_MODO existe para impedir.",
    );
  }

  const real = obtenerModoPublicacion();
  if (real === "live" || real === "dry-run") return;

  throw new Error(
    `PIPELINE_MODO=live, pero la publicación de web-builder está en "${real}": no está armada para\n` +
      "  publicar de verdad. Sin WEB_PUBLISH_MODE, MockPublisher reporta `published: true` para\n" +
      "  páginas que nunca salieron del contenedor — la base anotaría published_at sobre contenido\n" +
      "  que sigue en un out/ efímero, indistinguible de una publicación real mirando el portal.\n" +
      "  Definí WEB_PUBLISH_MODE=storyblok (con STORYBLOK_MANAGEMENT_TOKEN, o STORYBLOK_DRY_RUN=1\n" +
      "  para un live honesto que no publica todavía), o declará PIPELINE_MODO=mock.",
  );
}

/**
 * `PORT`, validado. `Number("ochomil")` es `NaN`, y `server.listen(NaN)` **no falla**: Node elige un
 * puerto libre al azar. El servicio queda arriba en un puerto que nadie sondea y el health check no
 * responde nunca — el mismo fallo silencioso de la base efímera, en chico.
 */
function leerPuerto(): number {
  const crudo = process.env["PORT"]?.trim();
  if (!crudo) return PUERTO_DEFECTO;
  const puerto = Number(crudo);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    throw new Error(`PORT inválido: "${crudo}". Tiene que ser un entero entre 1 y 65535.`);
  }
  return puerto;
}

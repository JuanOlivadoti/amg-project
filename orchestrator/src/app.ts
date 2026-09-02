import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { serve } from "inngest/node";
import type { ModoProsa, ModoPublicacion } from "web-builder";
import type { ConfigOrquestador, ModoBorrador, ModoPipeline, ModoPostBlog } from "./config.js";
import type { Salud } from "./salud.js";

/**
 * El servidor HTTP del orquestador. Igual que `renderer/src/app.ts` y `api/src/app.ts`, es una
 * FÁBRICA: no escucha ni lee el entorno, así que un test puede levantarlo en un puerto efímero.
 * Quien lo arranca es `server.ts`.
 */

/** Las opciones que recibe `serve()`, sin importar rutas internas del SDK. */
type OpcionesServe = Parameters<typeof serve>[0];

/**
 * Arma las opciones de `serve()` **a partir de la config ya validada**.
 *
 * ## Por qué la `signingKey` viaja por acá y no se deja al entorno
 *
 * `leerConfig()` valida `INNGEST_SIGNING_KEY` y la **trimea**. Si `serve()` no la recibiera, el SDK
 * la releería por su cuenta (`InngestCommHandler.js:1454`) **cruda**: lo comprobado y lo usado serían
 * dos lecturas distintas del mismo nombre, y *una restricción validada sobre otra cosa no es una
 * restricción* — el mismo argumento que `api/src/deps.ts` aplica a `eventKey`.
 *
 * No es teórico. Medido con `inngest@3.54.2`, con `INNGEST_SIGNING_KEY="signkey-prod-abc123def456   "`
 * (los espacios que deja copiar del dashboard) y una petición firmada con la clave limpia:
 *
 *   · sin pasar `signingKey` → **HTTP 401, "Invalid signature"**. Toda invocación de Inngest Cloud
 *     rebota, con un proceso que arrancó bien y responde `/_health` 200 `{"modo":"cloud"}`.
 *   · pasándola → la firma se acepta.
 *
 * El parámetro gana porque `InngestCommHandler.js:214` hace `this.signingKey = options.signingKey`
 * y el entorno solo entra en `if (!this.signingKey && …)`.
 *
 * ⚠️ Alcance real, para no prometer de más: esto arregla la verificación de firmas **entrantes**, que
 * es la superficie de seguridad. El cliente lee además `INNGEST_SIGNING_KEY` cruda en su constructor
 * para sus llamadas **salientes** (`Inngest.js:154`), y `setSigningKey` no la pisa (es no-op si ya hay
 * una: `api/api.js:38`). O sea: la variable **igual tiene que estar bien escrita** en el entorno; lo
 * que esto elimina es que una diferencia entre lo validado y lo usado pase inadvertida.
 */
export function opcionesDeServe(
  config: Pick<ConfigOrquestador, "inngestSigningKey">,
  client: OpcionesServe["client"],
  functions: OpcionesServe["functions"],
): OpcionesServe {
  return {
    client,
    functions,
    ...(config.inngestSigningKey ? { signingKey: config.inngestSigningKey } : {}),
  };
}

export interface OpcionesServidor {
  /** El handler de `inngest/node`. Lo único que atiende `/api/inngest`. */
  manejadorInngest: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  /** Cuántas funciones quedaron registradas. Presión interna: cero funciones = proceso inútil. */
  funciones: number;
  /** El veredicto del SDK (ver `config.ts`). Se reporta para poder verlo desde afuera. */
  modo: "cloud" | "dev";
  /** Lo declarado en `PIPELINE_MODO`. Se reporta para poder auditarlo sin entrar al panel. */
  pipeline: ModoPipeline;
  /**
   * En qué modo publica. **No sale de una variable sino de tres** (`WEB_PUBLISH_MODE`,
   * `STORYBLOK_DRY_RUN` y el token), así que acá el panel de Railway no alcanza ni leyéndolo entero.
   *
   * Llega como valor, igual que `pipeline` y `modo`, para que esta fábrica siga sin leer el entorno.
   * Quien lo deriva es `modoPublicacion()` de `web-builder` — **la misma decisión que construye el
   * publisher**, no una relectura paralela de `process.env`: si fueran dos, `/_health` podría decir
   * `dry-run` mientras se publica de verdad, que es la forma exacta en que la clave de firma de
   * Inngest ya nos mordió (lo validado y lo usado eran dos lecturas del mismo nombre).
   */
  publicacion: ModoPublicacion;
  /**
   * Con qué se rellena la prosa al publicar. **Es el eje que gasta**, y el que más fácil se cree
   * cubierto: `pipeline: "mock"` habla de DataForSEO —el 81% del costo— y no dice nada de esto.
   * `PIPELINE_MODO` tampoco lo gobierna. Con `OPENAI_API_KEY` puesta y `PROSE_MODE` sin declarar, el
   * default es `openai`: publicar factura sin que nadie lo haya decidido.
   *
   * Sale de `modoProsa()`, la misma condición que elige el generador. Ver `publicacion`.
   */
  prosa: ModoProsa;
  /**
   * Con qué se genera el borrador de respuesta con IA (Bloque F, fase 2). Es el segundo eje que
   * puede gastar sin que `pipeline`/`publicacion` lo digan — mismo motivo que `prosa` existe acá.
   */
  borrador: ModoBorrador;
  /**
   * Con qué se genera el post de blog con IA (sub-proyecto 3). Mismo motivo que `borrador`: es un
   * tercer eje que puede facturar sin que `pipeline`/`publicacion`/`prosa` lo digan.
   */
  postBlog: ModoPostBlog;
  /**
   * Comprueba las dependencias sin las que este proceso no sirve (hoy: Postgres). Ver `salud.ts`
   * para las tres decisiones —200 aunque esté degradado, el log de la transición, la cache—.
   *
   * Es **opcional** para no romper a quien levante el servidor sin base (un test del enrutado, un
   * dev-server). Sin ella, `/_health` reporta lo mismo que antes: que el proceso está vivo.
   */
  sonda?: () => Promise<Salud>;
}

const ARRANQUE = Date.now();

export function crearServidor(opciones: OpcionesServidor): Server {
  const { manejadorInngest, funciones, modo, pipeline, publicacion, prosa, borrador, postBlog, sonda } =
    opciones;

  return createServer((req, res) => {
    /*
     * Salud del proceso, y **sí toca la base** desde el 2026-08-07.
     *
     * Este comentario decía lo contrario, con el argumento del renderizador: que un health check no
     * dependa de terceros, porque si Postgres está de mantenimiento Railway mataría un proceso que
     * solo tenía que esperar. El argumento sigue siendo bueno **para el renderizador** y es falso
     * acá: para el orquestador la base no es un tercero, es todo lo que hace. Un orquestador que no
     * la alcanza no puede leer el run, ni escribir keywords, ni cerrar nada.
     *
     * Lo que se conserva de aquel razonamiento es lo que valía: **el código sigue siendo 200**, para
     * que Railway no reinicie en bucle un proceso que solo necesita que la base vuelva. Lo que
     * cambia es que ahora el cuerpo lo dice, y el log lo grita. Ver `salud.ts`.
     *
     * El chequeo va PRIMERO, antes de la delegación: si cayera después, un `/api/inngest*` mal
     * enrutado se lo comería y la salud del proceso dependería del SDK.
     */
    if (req.url === "/_health") {
      void (async () => {
        // Si la propia sonda revienta (no debería: atrapa adentro), se reporta degradado en vez de
        // tumbar el request. Un health check que devuelve 500 por su propio bug es lo peor de los
        // dos mundos: Railway reinicia y el motivo no aparece por ningún lado.
        const salud = sonda ? await sonda().catch(() => ({ degradado: ["sonda"] })) : {};
        const cuerpo = JSON.stringify({
          ok: true,
          funciones,
          modo,
          // Que `PIPELINE_MODO` se pueda leer desde afuera es la mitad de su valor: una declaración
          // que solo vive en el panel de variables no se puede auditar mirando el servicio.
          pipeline,
          // Y lo mismo para publicar, donde además el panel no alcanza: son tres entradas. Ver
          // `OpcionesServidor.publicacion`.
          publicacion,
          // El tercer modo, y el único de los tres que puede facturar en el paso de publicación.
          prosa,
          borrador,
          postBlog,
          uptimeSegundos: Math.round((Date.now() - ARRANQUE) / 1000),
          // Ausente cuando todo responde. Un `degradado: []` obligaría a leer el array para saber
          // que está sano, y lo que se quiere es que la presencia del campo sea la señal.
          ...salud,
        });
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(cuerpo);
      })();
      return;
    }

    if (req.url?.startsWith("/api/inngest")) {
      void manejadorInngest(req, res);
      return;
    }

    res.writeHead(404).end("not found");
  });
}

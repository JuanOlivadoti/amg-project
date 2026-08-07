import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { serve } from "inngest/node";
import type { ConfigOrquestador, ModoPipeline } from "./config.js";

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
}

const ARRANQUE = Date.now();

export function crearServidor(opciones: OpcionesServidor): Server {
  const { manejadorInngest, funciones, modo, pipeline } = opciones;

  return createServer((req, res) => {
    /*
     * Salud del proceso. **No toca la base ni Inngest, a propósito** — mismo criterio que el
     * renderizador (`renderer/src/app.ts`), que es el precedente más nuevo:
     *
     *  · Un chequeo que depende de una dependencia declara ENFERMO un proceso que sirve: si Postgres
     *    está de mantenimiento, Railway mataría y reiniciaría un orquestador que solo tenía que
     *    esperar. Inngest reintenta los runs solo; reiniciar no arregla nada y sí tira el proceso.
     *  · Y al revés, peor: uno que sí la toca puede declarar SANO un proceso que no sirve —la base
     *    responde, el proceso está trabado— porque mide la dependencia y no a sí mismo.
     *
     * Lo que sí reporta es lo que se puede saber sin preguntarle a nadie: cuántas funciones quedaron
     * registradas (cero = arriba e inútil), en qué modo cree estar, y hace cuánto arrancó.
     *
     * El chequeo va PRIMERO, antes de la delegación: si cayera después, un `/api/inngest*` mal
     * enrutado se lo comería y la salud del proceso dependería del SDK.
     */
    if (req.url === "/_health") {
      const cuerpo = JSON.stringify({
        ok: true,
        funciones,
        modo,
        // Que `PIPELINE_MODO` se pueda leer desde afuera es la mitad de su valor: una declaración
        // que solo vive en el panel de variables no se puede auditar mirando el servicio.
        pipeline,
        uptimeSegundos: Math.round((Date.now() - ARRANQUE) / 1000),
      });
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" }).end(cuerpo);
      return;
    }

    if (req.url?.startsWith("/api/inngest")) {
      void manejadorInngest(req, res);
      return;
    }

    res.writeHead(404).end("not found");
  });
}

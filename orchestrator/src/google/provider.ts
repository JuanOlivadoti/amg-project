import { leerConfig, type ModoResenasGoogle } from "../config.js";
import { MockGoogleReviewsProvider } from "./mock-provider.js";
import { LiveGoogleReviewsProvider } from "./live-provider.js";

/** Una reseña tal como la devuelve la Business Profile API (o el mock que la imita). */
export interface ReseñaCruda {
  googleReviewId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
}

/**
 * Separa el polling de si hay o no credenciales reales de Google — mismo criterio que `Publisher`
 * en `web-builder/src/publish/publisher.ts` (mock/dry-run/live). Bloque F fase 1 solo implementa el
 * mock: `live` no tiene acceso real a la Business Profile API todavía, ver {@link getGoogleReviewsProvider}.
 */
export interface GoogleReviewsProvider {
  /** Cambia un refresh token por un access token de corta duración. */
  refrescarToken(refreshToken: string): Promise<string>;
  /**
   * Las reseñas de una ubicación, tal como las devuelve la Business Profile API.
   *
   * ⚠️ `locationId` es, en modo `live`, el **nombre de recurso completo** de la v4
   * (`accounts/<id>/locations/<id>`), no un id suelto: es así como direcciona esa API. El mock usa
   * un valor opaco, así que la diferencia sólo aparece con credenciales reales.
   */
  listarResenas(accessToken: string, locationId: string): Promise<ReseñaCruda[]>;
  /** Publica la respuesta de vuelta en la reseña, en Google (Bloque F, fase 2, segunda pieza). */
  publicarRespuesta(
    accessToken: string,
    locationId: string,
    googleReviewId: string,
    texto: string,
  ): Promise<void>;
}

/**
 * El selector. `orchestrator` no tiene un `config` singleton como `web-builder` (ahí `config` se
 * arma una vez al importar el módulo); acá `leerConfig()` es una función que se llama explícitamente
 * y **una sola vez, al arrancar** (`server.ts`), y el valor validado se pasa de ahí en más — así
 * evita releer el entorno en cada request y mantiene testeable sin runtime, igual que `workflow.ts`.
 *
 * El parámetro con default sigue el mismo criterio que `crearConexiones` en `deps.ts`: quien ya tiene
 * la config la pasa explícita (evita una segunda lectura del entorno); quien no —como el Task 4,
 * "`getGoogleReviewsProvider(): GoogleReviewsProvider`", sin config a mano en ese punto— deja que se
 * resuelva sola.
 */
export function getGoogleReviewsProvider(
  modo: ModoResenasGoogle = leerConfig().resenasGoogle,
  /*
   * `?.trim() || undefined`, NO `??`: `env:sync` escribe `""` (no omite la clave) cuando falta en
   * `credenciales.env`, y `??` sólo cae al default ante null/undefined. Mismo patrón, y por el mismo
   * motivo, que `getTelegramProvider` con `TELEGRAM_BOT_TOKEN`.
   *
   * Viajan como argumentos (y no se leen dentro del provider) para que `LiveGoogleReviewsProvider`
   * quede testeable sin tocar `process.env`.
   */
  clientId: string | undefined = process.env["GOOGLE_CLIENT_ID"]?.trim() || undefined,
  clientSecret: string | undefined = process.env["GOOGLE_CLIENT_SECRET"]?.trim() || undefined,
): GoogleReviewsProvider {
  if (modo === "mock") return new MockGoogleReviewsProvider();

  // Un modo que no puede operar se cae acá, al construirse, y no en la primera llamada real dentro
  // de un ciclo de polling -- ahí el error aparecería lejos de su causa.
  if (!clientId?.trim()) throw new Error("GOOGLE_REVIEWS_MODO=live sin GOOGLE_CLIENT_ID.");
  if (!clientSecret?.trim()) throw new Error("GOOGLE_REVIEWS_MODO=live sin GOOGLE_CLIENT_SECRET.");
  return new LiveGoogleReviewsProvider(clientId, clientSecret);
}

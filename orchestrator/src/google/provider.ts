import { leerConfig, type ModoResenasGoogle } from "../config.js";
import { MockGoogleReviewsProvider } from "./mock-provider.js";

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
  /** Las reseñas de una ubicación, tal como las devuelve la Business Profile API. */
  listarResenas(accessToken: string, locationId: string): Promise<ReseñaCruda[]>;
  /**
   * Publica la respuesta de vuelta en la reseña, en Google (Bloque F, fase 2, segunda pieza).
   * `live` no la implementa todavía -- ver {@link getGoogleReviewsProvider}.
   */
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
): GoogleReviewsProvider {
  if (modo === "mock") return new MockGoogleReviewsProvider();

  // Bloque F fase 1 es mock-first a propósito: sin acceso real a la Business Profile API todavía.
  // Ver docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md.
  throw new Error(
    "GOOGLE_REVIEWS_MODO=live sin implementación todavía. Bloque F fase 1 es mock-first a propósito " +
      "-- ver docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md.",
  );
}

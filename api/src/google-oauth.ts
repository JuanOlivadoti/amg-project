import { LiveGoogleOAuthProvider } from "./google-oauth-live.js";

/**
 * Conexión OAuth con Google (Bloque F, fase 1). Mismo molde mock/live que `GoogleReviewsProvider`
 * (`orchestrator/src/google/provider.ts`): separa el flujo de "quién conecta la cuenta" de si hay o
 * no credenciales reales de Google — Bloque F fase 1 solo implementa el mock (`live` no tiene acceso
 * real a la consola de Google Cloud todavía).
 */
export interface GoogleOAuthProvider {
  /**
   * La URL a la que el portal redirige para que Google pida consentimiento.
   *
   * `callbackBaseUrl` es el origen de ESTA API (`new URL(c.req.url).origin`, se lo pasa el
   * endpoint) — en `live` se ignora, porque el `redirect_uri` real está fijado en la config de
   * Google Cloud, no en cada request; en `mock` es lo que permite simular el redirect SIN un sitio
   * externo real, apuntando al propio callback.
   *
   * NO recibe el cliente de AMG, a propósito: el callback es una ruta FIJA (`/google/callback`)
   * porque Google exige un `redirect_uri` exacto y sin comodines de path, y la identidad del cliente
   * viaja firmada dentro del `state`. Pasarlo acá además sería una segunda fuente de la misma verdad.
   */
  urlDeConsentimiento(state: string, callbackBaseUrl: string): string;
  /**
   * Intercambia el `code` del callback por un refresh token.
   *
   * `locationIdManual` es el nombre de recurso (`accounts/<id>/locations/<id>`) que un humano pegó al
   * conectar. **Si llega, se devuelve tal cual y NO se intenta descubrir la ficha en absoluto** — ni
   * "por si acaso" antes: las APIs de descubrimiento están en cuota 0 y el 429 volvería igual, con lo
   * que el camino manual no serviría de nada. Su formato lo validó el endpoint que firmó el `state`.
   *
   * "Si llega" significa `!== undefined`, y el código lo IMPONE: una cadena vacía **lanza** en vez de
   * caer al descubrimiento en silencio. Es la diferencia entre una garantía y una intención — esta
   * interfaz es pública, con dos implementaciones, y la promesa de arriba vale para cualquiera que la
   * llame, no sólo para el handler que hoy ya rechaza el vacío con un 400.
   */
  intercambiarCode(
    code: string,
    locationIdManual?: string,
  ): Promise<{ refreshToken: string; locationId: string }>;
}

/**
 * Fixtures fijas y deterministas — mismo criterio que `MockGoogleReviewsProvider`
 * (`orchestrator/src/google/mock-provider.ts`) y `MockPublisher`: nunca sale del proceso.
 *
 * No hay pantalla real de Google en mock: en vez de inventar una pantalla de consentimiento falsa,
 * la "url de consentimiento" apunta DIRECTO al propio callback de esta API, con un code fijo — así
 * se ejercita el mismo tramo de código que el modo live (navegación del navegador → callback →
 * redirect al portal), sin depender de nada externo.
 */
export class MockGoogleOAuthProvider implements GoogleOAuthProvider {
  urlDeConsentimiento(state: string, callbackBaseUrl: string): string {
    const params = new URLSearchParams({ code: "mock-code", state });
    return `${callbackBaseUrl}/google/callback?${params.toString()}`;
  }

  async intercambiarCode(
    code: string,
    locationIdManual?: string,
  ): Promise<{ refreshToken: string; locationId: string }> {
    if (!code) throw new Error("intercambiarCode: code vacío");
    // Misma regla que en live, y por eso está acá y no solo allá: lo pegado gana sobre lo descubierto.
    // Si el mock ignorara `locationIdManual`, el flujo de dev conectaría una ficha distinta de la que
    // conectaría producción con el mismo body — y eso se descubre en producción. El rechazo del vacío
    // también se copia: un mock más permisivo que el live deja pasar en dev lo que rompe en prod.
    /*
     * `!== undefined` y no truthiness: el docblock de la interfaz promete "si llega, no se descubre",
     * y con una guardia truthy un `""` se colaría al descubrimiento — la promesa valdría para
     * todos los valores menos uno, que es justo como se rompen estas cosas. Lanzar y no descubrir:
     * quien pasó una cadena vacía tiene un bug, y el descubrimiento devolvería un 429 de cuota que
     * no le diría a nadie dónde está.
     */
    if (locationIdManual !== undefined) {
      if (!locationIdManual.trim()) {
        throw new Error("intercambiarCode: locationIdManual vacío. Para descubrir la ficha, no lo pases.");
      }
      return { refreshToken: `mock-refresh-${code}`, locationId: locationIdManual };
    }
    return { refreshToken: `mock-refresh-${code}`, locationId: `mock-location-${code}` };
  }
}

/**
 * El selector. Mismo molde que `getGoogleReviewsProvider` en el orquestador: las credenciales viajan
 * como argumentos (no se leen dentro del provider) para que `LiveGoogleOAuthProvider` quede testeable
 * sin tocar `process.env`.
 *
 * `?.trim() || undefined`, NO `??`: `env:sync` escribe `""` cuando la clave falta en
 * `credenciales.env`, y `??` sólo cae al default ante null/undefined.
 */
export function getGoogleOAuthProvider(
  modo: "mock" | "live",
  clientId: string | undefined = process.env["GOOGLE_CLIENT_ID"]?.trim() || undefined,
  clientSecret: string | undefined = process.env["GOOGLE_CLIENT_SECRET"]?.trim() || undefined,
  redirectUri: string | undefined = process.env["GOOGLE_REDIRECT_URI"]?.trim() || undefined,
): GoogleOAuthProvider {
  if (modo === "mock") return new MockGoogleOAuthProvider();

  // Un modo que no puede operar se cae al construirse, no en el primer clic de «Conectar Google».
  if (!clientId?.trim()) throw new Error("GOOGLE_REVIEWS_MODO=live sin GOOGLE_CLIENT_ID.");
  if (!clientSecret?.trim()) throw new Error("GOOGLE_REVIEWS_MODO=live sin GOOGLE_CLIENT_SECRET.");
  // Sin default derivado del origen de la request a propósito: Google exige coincidencia EXACTA con
  // el URI registrado, y un valor adivinado falla con `redirect_uri_mismatch` recién en el navegador.
  if (!redirectUri?.trim()) throw new Error("GOOGLE_REVIEWS_MODO=live sin GOOGLE_REDIRECT_URI.");
  return new LiveGoogleOAuthProvider(clientId, clientSecret, redirectUri);
}

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
   */
  urlDeConsentimiento(clientId: string, state: string, callbackBaseUrl: string): string;
  /** Intercambia el `code` del callback por un refresh token. */
  intercambiarCode(code: string): Promise<{ refreshToken: string; locationId: string }>;
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
  urlDeConsentimiento(clientId: string, state: string, callbackBaseUrl: string): string {
    const params = new URLSearchParams({ code: "mock-code", state });
    return `${callbackBaseUrl}/clients/${encodeURIComponent(clientId)}/google/callback?${params.toString()}`;
  }

  async intercambiarCode(code: string): Promise<{ refreshToken: string; locationId: string }> {
    if (!code) throw new Error("intercambiarCode: code vacío");
    return { refreshToken: `mock-refresh-${code}`, locationId: `mock-location-${code}` };
  }
}

/** El selector. Bloque F fase 1 es mock-first a propósito: ver `MockGoogleOAuthProvider`. */
export function getGoogleOAuthProvider(modo: "mock" | "live"): GoogleOAuthProvider {
  if (modo === "mock") return new MockGoogleOAuthProvider();
  throw new Error(
    "GOOGLE_REVIEWS_MODO=live sin implementación todavía (Bloque F fase 1 es mock-first) -- ver " +
      "docs/superpowers/specs/2026-08-13-modulo-resenas-google-design.md.",
  );
}

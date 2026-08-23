import type { GoogleReviewsProvider, ReseñaCruda } from "./provider.js";

/**
 * Fixtures fijas y deterministas — mismo criterio que `MockPublisher`
 * (`web-builder/src/publish/mock-publisher.ts`): nunca sale a internet, y el `googleReviewId` es
 * estable entre corridas para que el test de idempotencia del polling (Task 4) tenga sentido.
 */
export class MockGoogleReviewsProvider implements GoogleReviewsProvider {
  async refrescarToken(refreshToken: string): Promise<string> {
    if (!refreshToken) throw new Error("refrescarToken: refresh token vacío");
    return `mock-access-token-para-${refreshToken}`;
  }

  async listarResenas(_accessToken: string, locationId: string): Promise<ReseñaCruda[]> {
    return [
      {
        googleReviewId: `mock-${locationId}-1`,
        puntuacion: 2,
        autor: "Cliente Mock Insatisfecho",
        texto: "El servicio tardó mucho.",
        publicadaEn: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      },
      {
        googleReviewId: `mock-${locationId}-2`,
        puntuacion: 5,
        autor: "Cliente Mock Contento",
        texto: "Excelente comida.",
        publicadaEn: new Date().toISOString(),
      },
    ];
  }

  async publicarRespuesta(
    _accessToken: string,
    _locationId: string,
    _googleReviewId: string,
    _texto: string,
  ): Promise<void> {
    // Determinista: "publica" siempre con éxito, sin salir a internet -- mismo criterio que el
    // resto de este mock (fixtures fijas, sin estado).
  }
}

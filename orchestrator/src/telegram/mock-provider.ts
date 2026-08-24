import type { ResultadoActualizaciones, TelegramProvider } from "./provider.js";

/**
 * Determinista y sin red -- mismo criterio que `MockGoogleReviewsProvider`
 * (`../google/mock-provider.ts`): nunca sale a internet, nunca hay novedades que procesar.
 */
export class MockTelegramProvider implements TelegramProvider {
  async obtenerActualizaciones(_offset: number): Promise<ResultadoActualizaciones> {
    return { maxUpdateId: null, mensajes: [] };
  }

  async enviarMensaje(_chatId: string, _texto: string): Promise<void> {
    // Determinista: "envía" siempre con éxito, sin salir a internet -- mismo criterio que el resto
    // de este mock.
  }
}

import type { ReseñaCruda } from "../google/provider.js";
import type { BorradorProvider } from "./provider.js";

/**
 * El prefijo que hace que un borrador mock NUNCA se confunda con uno real de OpenAI cuando alguien
 * lo edita en el portal — hallazgo de la revisión externa de diseño (ver la spec, sección "El
 * provider"). Un borrador sin este prefijo, en cualquier fila de `resenas_google`, es evidencia de
 * que salió de `OpenAIBorradorProvider`.
 */
export const PREFIJO_MOCK_BORRADOR = "[BORRADOR MOCK — no generado por IA]";

/** Texto determinista de fixture — nunca sale a internet. Mismo criterio que `MockGoogleReviewsProvider`. */
export class MockBorradorProvider implements BorradorProvider {
  async generar(reseña: ReseñaCruda): Promise<string> {
    return (
      `${PREFIJO_MOCK_BORRADOR} Gracias por tu reseña de ${reseña.puntuacion}★, ${reseña.autor}. ` +
      "¡Nos alegra mucho que hayas disfrutado la experiencia! Esperamos verte pronto de nuevo."
    );
  }
}

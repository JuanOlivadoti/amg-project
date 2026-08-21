import { leerConfig, type ModoBorrador } from "../config.js";
import type { ReseñaCruda } from "../google/provider.js";
import { MockBorradorProvider } from "./mock-provider.js";
import { OpenAIBorradorProvider } from "./openai-provider.js";

/**
 * Genera el texto de un borrador de respuesta para una reseña 4-5★. Mismo molde que
 * `GoogleReviewsProvider` (`../google/provider.ts`): una interfaz, dos implementaciones (mock/openai),
 * seleccionadas por config — nunca `live`/`openai` a medio implementar.
 */
export interface BorradorProvider {
  generar(reseña: ReseñaCruda): Promise<string>;
}

/**
 * El selector. Mismo criterio que `getGoogleReviewsProvider`: quien ya tiene la config la pasa
 * explícita, quien no deja que se resuelva sola desde `leerConfig()`.
 */
export function getBorradorProvider(
  modo: ModoBorrador = leerConfig().borradorResenas,
): BorradorProvider {
  return modo === "openai" ? new OpenAIBorradorProvider() : new MockBorradorProvider();
}

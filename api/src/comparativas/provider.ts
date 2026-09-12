import type { OpcionSeguro } from "db";
import { MockComparativaProvider } from "./mock-provider.js";

/**
 * Resultado de la generación de una comparativa: informe, recomendación, y draft de mail
 * que el corredor le envía al cliente final. Las opciones que alimentan el análisis van
 * por separado (`opciones`), sin procesamiento por el LLM.
 */
export interface Comparativa {
  opciones: OpcionSeguro[];
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
  costoUsd: number;
}

/**
 * Contrato del provider de LLM para comparativas de seguros.
 *
 * Mismo molde que `BorradorProvider` (`orchestrator/src/borrador/provider.ts`):
 * una interfaz, dos implementaciones (mock + OpenAI), seleccionadas por el modo.
 */
export interface LlmComparativaProvider {
  /**
   * Genera un informe comparativo a partir de cotizaciones (filas del CSV/Sheet) y el nombre
   * del cliente final de la correduría.
   *
   * @param filas Array de filas de cotizaciones: cada fila es un array de celdas (strings).
   *              Su estructura la define Task 2 (`filas.ts`). Aquí se usa como texto bruto para el LLM.
   * @param clienteFinal Nombre del cliente final (persona o empresa) para quien se genera el informe.
   * @returns Una comparativa generada — informe, recomendación, mail draft.
   */
  generar(filas: string[][], clienteFinal: string): Promise<Comparativa>;
}

/**
 * El selector de provider. Mismo patrón que `getBorradorProvider`:
 * - `"mock"` devuelve un mock determinista, sin costo, para desarrollo y tests.
 * - `"openai"` devuelve la implementación con OpenAI (Task 5).
 */
export function getComparativaProvider(modo: "mock" | "openai"): LlmComparativaProvider {
  // Por ahora solo mock; OpenAI se implementa en Task 5.
  // El loader dinámico aquí evita que el módulo de OpenAI sea obligatorio.
  if (modo === "openai") {
    // Task 5 lo implementará. Aquí soltamos un error descriptivo mientras tanto.
    throw new Error("OpenAI provider no implementado aún (Task 5)");
  }
  return new MockComparativaProvider();
}

/**
 * Se exporta para que los tests puedan verificar que el informe se identifica como mock.
 */
export const PREFIJO_MOCK_COMPARATIVA = "[COMPARATIVA MOCK — no generada por IA]";

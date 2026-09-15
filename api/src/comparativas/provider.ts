import type { OpcionSeguro } from "db";
import { MockComparativaProvider } from "./mock-provider.js";
import { OpenAIComparativaProvider } from "./openai-provider.js";

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
 * El selector de provider. Mismo patrón que `getBorradorProvider`
 * (`orchestrator/src/borrador/provider.ts`):
 * - `"mock"` devuelve un mock determinista, sin costo, para desarrollo y tests.
 * - `"openai"` devuelve la implementación real (Task 5): preflight de gasto ANTES de llamar, y
 *   rechazo explícito de la comparativa entera si el LLM no puede sostenerla con confianza.
 *
 * Import estático, no dinámico: `openai` ya es una dependencia real de `api/package.json` (estaba en
 * el monorepo vía `orchestrator`), así que no hay nada que evitar cargar — mismo criterio que
 * `getBorradorProvider`, que importa `OpenAIBorradorProvider` arriba del archivo.
 */
export function getComparativaProvider(modo: "mock" | "openai"): LlmComparativaProvider {
  return modo === "openai" ? new OpenAIComparativaProvider() : new MockComparativaProvider();
}

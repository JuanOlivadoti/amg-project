import type { CostMeter } from "./cost.js";
import { usdFromMicros } from "./cost.js";

/**
 * Presupuesto preflight (ADR-10): estima el costo de cada fase ANTES de gastarlo y aborta si no
 * entra en el remanente. Antes, `max_cost_micros` existía en los tipos pero no bloqueaba nada:
 * una corrida amplia podía superar el presupuesto sin ningún control.
 *
 * Cubre TODOS los proveedores (DataForSEO + LLM), porque el medidor los acumula a todos.
 */
export class BudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceededError";
  }
}

/**
 * ESTIMACIONES para el preflight, en micros de USD. Sirven solo para decidir si arrancar una fase;
 * el costo REAL se mide aparte con el CostMeter.
 *
 * Calibradas contra la primera corrida real (2026-07-13, 52 keywords, DataForSEO producción:
 * $0.2522 en total). Las anteriores estaban ~50× por debajo ($0.005 para enriquecer CUALQUIER
 * cantidad de keywords), así que el tope no protegía: el preflight siempre daba "entra" y el gasto
 * real lo desbordaba.
 *
 * El costo de enriquecimiento ESCALA CON LA CANTIDAD DE KEYWORDS, así que la estimación también.
 * Ante la duda se sobreestima: un preflight conservador puede abortar de más (molesto pero
 * gratis), mientras que uno optimista deja gastar de más (caro e irreversible).
 */
export interface PhaseEstimates {
  /** Por llamada de sugerencias (una por seed). */
  dfsSuggestions: number;
  /** Costo fijo de la task de volumen, independiente de las keywords. */
  dfsSearchVolumeBase: number;
  /** Costo por keyword en la task de volumen. */
  dfsSearchVolumePerKeyword: number;
  /** Costo fijo de la task de KD. */
  dfsBulkKdBase: number;
  /** Costo por keyword en la task de KD. */
  dfsBulkKdPerKeyword: number;
  /** Por SERP (el endpoint más caro). */
  dfsSerp: number;
  /** Por llamada de generación del LLM. */
  llmCall: number;
  /** Por lote de embeddings. */
  llmEmbed: number;
}

export const DEFAULT_ESTIMATES: PhaseEstimates = {
  dfsSuggestions: 10_000, // $0.010 por llamada
  dfsSearchVolumeBase: 50_000, // $0.050 fijo
  dfsSearchVolumePerKeyword: 1_000, // $0.001 por keyword
  dfsBulkKdBase: 30_000, // $0.030 fijo
  dfsBulkKdPerKeyword: 500, // $0.0005 por keyword
  dfsSerp: 3_000, // $0.003 por SERP
  llmCall: 5_000, // $0.005 por llamada
  llmEmbed: 1_000,
};

/** Estimación de la fase de enriquecimiento para N keywords (volumen + KD). */
export function estimateEnrichment(e: PhaseEstimates, keywordCount: number): number {
  return (
    e.dfsSearchVolumeBase +
    e.dfsBulkKdBase +
    keywordCount * (e.dfsSearchVolumePerKeyword + e.dfsBulkKdPerKeyword)
  );
}

export class Budget {
  readonly estimates: PhaseEstimates;

  /** @param maxMicros tope del run; `null` = sin límite (no bloquea nunca). */
  constructor(
    private readonly maxMicros: number | null,
    private readonly meter: Pick<CostMeter, "totalMicros">,
    estimates: Partial<PhaseEstimates> = {},
  ) {
    this.estimates = { ...DEFAULT_ESTIMATES, ...estimates };
  }

  get enabled(): boolean {
    return this.maxMicros != null;
  }

  get spentMicros(): number {
    return this.meter.totalMicros;
  }

  get remainingMicros(): number {
    return this.maxMicros == null ? Number.POSITIVE_INFINITY : this.maxMicros - this.spentMicros;
  }

  /**
   * PREFLIGHT: se llama ANTES de una fase. Si la estimación no entra en el remanente, aborta
   * sin haber gastado nada.
   */
  assertCanSpend(estimateMicros: number, phase: string): void {
    if (this.maxMicros == null) return;
    if (this.spentMicros + estimateMicros > this.maxMicros) {
      throw new BudgetExceededError(
        `Presupuesto insuficiente para la fase "${phase}": ` +
          `estimado $${usdFromMicros(estimateMicros)}, ` +
          `gastado $${usdFromMicros(this.spentMicros)}, ` +
          `tope $${usdFromMicros(this.maxMicros)}. No se ejecutó la fase.`,
      );
    }
  }

  /** POST-FASE: si el gasto real ya superó el tope (la estimación se quedó corta), corta acá. */
  assertNotExceeded(phase: string): void {
    if (this.maxMicros == null) return;
    if (this.spentMicros > this.maxMicros) {
      throw new BudgetExceededError(
        `Presupuesto superado tras la fase "${phase}": ` +
          `gastado $${usdFromMicros(this.spentMicros)} > tope $${usdFromMicros(this.maxMicros)}.`,
      );
    }
  }
}

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
 * ⚠️ ESTIMACIONES por llamada, en micros de USD. Son APROXIMADAS y sirven solo para el preflight
 * (decidir si arrancar una fase). El costo REAL se mide aparte con el CostMeter.
 * Calibrar con datos de producción; sobrescribibles por entorno.
 */
export interface PhaseEstimates {
  dfsSuggestions: number;
  dfsSearchVolume: number;
  dfsBulkKd: number;
  dfsSerp: number;
  llmCall: number;
  llmEmbed: number;
}

export const DEFAULT_ESTIMATES: PhaseEstimates = {
  dfsSuggestions: 1_000, // ~$0.001 por llamada
  dfsSearchVolume: 5_000,
  dfsBulkKd: 5_000,
  dfsSerp: 2_000, // el endpoint más caro
  llmCall: 3_000, // ~$0.003 por llamada de generación
  llmEmbed: 500,
};

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

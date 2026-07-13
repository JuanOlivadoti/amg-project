/**
 * Medición de costo del run, en MICROS de USD (millonésimas), para evitar coma flotante (ADR-10).
 *
 * Antes solo se medía DataForSEO; el LLM (buena parte del gasto real) no se contaba, así que el
 * "costo por research" que se le iba a presentar al cliente estaba incompleto. Este medidor
 * acumula TODOS los proveedores y devuelve el desglose.
 *
 * El costo de DataForSEO es REAL (lo reporta la API en cada respuesta).
 * El costo del LLM se CALCULA a partir de los tokens que reporta el proveedor (dato real) por
 * una tarifa configurable (ver TARIFAS).
 */

export type CostSource = "dataforseo" | "llm_generation" | "llm_embeddings";

export interface CostBreakdown {
  dataforseo_micros: number;
  llm_generation_micros: number;
  llm_embeddings_micros: number;
}

/** Precio en USD por 1.000.000 de tokens. */
export interface ModelPrice {
  input: number;
  output: number;
}

/**
 * ⚠️ TARIFAS APROXIMADAS — CONFIRMAR contra la página de precios del proveedor antes de usar
 * estos números en una propuesta comercial. Los precios de los modelos cambian.
 *
 * Se pueden sobrescribir por entorno con LLM_PRICES (JSON), p. ej.:
 *   LLM_PRICES={"gpt-4o":{"input":2.5,"output":10}}
 *
 * Si un modelo NO tiene tarifa, su costo NO se inventa: se cuenta 0 y se registra en
 * `unpricedModels`, para que el total quede marcado como incompleto en vez de mentir.
 */
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
};

function loadPrices(): Record<string, ModelPrice> {
  const raw = process.env.LLM_PRICES;
  if (!raw) return DEFAULT_PRICES;
  try {
    return { ...DEFAULT_PRICES, ...(JSON.parse(raw) as Record<string, ModelPrice>) };
  } catch {
    console.warn("  [cost] LLM_PRICES no es JSON válido; se usan las tarifas por defecto.");
    return DEFAULT_PRICES;
  }
}

export class CostMeter {
  private micros: Record<CostSource, number> = {
    dataforseo: 0,
    llm_generation: 0,
    llm_embeddings: 0,
  };
  private unpriced = new Set<string>();
  private prices: Record<string, ModelPrice>;

  constructor(prices: Record<string, ModelPrice> = loadPrices()) {
    this.prices = prices;
  }

  /** Costo real reportado por un proveedor (DataForSEO informa `cost` en USD por task). */
  addUsd(source: CostSource, usd: number): void {
    if (!Number.isFinite(usd) || usd <= 0) return;
    this.micros[source] += Math.round(usd * 1_000_000);
  }

  /**
   * Costo de LLM calculado desde los tokens reportados por el proveedor.
   * Si el modelo no tiene tarifa, se registra como "sin precio" y NO se inventa un costo.
   */
  addTokens(
    source: "llm_generation" | "llm_embeddings",
    model: string,
    inputTokens: number,
    outputTokens = 0,
  ): void {
    const p = this.prices[model];
    if (!p) {
      this.unpriced.add(model);
      return;
    }
    const usd = (inputTokens / 1_000_000) * p.input + (outputTokens / 1_000_000) * p.output;
    this.micros[source] += Math.round(usd * 1_000_000);
  }

  get breakdown(): CostBreakdown {
    return {
      dataforseo_micros: this.micros.dataforseo,
      llm_generation_micros: this.micros.llm_generation,
      llm_embeddings_micros: this.micros.llm_embeddings,
    };
  }

  get totalMicros(): number {
    return this.micros.dataforseo + this.micros.llm_generation + this.micros.llm_embeddings;
  }

  /** Modelos usados sin tarifa configurada → el total está incompleto. */
  get unpricedModels(): string[] {
    return [...this.unpriced];
  }

  reset(): void {
    this.micros = { dataforseo: 0, llm_generation: 0, llm_embeddings: 0 };
    this.unpriced.clear();
  }
}

/**
 * Medidor compartido del proceso. El CLI corre un research por proceso, así que un medidor
 * de módulo alcanza; `runResearch()` lo resetea al arrancar.
 * TODO (Inngest): pasar a un medidor por run inyectado, cuando haya runs concurrentes.
 */
export const costMeter = new CostMeter();

export function usdFromMicros(micros: number): string {
  return (micros / 1_000_000).toFixed(4);
}

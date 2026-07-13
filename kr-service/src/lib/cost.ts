import { AsyncLocalStorage } from "node:async_hooks";

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
 * Tarifas en USD por 1M de tokens.
 *
 * ✅ VERIFICADAS contra las páginas oficiales de OpenAI el 2026-07-13
 *    (developers.openai.com/api/docs/pricing y las model cards).
 * ⚠️ Los precios cambian: re-verificar antes de cerrar una propuesta comercial.
 *
 * Se pueden sobrescribir por entorno con LLM_PRICES (JSON), p. ej.:
 *   LLM_PRICES={"gpt-4o":{"input":2.5,"output":10}}
 *
 * Si un modelo NO tiene tarifa, su costo NO se inventa: se cuenta 0 y se registra en
 * `unpricedModels`, para que el total quede marcado como incompleto en vez de mentir.
 * (No hay tarifas de Anthropic acá: si se usa Claude, cargarlas por LLM_PRICES.)
 */
const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // Generación — modelos actuales (nota: los nuevos son MÁS BARATOS que gpt-4o).
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2.5, output: 15 },
  "gpt-5.6-luna": { input: 1, output: 6 },
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.4": { input: 2.5, output: 15 },
  "gpt-5.4-mini": { input: 0.75, output: 4.5 },
  "gpt-5.4-nano": { input: 0.2, output: 1.25 },

  // Generación — legacy (es el default actual del proyecto; ya no figura en la página de precios).
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },

  // Embeddings (solo cobran input).
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

  /**
   * ¿Hay tarifa para este modelo? Se consulta ANTES de gastar.
   *
   * Un modelo sin tarifa suma 0 al medidor, así que el presupuesto lo ve como gratis y no bloquea
   * nunca: el tope queda silenciosamente DESACTIVADO mientras se sigue gastando de verdad. Con un
   * tope activo eso es inaceptable, y por eso el run aborta de entrada (ver run.ts).
   */
  hasPriceFor(model: string): boolean {
    return this.prices[model] != null;
  }

  reset(): void {
    this.micros = { dataforseo: 0, llm_generation: 0, llm_embeddings: 0 };
    this.unpriced.clear();
  }
}

/**
 * Medidor POR RUN, propagado por contexto async (#3 review Codex).
 *
 * Antes había un `costMeter` singleton de módulo que `runResearch()` reseteaba al arrancar. Con un
 * research por proceso funcionaba, pero es un bug latente serio: **dos runs concurrentes en el
 * mismo proceso** (que es exactamente lo que pasa al exponer esto como servicio, sin esperar a
 * Inngest) se pisan entre sí: el `reset()` de uno borra el gasto del otro, un presupuesto ve el
 * consumo ajeno y aborta de más, y los briefs salen con totales cruzados. En un sistema cuyo
 * argumento de venta es el costo por research, eso es corromper el producto.
 *
 * `AsyncLocalStorage` da un medidor por run que se propaga solo a través de toda la cadena async,
 * sin tener que hilarlo a mano por los constructores de cada proveedor (que se crean en factories:
 * `getProvider()`, `getContentGen()`, `getEmbedder()`).
 */
const costContext = new AsyncLocalStorage<CostMeter>();

/** Medidor de último recurso: solo se usa fuera de un `withCostMeter` (tests, scripts sueltos). */
const fallbackMeter = new CostMeter();

/** El medidor del run actual. Todos los proveedores registran su gasto acá. */
export function currentMeter(): CostMeter {
  return costContext.getStore() ?? fallbackMeter;
}

/** Corre `fn` con su PROPIO medidor. Todo lo que gaste dentro se acumula ahí y en ningún otro lado. */
export function withCostMeter<T>(meter: CostMeter, fn: () => Promise<T>): Promise<T> {
  return costContext.run(meter, fn);
}

export function usdFromMicros(micros: number): string {
  return (micros / 1_000_000).toFixed(4);
}

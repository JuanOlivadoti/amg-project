import type { Market, Seed } from "../types.js";

/** Generación de texto (seeds, briefs). Implementaciones: mock | openai | anthropic. */
export interface TextGen {
  generateSeeds(prompt: string, market: Market): Promise<Seed[]>;
}

/** Embeddings para clustering semántico. Implementaciones: mock | openai. */
export interface Embedder {
  readonly dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

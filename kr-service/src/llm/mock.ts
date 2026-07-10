import type { Market, Seed } from "../types.js";
import type { Embedder, TextGen } from "./types.js";

/** Generador mock: heurística simple a partir del prompt (sin key). */
export class MockTextGen implements TextGen {
  async generateSeeds(prompt: string, _market: Market): Promise<Seed[]> {
    const lower = prompt.toLowerCase();
    const cityMatch = lower.match(/en ([a-záéíóúñ ]+?)(?:\.|,| centro|$)/);
    const city = cityMatch?.[1]?.trim() ?? "";
    const base = ["restaurante italiano", "pizzería", "pasta fresca", "menú del día"];
    const seeds: Seed[] = [];
    for (const b of base) {
      seeds.push({ keyword: city ? `${b} ${city}` : b, service: b, intent_hint: "local" });
      seeds.push({
        keyword: `mejor ${b}${city ? " " + city : ""}`,
        service: b,
        intent_hint: "commercial",
      });
    }
    return seeds;
  }
}

/**
 * Embedder mock: vector bag-of-words por hash de tokens (determinista).
 * Keywords que comparten palabras quedan cerca en coseno → el clustering agrupa
 * duplicados reales sin necesidad de una API. Suficiente para validar el flujo.
 */
export class MockEmbedder implements Embedder {
  readonly dim = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vec(t));
  }

  private vec(text: string): number[] {
    const v = new Array<number>(this.dim).fill(0);
    for (const token of tokenize(text)) {
      v[hash(token) % this.dim]! += 1;
    }
    // Normalizar (L2) para que el coseno sea comparable.
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map((x) => x / norm);
  }
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

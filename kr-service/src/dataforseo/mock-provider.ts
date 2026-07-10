import type { Market } from "../types.js";
import type { KeywordDataProvider, SearchVolumeRow } from "./provider.js";

/**
 * Provider mock: genera datos ficticios pero REALISTAS y DETERMINISTAS
 * (mismo keyword → mismos números), sin cuenta de DataForSEO.
 * Sirve para desarrollar y testear el pipeline end-to-end antes de abrir la cuenta.
 * Simula el costo de la API para que el meta_run tenga un número plausible.
 */
export class MockProvider implements KeywordDataProvider {
  costMicros = 0;

  async keywordSuggestions(keyword: string, _market: Market, limit = 30): Promise<string[]> {
    this.costMicros += 10_000; // ~ $0.01 por llamada de sugerencias
    const modifiers = [
      "precio",
      "opiniones",
      "cerca de mi",
      "barato",
      "a domicilio",
      "reservar",
      "carta",
      "menú",
      "mejor",
      "para grupos",
      "abierto ahora",
      "recomendado",
    ];
    const questions = [`qué es ${keyword}`, `cuánto cuesta ${keyword}`, `cómo elegir ${keyword}`];
    const out = new Set<string>([keyword]);
    for (const m of modifiers) {
      out.add(m === "mejor" ? `${m} ${keyword}` : `${keyword} ${m}`);
    }
    for (const q of questions) out.add(q);
    return [...out].slice(0, limit);
  }

  async searchVolume(keywords: string[], _market: Market): Promise<SearchVolumeRow[]> {
    this.costMicros += keywords.length * 100; // ~ $0.0001 por keyword
    return keywords.map((keyword) => {
      const h = hash(keyword);
      // ~10% sin datos (volumen null) para ejercitar el penalizado de confianza.
      if (h % 10 === 0) {
        return { keyword, search_volume: null, cpc: null, competition: null };
      }
      const words = keyword.split(/\s+/).length;
      const base = 40 + Math.floor(rand(h) * 6000);
      const volume = Math.max(10, Math.round(base / Math.max(1, words - 1))); // long-tail baja
      return {
        keyword,
        search_volume: volume,
        cpc: Math.round((0.2 + rand(h * 3) * 4) * 100) / 100,
        competition: Math.round(rand(h * 7) * 100) / 100,
        monthly_searches: monthlyTrend(volume, h),
      };
    });
  }

  async bulkKeywordDifficulty(
    keywords: string[],
    _market: Market,
  ): Promise<Map<string, number | null>> {
    this.costMicros += keywords.length * 100;
    const map = new Map<string, number | null>();
    for (const k of keywords) {
      const h = hash(k + "#kd");
      map.set(k, 5 + Math.round(rand(h) * 65)); // KD 5..70
    }
    return map;
  }

  /**
   * SERP mock: top URLs derivadas de los tokens significativos del keyword.
   * Keywords que comparten palabras comparten URLs → el SERP-overlap las fusiona,
   * igual que en la realidad (mismo tema = mismas páginas rankeando).
   */
  async serp(keyword: string, _market: Market, depth = 10): Promise<string[]> {
    this.costMicros += 3_000; // ~ $0.003 por SERP (el endpoint más caro)
    const tokens = keyword
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const urls = new Set<string>();
    for (const t of tokens) urls.add(`https://ejemplo-serp.com/${t}`);
    // Relleno determinista hasta `depth` con URLs "genéricas" (no aportan overlap).
    let i = 0;
    while (urls.size < depth) urls.add(`https://generico-${hash(keyword + i++) % 9999}.com/`);
    return [...urls].slice(0, depth);
  }
}

function monthlyTrend(volume: number, h: number): Array<{ year: number; month: number; search_volume: number }> {
  const now = new Date();
  const rows = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const wobble = 0.75 + rand(h * (i + 2)) * 0.5; // ±25%
    rows.push({
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      search_volume: Math.round(volume * wobble),
    });
  }
  return rows;
}

/** Hash FNV-1a determinista. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** PRNG determinista 0..1 a partir de una semilla entera. */
function rand(seed: number): number {
  let x = seed || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

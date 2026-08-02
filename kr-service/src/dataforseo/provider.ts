import type { Market } from "../types.js";
import type { SearchVolumeRow, SerpResultado } from "./endpoints.js";

// `SerpResultado` se define junto al endpoint que lo produce (igual que `SearchVolumeRow`) y se
// re-exporta acá, que es donde vive el contrato que consume el pipeline.
export type { SearchVolumeRow, SerpResultado };

/**
 * Abstracción de la fuente de datos de keywords. El pipeline depende de esta
 * interfaz, no de DataForSEO directamente → permite mock (sin cuenta) y facilita tests.
 */
export interface KeywordDataProvider {
  /** Costo acumulado del run, en micros de USD. */
  readonly costMicros: number;
  keywordSuggestions(keyword: string, market: Market, limit?: number): Promise<string[]>;
  searchVolume(keywords: string[], market: Market): Promise<SearchVolumeRow[]>;
  bulkKeywordDifficulty(
    keywords: string[],
    market: Market,
  ): Promise<Map<string, number | null>>;
  /**
   * SERP: top URLs orgánicas (para validar clusters por overlap) **y** la señal de map pack, que es
   * la evidencia real de que Google considera local esa búsqueda (ver `SerpResultado`).
   */
  serp(keyword: string, market: Market, depth?: number): Promise<SerpResultado>;
}

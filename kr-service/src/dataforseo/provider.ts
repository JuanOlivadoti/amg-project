import type { Market } from "../types.js";
import type { SearchVolumeRow } from "./endpoints.js";

export type { SearchVolumeRow };

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
  /** Top URLs orgánicas del SERP (para validar clusters por overlap). */
  serp(keyword: string, market: Market, depth?: number): Promise<string[]>;
}

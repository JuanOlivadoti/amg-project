import type { Market } from "../types.js";
import { DataForSeoClient } from "./client.js";
import {
  bulkKeywordDifficulty,
  keywordSuggestions,
  searchVolume,
  serpOrganic,
  type SearchVolumeRow,
} from "./endpoints.js";
import type { KeywordDataProvider } from "./provider.js";

/** Provider real: pega contra la API de DataForSEO (sandbox o producción). */
export class LiveProvider implements KeywordDataProvider {
  private client = new DataForSeoClient();

  get costMicros(): number {
    return this.client.costMicros;
  }

  keywordSuggestions(keyword: string, market: Market, limit = 30): Promise<string[]> {
    return keywordSuggestions(this.client, keyword, market, limit);
  }

  searchVolume(keywords: string[], market: Market): Promise<SearchVolumeRow[]> {
    return searchVolume(this.client, keywords, market);
  }

  bulkKeywordDifficulty(
    keywords: string[],
    market: Market,
  ): Promise<Map<string, number | null>> {
    return bulkKeywordDifficulty(this.client, keywords, market);
  }

  serp(keyword: string, market: Market, depth = 10): Promise<string[]> {
    return serpOrganic(this.client, keyword, market, depth);
  }
}

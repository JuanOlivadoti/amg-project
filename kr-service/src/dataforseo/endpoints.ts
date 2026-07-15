import type { Market } from "../types.js";
import type { DataForSeoClient } from "./client.js";

// Wrappers tipados de los endpoints que usa el Módulo 2 (ver docs/guia-dataforseo.md §4).
//
// DOS caminos, según lo que soporta cada endpoint (ADR-14):
//  · SERP y Search Volume → método STANDARD (`postStandard`): task_post/task_get, la tarea pagada
//    se recupera gratis. Una respuesta perdida NO es dinero perdido.
//  · Suggestions y KD (Labs) → LIVE (`post`): no existe task_post para Labs. Ahí una respuesta
//    perdida detiene el run en vez de arriesgar un doble cobro.

export interface SearchVolumeRow {
  keyword: string;
  search_volume: number | null;
  cpc: number | null;
  competition: number | null;
  monthly_searches?: Array<{ year: number; month: number; search_volume: number }>;
}

export interface KeywordSuggestionRow {
  keyword_data?: { keyword: string };
  keyword?: string;
}

export interface BulkKdRow {
  keyword: string;
  keyword_difficulty: number | null;
}

const loc = (m: Market) => ({ location_code: m.location_code, language_code: m.language_code });

export async function searchVolume(
  client: DataForSeoClient,
  keywords: string[],
  market: Market,
): Promise<SearchVolumeRow[]> {
  // STANDARD: task_post/task_get. Search Volume usa el task_get REGULAR (sin /advanced).
  const res = await client.postStandard<{ items?: SearchVolumeRow[] } | SearchVolumeRow>(
    "/v3/keywords_data/google_ads/search_volume",
    [{ keywords, ...loc(market) }],
    { modoGet: "regular" },
  );
  // El shape varía; normalizamos a filas.
  return res.flatMap((r) => ("items" in r && r.items ? r.items : [r as SearchVolumeRow]));
}

export async function keywordSuggestions(
  client: DataForSeoClient,
  keyword: string,
  market: Market,
  limit = 30,
): Promise<string[]> {
  const res = await client.post<{ items?: KeywordSuggestionRow[] }>(
    "/v3/dataforseo_labs/google/keyword_suggestions/live",
    [{ keyword, ...loc(market), limit }],
  );
  const out = new Set<string>();
  for (const block of res) {
    for (const item of block.items ?? []) {
      const kw = item.keyword_data?.keyword ?? item.keyword;
      if (kw) out.add(kw);
    }
  }
  return [...out];
}

export async function serpOrganic(
  client: DataForSeoClient,
  keyword: string,
  market: Market,
  depth = 10,
): Promise<string[]> {
  // STANDARD: task_post/task_get. SERP usa el task_get ADVANCED (`.../task_get/advanced/{id}`).
  const res = await client.postStandard<{ items?: Array<{ type?: string; url?: string }> }>(
    "/v3/serp/google/organic",
    [{ keyword, ...loc(market), depth }],
    { modoGet: "advanced" },
  );
  const urls: string[] = [];
  for (const block of res) {
    for (const item of block.items ?? []) {
      if (item.type === "organic" && item.url) urls.push(item.url);
    }
  }
  return urls.slice(0, depth);
}

export async function bulkKeywordDifficulty(
  client: DataForSeoClient,
  keywords: string[],
  market: Market,
): Promise<Map<string, number | null>> {
  const res = await client.post<{ items?: BulkKdRow[] }>(
    "/v3/dataforseo_labs/google/bulk_keyword_difficulty/live",
    [{ keywords, ...loc(market) }],
  );
  const map = new Map<string, number | null>();
  for (const block of res) {
    for (const item of block.items ?? []) map.set(item.keyword, item.keyword_difficulty);
  }
  return map;
}

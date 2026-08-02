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

/**
 * Lo que devuelve una consulta de SERP: las URLs orgánicas y **si Google mostró map pack**.
 *
 * `mapPack: null` significa **NO SE PUDO OBSERVAR** (el SERP falló, o quien produjo el resultado no
 * mira esa señal). No es lo mismo que `false` ("se miró y no hay bloque local"). Es la misma
 * distinción que ya rige `volumen`: ausencia de dato ≠ dato negativo. Tratar el `null` como `false`
 * afirmaría "Google no considera local esta búsqueda" sin haberla mirado, que es exactamente el
 * error que este campo existe para corregir.
 */
export interface SerpResultado {
  /** URLs orgánicas, en orden. Lo que `serp()` devolvía antes. */
  urls: string[];
  /** ¿El SERP trae map pack (el bloque de resultados locales)? `null` = no observado. */
  mapPack: boolean | null;
}

/**
 * Los `item.type` de la respuesta *advanced* de DataForSEO que cuentan como **map pack**.
 *
 * ⚠️ **NO ESTÁ VERIFICADO CONTRA LA API REAL.** Ningún test puede verlo: el mock es determinista y
 * lo inventa, y una corrida live cuesta dinero. Sale de la documentación del proveedor: el bloque
 * local llega como `local_pack`, y en algunos SERP como `map`. Confirmarlo exige una corrida de
 * producción, que decide un humano.
 *
 * Si estos nombres estuvieran mal, `mapPack` saldría `false` para todo y el refinamiento
 * **desmarcaría** `is_local` en vez de marcarlo — o sea, fallaría hacia el lado conservador
 * (páginas `WebPage`/`Article` en vez de `LocalBusiness` de más). Es el lado correcto en el que
 * fallar: el problema que se está arreglando es publicarle a Google afirmaciones falsas.
 */
export const TIPOS_MAP_PACK: readonly string[] = ["local_pack", "map"];

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
): Promise<SerpResultado> {
  // STANDARD: task_post/task_get. SERP usa el task_get ADVANCED (`.../task_get/advanced/{id}`).
  const res = await client.postStandard<{ items?: Array<{ type?: string; url?: string }> }>(
    "/v3/serp/google/organic",
    [{ keyword, ...loc(market), depth }],
    { modoGet: "advanced" },
  );
  const urls: string[] = [];
  let mapPack = false;
  for (const block of res) {
    for (const item of block.items ?? []) {
      if (item.type === "organic" && item.url) urls.push(item.url);
      if (item.type && TIPOS_MAP_PACK.includes(item.type)) mapPack = true;
    }
  }
  // El proveedor RESPONDIÓ: la observación existe, aunque su resultado sea "no hay map pack". El
  // `null` queda reservado para cuando no hubo respuesta — eso lo decide quien atrapa el error
  // (ver `clusterKeywords`), no este código, que solo llega acá si `postStandard` no lanzó.
  return { urls: urls.slice(0, depth), mapPack };
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

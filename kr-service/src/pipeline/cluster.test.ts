import { test } from "node:test";
import assert from "node:assert/strict";
import { clusterKeywords } from "./cluster.js";
import { MARKET_ES } from "../config.js";
import type { KeywordDataProvider, SearchVolumeRow, SerpResultado } from "../dataforseo/provider.js";
import type { Embedder } from "../llm/types.js";
import type { EnrichedKeyword } from "../types.js";

function kw(keyword: string, score: number): EnrichedKeyword {
  return {
    keyword,
    source: "seed",
    volume: 100,
    difficulty: null,
    cpc: null,
    competition: null,
    trend: null,
    intent: null,
    is_local: false,
    business_relevance: null,
    opportunity_score: score,
    score_confidence: null,
    cluster_id: null,
    discarded: false,
  };
}

/** Vectores ortogonales: nada se fusiona por semántica, así que cada keyword es una cabeza. */
const embedderOrtogonal: Embedder = {
  dim: 8,
  async embed(texts) {
    return texts.map((_, i) => Array.from({ length: 8 }, (_, j) => (i === j ? 1 : 0)));
  },
};

class ProviderDeSerp implements KeywordDataProvider {
  costMicros = 0;
  constructor(private readonly respuesta: (kw: string) => SerpResultado | Error) {}
  async keywordSuggestions(): Promise<string[]> { return []; }
  async searchVolume(): Promise<SearchVolumeRow[]> { return []; }
  async bulkKeywordDifficulty(): Promise<Map<string, number | null>> { return new Map(); }
  async serp(keyword: string): Promise<SerpResultado> {
    const r = this.respuesta(keyword);
    if (r instanceof Error) throw r;
    return r;
  }
}

const KWS = [kw("restaurante italiano madrid", 90), kw("como hacer pasta fresca", 80)];

test("clusterKeywords: onSerp recibe la señal de cada cabeza consultada", async () => {
  const vistas = new Map<string, SerpResultado>();
  const provider = new ProviderDeSerp((k) => ({
    urls: [`https://${k.split(" ")[0]}.com`],
    mapPack: k.includes("restaurante"),
  }));

  await clusterKeywords(KWS, embedderOrtogonal, provider, MARKET_ES, {}, (k, r) => vistas.set(k, r));

  assert.equal(vistas.size, 2);
  assert.equal(vistas.get("restaurante italiano madrid")!.mapPack, true);
  assert.equal(vistas.get("como hacer pasta fresca")!.mapPack, false);
});

/**
 * 🔴 Un SERP que FALLÓ no es un SERP sin map pack.
 *
 * Si acá se reportara `false`, el refinamiento desmarcaría `is_local` de una landing local legítima
 * por un timeout de red — afirmando "Google no considera local esta búsqueda" sin haberla mirado.
 * El `null` es lo que hace que `refineIsLocal` la deje en paz.
 */
test("🔴 un SERP fallido se reporta como { urls: [], mapPack: null }, no como false", async () => {
  const vistas = new Map<string, SerpResultado>();
  const provider = new ProviderDeSerp((k) =>
    k.includes("restaurante") ? new Error("timeout") : { urls: ["https://x.com"], mapPack: false },
  );

  await clusterKeywords(KWS, embedderOrtogonal, provider, MARKET_ES, {}, (k, r) => vistas.set(k, r));

  assert.deepEqual(vistas.get("restaurante italiano madrid"), { urls: [], mapPack: null });
  assert.equal(vistas.get("como hacer pasta fresca")!.mapPack, false, "las demás cabezas se siguen observando");
});

/** El callback es opcional y una salida lateral: sin él, el clustering hace exactamente lo mismo. */
test("clusterKeywords: sin onSerp funciona igual y el tipo de retorno no cambió", async () => {
  const provider = new ProviderDeSerp(() => ({ urls: ["https://a.com"], mapPack: null }));
  const clusters = await clusterKeywords(KWS, embedderOrtogonal, provider, MARKET_ES);

  assert.equal(clusters.length, 2);
  assert.equal(clusters[0]!.members[0]!.keyword, "restaurante italiano madrid");
});

/**
 * El overlap sigue leyéndose de `urls`. Si el clustering mirara el objeto entero (o `undefined`),
 * dejaría de fusionar y el brief saldría con el doble de páginas sin que ningún test lo notara.
 */
test("clusterKeywords: el overlap se calcula sobre .urls y sigue fusionando cabezas", async () => {
  const compartidas = ["https://a.com", "https://b.com", "https://c.com"];
  const provider = new ProviderDeSerp(() => ({ urls: compartidas, mapPack: true }));

  const clusters = await clusterKeywords(KWS, embedderOrtogonal, provider, MARKET_ES);

  assert.equal(clusters.length, 1, "3 URLs compartidas ≥ serpOverlapMin(3) → se fusionan");
  assert.equal(clusters[0]!.members.length, 2);
});

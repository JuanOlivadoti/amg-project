import { MARKET_ES } from "../config.js";
import { getProvider } from "../dataforseo/index.js";
import { getEmbedder } from "../llm/index.js";
import { generateSeeds } from "../llm/seeds.js";
import { WEIGHTS_DEFAULT } from "../types.js";
import type { EnrichedKeyword, KeywordResearchBrief, KeywordResearchInput } from "../types.js";
import { classifyIntent } from "./intent.js";
import { scoreKeywords } from "./scoring.js";
import { clusterKeywords } from "./cluster.js";
import { mapClustersToPages } from "./cluster-map.js";
import { applyBusinessRelevance, applyPageContent } from "./enrich-content.js";
import { assembleBrief } from "./brief.js";

/**
 * Orquestador secuencial del spike (Fase 0).
 * TODO: envolver cada paso en un step durable de Inngest (reintentos + waitForEvent
 * para la compuerta humana). Acá corre en línea para validar el flujo end-to-end.
 */
export async function runResearch(input: KeywordResearchInput): Promise<KeywordResearchBrief> {
  const market = input.market ?? MARKET_ES;
  const weights = input.options?.weights ?? WEIGHTS_DEFAULT;
  const maxPages = input.options?.max_pages ?? 25;
  const dfs = getProvider();

  const log = (step: string, msg: string) => console.log(`  [${step}] ${msg}`);

  // Paso 2 — Seeds
  const seeds = await generateSeeds(input.prompt, market);
  log("seeds", `${seeds.length} keywords semilla`);

  // Paso 3 — Expansión (sugerencias) por cada seed
  const universe = new Set(seeds.map((s) => s.keyword));
  for (const s of seeds.slice(0, 10)) {
    try {
      const sugg = await dfs.keywordSuggestions(s.keyword, market, 20);
      sugg.forEach((k) => universe.add(k));
    } catch (e) {
      log("expand", `aviso: ${(e as Error).message}`);
    }
  }
  const keywords = [...universe];
  log("expand", `${keywords.length} keywords tras expansión`);

  // Paso 4 — Enriquecimiento (volumen + dificultad)
  const [volRows, kdMap] = await Promise.all([
    dfs.searchVolume(keywords, market).catch((e) => {
      log("enrich", `aviso volumen: ${(e as Error).message}`);
      return [] as Awaited<ReturnType<typeof dfs.searchVolume>>;
    }),
    dfs.bulkKeywordDifficulty(keywords, market).catch((e) => {
      log("enrich", `aviso KD: ${(e as Error).message}`);
      return new Map<string, number | null>();
    }),
  ]);
  const volMap = new Map(volRows.map((r) => [r.keyword, r]));

  const enriched: EnrichedKeyword[] = keywords.map((kw) => {
    const v = volMap.get(kw);
    const { intent, is_local } = classifyIntent(kw, market);
    return {
      keyword: kw,
      source: seeds.some((s) => s.keyword === kw) ? "seed" : "suggestion",
      volume: v?.search_volume ?? null,
      difficulty: kdMap.get(kw) ?? null,
      cpc: v?.cpc ?? null,
      competition: v?.competition ?? null,
      trend: null,
      intent,
      is_local,
      business_relevance: null, // TODO (F2): scoring de relevancia con LLM
      opportunity_score: null,
      score_confidence: null,
      cluster_id: null,
      discarded: false,
    };
  });
  log("enrich", `enriquecidas ${enriched.length} · coste API $${(dfs.costMicros / 1_000_000).toFixed(4)}`);

  // Paso 4b — Relevancia de negocio (LLM) → activa el gate del scoring
  await applyBusinessRelevance(enriched, input.prompt);

  // Paso 8 — Scoring (aplica el gate de relevancia)
  scoreKeywords(enriched, weights);
  log("score", `scoreadas · ${enriched.filter((k) => k.discarded).length} descartadas por relevancia`);

  // Paso 6 — Clustering híbrido (semántico + validación SERP)
  const clusters = await clusterKeywords(enriched, getEmbedder(), dfs, market);
  log("cluster", `${clusters.length} clusters`);

  // Paso 9 — Mapeo a páginas
  const { pages, backlog } = mapClustersToPages(clusters, maxPages);
  log("map", `${pages.length} páginas · ${backlog.length} en backlog`);

  // Paso 10 — Contenido on-page (meta, secciones, FAQs, claims) por LLM
  await applyPageContent(pages, input.prompt, market);
  log("content", `contenido generado para ${pages.length} páginas`);

  // Paso 11 — Brief
  return assembleBrief({
    cliente: deriveCliente(input.prompt),
    market,
    pages,
    backlog,
    keywordsAnalizadas: enriched.length,
    costeMicros: dfs.costMicros,
  });
}

function deriveCliente(prompt: string): string {
  return prompt.split(/[.,]/)[0]?.trim().slice(0, 80) ?? "Cliente";
}

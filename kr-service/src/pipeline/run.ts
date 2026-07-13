import { config, MARKET_ES } from "../config.js";
import { canonicalKey, dedupeByCanonical } from "../lib/text.js";
import { costMeter, usdFromMicros } from "../lib/cost.js";
import { Budget } from "../lib/budget.js";
import { getProvider } from "../dataforseo/index.js";
import { getEmbedder } from "../llm/index.js";
import { generateSeeds } from "../llm/seeds.js";
import { WEIGHTS_DEFAULT } from "../types.js";
import type {
  DataQuality,
  EnrichedKeyword,
  KeywordResearchBrief,
  KeywordResearchInput,
} from "../types.js";
import { scoreKeywords } from "./scoring.js";
import { clusterKeywords } from "./cluster.js";
import { mapClustersToPages } from "./cluster-map.js";
import { applyBusinessRelevance, applyIntents, applyPageContent } from "./enrich-content.js";
import { assembleBrief } from "./brief.js";

/**
 * Dataset crudo del run: todas las keywords enriquecidas y los clusters resultantes.
 *
 * Se expone aparte del brief porque el brief solo lleva las páginas propuestas. Sin esto, los
 * datos por los que se le pagó a DataForSEO se pierden al terminar el proceso, y cualquier ajuste
 * de scoring o de clustering obliga a pagar OTRA corrida. Con el volcado, el tuning es offline
 * y gratis.
 */
export interface ResearchDataset {
  keywords: EnrichedKeyword[];
  clusters: Array<{ head: string; members: string[] }>;
}

/**
 * Orquestador secuencial del spike (Fase 0).
 * TODO: envolver cada paso en un step durable de Inngest (reintentos + waitForEvent
 * para la compuerta humana). Acá corre en línea para validar el flujo end-to-end.
 */
export async function runResearch(
  input: KeywordResearchInput,
  onDataset?: (d: ResearchDataset) => void,
): Promise<KeywordResearchBrief> {
  const market = input.market ?? MARKET_ES;
  const weights = input.options?.weights ?? WEIGHTS_DEFAULT;
  const maxPages = input.options?.max_pages ?? 25;
  const dfs = getProvider();

  const log = (step: string, msg: string) => console.log(`  [${step}] ${msg}`);

  // Costo y presupuesto del run (ADR-10). El medidor acumula TODOS los proveedores
  // (DataForSEO + LLM); el presupuesto estima cada fase ANTES de ejecutarla y aborta
  // si no entra en el remanente, en vez de descubrir el exceso cuando ya se gastó.
  costMeter.reset();
  const budget = new Budget(input.options?.max_cost_micros ?? null, costMeter);
  const est = budget.estimates;
  if (budget.enabled) {
    log("budget", `tope del run: $${usdFromMicros(input.options!.max_cost_micros!)}`);
  }

  // Paso 2 — Seeds
  budget.assertCanSpend(est.llmCall, "seeds");
  const seeds = await generateSeeds(input.prompt, market);
  log("seeds", `${seeds.length} keywords semilla`);

  // Paso 3 — Expansión (sugerencias) por cada seed.
  // El dedupe es por clave CANÓNICA: a DataForSEO se le paga por keyword, y los duplicados de
  // casing ("pasta fresca Madrid" / "pasta fresca madrid") se pagaban dos veces.
  const toExpand = seeds.slice(0, 10);
  budget.assertCanSpend(toExpand.length * est.dfsSuggestions, "expansión");
  const raw: string[] = seeds.map((s) => s.keyword);
  for (const s of toExpand) {
    try {
      const sugg = await dfs.keywordSuggestions(s.keyword, market, 20);
      raw.push(...sugg);
    } catch (e) {
      log("expand", `aviso: ${(e as Error).message}`);
    }
  }
  const keywords = dedupeByCanonical(raw);
  const dups = raw.length - keywords.length;
  log(
    "expand",
    `${keywords.length} keywords tras expansión` + (dups > 0 ? ` (${dups} duplicadas descartadas)` : ""),
  );

  // Paso 4 — Enriquecimiento (volumen + dificultad)
  budget.assertCanSpend(est.dfsSearchVolume + est.dfsBulkKd, "enriquecimiento");
  const endpointsDegradados: string[] = [];
  const [volRows, kdMap] = await Promise.all([
    dfs.searchVolume(keywords, market).catch((e) => {
      log("enrich", `aviso volumen: ${(e as Error).message}`);
      endpointsDegradados.push("search_volume");
      return [] as Awaited<ReturnType<typeof dfs.searchVolume>>;
    }),
    dfs.bulkKeywordDifficulty(keywords, market).catch((e) => {
      log("enrich", `aviso KD: ${(e as Error).message}`);
      endpointsDegradados.push("bulk_keyword_difficulty");
      return new Map<string, number | null>();
    }),
  ]);
  // Se indexa por clave canónica: el proveedor puede devolver la keyword con otro casing/espaciado
  // o forma Unicode que la enviada (#7). Sin esto, el lookup falla y la métrica se pierde.
  const volMap = new Map(volRows.map((r) => [canonicalKey(r.keyword), r]));
  const kdCanon = new Map([...kdMap].map(([k, v]) => [canonicalKey(k), v]));
  const seedKeys = new Set(seeds.map((s) => canonicalKey(s.keyword)));

  const enriched: EnrichedKeyword[] = keywords.map((kw) => {
    const key = canonicalKey(kw);
    const v = volMap.get(key);
    return {
      keyword: kw,
      source: seedKeys.has(key) ? "seed" : "suggestion",
      volume: v?.search_volume ?? null,
      difficulty: kdCanon.get(key) ?? null,
      cpc: v?.cpc ?? null,
      competition: v?.competition ?? null,
      trend: null,
      intent: null, // se completa en Paso 4b (clasificación por LLM)
      is_local: false,
      business_relevance: null, // se completa en Paso 4c
      opportunity_score: null,
      score_confidence: null,
      cluster_id: null,
      discarded: false,
    };
  });
  log("enrich", `enriquecidas ${enriched.length} · coste API $${(dfs.costMicros / 1_000_000).toFixed(4)}`);

  // Gate de cobertura — el fallo de DataForSEO deja de ser invisible.
  //
  // El pipeline degrada con elegancia (catch → null y sigue), lo cual está bien... salvo que el
  // fallo era INDISTINGUIBLE del éxito: si el endpoint de volumen se caía entero, el run seguía
  // gastando en intención, relevancia, clustering y contenido, y escupía un brief igual de
  // confiado con páginas basadas en CERO datos de mercado. El cliente no tenía cómo notarlo.
  //
  // Con cobertura 0 se corta ACÁ, antes de seguir gastando: un research sin un solo dato de
  // mercado no es un research, es una lista de opiniones del LLM.
  const calidadDatos: DataQuality = {
    cobertura_volumen: enriched.length ? enriched.filter((k) => k.volume != null).length / enriched.length : 0,
    cobertura_kd: enriched.length ? enriched.filter((k) => k.difficulty != null).length / enriched.length : 0,
    endpoints_degradados: endpointsDegradados,
  };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  log(
    "calidad",
    `cobertura volumen ${pct(calidadDatos.cobertura_volumen)} · KD ${pct(calidadDatos.cobertura_kd)}` +
      (endpointsDegradados.length ? ` · ⚠️ degradados: ${endpointsDegradados.join(", ")}` : ""),
  );
  // El corte duro solo aplica cuando el dinero es REAL. El mock y el sandbox no cobran y no
  // devuelven volúmenes de verdad (el sandbox da 0% por diseño), así que abortar ahí rompería el
  // loop de desarrollo gratis —que es una propiedad central del proyecto— sin proteger nada.
  const gastaDineroReal = config.dataforseo.mode === "live" && !config.dataforseo.isSandbox;

  if (calidadDatos.cobertura_volumen === 0) {
    const msg =
      "Cobertura de volumen 0%: ninguna keyword tiene datos de mercado. " +
      (endpointsDegradados.length
        ? `Endpoints caídos: ${endpointsDegradados.join(", ")}.`
        : "El proveedor respondió pero sin volúmenes.");

    if (gastaDineroReal) {
      throw new Error(
        `${msg} Se aborta ANTES de gastar en contenido: un brief sin un solo volumen real no es un ` +
          `research, y presentarlo como tal engañaría al cliente.`,
      );
    }
    log("calidad", `⚠️ ${msg} (esperable fuera de producción: se continúa)`);
  } else if (calidadDatos.cobertura_volumen < 0.3) {
    log(
      "calidad",
      `⚠️ solo ${pct(calidadDatos.cobertura_volumen)} de las keywords tiene volumen. El brief lo ` +
        `declara en meta_run.calidad_datos y las páginas afectadas quedan marcadas "sin_validar".`,
    );
  }

  // Paso 4b — Intención de búsqueda (LLM en batch, con fallback heurístico)
  budget.assertCanSpend(est.llmCall, "intención");
  const intentStats = await applyIntents(enriched, input.prompt, market);
  log("intent", `clasificadas ${enriched.length} · LLM ${intentStats.llm} · heurística ${intentStats.heuristic}`);

  // Paso 4c — Relevancia de negocio (LLM) → activa el gate del scoring
  budget.assertCanSpend(est.llmCall, "relevancia de negocio");
  await applyBusinessRelevance(enriched, input.prompt);

  // Paso 8 — Scoring (aplica el gate de relevancia) — sin costo externo
  scoreKeywords(enriched, weights);
  log("score", `scoreadas · ${enriched.filter((k) => k.discarded).length} descartadas por relevancia`);

  // Paso 6 — Clustering híbrido (embeddings + validación SERP: el endpoint más caro)
  budget.assertCanSpend(est.llmEmbed + CLUSTER_SERP_HEADS * est.dfsSerp, "clustering");
  const clusters = await clusterKeywords(enriched, getEmbedder(), dfs, market);
  log("cluster", `${clusters.length} clusters`);

  // Se entrega el dataset crudo ANTES de mapear a páginas: son los datos que se pagaron, y sin
  // esto se pierden al terminar el proceso.
  onDataset?.({
    keywords: enriched,
    clusters: clusters.map((c) => ({
      head: c.members[0]!.keyword,
      members: c.members.map((m) => m.keyword),
    })),
  });

  // Paso 9 — Mapeo a páginas — sin costo externo
  const { pages, backlog } = mapClustersToPages(clusters, maxPages);
  log("map", `${pages.length} páginas · ${backlog.length} en backlog`);

  // Paso 10 — Contenido on-page (una llamada LLM por página)
  budget.assertCanSpend(pages.length * est.llmCall, "contenido on-page");
  await applyPageContent(pages, input.prompt, market);
  log("content", `contenido generado para ${pages.length} páginas`);

  // Corte final: si el gasto real superó el tope (la estimación se quedó corta), se avisa acá.
  budget.assertNotExceeded("fin del run");

  const breakdown = costMeter.breakdown;
  log(
    "cost",
    `total $${usdFromMicros(costMeter.totalMicros)} · ` +
      `DFS $${usdFromMicros(breakdown.dataforseo_micros)} · ` +
      `LLM $${usdFromMicros(breakdown.llm_generation_micros)} · ` +
      `emb $${usdFromMicros(breakdown.llm_embeddings_micros)}`,
  );
  if (costMeter.unpricedModels.length) {
    log("cost", `⚠️ sin tarifa: ${costMeter.unpricedModels.join(", ")} → el total es INCOMPLETO`);
  }

  // Paso 11 — Brief
  return assembleBrief({
    cliente: deriveCliente(input.prompt),
    market,
    pages,
    backlog,
    keywordsAnalizadas: enriched.length,
    calidadDatos,
    costeMicros: costMeter.totalMicros, // TODOS los proveedores (antes: solo DataForSEO)
    costeBreakdown: breakdown,
    modelosSinPrecio: costMeter.unpricedModels,
  });
}

/** Cabezas de cluster que se validan por SERP (debe coincidir con cluster.ts serpValidateTop). */
const CLUSTER_SERP_HEADS = 15;

function deriveCliente(prompt: string): string {
  return prompt.split(/[.,]/)[0]?.trim().slice(0, 80) ?? "Cliente";
}

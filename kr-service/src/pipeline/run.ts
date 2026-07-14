import { randomUUID } from "node:crypto";
import { config, MARKET_ES } from "../config.js";
import { canonicalKey, dedupeByCanonical } from "../lib/text.js";
import { CostMeter, currentMeter, usdFromMicros, withCostMeter } from "../lib/cost.js";
import { Budget, BudgetExceededError, estimateEnrichment } from "../lib/budget.js";
import { CachedProvider, getProvider } from "../dataforseo/index.js";
import type { ProviderTaskLog } from "../dataforseo/task-log.js";
import type { KeywordCache } from "../dataforseo/cache.js";
import { getEmbedder } from "../llm/index.js";
import { generateSeeds } from "../llm/seeds.js";
import { WEIGHTS_DEFAULT } from "../types.js";
import type {
  DataQuality,
  EnrichedKeyword,
  KeywordResearchBrief,
  KeywordResearchInput,
  Market,
  ScoringWeights,
} from "../types.js";
import { scoreKeywords } from "./scoring.js";
import { CLUSTER_SIM_THRESHOLD_DEFAULT, clusterKeywords } from "./cluster.js";
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
  /** Config del run: sin esto el dataset no es reproducible ni comparable entre corridas. */
  run: {
    run_id: string;
    generated_at: string;
    market: Market;
    prompt: string;
    modelo_generacion: string;
    modelo_embeddings: string;
    sim_threshold: number;
    weights: ScoringWeights;
  };
  keywords: EnrichedKeyword[];
  clusters: Array<{ head: string; members: string[] }>;
}

/**
 * Checkpoint durable del dataset. Se ESPERA (async) y se invoca en cuanto los datos pagos existen.
 *
 * Antes el dataset solo se entregaba por callback síncrono y el CLI lo escribía DESPUÉS de que
 * `runResearch()` retornara: si el presupuesto abortaba, los embeddings fallaban o el corte final
 * saltaba, el proceso rechazaba y los datos por los que ya se le había pagado a DataForSEO
 * **se perdían enteros**. Ahora se persisten apenas se tienen.
 */
export type DatasetCheckpoint = (d: ResearchDataset) => void | Promise<void>;

/**
 * Lo que el pipeline necesita de afuera pero no debe CONOCER.
 *
 * `kr-service` sigue siendo una librería pura: no sabe que existe una base de datos. Conoce la
 * interfaz `ProviderTaskLog`, no su implementación — igual que con `KeywordCache`. El orquestador
 * le inyecta la que persiste en Postgres; un proceso suelto no le inyecta nada.
 */
export interface RunDeps {
  /** Registro de idempotencia de las peticiones FACTURABLES. Ver `dataforseo/task-log.ts`. */
  taskLog?: ProviderTaskLog;
  /**
   * La cache de respuestas del proveedor. Sin inyectar, cae en un archivo JSON local — que en un
   * despliegue con varias instancias no se comparte y se corrompe por escrituras concurrentes.
   * El orquestador inyecta la de Postgres, que SÍ se comparte entre todos los clientes.
   */
  cache?: KeywordCache;
}

/**
 * Pipeline del research. Corre en línea; la durabilidad (steps, reintentos, la compuerta humana)
 * la aporta el orquestador, que envuelve esta llamada — ver ADR-12.
 *
 * Cada run corre con su PROPIO medidor de costo, aislado por contexto async: dos runs concurrentes
 * en el mismo proceso ya no se pisan el gasto ni el presupuesto (#3).
 */
export function runResearch(
  input: KeywordResearchInput,
  onDataset?: DatasetCheckpoint,
  deps: RunDeps = {},
): Promise<KeywordResearchBrief> {
  return withCostMeter(new CostMeter(), () => runResearchInner(input, onDataset, deps));
}

async function runResearchInner(
  input: KeywordResearchInput,
  onDataset: DatasetCheckpoint | undefined,
  deps: RunDeps,
): Promise<KeywordResearchBrief> {
  const costMeter = currentMeter();
  const market = input.market ?? MARKET_ES;
  const weights = input.options?.weights ?? WEIGHTS_DEFAULT;
  const maxPages = input.options?.max_pages ?? 25;
  // Configurable (#9): el umbral estaba hardcodeado en cluster.ts, así que todos los verticales e
  // idiomas quedaban atados al 0.75 calibrado con UN dataset (restaurante en Madrid). Sigue siendo
  // el default, pero ahora se puede ajustar por run y queda registrado en el dataset.
  const simThreshold = input.options?.sim_threshold ?? CLUSTER_SIM_THRESHOLD_DEFAULT;
  const dfs = getProvider(deps.taskLog, deps.cache);
  const runId = randomUUID();
  const generatedAt = new Date().toISOString();

  const log = (step: string, msg: string) => console.log(`  [${step}] ${msg}`);

  // Costo y presupuesto del run (ADR-10). El medidor es EXCLUSIVO de este run (ya no hay reset de
  // un singleton compartido) y acumula TODOS los proveedores; el presupuesto estima cada fase ANTES
  // de ejecutarla y aborta si no entra en el remanente, en vez de descubrir el exceso ya gastado.
  const budget = new Budget(input.options?.max_cost_micros ?? null, costMeter);
  const est = budget.estimates;
  if (budget.enabled) {
    log("budget", `tope del run: $${usdFromMicros(input.options!.max_cost_micros!)}`);

    // Un modelo SIN tarifa suma 0 al medidor: el presupuesto lo ve gratis y nunca bloquea, o sea
    // que el tope queda silenciosamente desactivado mientras se gasta de verdad. Si hay tope, eso
    // no se tolera: se aborta ANTES de la primera llamada, no a mitad del run.
    //
    // Se consultan los modelos del proveedor REALMENTE activo. Antes se miraban siempre los de
    // OpenAI: con LLM_PROVIDER=anthropic, el chequeo pasaba (los modelos de OpenAI sí tienen tarifa)
    // mientras se gastaba con modelos de Claude que NO la tienen — el tope quedaba desactivado en
    // silencio, que es exactamente el agujero que este chequeo existe para cerrar.
    const sinTarifa = modelosFacturables().filter((m) => !costMeter.hasPriceFor(m));
    if (sinTarifa.length) {
      throw new BudgetExceededError(
        `Hay un tope de gasto activo pero no hay tarifa configurada para: ${sinTarifa.join(", ")}. ` +
          `Su costo contaría como 0 y el tope NO protegería nada. Cargá la tarifa en LLM_PRICES ` +
          `(JSON) o quitá el tope.`,
      );
    }
  }

  // Paso 2 — Seeds
  //
  // El dedupe va ACÁ, antes de cualquier llamada externa: el LLM devuelve seeds equivalentes con
  // frecuencia ("Pasta fresca Madrid" / "pasta fresca madrid"), y cada una disparaba su PROPIA
  // llamada de expansión facturada. Deduplicar después de expandir limpiaba el resultado pero la
  // llamada duplicada ya estaba pagada.
  budget.assertCanSpend(est.llmCall, "seeds");
  const seedsRaw = await generateSeeds(input.prompt, market);
  const seenSeed = new Set<string>();
  const seeds = seedsRaw.filter((s) => {
    const k = canonicalKey(s.keyword);
    if (!k || seenSeed.has(k)) return false;
    seenSeed.add(k);
    return true;
  });
  const seedDups = seedsRaw.length - seeds.length;
  log(
    "seeds",
    `${seeds.length} keywords semilla` + (seedDups > 0 ? ` (${seedDups} duplicada(s) descartada(s))` : ""),
  );

  // Paso 3 — Expansión (sugerencias) por cada seed.
  // El dedupe del universo también es por clave CANÓNICA: a DataForSEO se le paga por keyword.
  const toExpand = seeds.slice(0, 10);
  budget.assertCanSpend(toExpand.length * est.dfsSuggestions, "expansión");
  const raw: string[] = seeds.map((s) => s.keyword);
  for (const s of toExpand) {
    // Chequeo ANTES DE CADA LLAMADA, no solo antes de la fase: si la estimación de la fase se
    // quedó corta, el bucle seguía gastando hasta terminar las 10 llamadas. Ahora corta en la
    // primera que no entre en el remanente.
    budget.assertCanSpend(est.dfsSuggestions, "expansión");
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

  // Paso 4 — Enriquecimiento (volumen + dificultad).
  // La estimación escala con la cantidad de keywords: el costo de estas tasks depende de cuántas
  // se mandan, y una estimación fija hacía que el tope no protegiera en runs grandes.
  budget.assertCanSpend(estimateEnrichment(est, keywords.length), "enriquecimiento");
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

  // CHECKPOINT 1 — los datos caros ya están pagados: se persisten AHORA.
  //
  // Todo lo que sigue (intención, relevancia, clustering, contenido) puede fallar o ser abortado
  // por el presupuesto. Si el dataset se entregara recién al final, un aborto tiraría a la basura
  // los ~$0.25 de DataForSEO que ya se gastaron. Esto es lo que hace que el tuning posterior sea
  // gratis incluso cuando el run no llega a terminar.
  const snapshot = (clusters: Array<{ head: string; members: string[] }> = []): ResearchDataset => ({
    run: {
      run_id: runId,
      generated_at: generatedAt,
      market,
      prompt: input.prompt,
      modelo_generacion: config.openai.generationModel,
      modelo_embeddings: config.openai.embeddingModel,
      sim_threshold: simThreshold,
      weights,
    },
    keywords: enriched,
    clusters,
  });
  await onDataset?.(snapshot());

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
  const clusters = await clusterKeywords(enriched, getEmbedder(), dfs, market, { simThreshold });
  log("cluster", `${clusters.length} clusters`);

  // CHECKPOINT 2 — se actualiza el dataset con el scoring y los clusters ya calculados.
  await onDataset?.(
    snapshot(
      clusters.map((c) => ({
        head: c.members[0]!.keyword,
        members: c.members.map((m) => m.keyword),
      })),
    ),
  );

  // Paso 9 — Mapeo a páginas — sin costo externo
  const { pages, backlog } = mapClustersToPages(clusters, maxPages);
  log("map", `${pages.length} páginas · ${backlog.length} en backlog`);

  // Paso 10 — Contenido on-page (una llamada LLM por página).
  // El preflight cubre la fase entera, y además se re-chequea antes de CADA página: si la
  // estimación se queda corta, el bucle corta en vez de seguir pagando el resto.
  budget.assertCanSpend(pages.length * est.llmCall, "contenido on-page");
  await applyPageContent(pages, input.prompt, market, () =>
    budget.assertCanSpend(est.llmCall, "contenido on-page"),
  );
  log("content", `contenido generado para ${pages.length} páginas`);

  // Corte final: si el gasto real superó el tope (la estimación se quedó corta), se avisa acá.
  budget.assertNotExceeded("fin del run");

  // La cache persiste en cada `setMany`, no acá: si el run se cae a mitad, lo que YA se pagó tiene
  // que quedar guardado igual. Es la misma lección del checkpoint del dataset.
  if (dfs instanceof CachedProvider) {
    const { hits, misses } = dfs.stats;
    const total = hits + misses;
    if (total > 0) {
      const pctHit = Math.round((hits / total) * 100);
      log("cache", `${hits}/${total} consultas servidas desde cache (${pctHit}%) · ${misses} pagadas`);
    }
  }

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
    runId,
    generatedAt,
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

/**
 * Los modelos que este run va a FACTURAR de verdad, según el proveedor activo (ADR-09).
 *
 * El preflight del presupuesto los necesita para negarse a arrancar si alguno no tiene tarifa: un
 * modelo sin tarifa suma 0 al medidor, así que el tope lo ve gratis y nunca bloquea. Mirar siempre
 * los de OpenAI hacía que, con Anthropic, el chequeo pasara mientras se gastaba a ciegas.
 *
 * Los embeddings son de OpenAI en los dos casos (ADR-09), salvo que no haya key y caiga a mock.
 */
function modelosFacturables(): string[] {
  const modelos: string[] = [];

  if (config.llm.provider === "anthropic" && config.anthropic.hasKey) {
    modelos.push(config.anthropic.generationModel, config.anthropic.classificationModel);
  } else if (config.llm.provider === "openai" && config.openai.hasKey) {
    modelos.push(config.openai.generationModel);
  }
  // mock no factura nada.

  if (config.llm.embeddingProvider === "openai") modelos.push(config.openai.embeddingModel);

  return [...new Set(modelos.filter(Boolean))];
}

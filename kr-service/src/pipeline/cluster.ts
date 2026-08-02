import type { KeywordDataProvider } from "../dataforseo/index.js";
import type { SerpResultado } from "../dataforseo/provider.js";
import type { Embedder } from "../llm/index.js";
import type { EnrichedKeyword, Market } from "../types.js";
import { cosine, overlapCount } from "../lib/vector.js";

export interface Cluster {
  members: EnrichedKeyword[]; // ordenados: head primero (mayor opportunity_score)
}

export interface ClusterOptions {
  simThreshold: number; // coseno mínimo para unir a un cluster
  serpOverlapMin: number; // URLs compartidas para fusionar cabezas (default 3)
  serpValidateTop: number; // cuántas cabezas validar por SERP (control de costo)
}

/**
 * simThreshold 0.75 — calibrado contra el primer dataset REAL de DataForSEO (60 keywords,
 * restaurante italiano en Madrid), barriendo 0.55…0.85 sobre las keywords persistidas.
 *
 * El 0.55 original era demasiado permisivo para keywords locales cortas: todas comparten
 * "madrid" + "italiano", así que el coseno las une casi todas. En el dataset real colapsaba
 * 41 de 45 keywords vivas en UN cluster, fusionando "pasta fresca", "pizza napolitana" y
 * "restaurante italiano centro" —tres páginas comercialmente distintas— en una sola. Resultado:
 * 3 páginas propuestas en vez de 8.
 *
 * A 0.75 las cabezas caen sobre las especialidades reales del negocio. Por encima de 0.85 se
 * fragmenta (separa variantes de la misma keyword).
 *
 * Re-calibrar con `datasets/keywords.json` si cambia el vertical o el modelo de embeddings.
 */
export const CLUSTER_SIM_THRESHOLD_DEFAULT = 0.75;

const DEFAULTS: ClusterOptions = {
  simThreshold: CLUSTER_SIM_THRESHOLD_DEFAULT,
  serpOverlapMin: 3,
  serpValidateTop: 15,
};

/**
 * Se invoca por cada cabeza cuyo SERP se consultó, con la señal cruda.
 *
 * El clustering es **el único punto del pipeline donde se mira un SERP**, y esa consulta ya está
 * pagada. Sin este callback, la señal de map pack moriría acá dentro y refinar `is_local` exigiría
 * pedir los SERP otra vez. Mismo patrón que el `beforeEach` de `applyPageContent`: el llamador
 * decide qué hacer con lo que pasa dentro del bucle, sin que el bucle sepa de qué se trata.
 *
 * Un SERP que falló también se reporta, con `{ urls: [], mapPack: null }`: "no se pudo observar" es
 * información, y perderla haría indistinguible el fallo del "no hay map pack".
 */
export type SerpObserver = (keyword: string, resultado: SerpResultado) => void;

/**
 * Clustering híbrido (ver plan §Paso 6):
 * 1) Semántico: greedy por similitud coseno de embeddings (barato, cubre todo).
 * 2) Validación SERP: solo para las cabezas top; si comparten URLs, se fusionan.
 * Reemplaza al agrupado naive por tokens del v0.
 */
export async function clusterKeywords(
  kws: EnrichedKeyword[],
  embedder: Embedder,
  provider: KeywordDataProvider,
  market: Market,
  opts: Partial<ClusterOptions> = {},
  /** Ver `SerpObserver`. El tipo de retorno NO cambia: esto es una salida lateral, no un resultado. */
  onSerp?: SerpObserver,
): Promise<Cluster[]> {
  const o = { ...DEFAULTS, ...opts };
  const active = kws.filter((k) => !k.discarded);
  if (active.length === 0) return [];

  // Orden por score desc → las de mayor oportunidad son cabezas.
  const ordered = [...active].sort(
    (a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0),
  );
  const vectors = await embedder.embed(ordered.map((k) => k.keyword));

  // 1) Greedy semántico.
  const clusters: { head: number; members: number[] }[] = [];
  const assigned = new Array<boolean>(ordered.length).fill(false);
  for (let i = 0; i < ordered.length; i++) {
    if (assigned[i]) continue;
    const members = [i];
    assigned[i] = true;
    for (let j = i + 1; j < ordered.length; j++) {
      if (assigned[j]) continue;
      if (cosine(vectors[i]!, vectors[j]!) >= o.simThreshold) {
        members.push(j);
        assigned[j] = true;
      }
    }
    clusters.push({ head: i, members });
  }

  // 2) Validación SERP: fusiona cabezas cercanas que comparten resultados.
  // Resiliente (#11): si el SERP de una cabeza falla, se sigue con las demás. Antes, un solo
  // fallo abortaba TODA la corrida; ahora esa cabeza simplemente no se valida (queda sin fusionar,
  // que es el comportamiento conservador: no se agrupa lo que no se pudo confirmar).
  const topHeads = clusters.slice(0, o.serpValidateTop);
  const serps = new Map<number, string[]>();
  let serpFailures = 0;
  for (const c of topHeads) {
    const keyword = ordered[c.head]!.keyword;
    try {
      const r = await provider.serp(keyword, market);
      serps.set(c.head, r.urls);
      onSerp?.(keyword, r);
    } catch (e) {
      serpFailures++;
      serps.set(c.head, []); // sin URLs → overlap 0 → no fusiona
      // `mapPack: null`, no `false`: no se observó nada. Reportar `false` acá le diría al
      // refinamiento "Google no considera local esta búsqueda" sin haberla mirado.
      onSerp?.(keyword, { urls: [], mapPack: null });
      console.warn(`  [cluster] aviso SERP "${keyword}": ${(e as Error).message}`);
    }
  }
  if (serpFailures > 0) {
    console.warn(
      `  [cluster] ${serpFailures}/${topHeads.length} SERP fallaron → esas cabezas no se validaron.`,
    );
  }
  const merged = new Set<number>();
  for (let a = 0; a < topHeads.length; a++) {
    if (merged.has(a)) continue;
    for (let b = a + 1; b < topHeads.length; b++) {
      if (merged.has(b)) continue;
      const overlap = overlapCount(serps.get(topHeads[a]!.head)!, serps.get(topHeads[b]!.head)!);
      if (overlap >= o.serpOverlapMin) {
        topHeads[a]!.members.push(...topHeads[b]!.members);
        merged.add(b);
      }
    }
  }
  const finalClusters = clusters.filter((_, idx) => !(idx < topHeads.length && merged.has(idx)));

  // Materializar → keywords, head primero.
  return finalClusters.map((c) => ({
    members: c.members
      .map((idx) => ordered[idx]!)
      .sort((x, y) => (y.opportunity_score ?? 0) - (x.opportunity_score ?? 0)),
  }));
}

import type { KeywordDataProvider } from "../dataforseo/index.js";
import type { Embedder } from "../llm/index.js";
import type { EnrichedKeyword, Market } from "../types.js";
import { cosine, overlapCount } from "../lib/vector.js";

export interface Cluster {
  members: EnrichedKeyword[]; // ordenados: head primero (mayor opportunity_score)
}

export interface ClusterOptions {
  simThreshold: number; // coseno mínimo para unir a un cluster (default 0.55)
  serpOverlapMin: number; // URLs compartidas para fusionar cabezas (default 3)
  serpValidateTop: number; // cuántas cabezas validar por SERP (control de costo)
}

const DEFAULTS: ClusterOptions = { simThreshold: 0.55, serpOverlapMin: 3, serpValidateTop: 15 };

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
  const topHeads = clusters.slice(0, o.serpValidateTop);
  const serps = new Map<number, string[]>();
  for (const c of topHeads) {
    serps.set(c.head, await provider.serp(ordered[c.head]!.keyword, market));
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

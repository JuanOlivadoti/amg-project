// Módulo 2 — Keyword Research · tipos (mirror de docs/modulo-2-esquema/types.ts, v0.2).
// Fuente de diseño: ../docs/modulo-2-esquema/. Acá viven los tipos de implementación.

/*
 * Los tipos del CONTRATO del brief viven en el paquete `contrato` (KR-2a): los comparten el M2 (que los
 * emite), el M1 (que los recibe) y la API (que renderiza el informe). Acá se re-exportan para no tocar
 * los ~20 imports que ya apuntaban a este archivo — pero este archivo ya NO los define.
 *
 * Lo que sigue viviendo acá es lo INTERNO del pipeline: pesos de scoring, la entrada del research y las
 * keywords enriquecidas. Nada de eso cruza la frontera del módulo.
 */
export { SCHEMA_VERSION } from "contrato";
export type {
  Market,
  SearchIntent,
  PageType,
  PageStrategy,
  PageEvidence,
  DataQuality,
  PageSeo,
  ContentBrief,
  ProposedPage,
  KeywordResearchBrief,
} from "contrato";

// Un `export ... from` re-exporta pero NO crea un binding local, así que los tipos internos de abajo
// que mencionan `Market` o `SearchIntent` necesitan importarlos además de reenviarlos.
import type { Market, SearchIntent } from "contrato";

export interface ScoringWeights {
  volume: number;
  difficulty: number;
  intent: number;
  business: number;
}

export const WEIGHTS_DEFAULT: ScoringWeights = {
  volume: 0.3,
  difficulty: 0.3,
  intent: 0.2,
  business: 0.2,
};

export interface KeywordResearchInput {
  prompt: string;
  market?: Market;
  options?: {
    max_pages?: number;
    max_cost_micros?: number;
    /** Umbral de coseno del clustering. Default 0.75 (calibrado con datos reales, ver cluster.ts). */
    sim_threshold?: number;
    weights?: ScoringWeights;
  };
}

export interface Seed {
  keyword: string;
  service?: string;
  intent_hint?: SearchIntent;
}

export interface MonthlyTrend {
  year: number;
  month: number;
  volume: number;
}

export interface EnrichedKeyword {
  keyword: string;
  source: "seed" | "suggestion" | "related" | "ideas";
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  trend: MonthlyTrend[] | null;
  intent: SearchIntent | null;
  is_local: boolean;
  business_relevance: number | null;
  opportunity_score: number | null;
  score_confidence: number | null;
  cluster_id: string | null;
  discarded: boolean;
  discard_reason?: string;
}

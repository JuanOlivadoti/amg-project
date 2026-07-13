// Módulo 2 — Keyword Research · tipos (mirror de docs/modulo-2-esquema/types.ts, v0.2).
// Fuente de diseño: ../docs/modulo-2-esquema/. Acá viven los tipos de implementación.

export const SCHEMA_VERSION = "kr.v0.2";

export interface Market {
  country: string; // ISO-3166-1 alpha-2
  language_code: string; // ISO-639-1
  location_code: number; // código DataForSEO (ES = 2724)
}

export type SearchIntent =
  | "transactional"
  | "commercial"
  | "local"
  | "informational"
  | "navigational";

export type PageType = "servicio" | "landing_local" | "blog" | "institucional";
export type PageStrategy = "single" | "hub_spoke" | "merge" | "backlog";

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

export interface PageSeo {
  meta_title: string;
  meta_description: string;
  schema_type: "LocalBusiness" | "Article" | "FAQPage" | "WebPage";
  canonical: string;
}

export interface ContentBrief {
  h1: string;
  secciones_sugeridas: string[];
  word_count_objetivo: number;
  enlazado_interno: string[];
  cta?: string;
  tono?: string;
  claims_permitidos?: string[];
  claims_prohibidos?: string[];
  competidores_serp?: string[];
}

export interface ProposedPage {
  cluster_id: string;
  tipo: PageType;
  page_strategy: PageStrategy;
  url_slug: string;
  keyword_principal: string;
  keywords_secundarias: string[];
  intencion: SearchIntent;
  local: boolean;
  volumen: number;
  dificultad: number;
  opportunity_score: number;
  score_confidence: number;
  seo: PageSeo;
  content_brief: ContentBrief;
  preguntas_frecuentes: string[];
  approved: boolean;
}

export interface KeywordResearchBrief {
  schema_version: string;
  run_id: string;
  cliente: string;
  market: Market;
  generated_at: string;
  status: "pending_approval" | "approved" | "rejected";
  paginas_propuestas: ProposedPage[];
  backlog: Array<{ keyword_principal: string; opportunity_score: number }>;
  meta_run: {
    keywords_analizadas: number;
    paginas_propuestas: number;
    coste_micros_usd: number;
  };
}

// Módulo 2 — Keyword Research · Esquema tipo v0.2 (ES-first) — post-review Codex
// Cambios v0.2: schema_version en el brief; intención sin compuestos (intent + is_local);
// score_confidence; page_strategy; contrato editorial en content_brief.
// Sigue siendo v0: se afina tras las pruebas. Recomendación: validar el brief con Zod.

export const SCHEMA_VERSION = "kr.v0.2";

/** Mercado objetivo. Arrancamos solo con ES; el campo existe para no hardcodear idioma. */
export interface Market {
  country: string;        // ISO-3166-1 alpha-2, ej. "ES"
  language_code: string;  // ISO-639-1, ej. "es"
  location_code: number;  // código de ubicación DataForSEO, ej. 2724 (España)
}

export const MARKET_ES: Market = { country: "ES", language_code: "es", location_code: 2724 };

/** Intención de búsqueda (single). La localidad va aparte en `is_local`. */
export type SearchIntent =
  | "transactional"
  | "commercial"
  | "local"
  | "informational"
  | "navigational";

/** Tipo de página que se propone crear. */
export type PageType = "servicio" | "landing_local" | "blog" | "institucional";

/** Estrategia de página para un cluster (default: single). */
export type PageStrategy = "single" | "hub_spoke" | "merge" | "backlog";

/* ---------- INPUT: disparar un research ---------- */

export interface KeywordResearchInput {
  prompt: string;          // descripción del negocio
  market?: Market;         // default MARKET_ES (1 run = 1 market)
  options?: {
    max_pages?: number;        // default 25
    max_cost_micros?: number;  // presupuesto preflight; corta si se supera
    weights?: ScoringWeights;  // default WEIGHTS_DEFAULT
  };
}

export interface ScoringWeights {
  volume: number;      // w_v
  difficulty: number;  // w_d
  intent: number;      // w_i
  business: number;    // w_b (además actúa como gate/cap, ver plan §7)
}

export const WEIGHTS_DEFAULT: ScoringWeights = {
  volume: 0.30, difficulty: 0.30, intent: 0.20, business: 0.20,
};

/* ---------- KEYWORD enriquecida ---------- */

export interface MonthlyTrend { year: number; month: number; volume: number; }

export interface EnrichedKeyword {
  keyword: string;
  source: "seed" | "suggestion" | "related" | "ideas";
  volume: number | null;
  difficulty: number | null;          // 0..100
  cpc: number | null;
  competition: number | null;         // 0..1
  trend: MonthlyTrend[] | null;
  intent: SearchIntent | null;
  is_local: boolean;                  // modificador local (intención compuesta)
  business_relevance: number | null;  // 0..1 (LLM); actúa como gate/cap en el scoring
  opportunity_score: number | null;   // 0..100
  score_confidence: number | null;    // 0..1 (penaliza datos faltantes)
  cluster_id: string | null;
  discarded: boolean;
  discard_reason?: string;
}

/* ---------- CLUSTER ---------- */

export interface KeywordCluster {
  id: string;
  label: string;
  intent: SearchIntent;
  is_local: boolean;
  page_type: PageType;
  page_strategy: PageStrategy;
  primary_keyword: string;
  aggregate_score: number;      // 0..100
  serp_overlap_urls?: string[]; // URLs compartidas (canonicalizadas) que justifican fusionar
}

/* ---------- PÁGINA propuesta (unidad que consume el Módulo 1) ---------- */

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
  enlazado_interno: string[];        // slugs internos sugeridos
  // Contrato editorial/legal (importante en salud/gastronomía):
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
  intencion: SearchIntent;           // single; la localidad va en `local`
  local: boolean;
  volumen: number;
  dificultad: number;                // 0..100
  opportunity_score: number;         // 0..100
  score_confidence: number;          // 0..1
  seo: PageSeo;
  content_brief: ContentBrief;
  preguntas_frecuentes: string[];
  approved: boolean;
}

/* ---------- OUTPUT: el brief completo ---------- */

export interface KeywordResearchBrief {
  schema_version: string;       // = SCHEMA_VERSION
  run_id: string;
  cliente: string;
  market: Market;
  generated_at: string;         // ISO-8601
  status: "pending_approval" | "approved" | "rejected";
  paginas_propuestas: ProposedPage[];
  backlog: Array<{ keyword_principal: string; opportunity_score: number }>;
  meta_run: {
    keywords_analizadas: number;
    paginas_propuestas: number;
    coste_micros_usd: number;
  };
}

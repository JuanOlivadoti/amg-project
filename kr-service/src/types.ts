// Módulo 2 — Keyword Research · tipos (mirror de docs/modulo-2-esquema/types.ts, v0.2).
// Fuente de diseño: ../docs/modulo-2-esquema/. Acá viven los tipos de implementación.

// v0.3: `coste_micros_usd` pasa a incluir TODOS los proveedores (antes: solo DataForSEO)
// y se añade `coste_breakdown`. Cambio semántico → bump de versión.
// v0.4: `volumen` y `dificultad` pasan a ser nullable. Antes un dato faltante se escribía como 0,
// que el consumidor no podía distinguir de un 0 real. Cambio de contrato → sube la versión.
// v0.5: cada página declara su `evidencia` (¿está respaldada por datos de mercado o no?) y el
// brief reporta la `calidad_datos` del run. Sin esto, una página basada en CERO datos se
// presentaba junto a una validada, indistinguibles para quien aprueba.
export const SCHEMA_VERSION = "kr.v0.5";

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
/** Ver `ProposedPage.evidencia`. */
export type PageEvidence = "datos_mercado" | "sin_validar";

/**
 * Cobertura real de los datos de mercado del run.
 *
 * El pipeline degrada con elegancia ante un fallo de DataForSEO (catch → null y sigue), lo cual
 * está bien... salvo que el fallo se volvía INVISIBLE: el brief salía igual de confiado, con
 * páginas basadas en cero datos. Esto lo hace explícito y auditable.
 */
export interface DataQuality {
  /** Fracción de keywords con volumen conocido (0..1). */
  cobertura_volumen: number;
  /** Fracción de keywords con dificultad conocida (0..1). */
  cobertura_kd: number;
  /** Endpoints de pago que fallaron ENTEROS (no devolvieron nada). */
  endpoints_degradados: string[];
}

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
  /** `null` = el proveedor no devolvió el dato (≠ 0 búsquedas/mes). */
  volumen: number | null;
  /** `null` = el proveedor no devolvió el dato (≠ dificultad 0). */
  dificultad: number | null;
  /**
   * ¿Esta página está respaldada por datos de mercado, o es una apuesta sin validar?
   *
   * - `datos_mercado`: la keyword principal, o alguna del cluster, tiene volumen real.
   * - `sin_validar`: NINGUNA keyword del cluster tiene volumen. La página puede ser legítima
   *   (suele ser un servicio que el propio negocio declaró), pero **no hay evidencia de que
   *   alguien la busque**. No es lo mismo, y quien aprueba tiene que poder distinguirlo.
   *
   * Las `sin_validar` NUNCA se ordenan por encima de las que tienen datos.
   */
  evidencia: PageEvidence;
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
    /** Cobertura real de los datos de mercado. Un fallo de DataForSEO deja de ser invisible. */
    calidad_datos: DataQuality;
    /** Costo TOTAL del run (DataForSEO + LLM), en micros de USD. */
    coste_micros_usd: number;
    /** Desglose por proveedor: permite ver dónde se va el gasto. */
    coste_breakdown: {
      dataforseo_micros: number;
      llm_generation_micros: number;
      llm_embeddings_micros: number;
    };
    /** Modelos usados sin tarifa configurada → el total está INCOMPLETO (no se inventa el costo). */
    modelos_sin_precio?: string[];
  };
}

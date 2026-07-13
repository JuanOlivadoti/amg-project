// Validación del brief con Zod (recomendación de la review Codex).
// Es la "validación" del pipeline: garantiza que la salida cumple el contrato v0.2.
import { z } from "zod";

const marketSchema = z.object({
  country: z.string(),
  language_code: z.string(),
  location_code: z.number().int(),
});

const searchIntent = z.enum([
  "transactional",
  "commercial",
  "local",
  "informational",
  "navigational",
]);

const pageSeo = z.object({
  meta_title: z.string().min(1),
  meta_description: z.string().min(1),
  schema_type: z.enum(["LocalBusiness", "Article", "FAQPage", "WebPage"]),
  canonical: z.string(),
});

const contentBrief = z.object({
  h1: z.string().min(1),
  secciones_sugeridas: z.array(z.string()),
  word_count_objetivo: z.number().int().positive(),
  enlazado_interno: z.array(z.string()),
  cta: z.string().optional(),
  tono: z.string().optional(),
  claims_permitidos: z.array(z.string()).optional(),
  claims_prohibidos: z.array(z.string()).optional(),
  competidores_serp: z.array(z.string()).optional(),
});

const proposedPage = z.object({
  cluster_id: z.string(),
  tipo: z.enum(["servicio", "landing_local", "blog", "institucional"]),
  page_strategy: z.enum(["single", "hub_spoke", "merge", "backlog"]),
  url_slug: z.string().startsWith("/"),
  keyword_principal: z.string().min(1),
  keywords_secundarias: z.array(z.string()),
  intencion: searchIntent,
  local: z.boolean(),
  volumen: z.number().int().nonnegative().nullable(),
  dificultad: z.number().min(0).max(100).nullable(),
  // v0.5: ¿la página está respaldada por datos de mercado o es una apuesta sin validar?
  evidencia: z.enum(["datos_mercado", "sin_validar"]),
  opportunity_score: z.number().min(0).max(100),
  score_confidence: z.number().min(0).max(1),
  seo: pageSeo,
  content_brief: contentBrief,
  preguntas_frecuentes: z.array(z.string()),
  approved: z.boolean(),
});

export const briefSchema = z.object({
  schema_version: z.string(),
  run_id: z.string(),
  cliente: z.string(),
  market: marketSchema,
  generated_at: z.string(),
  status: z.enum(["pending_approval", "approved", "rejected"]),
  paginas_propuestas: z.array(proposedPage),
  backlog: z.array(
    z.object({ keyword_principal: z.string(), opportunity_score: z.number() }),
  ),
  meta_run: z.object({
    keywords_analizadas: z.number().int().nonnegative(),
    paginas_propuestas: z.number().int().nonnegative(),
    // v0.5: cobertura real de los datos. Un fallo de DataForSEO deja de ser invisible.
    calidad_datos: z.object({
      cobertura_volumen: z.number().min(0).max(1),
      cobertura_kd: z.number().min(0).max(1),
      endpoints_degradados: z.array(z.string()),
    }),
    // v0.3: total de TODOS los proveedores (antes solo DataForSEO) + desglose.
    coste_micros_usd: z.number().int().nonnegative(),
    coste_breakdown: z.object({
      dataforseo_micros: z.number().int().nonnegative(),
      llm_generation_micros: z.number().int().nonnegative(),
      llm_embeddings_micros: z.number().int().nonnegative(),
    }),
    modelos_sin_precio: z.array(z.string()).optional(),
  }),
});

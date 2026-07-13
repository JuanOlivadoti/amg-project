import { z } from "zod";
import type { BusinessProfile, KrBrief } from "./types.js";

/**
 * Contrato de handoff validado en runtime (ADR-06/07). El brief del M2 es una frontera
 * externa: puede venir de otra versión del pipeline, de edición humana o de JSON corrupto.
 * Validamos con Zod ANTES de generar/publicar y rechazamos versiones no soportadas.
 *
 * TODO (Fase 2): extraer estos esquemas a un paquete compartido entre M2 y M1 para una
 * sola fuente de verdad (el M2 ya valida su salida con Zod en kr-service).
 */
// v0.3 solo cambia `meta_run` (costo total + desglose), que el M1 no consume → compatible.
export const SUPPORTED_SCHEMA_VERSIONS = ["kr.v0.2", "kr.v0.3", "kr.v0.4"] as const;

const schemaTypeSchema = z.enum(["LocalBusiness", "Article", "FAQPage", "WebPage"]);
const pageTypeSchema = z.enum(["servicio", "landing_local", "blog", "institucional"]);
const intentSchema = z.enum([
  "transactional",
  "commercial",
  "local",
  "informational",
  "navigational",
]);

const proposedPageSchema = z.object({
  cluster_id: z.string(),
  tipo: pageTypeSchema,
  url_slug: z.string().min(1),
  keyword_principal: z.string().min(1),
  keywords_secundarias: z.array(z.string()),
  intencion: intentSchema,
  local: z.boolean(),
  // Nullable desde kr.v0.4: `null` = el proveedor no devolvió la métrica (≠ 0).
  // Los briefs kr.v0.2/v0.3 traen number y siguen validando.
  volumen: z.number().nullable(),
  dificultad: z.number().nullable(),
  opportunity_score: z.number(),
  seo: z.object({
    meta_title: z.string(),
    meta_description: z.string(),
    schema_type: schemaTypeSchema,
    canonical: z.string(),
  }),
  content_brief: z.object({
    h1: z.string(),
    secciones_sugeridas: z.array(z.string()),
    word_count_objetivo: z.number(),
    enlazado_interno: z.array(z.string()),
    cta: z.string().optional(),
    tono: z.string().optional(),
    claims_permitidos: z.array(z.string()).optional(),
    claims_prohibidos: z.array(z.string()).optional(),
    competidores_serp: z.array(z.string()).optional(),
  }),
  preguntas_frecuentes: z.array(z.string()),
  approved: z.boolean(),
});

const briefSchema = z.object({
  schema_version: z.string(),
  cliente: z.string(),
  market: z.object({
    country: z.string(),
    language_code: z.string(),
    location_code: z.number(),
  }),
  status: z.enum(["pending_approval", "approved", "rejected"]),
  paginas_propuestas: z.array(proposedPageSchema),
});

/** Valida y tipa el brief. Lanza con un mensaje claro si la forma o la versión no cuadran. */
export function parseBrief(raw: unknown): KrBrief {
  const parsed = briefSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Brief inválido: ${formatIssues(parsed.error)}`);
  }
  const version = parsed.data.schema_version;
  if (!SUPPORTED_SCHEMA_VERSIONS.includes(version as (typeof SUPPORTED_SCHEMA_VERSIONS)[number])) {
    throw new Error(
      `schema_version "${version}" no soportada. Soportadas: ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}. ` +
        `Actualizá el adaptador o migrá el brief.`,
    );
  }
  return parsed.data as KrBrief;
}

const postalAddressSchema = z.object({
  streetAddress: z.string(),
  addressLocality: z.string(),
  postalCode: z.string(),
  addressRegion: z.string().optional(),
  addressCountry: z.string().optional(),
});

const businessProfileSchema = z.object({
  name: z.string().min(1),
  telephone: z.string().optional(),
  priceRange: z.string().optional(),
  url: z.string().url().optional(),
  image: z.string().url().optional(),
  address: postalAddressSchema.optional(),
  opening_hours: z.string().optional(),
});

/** Valida el perfil de negocio. Lanza si el JSON existe pero está mal formado. */
export function parseProfile(raw: unknown): BusinessProfile {
  const parsed = businessProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`business-profile.json inválido: ${formatIssues(parsed.error)}`);
  }
  return parsed.data as BusinessProfile;
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("; ");
}

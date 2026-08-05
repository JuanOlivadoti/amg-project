/*
 * DOS validadores, UNA base. No son dos copias del mismo contrato: son dos contratos con propósitos
 * opuestos, y por eso NO se fusionan (lo confirmó la 14ª review).
 *
 *  · `emisionM2` valida LO QUE EL M2 PRODUCE: estricto, versión actual, todos los campos.
 *  · `consumoM1` valida LO QUE EL M1 PUEDE RECIBIR: laxo, cuatro `schema_version`, con `evidencia` y
 *    `score_confidence` opcionales para no rechazar briefs viejos que siguen siendo publicables.
 *
 * Fusionarlos obliga a que uno pierda su garantía: o el M1 deja de aceptar briefs históricos, o el M2
 * deja de exigir campos que hoy exige. Lo que se comparte es `esquemaBase` y los tipos.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------------------------
// `esquemaBase` — el piso común de los dos validadores.
//
// Es el MÍNIMO que los dos aceptan, no el máximo, y esa dirección es una decisión: en Zod endurecer
// es aditivo (`.extend()` con la restricción encima) mientras aflojar obliga a redeclarar el campo
// entero. Con el piso laxo, cada exigencia del M2 queda ESCRITA como un `.extend()` explícito y la
// diferencia entre los dos contratos se lee en un solo lugar. Al revés —base estricta, consumo que
// afloja— cada exigencia nueva del M2 se le colaría al M1 en silencio y le haría rechazar briefs
// históricos que hoy publica.
//
// Lo que vive acá es lo que NO puede divergir entre emisión y consumo: el vocabulario cerrado (los
// enums) y la forma de los objetos anidados. Un valor de enum que se agregue en un lado y no en el
// otro es un brief que el M2 emite y el M1 rechaza, o peor, un campo que Zod DESCARTA al parsear.
// ---------------------------------------------------------------------------------------------

/** `location_code` sin `.int()`: el M2 lo exige entero, el M1 nunca lo hizo. */
const market = z.object({
  country: z.string(),
  language_code: z.string(),
  location_code: z.number(),
});

const searchIntent = z.enum([
  "transactional",
  "commercial",
  "local",
  "informational",
  "navigational",
]);

const pageType = z.enum(["servicio", "landing_local", "blog", "institucional"]);

/**
 * `schema_type` es una decisión SEPARADA del tipo de página: declarar `LocalBusiness` es afirmarle a
 * Google que la página ES la ficha de un negocio físico. La allowlist es el freno.
 */
const schemaType = z.enum(["LocalBusiness", "Article", "FAQPage", "WebPage"]);

/** v0.5: ¿la página está respaldada por datos de mercado o es una apuesta sin validar? */
const evidencia = z.enum(["datos_mercado", "sin_validar"]);

const estado = z.enum(["pending_approval", "approved", "rejected"]);

const seo = z.object({
  meta_title: z.string(),
  meta_description: z.string(),
  schema_type: schemaType,
  canonical: z.string(),
});

const contentBrief = z.object({
  h1: z.string(),
  secciones_sugeridas: z.array(z.string()),
  word_count_objetivo: z.number(),
  enlazado_interno: z.array(z.string()),
  cta: z.string().optional(),
  tono: z.string().optional(),
  claims_permitidos: z.array(z.string()).optional(),
  claims_prohibidos: z.array(z.string()).optional(),
  competidores_serp: z.array(z.string()).optional(),
});

/**
 * Las piezas compartidas, expuestas para que el validador de consumo (`consumoM1`) derive de acá en
 * vez de copiarlas. Se exporta el objeto y no cada pieza para que agregar una no toque `index.ts`.
 */
export const esquemaBase = {
  market,
  searchIntent,
  pageType,
  schemaType,
  evidencia,
  estado,
  seo,
  contentBrief,
} as const;

// ---------------------------------------------------------------------------------------------
// `emisionM2` — lo que el M2 produce. Es la "validación" del pipeline: garantiza que la salida
// cumple el contrato antes de que el brief salga del proceso (recomendación de la review Codex).
//
// Cada restricción que se añade acá sobre el piso es una exigencia que el M1 NO impone a propósito.
// ---------------------------------------------------------------------------------------------

/** El M2 nunca emite un title/description vacío: los genera el LLM y se revisan en la compuerta. */
const seoM2 = seo.extend({
  meta_title: z.string().min(1),
  meta_description: z.string().min(1),
});

const contentBriefM2 = contentBrief.extend({
  h1: z.string().min(1),
  word_count_objetivo: z.number().int().positive(),
});

const paginaM2 = z.object({
  cluster_id: z.string(),
  tipo: pageType,
  // El M1 no valida `page_strategy` (la ignora): es información de cómo se decidió la página, no de
  // cómo se publica. El M2 sí la exige, porque es la que dice si la página va al backlog.
  page_strategy: z.enum(["single", "hub_spoke", "merge", "backlog"]),
  url_slug: z.string().startsWith("/"),
  keyword_principal: z.string().min(1),
  keywords_secundarias: z.array(z.string()),
  intencion: searchIntent,
  local: z.boolean(),
  // `null` = el proveedor no devolvió el dato (≠ 0 búsquedas/mes). Ver `ProposedPage.volumen`.
  volumen: z.number().int().nonnegative().nullable(),
  dificultad: z.number().min(0).max(100).nullable(),
  evidencia,
  opportunity_score: z.number().min(0).max(100),
  score_confidence: z.number().min(0).max(1),
  seo: seoM2,
  content_brief: contentBriefM2,
  preguntas_frecuentes: z.array(z.string()),
  approved: z.boolean(),
});

export const emisionM2 = z.object({
  schema_version: z.string(),
  run_id: z.string(),
  cliente: z.string(),
  market: market.extend({ location_code: z.number().int() }),
  generated_at: z.string(),
  status: estado,
  paginas_propuestas: z.array(paginaM2),
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

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
import type { KeywordResearchBrief } from "./tipos.js";

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
    //
    // `.nullable()` y NUNCA `.optional()`: la clave es obligatoria porque "no sé" es un valor que hay
    // que ESCRIBIR, no una ausencia que se pueda omitir. Con `.optional()`, un brief que simplemente
    // se olvidó de calcular la cobertura pasaría indistinguible de uno que declara no conocerla.
    // Ver `DataQuality` en tipos.ts para por qué `null` ≠ `0` y `null` ≠ `[]`.
    calidad_datos: z.object({
      cobertura_volumen: z.number().min(0).max(1).nullable(),
      cobertura_kd: z.number().min(0).max(1).nullable(),
      endpoints_degradados: z.array(z.string()).nullable(),
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

// ---------------------------------------------------------------------------------------------
// `consumoM1` — lo que el M1 puede RECIBIR. Es el esquema que vivía en `web-builder/src/contract.ts`,
// derivado del mismo piso: usa las piezas de `esquemaBase` (los enums, `seo`, `contentBrief`,
// `market`) sin endurecer NINGUNA.
//
// Cada laxitud de acá es deliberada, no un descuido: el brief que llega puede ser de una versión
// anterior del pipeline, venir de edición humana, o ser el que el orquestador RECONSTRUYE desde la
// base (que no trae `meta_run`). Un endurecimiento accidental no rompe un test: hace que el M1
// empiece a rechazar briefs que hoy publica.
//
// Lo que NO se comparte con `emisionM2` es la lista de campos de la página, escrita dos veces a
// propósito: de los 17 campos, 9 difieren (`page_strategy`, `url_slug`, `volumen`, `dificultad`,
// `opportunity_score`, `evidencia`, `score_confidence`, y `seo`/`content_brief` vía `.extend()`), así
// que una página base común obligaría a fusionar dos objetos mentalmente para saber qué garantiza cada
// validador — y la severidad del de emisión es la razón entera de que exista aparte.
//
// El riesgo de esa duplicación es olvidar un campo, que Zod entonces DESCARTA al parsear en silencio
// (es el bug histórico de `evidencia`). Lo que lo cubre: el test que exige que `evidencia` y
// `score_confidence` SOBREVIVAN al parseo, y el diferencial de 1101 casos contra el esquema viejo que
// se corrió al mudarlo, que compara el JSON de salida y no solo si acepta.
// ---------------------------------------------------------------------------------------------

// v0.3 solo cambia `meta_run` (costo total + desglose), que el M1 no consume → compatible.
// v0.4: `volumen`/`dificultad` nullable.
// v0.5: `evidencia` + `score_confidence` por página. Ambos OPCIONALES acá para no romper los
// briefs viejos, pero el M1 los usa para AVISAR: una página sin evidencia de mercado no puede
// llegar a publicarse sin que quien aprueba lo sepa.
export const SUPPORTED_SCHEMA_VERSIONS = ["kr.v0.2", "kr.v0.3", "kr.v0.4", "kr.v0.5"] as const;

const paginaM1 = z.object({
  cluster_id: z.string(),
  tipo: pageType,
  // `.min(1)` y no `.startsWith("/")` como el M2: exigirla acá rechazaría un brief que se publica
  // IGUAL, porque `normalizeSlug` (web-builder/src/handoff/adapter.ts) le saca la barra de todos
  // modos — Storyblok quiere el slug sin ella. El M2 sí la exige, sobre lo que él mismo emite.
  url_slug: z.string().min(1),
  keyword_principal: z.string().min(1),
  keywords_secundarias: z.array(z.string()),
  intencion: searchIntent,
  local: z.boolean(),
  // Nullable desde kr.v0.4: `null` = el proveedor no devolvió la métrica (≠ 0).
  // Los briefs kr.v0.2/v0.3 traen number y siguen validando. Sin rango, a diferencia del M2: acá un
  // valor fuera de 0..100 es un dato feo de un brief viejo, no motivo para no publicar la web.
  volumen: z.number().nullable(),
  dificultad: z.number().nullable(),
  opportunity_score: z.number(),
  // Desde kr.v0.5. Opcionales para no romper briefs anteriores, pero SON la señal de honestidad
  // del research: sin ellos, quien aprueba la web no puede saber que una página se apoya en cero
  // datos de mercado. Antes ni siquiera estaban en el esquema, así que Zod los DESCARTABA al
  // parsear: el M2 los calculaba y el M1 los tiraba a la basura.
  evidencia: evidencia.optional(),
  score_confidence: z.number().min(0).max(1).optional(),
  seo,
  content_brief: contentBrief,
  preguntas_frecuentes: z.array(z.string()),
  approved: z.boolean(),
});

export const consumoM1 = z.object({
  schema_version: z.string(),
  cliente: z.string(),
  market,
  status: estado,
  paginas_propuestas: z.array(paginaM1),
});

/**
 * Valida y tipa el brief. Lanza con un mensaje claro si la forma o la versión no cuadran.
 *
 * El tipo de retorno es el del brief COMPLETO, pero `consumoM1` no exige `run_id`, `generated_at`,
 * `backlog` ni `meta_run`: el M1 no los consume, y el brief que el orquestador reconstruye desde la
 * base no trae `meta_run`. O sea que el `as` de abajo afirma más de lo que se validó. Quien lea uno de
 * esos cuatro campos desde el M1 tiene que tratarlo como ausente aunque el tipo diga que está.
 */
export function parseBrief(raw: unknown): KeywordResearchBrief {
  const parsed = consumoM1.safeParse(raw);
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
  return parsed.data as KeywordResearchBrief;
}

// Se movió tal cual desde `web-builder/src/contract.ts`, con sus mensajes: son los que LEE UN HUMANO
// cuando un brief no cuadra, y reescribirlos habría perdido información que ya estaba bien. El corte
// en 5 issues es para que el error sea legible: un brief roto de raíz genera uno por página.
function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("; ");
}

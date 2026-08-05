/*
 * DOS validadores, UNA base. No son dos copias del mismo contrato: son dos contratos con propósitos
 * opuestos, y por eso NO se fusionan (lo confirmó la 14ª review).
 *
 *  · `emisionM2` valida LO QUE EL M2 PRODUCE: estricto, versión actual, todos los campos.
 *  · `consumoM1` valida LO QUE EL M1 PUEDE RECIBIR: laxo, cuatro `schema_version`, con `evidencia` y
 *    `score_confidence` opcionales para no rechazar briefs viejos que siguen siendo publicables.
 *
 * Fusionarlos obliga a que uno pierda su garantía: o el M1 deja de aceptar briefs históricos, o el M2
 * deja de exigir campos que hoy exige. Lo que se comparte son las piezas del piso de más abajo (los
 * enums, `market`, `seo`, `contentBrief`) y los tipos de `tipos.ts`.
 */
import { z } from "zod";
import type { CostBreakdown, KeywordResearchBrief } from "./tipos.js";

// ---------------------------------------------------------------------------------------------
// EL PISO COMÚN de los dos validadores. Son `const` de módulo y NO se exportan: desde afuera del
// paquete el contrato se usa por `emisionM2`, `consumoM1` o `parseBrief`, y por nada más.
//
// Estuvieron exportadas en un objeto `esquemaBase` hasta la review final de rama de KR-2a, que midió
// que nadie lo leía: `consumoM1` vive en este módulo y referencia los `const` directamente, así que
// borrarlo —objeto y línea de `index.ts`— dejó la suite entera en verde y el typecheck en exit 0. Se
// sacó en vez de hacer que los dos validadores derivaran DE VERDAD a través de él, porque exportarlo
// habilitaba justo lo que este paquete existe para impedir y hacerlo real no lo arreglaba: un
// consumidor armándose su propio validador de página con `esquemaBase.seo.extend({...})` NO lo caza
// `una-sola-fuente.test.ts`, cuya firma es un `z.object` con `paginas_propuestas` adentro — y un
// esquema de PÁGINA no la tiene. Medido con dos sondas en `api/src/`: la de página pasa el barrido sin
// que caiga nada, la que agrega `paginas_propuestas` lo tumba nombrando el archivo.
//
// El *compartir* sigue siendo real y es esto de acá abajo; el objeto era ceremonia con un filo.
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

/* ---------------------------------------------------------------------------------------------
 * EL LAZO entre las dos descripciones del contrato de EMISIÓN. Es una comprobación de tipos, no un
 * comentario: la impone `npm run typecheck`.
 *
 * `emisionM2` (arriba) y `KeywordResearchBrief` (`tipos.ts`) describen la MISMA cosa y los dos se
 * escriben a mano, así que hasta la review final de rama de KR-2a coincidían solo por vigilancia. Está
 * medido, y por eso existe este bloque: antes de él, quitarle `preguntas_frecuentes` a `emisionM2`
 * dejaba la suite ENTERA en verde y el typecheck en exit 0 (con el bloque puesto la suite sigue verde
 * igual: el typecheck es lo único que cae, y eso es el punto).
 *
 * Y lo que se apaga al comerse una línea de acá no es un test: es la ÚNICA comprobación de salida del
 * M2 (`kr-service/src/cli/spike.ts` corre `emisionM2` sobre el brief). `assembleBrief` sigue
 * devolviendo `KeywordResearchBrief`, así que el campo se sigue EMITIENDO — solo deja de validarse.
 *
 * El lado de CONSUMO ya estaba atado con el mismo mecanismo pero al revés: `ConsumoM1Brief` se DERIVA
 * de `consumoM1` con `z.infer`, así que no puede mentir. Acá no se puede derivar en esa dirección —el
 * tipo es la fuente que usan tres paquetes, y el validador tiene derecho a ser MÁS estricto que él— así
 * que se atan con las dos asignabilidades cruzadas.
 * --------------------------------------------------------------------------------------------- */
type Emitido = z.infer<typeof emisionM2>;

/**
 * `A` tiene que ser asignable a `B`, o `tsc` cae acá con el campo culpable en el mensaje. El alias no
 * se usa para nada más: existe para que el chequeo no emita ni una línea de JavaScript.
 */
type Asignable<A extends B, B> = [A, B];

/**
 * La ÚNICA divergencia deliberada entre las dos descripciones: `coste_breakdown`. El tipo lo admite
 * parcial (un brief LEÍDO de Postgres trae `{}`, el default de la columna) y `emisionM2` lo exige
 * completo (el M2 los emite siempre). Se nombra acá, en el único punto donde las dos se comparan, en
 * vez de dejar la dirección 2 sin comprobar: cualquier OTRA divergencia sigue cayendo.
 */
type BriefConDesgloseCompleto = Omit<KeywordResearchBrief, "meta_run"> & {
  meta_run: Omit<KeywordResearchBrief["meta_run"], "coste_breakdown"> & {
    coste_breakdown: CostBreakdown;
  };
};

/** Dirección 1: todo lo que `emisionM2` acepta ES un `KeywordResearchBrief`. Cae si al VALIDADOR le
 * falta un campo que el tipo declara — la mutación que la review midió y que nadie notaba. */
type _EmisionCubreElTipo = Asignable<Emitido, KeywordResearchBrief>;

/** Dirección 2: y todo `KeywordResearchBrief` satisface a `emisionM2`. Cae si el validador exige algo
 * que el tipo no tiene, o si estrecha un enum compartido que el tipo deja ancho — que los tests solo
 * cazan cuando algún fixture ejercita ese valor (lo dice el test de inclusión de sí mismo). */
type _ElTipoSatisfaceLaEmision = Asignable<BriefConDesgloseCompleto, Emitido>;

// ---------------------------------------------------------------------------------------------
// `consumoM1` — lo que el M1 puede RECIBIR. Es el esquema que vivía en `web-builder/src/contract.ts`,
// derivado del mismo piso: referencia los `const` de arriba (los enums, `seo`, `contentBrief`,
// `market`) sin endurecer NINGUNO.
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
// (es el bug histórico de `evidencia`). Lo cubren dos redes, y son de naturaleza distinta:
//
//  · en RUNTIME, el test que exige que `evidencia` y `score_confidence` SOBREVIVAN al parseo;
//  · en TIPOS, y es la que muerde de verdad: `tsc` sobre el tipo DERIVADO. `ConsumoM1Pagina` sale de
//    `paginaM1` con `z.infer`, así que un campo que se caiga de este objeto desaparece del tipo y
//    rompe a quien lo lee. Medido: quitarle `keywords_secundarias` a `paginaM1` da `TS2339` en
//    `web-builder/src/handoff/adapter.ts:57` SIN que caiga ningún test de `contrato`.
//
// Lo que NO es una red, y este comentario lo presentaba como si lo fuera hasta la review final de rama:
// el diferencial de 1101 casos contra el esquema viejo. Fue una medición PUNTUAL al mudarlo —que la
// mudanza no cambiaba el JSON de salida, no solo si aceptaba— y no se puede repetir: el esquema viejo
// (`kr-service/src/validation/brief.schema.ts`) lo borró `db8b255` y el script del diferencial era de un
// solo uso. Sirvió para lo que sirvió; no vigila nada desde entonces.
// ---------------------------------------------------------------------------------------------

// v0.3 solo cambia `meta_run` (costo total + desglose), que el M1 no consume → compatible.
// v0.4: `volumen`/`dificultad` nullable.
// v0.5: `evidencia` + `score_confidence` por página. Ambos OPCIONALES acá para no romper los
// briefs viejos, pero el M1 los usa para AVISAR: una página sin evidencia de mercado no puede
// llegar a publicarse sin que quien aprueba lo sepa.
export const SUPPORTED_SCHEMA_VERSIONS = ["kr.v0.2", "kr.v0.3", "kr.v0.4", "kr.v0.5"] as const;

export const paginaM1 = z.object({
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

/*
 * Lo que el M1 recibe DE VERDAD. Se DERIVA del validador con `z.infer`, no se escribe a mano.
 *
 * Dos razones, y las dos son cicatrices:
 *
 *  1. Un subconjunto escrito aparte (`Pick<…>`, una interfaz gemela) es la segunda descripción del
 *     mismo esquema que KR-2a existe para eliminar: se desincroniza de `consumoM1` sin que nada avise.
 *     Derivado, el tipo NO PUEDE mentir, porque lo genera el mismo validador que corre.
 *
 *  2. Y NO es `KeywordResearchBrief`, que es el tipo de EMISIÓN. Ese exige `run_id`, `generated_at`,
 *     `backlog`, `meta_run` y —por página— `page_strategy`, más `evidencia` y `score_confidence`
 *     obligatorios. `consumoM1` no valida ninguno de esos cinco y Zod los DESCARTA al parsear, así que
 *     tipar el retorno como el brief completo era prometer cinco campos que el dato no tiene. No era
 *     teórico: el brief que el orquestador reconstruye desde la base (`briefDesdeLaBase`, en
 *     `orchestrator/src/workflow.ts`) no trae `meta_run` ni `page_strategy`, o sea que la promesa ya
 *     era falsa en un camino de producción. Un `brief.meta_run.coste_micros_usd` habría compilado
 *     limpio y reventado en runtime.
 *
 * El tipo de emisión sigue existiendo y sigue siendo el correcto para el M2 y para `renderReport`:
 * son dos tipos porque son dos contratos, igual que `emisionM2` y `consumoM1` son dos validadores.
 */
export type ConsumoM1Brief = z.infer<typeof consumoM1>;
export type ConsumoM1Pagina = z.infer<typeof paginaM1>;

/** Valida y tipa el brief. Lanza con un mensaje claro si la forma o la versión no cuadran. */
export function parseBrief(raw: unknown): ConsumoM1Brief {
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
  // Sin `as`: el tipo de retorno es el que el validador produce, así que no hay nada que afirmar.
  return parsed.data;
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

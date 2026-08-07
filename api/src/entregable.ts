import type {
  ContentBrief,
  CostBreakdown,
  DataQuality,
  KeywordResearchBrief,
  PageEvidence,
  PageSeo,
  PageStrategy,
  PageType,
  ProposedPage,
  SearchIntent,
} from "contrato";
import type { DatosEntregable, PageRow } from "db";

/**
 * De lo que hay EN LA BASE al brief del contrato, para producir el **entregable del restaurante**.
 *
 * ## Por qué esto existe y no se reusa `briefDesdeLaBase` del orquestador
 *
 * Se miró antes de escribirlo. `briefDesdeLaBase` (`orchestrator/src/workflow.ts`) hace algo parecido y
 * **no sirve acá**, por tres razones y ninguna es de estilo: no está exportada, vive en un paquete que no
 * es éste, y sobre todo **no construye `meta_run`** — porque su destino es `consumoM1`, el validador laxo,
 * que ni lo mira. `renderReport` sí lo necesita entero (keywords analizadas, calidad de datos, coste).
 * Aliasear una a la otra habría obligado a mentir en un tipo, que es el defecto que `contrato` ya arregló
 * dos veces.
 *
 * ## Por qué hay que normalizar, y no es paranoia
 *
 * En producción el dato **llega de Postgres sin pasar por Zod**, y el esquema no lo restringe tanto como
 * el contrato:
 *
 *  · `kr_pages.seo` y `content_brief` son `jsonb not null default '{}'` (`0001_init.sql:240-241`). Un run
 *    con `{}` —el default de la columna, y lo que siembran varios tests— hacía que `renderReport` leyera
 *    `content_brief.secciones_sugeridas.length` sobre `undefined` y **reventara con TypeError**. No es
 *    hipotético: es el mismo `{}` que ya hizo emitir `$NaN` en el bloque de coste (KR-2a).
 *  · `tipo`, `intencion` y `evidencia` son `text` PELADO (`0001_init.sql:225,229,236`): ninguna constraint
 *    los ata al vocabulario cerrado del contrato.
 *
 * Es la misma disciplina que el renderizador aplica con lo que sale a internet (ADR-19, defensa en
 * profundidad): el borde revalida lo que la base no puede garantizar.
 *
 * ## El criterio, que es de tres clases y conviene no mezclarlas
 *
 *  1. **Se NORMALIZA** lo que rompería el documento: las formas jsonb (`seo`, `content_brief`,
 *     `calidad_datos`, `coste_breakdown`). Un campo ausente pasa a su equivalente honesto —`null` para
 *     "no se sabe", `[]` para una lista vacía—, nunca a un cero que afirme algo.
 *  2. **Se ESTRECHA con allowlist** lo único cuyo valor CAMBIA el documento: `evidencia`. `renderReport`
 *     parte las páginas en «✅ respaldadas por datos de mercado» y «⚠️ sin validar» comparando contra
 *     `"datos_mercado"`; un valor desconocido no caería en ninguno de los dos grupos y la página
 *     **desaparecería de las dos tablas** en silencio. Se falla hacia `sin_validar`: lo que no se puede
 *     demostrar respaldado, no se presenta como respaldado.
 *  3. **Se CASTEA** lo que el documento solo IMPRIME (`tipo`, `intencion`, `schema_type` y el inerte
 *     `page_strategy`). Acá el valor de la base es la verdad y sustituirlo por uno del vocabulario sería
 *     inventar dato en el documento que lee el cliente. El cast es una afirmación sobre el tipo, no sobre
 *     el runtime, y está acotada a campos donde un valor raro se ve impreso en vez de cambiar nada.
 */

// --------------------------------------------------------------------- lectores de jsonb

const esTexto = (v: unknown): v is string => typeof v === "string";

function texto(v: unknown, fallback = ""): string {
  return esTexto(v) ? v : fallback;
}

function listaDeTextos(v: unknown): string[] {
  return Array.isArray(v) ? v.filter(esTexto) : [];
}

/** Número, o `null` si el dato no está. **Nunca 0**: `0` es una afirmación y `null` es su ausencia. */
function numeroOnulo(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * `kr_runs.calidad_datos` → `DataQuality`.
 *
 * Los tres campos caen a `null` y no a `0`/`[]` cuando faltan, y la diferencia es el sentido del aviso que
 * el documento imprime: `[]` afirma "ningún endpoint falló" y `null` dice "no se registró si alguno
 * falló". Confundirlos convierte un dato desconocido en una certeza — es el hallazgo que la 14ª review
 * hizo sobre el seed de la demo.
 */
function calidadDeDatos(raw: Record<string, unknown>): DataQuality {
  const endpoints = raw["endpoints_degradados"];
  return {
    cobertura_volumen: numeroOnulo(raw["cobertura_volumen"]),
    cobertura_kd: numeroOnulo(raw["cobertura_kd"]),
    endpoints_degradados: Array.isArray(endpoints) ? endpoints.filter(esTexto) : null,
  };
}

/**
 * `kr_runs.coste_breakdown` → `Partial<CostBreakdown>`.
 *
 * Parcial y no completo porque la columna tiene default `'{}'`: un run viejo, o uno que no llegó a
 * cerrarse, trae el objeto vacío legítimamente. `renderReport` ya sabe distinguirlo (con desglose pinta la
 * tabla, sin él pinta solo el total). En el entregable **nada de esto se imprime** —`incluirCoste: false`—
 * pero el tipo del brief lo pide, y llenarlo con la verdad es más barato que llenarlo con ceros.
 */
function desgloseDeCoste(raw: Record<string, unknown>): Partial<CostBreakdown> {
  const desglose: Partial<CostBreakdown> = {};
  const dfs = numeroOnulo(raw["dataforseo_micros"]);
  const gen = numeroOnulo(raw["llm_generation_micros"]);
  const emb = numeroOnulo(raw["llm_embeddings_micros"]);
  if (dfs !== null) desglose.dataforseo_micros = dfs;
  if (gen !== null) desglose.llm_generation_micros = gen;
  if (emb !== null) desglose.llm_embeddings_micros = emb;
  return desglose;
}

/**
 * Cuántas keywords analizó el run. Hay **dos** fuentes y ninguna cubre todos los runs.
 *
 * · **Declarada**, en `kr_runs.calidad_datos.keywords_analizadas`. Es un cuarto campo que viaja dentro de
 *   esa columna porque `kr_runs` no tiene una propia para él, y es de donde el informe interno del seed de
 *   la demo saca su número (`db/src/seed-demo.ts`, `CALIDAD_DATOS_DEMO.keywords_analizadas = 55`).
 * · **Contada**, `count(*)` sobre `kr_keywords`. Es lo que hay en un run de verdad, donde el checkpoint de
 *   `saveKeywords` persiste todas las que se pagaron — pero `finishRun` guarda en `calidad_datos` solo los
 *   tres campos de `DataQuality`, así que ahí la declarada **no existe**.
 *
 * Gana la declarada, y no es una preferencia estética: **medido sobre el seed de la demo**, el run tiene
 * `keywords_analizadas: 55` en la columna y **cero filas** en `kr_keywords`. Contando salían `0`, y el
 * informe interno del MISMO run seguía diciendo 55 — dos documentos de la agencia contradiciéndose sobre
 * el mismo research, que es peor que cualquiera de los dos números por separado.
 */
function keywordsAnalizadas(d: DatosEntregable): number {
  return numeroOnulo(d.calidad_datos["keywords_analizadas"]) ?? d.keywords_analizadas;
}

const SCHEMA_TYPES = new Set(["LocalBusiness", "Article", "FAQPage", "WebPage"]);

/**
 * `kr_pages.seo` → `PageSeo`.
 *
 * `schema_type` es el único con allowlist acá, y no por el documento: declarar `LocalBusiness` es
 * afirmarle a Google que la página ES la ficha de un negocio físico, así que un valor basura no puede
 * heredar esa afirmación. Cae a `WebPage`, el neutro. (El entregable no publica nada, pero el campo viaja
 * en el brief y el criterio del contrato es ése.)
 */
function seoDe(raw: Record<string, unknown>): PageSeo {
  const schema = raw["schema_type"];
  return {
    meta_title: texto(raw["meta_title"]),
    meta_description: texto(raw["meta_description"]),
    schema_type: (esTexto(schema) && SCHEMA_TYPES.has(schema) ? schema : "WebPage") as PageSeo["schema_type"],
    canonical: texto(raw["canonical"]),
  };
}

/**
 * `kr_pages.content_brief` → `ContentBrief`.
 *
 * `h1` cae a la keyword principal de la MISMA página, no a `""`. No es inventar: es otro campo real de esa
 * página, y el vacío imprimiría un encabezado `### 3.` sin título en el documento que lee el restaurante —
 * un desperfecto visible en la cara del cliente por un dato que sí tenemos al lado.
 */
function contenidoDe(raw: Record<string, unknown>, keywordPrincipal: string): ContentBrief {
  const brief: ContentBrief = {
    h1: texto(raw["h1"]) || keywordPrincipal,
    secciones_sugeridas: listaDeTextos(raw["secciones_sugeridas"]),
    word_count_objetivo: numeroOnulo(raw["word_count_objetivo"]) ?? 0,
    enlazado_interno: listaDeTextos(raw["enlazado_interno"]),
  };
  // Los opcionales se OMITEN si no están, en vez de ponerlos vacíos: `renderReport` los pinta con un
  // `if (…​.length)`, así que un `[]` y una ausencia se ven igual — pero un `""` en `cta` no.
  if (esTexto(raw["cta"])) brief.cta = raw["cta"];
  if (esTexto(raw["tono"])) brief.tono = raw["tono"];
  if (Array.isArray(raw["claims_permitidos"])) brief.claims_permitidos = listaDeTextos(raw["claims_permitidos"]);
  if (Array.isArray(raw["claims_prohibidos"])) brief.claims_prohibidos = listaDeTextos(raw["claims_prohibidos"]);
  if (Array.isArray(raw["competidores_serp"])) brief.competidores_serp = listaDeTextos(raw["competidores_serp"]);
  return brief;
}

/** `PageRow` (fila de Postgres) → `ProposedPage` (contrato). Ver las tres clases en la cabecera. */
function paginaDe(p: PageRow): ProposedPage {
  return {
    cluster_id: p.cluster_id,
    // (3) solo se imprimen: el valor de la base es la verdad del documento.
    tipo: p.tipo as PageType,
    // (3) inerte: `renderReport` no lo lee. Viaja porque el tipo del brief lo exige.
    page_strategy: (p.page_strategy ?? "single") as PageStrategy,
    url_slug: p.url_slug,
    keyword_principal: p.keyword_principal,
    keywords_secundarias: p.keywords_secundarias,
    intencion: p.intencion as SearchIntent,
    local: p.local,
    volumen: p.volumen,
    dificultad: p.dificultad,
    // (2) el único que CAMBIA el documento: falla hacia `sin_validar`.
    evidencia: (p.evidencia === "datos_mercado" ? "datos_mercado" : "sin_validar") satisfies PageEvidence,
    opportunity_score: p.opportunity_score,
    score_confidence: p.score_confidence,
    seo: seoDe(p.seo),
    content_brief: contenidoDe(p.content_brief, p.keyword_principal),
    preguntas_frecuentes: p.preguntas_frecuentes,
    // No es una suposición: la consulta de `getDatosEntregable` exige `approved`.
    approved: true,
  };
}

/**
 * Los datos del run → el brief que `renderReport` sabe leer.
 *
 * `status` se colapsa a los tres del contrato: un run `running` o `failed` no tiene un estado propio en el
 * brief, y `pending_approval` es el honesto (todavía no está aprobado). No se imprime en el documento; se
 * mapea para no meter un valor que el contrato no admite.
 */
export function briefDelEntregable(d: DatosEntregable): KeywordResearchBrief {
  return {
    schema_version: d.schema_version,
    run_id: d.run_id,
    cliente: d.cliente,
    market: {
      country: d.market_country,
      language_code: d.market_language,
      location_code: d.market_location_code,
    },
    generated_at: d.generated_at,
    status: d.status === "approved" ? "approved" : d.status === "rejected" ? "rejected" : "pending_approval",
    paginas_propuestas: d.paginas.map(paginaDe),
    // El backlog es trabajo que la agencia NO propuso para esta fase. Al restaurante no se le manda una
    // lista de lo que quedó afuera: se le manda lo aprobado. Vacío a propósito, no por falta de dato.
    backlog: [],
    meta_run: {
      keywords_analizadas: keywordsAnalizadas(d),
      // Las del ENTREGABLE (las aprobadas), no las que el research propuso. El documento tiene que contar
      // lo que muestra: si dijera 14 y la tabla tuviera 8, el número desmentiría a la tabla.
      paginas_propuestas: d.paginas.length,
      calidad_datos: calidadDeDatos(d.calidad_datos),
      coste_micros_usd: d.coste_micros_usd,
      coste_breakdown: desgloseDeCoste(d.coste_breakdown),
    },
  };
}

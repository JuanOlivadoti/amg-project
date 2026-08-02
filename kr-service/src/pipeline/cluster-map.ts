import { randomUUID } from "node:crypto";
import type { Cluster } from "./cluster.js";
import type {
  EnrichedKeyword,
  PageEvidence,
  PageSeo,
  PageType,
  ProposedPage,
  SearchIntent,
} from "../types.js";

/**
 * ¿Hay ALGUNA evidencia de mercado detrás de este cluster?
 *
 * Basta con que una keyword del cluster —no necesariamente la cabeza— tenga volumen conocido:
 * si el tema tiene demanda demostrable, la página se sostiene aunque la cabeza sea una variante
 * long-tail sin datos propios.
 */
function evidenceOf(members: EnrichedKeyword[]): PageEvidence {
  // `> 0`, no `!= null`. Un volumen CERO es un dato conocido, pero demuestra lo contrario de lo que
  // afirmábamos: que NADIE busca eso. Con `!= null`, un cluster cuyo único dato era un 0 salía como
  // "datos_mercado" y el informe declaraba "hay demanda de búsqueda demostrable" — una afirmación
  // falsa, de la misma familia que el viejo `volumen ?? 0`. Un cero prueba que el dato existe, no
  // que haya demanda.
  return members.some((m) => m.volume != null && m.volume > 0) ? "datos_mercado" : "sin_validar";
}

/**
 * Cuánto pesa `score_confidence` en el orden, DENTRO de un grupo de evidencia.
 *
 * Default de PRODUCCIÓN (no lo elige ningún test, y hay uno que fija este valor). Con 0.5: confianza
 * 1.0 deja el score intacto y confianza 0.3 lo deja en el 65%. Es una penalización moderada y
 * explicable —una página floja pero medida sigue por encima de una buena a medias—, no una
 * descalificación: la confianza baja señala que faltan datos, no que la oportunidad no exista.
 */
export const PESO_CONFIANZA_ORDEN = 0.5;

/**
 * El score con el que se ORDENA (y con el que se decide el corte al backlog), no el que se reporta.
 *
 * `score_confidence ?? 0` a propósito, igual que `buildPage`: coherencia antes que astucia. Un `?? 1`
 * premiaría justo al caso del que menos sabemos.
 */
function scoreEfectivo(head: EnrichedKeyword): number {
  const score = head.opportunity_score ?? 0;
  const confianza = head.score_confidence ?? 0;
  return score * (1 - PESO_CONFIANZA_ORDEN + PESO_CONFIANZA_ORDEN * confianza);
}

/**
 * Mapeo de clusters (ya armados por cluster.ts) → páginas propuestas.
 *
 * ORDEN, en dos niveles:
 *
 * 1. **La evidencia manda, siempre.** Una página `sin_validar` NUNCA se ordena por encima de una
 *    respaldada por datos de mercado, aunque tenga score 100 y confianza 1.0.
 * 2. **Dentro de cada grupo, por `scoreEfectivo`**, que pondera la confianza.
 *
 * Los dos niveles atacan el mismo problema por lados distintos: el 40% del score (intención +
 * relevancia) no depende de ningún dato de mercado, así que una keyword de la que no sabemos NADA
 * arranca en ~50 puntos y puede superar a una con volumen real pero alta dificultad. La evidencia
 * separa "tiene demanda demostrable" de "no la tiene"; la confianza ordena el resto —"sabemos el
 * volumen pero no el KD" no es lo mismo que "no sabemos nada"—. `score_confidence` detectaba el caso
 * (bajaba a 0.3), el portal ya lo mostraba como columna "Confianza", y no ordenaba nada. Ahora sí.
 *
 * Esto NO sube `SCHEMA_VERSION`: no cambia la forma ni el significado de ningún campo del brief,
 * cambia el orden de una lista. El orden no es parte del esquema.
 *
 * Las `sin_validar` NO se descartan: suelen ser servicios que el propio negocio declaró (un
 * restaurante quiere su página de "menú del día" tenga o no volumen medible). Se conservan, pero
 * ETIQUETADAS, y el informe las separa. Presentarlas mezcladas con las validadas era el problema.
 */
export function mapClustersToPages(clusters: Cluster[], maxPages: number): {
  pages: ProposedPage[];
  backlog: Array<{ keyword_principal: string; opportunity_score: number }>;
} {
  const ranked = [...clusters].sort((a, b) => {
    const ea = evidenceOf(a.members) === "datos_mercado" ? 1 : 0;
    const eb = evidenceOf(b.members) === "datos_mercado" ? 1 : 0;
    if (ea !== eb) return eb - ea; // la evidencia manda sobre el score y sobre la confianza
    return scoreEfectivo(b.members[0]!) - scoreEfectivo(a.members[0]!);
  });

  const pages: ProposedPage[] = [];
  const backlog: Array<{ keyword_principal: string; opportunity_score: number }> = [];

  ranked.forEach((cluster, i) => {
    const head = cluster.members[0]!;
    // El corte usa el orden nuevo —ese es el punto: una página de baja confianza cae al backlog
    // antes que una respaldada—, pero la ENTRADA lleva el `opportunity_score` crudo, que es el
    // campo declarado del contrato. El efectivo es un criterio de orden interno, no un dato del
    // brief: publicarlo ahí obligaría a explicarle al cliente dos scores distintos para lo mismo.
    if (i >= maxPages) {
      backlog.push({ keyword_principal: head.keyword, opportunity_score: head.opportunity_score ?? 0 });
      return;
    }
    pages.push(buildPage(head, cluster.members));
  });

  return { pages, backlog };
}

function buildPage(head: EnrichedKeyword, members: EnrichedKeyword[]): ProposedPage {
  const intent = head.intent ?? "commercial";
  const tipo = pageTypeFor(intent, head.is_local);
  return {
    cluster_id: randomUUID(),
    tipo,
    page_strategy: "single",
    url_slug: slugify(head.keyword),
    keyword_principal: head.keyword,
    keywords_secundarias: members.slice(1, 6).map((m) => m.keyword),
    intencion: intent,
    local: head.is_local,
    // `null` = el proveedor NO devolvió el dato. NO se coacciona a 0: "sin dato" y "cero
    // búsquedas/mes" son cosas distintas, y confundirlas le miente al cliente en el entregable.
    // El scoring ya penaliza la falta de dato vía `score_confidence`.
    volumen: head.volume ?? null,
    dificultad: head.difficulty ?? null,
    evidencia: evidenceOf(members),
    opportunity_score: head.opportunity_score ?? 0,
    score_confidence: head.score_confidence ?? 0,
    seo: {
      meta_title: capitalize(head.keyword),
      meta_description: `Información sobre ${head.keyword}.`, // TODO: generar con LLM
      schema_type: schemaTypeFor(tipo, intent),
      canonical: slugify(head.keyword),
    },
    content_brief: {
      h1: capitalize(head.keyword),
      secciones_sugeridas: [], // TODO: generar con LLM
      word_count_objetivo: tipo === "blog" ? 900 : 1100,
      enlazado_interno: [],
    },
    preguntas_frecuentes: [],
    approved: false,
  };
}

/**
 * La intención INFORMATIVA gana sobre la señal local.
 *
 * Antes `is_local` cortocircuitaba todo: cualquier keyword marcada local salía `landing_local`,
 * incluso una claramente informativa ("cómo se hace la pasta fresca"). Una guía no es una landing
 * de negocio, y como el schema colgaba del tipo de página, terminaba declarándose `LocalBusiness`.
 */
function pageTypeFor(intent: SearchIntent, isLocal: boolean): PageType {
  if (intent === "informational") return "blog";
  if (isLocal) return "landing_local";
  if (intent === "transactional" || intent === "commercial") return "servicio";
  return "institucional";
}

/**
 * El JSON-LD es una decisión SEPARADA del tipo de página (#5 review Codex).
 *
 * `schema_type` es una afirmación estructurada dirigida a Google, no una etiqueta interna:
 * declarar `LocalBusiness` significa "esta página ES la ficha de un negocio físico". Antes colgaba
 * directamente del `page_type`, así que la sobre-detección de `is_local` se propagaba hasta el
 * marcado y publicábamos afirmaciones falsas.
 *
 * Regla: `LocalBusiness` solo cuando la página realmente representa al negocio en un lugar —es
 * decir, una landing local con intención de negocio (no una guía que además menciona la ciudad).
 */
function schemaTypeFor(tipo: PageType, intent: SearchIntent): PageSeo["schema_type"] {
  if (intent === "informational") return "Article"; // una guía nunca es un LocalBusiness
  if (tipo === "landing_local") return "LocalBusiness";
  if (tipo === "blog") return "Article";
  return "WebPage";
}

function slugify(s: string): string {
  return (
    "/" +
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
  );
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}


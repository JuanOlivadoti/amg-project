import { randomUUID } from "node:crypto";
import type { Cluster } from "./cluster.js";
import type { EnrichedKeyword, PageEvidence, PageType, ProposedPage, SearchIntent } from "../types.js";

/**
 * ¿Hay ALGUNA evidencia de mercado detrás de este cluster?
 *
 * Basta con que una keyword del cluster —no necesariamente la cabeza— tenga volumen conocido:
 * si el tema tiene demanda demostrable, la página se sostiene aunque la cabeza sea una variante
 * long-tail sin datos propios.
 */
function evidenceOf(members: EnrichedKeyword[]): PageEvidence {
  return members.some((m) => m.volume != null) ? "datos_mercado" : "sin_validar";
}

/**
 * Mapeo de clusters (ya armados por cluster.ts) → páginas propuestas.
 *
 * ORDEN: primero por evidencia, después por score. Una página `sin_validar` NUNCA se ordena por
 * encima de una respaldada por datos de mercado, aunque su `opportunity_score` sea mayor.
 *
 * Esto importa porque el score no lo impide solo: el 40% (intención + relevancia) no depende de
 * ningún dato de mercado, así que una keyword de la que no sabemos NADA arranca en ~50 puntos y
 * puede superar a una con volumen real pero alta dificultad. `score_confidence` detectaba el caso
 * (0.3) pero no se usaba para nada. Ahora sí.
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
    if (ea !== eb) return eb - ea; // la evidencia manda sobre el score
    return (b.members[0]!.opportunity_score ?? 0) - (a.members[0]!.opportunity_score ?? 0);
  });

  const pages: ProposedPage[] = [];
  const backlog: Array<{ keyword_principal: string; opportunity_score: number }> = [];

  ranked.forEach((cluster, i) => {
    const head = cluster.members[0]!;
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
      schema_type: tipo === "blog" ? "Article" : tipo === "landing_local" ? "LocalBusiness" : "WebPage",
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

function pageTypeFor(intent: SearchIntent, isLocal: boolean): PageType {
  if (isLocal) return "landing_local";
  if (intent === "transactional" || intent === "commercial") return "servicio";
  if (intent === "informational") return "blog";
  return "institucional";
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


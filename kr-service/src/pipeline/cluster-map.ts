import { randomUUID } from "node:crypto";
import type { Cluster } from "./cluster.js";
import type { EnrichedKeyword, PageType, ProposedPage, SearchIntent } from "../types.js";

/**
 * Mapeo de clusters (ya armados por cluster.ts) → páginas propuestas.
 * Una página por cluster; se respeta max_pages priorizando por score, el resto
 * va a backlog. La lógica de agrupación real vive en cluster.ts.
 */
export function mapClustersToPages(clusters: Cluster[], maxPages: number): {
  pages: ProposedPage[];
  backlog: Array<{ keyword_principal: string; opportunity_score: number }>;
} {
  const ranked = [...clusters].sort(
    (a, b) => (b.members[0]!.opportunity_score ?? 0) - (a.members[0]!.opportunity_score ?? 0),
  );

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
    volumen: head.volume ?? 0,
    dificultad: head.difficulty ?? 0,
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


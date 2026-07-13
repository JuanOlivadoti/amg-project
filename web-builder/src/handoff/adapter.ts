import { CONTRACT_VERSION } from "../types.js";
import type { Blok, KrBrief, KrProposedPage, Story } from "../types.js";

/**
 * Adaptador de handoff (ADR-06/07): traduce el brief del Módulo 2 en stories de Storyblok.
 * Una página propuesta → una story. Puro y sin efectos: testeable y determinista.
 *
 * El body queda con la ESTRUCTURA (hero + secciones + FAQ) y el contrato editorial en meta;
 * la prose final de cada sección la completa la generación por LLM (siguiente incremento).
 */
export function briefToStories(brief: KrBrief): Story[] {
  return brief.paginas_propuestas.map((page) => pageToStory(page, brief));
}

export function pageToStory(page: KrProposedPage, brief: KrBrief): Story {
  const cb = page.content_brief;

  const body: Blok[] = [
    {
      component: "hero",
      headline: cb.h1,
      subhead: page.seo.meta_description,
      cta_label: cb.cta ?? defaultCta(page),
    },
    ...cb.secciones_sugeridas.map(
      (heading): Blok => ({ component: "section", heading, body: "" }),
    ),
  ];

  if (page.preguntas_frecuentes.length > 0) {
    body.push({
      component: "faq",
      items: page.preguntas_frecuentes.map((question) => ({ question, answer: "" })),
    });
  }

  return {
    name: page.seo.meta_title,
    slug: normalizeSlug(page.url_slug),
    content: {
      component: "page",
      seo: {
        title: page.seo.meta_title,
        description: page.seo.meta_description,
        canonical: page.seo.canonical,
        og_title: page.seo.meta_title,
        og_description: page.seo.meta_description,
      },
      schema_type: page.seo.schema_type,
      page_type: page.tipo,
      intent: page.intencion,
      is_local: page.local,
      body,
      meta: {
        contract_version: CONTRACT_VERSION,
        source_keyword: page.keyword_principal,
        secondary_keywords: page.keywords_secundarias,
        internal_links: cb.enlazado_interno,
        word_count_objetivo: cb.word_count_objetivo,
        tono: cb.tono,
        claims_permitidos: cb.claims_permitidos,
        claims_prohibidos: cb.claims_prohibidos,
        opportunity_score: page.opportunity_score,
        volumen: page.volumen,
        dificultad: page.dificultad,
      },
    },
  };
}

function defaultCta(page: KrProposedPage): string {
  if (page.local || page.intencion === "local") return "Reserva tu mesa";
  if (page.intencion === "transactional" || page.intencion === "commercial") return "Contáctanos";
  return "Saber más";
}

/** Storyblok usa slugs sin barra inicial; el brief los emite con "/". */
export function normalizeSlug(slug: string): string {
  return slug.replace(/^\/+/, "").replace(/\/+$/, "") || "inicio";
}

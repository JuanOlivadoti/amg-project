import { getContentGen } from "../llm/content.js";
import type { EnrichedKeyword, Market, ProposedPage } from "../types.js";

/**
 * Puntúa business_relevance de cada keyword (activa el gate del scoring).
 * Resiliente: si la API falla, deja null (scoring usa el default neutral).
 */
export async function applyBusinessRelevance(
  keywords: EnrichedKeyword[],
  businessPrompt: string,
): Promise<void> {
  try {
    const scores = await getContentGen().businessRelevance(
      businessPrompt,
      keywords.map((k) => k.keyword),
    );
    for (const k of keywords) {
      const r = scores.get(k.keyword);
      if (r != null) k.business_relevance = r;
    }
  } catch (e) {
    console.warn(`  [content] aviso business_relevance: ${(e as Error).message}`);
  }
}

/**
 * Rellena SEO on-page (meta, secciones, FAQs, contrato editorial) de cada página.
 * Una llamada por página. TODO: batchear si max_pages es grande.
 */
export async function applyPageContent(
  pages: ProposedPage[],
  businessPrompt: string,
  market: Market,
): Promise<void> {
  const gen = getContentGen();
  for (const page of pages) {
    try {
      const c = await gen.pageContent({
        keyword_principal: page.keyword_principal,
        keywords_secundarias: page.keywords_secundarias,
        intent: page.intencion,
        is_local: page.local,
        page_type: page.tipo,
        businessPrompt,
        market,
      });
      page.seo.meta_title = c.meta_title;
      page.seo.meta_description = c.meta_description;
      page.content_brief.h1 = c.h1;
      page.content_brief.secciones_sugeridas = c.secciones_sugeridas;
      page.content_brief.word_count_objetivo = c.word_count_objetivo;
      page.content_brief.cta = c.cta;
      page.content_brief.tono = c.tono;
      page.content_brief.claims_permitidos = c.claims_permitidos;
      page.content_brief.claims_prohibidos = c.claims_prohibidos;
      page.preguntas_frecuentes = c.faqs;
    } catch (e) {
      console.warn(`  [content] aviso página "${page.keyword_principal}": ${(e as Error).message}`);
    }
  }
}

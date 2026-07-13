import { getContentGen } from "../llm/content.js";
import { canonicalKey } from "../lib/text.js";
import { classifyIntent } from "./intent.js";
import type { EnrichedKeyword, Market, ProposedPage } from "../types.js";

/**
 * Clasifica intención + señal local de cada keyword (LLM en batch).
 * Resiliente: cualquier keyword que el LLM no devuelva (o si la llamada falla)
 * cae al clasificador heurístico. Devuelve cuántas resolvió cada vía.
 */
export async function applyIntents(
  keywords: EnrichedKeyword[],
  businessPrompt: string,
  market: Market,
): Promise<{ llm: number; heuristic: number }> {
  let byLlm = new Map<string, { intent: EnrichedKeyword["intent"]; is_local: boolean }>();
  try {
    const raw = await getContentGen().classifyIntents(
      businessPrompt,
      keywords.map((k) => k.keyword),
      market,
    );
    // Re-indexar por clave canónica: el LLM puede devolver la keyword con otro casing/espaciado (#7).
    byLlm = new Map([...raw].map(([k, v]) => [canonicalKey(k), v]));
  } catch (e) {
    console.warn(`  [intent] aviso clasificación LLM: ${(e as Error).message}`);
  }

  let heuristic = 0;
  for (const k of keywords) {
    const r = byLlm.get(canonicalKey(k.keyword));
    if (r && r.intent) {
      k.intent = r.intent;
      k.is_local = r.is_local;
    } else {
      const h = classifyIntent(k.keyword, market);
      k.intent = h.intent;
      k.is_local = h.is_local;
      heuristic++;
    }
  }
  return { llm: keywords.length - heuristic, heuristic };
}

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
    // Re-indexar por clave canónica para no perder el match por casing/espaciado (#7).
    const byKey = new Map([...scores].map(([k, v]) => [canonicalKey(k), v]));
    for (const k of keywords) {
      const r = byKey.get(canonicalKey(k.keyword));
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

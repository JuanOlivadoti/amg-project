import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getProseGen } from "./llm/content.js";
import { parseProfile } from "./contract.js";
import type { BusinessProfile, FaqBlok, KrBrief, SectionBlok, Story } from "./types.js";

/**
 * Carga el perfil de negocio (opcional). SOLO la ausencia del archivo (ENOENT) se trata como
 * "sin perfil" → null. Un JSON corrupto o con tipos inválidos LANZA: un error operativo no
 * debe disfrazarse de "sin perfil" y publicar un LocalBusiness incompleto (#14 review Codex).
 */
export async function loadProfile(path: string): Promise<BusinessProfile | null> {
  let raw: string;
  try {
    raw = await readFile(resolve(path), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`No se pudo leer el perfil de negocio (${path}): ${(e as Error).message}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`business-profile.json no es JSON válido: ${(e as Error).message}`);
  }
  return parseProfile(json);
}

/**
 * Rellena la prose de cada story (secciones + respuestas FAQ) vía LLM, respetando el
 * contrato editorial del brief (tono, claims). Resiliente: si el LLM falla, deja los
 * textos de fallback del reconcile. Devuelve cuántas páginas se enriquecieron.
 */
export async function applyProse(
  stories: Story[],
  brief: KrBrief,
  profile: BusinessProfile | null,
): Promise<number> {
  const gen = getProseGen();
  let filled = 0;

  for (const story of stories) {
    const c = story.content;
    const sections = c.body.filter((b): b is SectionBlok => b.component === "section");
    const faq = c.body.find((b): b is FaqBlok => b.component === "faq");
    const questions = faq?.items.map((i) => i.question) ?? [];

    try {
      const result = await gen.fillPage({
        businessContext: brief.cliente,
        languageCode: brief.market.language_code,
        pageTitle: c.seo.title,
        intent: c.intent,
        pageType: c.page_type,
        isLocal: c.is_local,
        sections: sections.map((s) => s.heading),
        faqs: questions,
        tono: c.meta.tono,
        claimsPermitidos: c.meta.claims_permitidos,
        claimsProhibidos: c.meta.claims_prohibidos,
        profile: profile ?? undefined,
      });

      const byHeading = new Map(result.sections.map((s) => [s.heading, s.body]));
      for (const s of sections) s.body = byHeading.get(s.heading) ?? s.body;

      if (faq) {
        const byQuestion = new Map(result.faqs.map((f) => [f.question, f.answer]));
        for (const item of faq.items) item.answer = byQuestion.get(item.question) ?? item.answer;
      }
      filled++;
    } catch (e) {
      console.warn(`  [prose] aviso "${story.slug}": ${(e as Error).message}`);
    }
  }
  return filled;
}

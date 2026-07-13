import { stableUid } from "../lib/uid.js";
import type { FaqBlok, HeroBlok, SectionBlok, Story } from "../types.js";

/**
 * Transforma el contenido canónico (limpio, agnóstico) al formato que espera Storyblok:
 *  - cada blok lleva `_uid` (requerido por el Visual Editor),
 *  - el `seo` (objeto) se aplana a `seo_title` / `seo_description` (campos del componente `page`),
 *  - los items de FAQ pasan a ser bloks `faq_item` anidados.
 *
 * Así el contrato de bloks (types.ts) queda limpio y toda la "storyblok-idad" vive acá.
 */
export function toStoryblokContent(story: Story): Record<string, unknown> {
  const c = story.content;
  // Los _uid son deterministas (#12): se derivan del slug + la identidad natural de cada blok,
  // así una republicación del mismo contenido produce exactamente los mismos _uid.
  const slug = story.slug;
  return {
    component: "page",
    _uid: stableUid(slug, "page"),
    seo_title: c.seo.title,
    seo_description: c.seo.description,
    // #13: preservar canonical, OG, contrato editorial y traza; antes se perdían en Storyblok.
    seo_canonical: c.seo.canonical,
    og_title: c.seo.og_title,
    og_description: c.seo.og_description,
    schema_type: c.schema_type,
    page_type: c.page_type,
    intent: c.intent,
    is_local: c.is_local,
    internal_links: (c.meta.internal_links ?? []).join("\n"),
    claims_permitidos: (c.meta.claims_permitidos ?? []).join("\n"),
    claims_prohibidos: (c.meta.claims_prohibidos ?? []).join("\n"),
    source_keyword: c.meta.source_keyword,
    body: c.body.map((b) => shapeBlok(b, slug)),
  };
}

/**
 * Identidad natural de cada blok (lo que lo hace "ese" blok y no otro):
 *  - hero: hay uno solo por página,
 *  - section: su heading,
 *  - faq: hay una sola; cada item, su pregunta.
 */
function shapeBlok(blok: HeroBlok | SectionBlok | FaqBlok, slug: string): Record<string, unknown> {
  switch (blok.component) {
    case "hero":
      return {
        component: "hero",
        _uid: stableUid(slug, "hero"),
        headline: blok.headline,
        subhead: blok.subhead,
        cta_label: blok.cta_label ?? "",
      };
    case "section":
      return {
        component: "section",
        _uid: stableUid(slug, "section", blok.heading),
        heading: blok.heading,
        body: blok.body,
      };
    case "faq":
      return {
        component: "faq",
        _uid: stableUid(slug, "faq"),
        items: blok.items.map((it) => ({
          component: "faq_item",
          _uid: stableUid(slug, "faq_item", it.question),
          question: it.question,
          answer: it.answer,
        })),
      };
  }
}

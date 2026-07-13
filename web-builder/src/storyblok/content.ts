import { randomUUID } from "node:crypto";
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
  return {
    component: "page",
    _uid: randomUUID(),
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
    body: c.body.map(shapeBlok),
  };
}

function shapeBlok(blok: HeroBlok | SectionBlok | FaqBlok): Record<string, unknown> {
  switch (blok.component) {
    case "hero":
      return {
        component: "hero",
        _uid: randomUUID(),
        headline: blok.headline,
        subhead: blok.subhead,
        cta_label: blok.cta_label ?? "",
      };
    case "section":
      return { component: "section", _uid: randomUUID(), heading: blok.heading, body: blok.body };
    case "faq":
      return {
        component: "faq",
        _uid: randomUUID(),
        items: blok.items.map((it) => ({
          component: "faq_item",
          _uid: randomUUID(),
          question: it.question,
          answer: it.answer,
        })),
      };
  }
}

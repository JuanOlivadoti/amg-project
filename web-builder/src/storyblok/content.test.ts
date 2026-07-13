import { test } from "node:test";
import assert from "node:assert/strict";
import { toStoryblokContent } from "./content.js";
import { pageToStory } from "../handoff/adapter.js";
import { validBrief, validPage } from "../fixtures.js";

function build() {
  return toStoryblokContent(pageToStory(validPage(), validBrief()));
}

test("toStoryblokContent: el page raíz lleva _uid y component", () => {
  const c = build();
  assert.equal(c.component, "page");
  assert.equal(typeof c._uid, "string");
});

test("toStoryblokContent: cada blok del body lleva _uid", () => {
  const body = build().body as Array<{ _uid?: string }>;
  assert.ok(body.length > 0);
  assert.ok(body.every((b) => typeof b._uid === "string"));
});

test("toStoryblokContent: los items de FAQ son bloks faq_item con _uid", () => {
  const body = build().body as Array<{ component: string; items?: Array<{ component: string; _uid: string }> }>;
  const faq = body.find((b) => b.component === "faq");
  assert.ok(faq?.items?.length);
  assert.ok(faq!.items!.every((it) => it.component === "faq_item" && typeof it._uid === "string"));
});

test("#13 toStoryblokContent: preserva canonical, OG, claims y source_keyword", () => {
  const c = build() as Record<string, unknown>;
  assert.equal(c.seo_canonical, "/restaurante-italiano-madrid-centro");
  assert.equal(c.og_title, "Restaurante Italiano en Madrid Centro");
  assert.equal(c.claims_prohibidos, "el mejor de Madrid");
  assert.equal(c.source_keyword, "restaurante italiano madrid centro");
});

test("#13 toStoryblokContent: SEO aplanado (seo_title/seo_description, no objeto anidado)", () => {
  const c = build() as Record<string, unknown>;
  assert.equal(typeof c.seo_title, "string");
  assert.equal(c.seo, undefined);
});

test("#12 toStoryblokContent: republicar el mismo contenido produce los MISMOS _uid", () => {
  // Antes se usaba randomUUID(): cada publicación regeneraba todos los _uid y Storyblok veía
  // bloks nuevos aunque nada hubiera cambiado.
  assert.deepEqual(build(), build());
});

test("#12 toStoryblokContent: los _uid dependen de la identidad del blok, no del orden", () => {
  const a = toStoryblokContent(pageToStory(validPage(), validBrief()));
  // Misma página con una sección extra: las secciones originales conservan su _uid.
  const b = toStoryblokContent(
    pageToStory(
      validPage({
        content_brief: {
          ...validPage().content_brief,
          secciones_sugeridas: ["Nueva Primera", "Sobre Nosotros", "Especialidades"],
        },
      }),
      validBrief(),
    ),
  );
  const uidOf = (c: Record<string, unknown>, heading: string) =>
    (c.body as Array<{ component: string; heading?: string; _uid: string }>).find(
      (x) => x.component === "section" && x.heading === heading,
    )?._uid;

  assert.equal(uidOf(a, "Sobre Nosotros"), uidOf(b, "Sobre Nosotros"));
  assert.equal(uidOf(a, "Especialidades"), uidOf(b, "Especialidades"));
});

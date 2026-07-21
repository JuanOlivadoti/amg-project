import { test } from "node:test";
import assert from "node:assert/strict";
import { fromStoryblokContent, toStoryblokContent } from "./content.js";
import { pageToStory } from "../handoff/adapter.js";
import { renderStory } from "../render/html.js";
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

// ---------------------------------------------------------------- el ida-y-vuelta (10ª review + demo)
//
// La costura que NINGÚN test cruzaba: web-builder produce una Story → toStoryblokContent la aplana →
// Storyblok la guarda → el renderizador la lee → renderStory la consume. La forma aplanada NO es la
// que renderStory espera (`seo` objeto vs `seo_title` plano). Lo cazó la demo contra el space real.

test("fromStoryblokContent: deshace el aplanado (seo_title → seo.title)", () => {
  const guardado = build(); // forma Storyblok (plana)
  const story = fromStoryblokContent({ name: "X", slug: "italiano-madrid", content: guardado });

  assert.equal(story.content.component, "page");
  assert.equal(story.content.seo.title, guardado["seo_title"], "el seo anidado se reconstruye");
  assert.equal(story.content.seo.canonical, guardado["seo_canonical"]);
  assert.ok(Array.isArray(story.content.body) && story.content.body.length > 0);
});

test("🔴 round-trip: renderStory NO explota con lo que Storyblok devuelve", () => {
  // El bug real: renderStory(contenido_plano) hacía `c.seo.title` con `c.seo` undefined → TypeError.
  const guardado = build();
  const story = fromStoryblokContent({ name: "X", slug: "italiano-madrid", content: guardado });

  const html = renderStory(story); // antes: TypeError → 500 → 503 en el renderizador
  assert.match(html, /<h1>/, "sale una página con su H1");
  assert.match(html, /application\/ld\+json/, "y su JSON-LD");
});

test("🔴 round-trip: las FAQ sobreviven el viaje (faq_item → items)", () => {
  const guardado = build();
  const story = fromStoryblokContent({ name: "X", slug: "italiano-madrid", content: guardado });
  const faq = story.content.body.find((b) => b.component === "faq");

  assert.ok(faq && faq.component === "faq" && faq.items.length > 0, "las FAQ vuelven como items");
  // Las preguntas son la identidad del item; sobreviven textualmente. (Las respuestas las rellena
  // el LLM después del handoff, así que en la fixture están vacías — y así deben round-trippear.)
  assert.deepEqual(
    faq.items.map((it) => it.question),
    ["¿Tienen opciones sin gluten?", "¿Cómo reservo?"],
  );
  assert.ok(faq.items.every((it) => typeof it.answer === "string"), "la respuesta round-trippea fiel");
});

test("fromStoryblokContent: un blok desconocido se ignora, no rompe", () => {
  const story = fromStoryblokContent({
    slug: "x",
    content: { component: "page", body: [{ component: "widget_raro", foo: 1 }, { component: "hero", headline: "H", subhead: "S" }] },
  });
  assert.equal(story.content.body.length, 1, "el blok raro se descarta");
  assert.equal(story.content.body[0]!.component, "hero");
});

test("fromStoryblokContent: contenido vacío no explota (falla suave)", () => {
  const story = fromStoryblokContent({ content: {} });
  assert.equal(story.content.body.length, 0);
  assert.doesNotThrow(() => renderStory(story), "una página sin bloks sale, no revienta");
});

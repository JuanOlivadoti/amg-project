import { test } from "node:test";
import assert from "node:assert/strict";
import { briefToStories, normalizeSlug, pageToStory } from "./adapter.js";
import { validBrief, validPage } from "../fixtures.js";

test("normalizeSlug: quita la barra inicial del brief", () => {
  assert.equal(normalizeSlug("/restaurante-italiano-madrid"), "restaurante-italiano-madrid");
});

test("normalizeSlug: vacío → 'inicio'", () => {
  assert.equal(normalizeSlug("/"), "inicio");
});

test("briefToStories: una página → una story", () => {
  const stories = briefToStories(validBrief());
  assert.equal(stories.length, 1);
  assert.equal(stories[0]!.content.component, "page");
});

test("pageToStory: mapea hero + secciones + faq en el body", () => {
  const story = pageToStory(validPage(), validBrief());
  const comps = story.content.body.map((b) => b.component);
  assert.deepEqual(comps, ["hero", "section", "section", "faq"]);
});

test("pageToStory: preserva SEO, schema_type e intención", () => {
  const story = pageToStory(validPage(), validBrief());
  assert.equal(story.content.schema_type, "LocalBusiness");
  assert.equal(story.content.intent, "local");
  assert.equal(story.content.seo.canonical, "/restaurante-italiano-madrid-centro");
});

test("pageToStory: sin FAQs no agrega el blok faq", () => {
  const story = pageToStory(validPage({ preguntas_frecuentes: [] }), validBrief());
  assert.ok(!story.content.body.some((b) => b.component === "faq"));
});

test("pageToStory: traza el contrato editorial en meta", () => {
  const story = pageToStory(validPage(), validBrief());
  assert.deepEqual(story.content.meta.claims_prohibidos, ["el mejor de Madrid"]);
  assert.equal(story.content.meta.source_keyword, "restaurante italiano madrid centro");
});

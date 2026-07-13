import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStory } from "./html.js";
import { pageToStory } from "../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../fixtures.js";

const story = () => pageToStory(validPage(), validBrief());

/** Extrae y parsea el bloque JSON-LD del HTML. */
function extractLd(html: string): { "@graph": Array<{ "@type": string; [k: string]: unknown }> } {
  const m = html.match(/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(m, "debe existir el bloque ld+json");
  return JSON.parse(m![1]!);
}

test("#15 render: <html lang> sale del brief (no hardcodeado)", () => {
  const html = renderStory(story(), null, "ca");
  assert.match(html, /<html lang="ca">/);
});

test("#17 render: id 'contacto' y 'faq' no se duplican", () => {
  const html = renderStory(story(), validProfile());
  assert.equal((html.match(/id="contacto"/g) ?? []).length, 1);
  assert.equal((html.match(/id="faq"/g) ?? []).length, 1);
});

test("#16 render: canonical del brief resuelto contra el dominio del perfil", () => {
  const html = renderStory(story(), validProfile());
  assert.match(html, /rel="canonical" href="https:\/\/trattoriabellanapoli\.es\/restaurante-italiano-madrid-centro"/);
});

test("#16 render: sin perfil, canonical queda relativo (el frontend le pone base)", () => {
  const html = renderStory(story(), null);
  assert.match(html, /rel="canonical" href="\/restaurante-italiano-madrid-centro"/);
});

test("#9 render: neutraliza intento de XSS en el título (no hay </script><script> crudo)", () => {
  const malicious = validPage({
    seo: {
      meta_title: "Pizza </script><script>alert(1)</script>",
      meta_description: "desc",
      schema_type: "LocalBusiness",
      canonical: "/x",
    },
  });
  const html = renderStory(pageToStory(malicious, validBrief()), null);
  assert.ok(!/<\/script><script>alert/i.test(html), "no debe haber cierre de script crudo");
  assert.match(html, /\\u003c\/script\\u003e/, "el título debe quedar escapado en el JSON-LD");
});

test("render: JSON-LD incluye LocalBusiness y FAQPage en el @graph", () => {
  const graph = extractLd(renderStory(story(), validProfile()))["@graph"];
  const types = graph.map((n) => n["@type"]);
  assert.ok(types.includes("LocalBusiness"));
  assert.ok(types.includes("FAQPage"));
});

test("#13 render: con perfil, LocalBusiness incluye telephone y address", () => {
  const graph = extractLd(renderStory(story(), validProfile()))["@graph"];
  const lb = graph.find((n) => n["@type"] === "LocalBusiness") as unknown as {
    telephone: string;
    address: { "@type": string };
  };
  assert.equal(lb.telephone, "+34 911 23 45 67");
  assert.equal(lb.address["@type"], "PostalAddress");
});

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

// ---------------------------------------------------------------- marca por tenant (tema)

test("tema: un color de marca válido pinta el acento", () => {
  const html = renderStory(story(), validProfile({ brand: { color: "#0a7d34" } }));
  assert.match(html, /--accent:#0a7d34/, "el hex de marca entra como variable CSS");
});

test("🔴 tema: un color con inyección CSS se DESCARTA, no se inyecta", () => {
  // El color va dentro de un <style>. `red;} body{display:none} .x{` rompería la página.
  const html = renderStory(story(), validProfile({ brand: { color: "red;}body{display:none}" } as never }));
  assert.doesNotMatch(html, /display:none/, "el valor malicioso no llega a la hoja de estilo");
  assert.doesNotMatch(html, /--accent:red/, "y tampoco se acepta un color no-hex");
});

test("🔴 tema: la fuente sale de una allowlist, no es texto libre", () => {
  const ok = renderStory(story(), validProfile({ brand: { font: "serif" } }));
  assert.match(ok, /--font:Georgia/, "la fuente elegida mapea a un stack seguro");

  // Un valor fuera de la allowlist se ignora (no se puede escribir el stack a mano).
  const malo = renderStory(story(), validProfile({ brand: { font: "</style><script>" } as never }));
  assert.doesNotMatch(malo, /<\/style><script>/);
});

test("marca: el logo aparece en la cabecera del sitio, escapado", () => {
  const html = renderStory(story(), validProfile({ brand: { logo: "https://cdn.ej/logo.png" } }));
  assert.match(html, /class="sitebar"/, "hay cabecera de sitio");
  assert.match(html, /<img class="logo" src="https:\/\/cdn\.ej\/logo\.png"/);
});

test("marca: sin logo, la cabecera muestra el nombre del negocio", () => {
  const html = renderStory(story(), validProfile());
  assert.match(html, /class="marca">Trattoria Bella Napoli/);
});

test("sin perfil no hay cabecera de sitio (falla suave)", () => {
  assert.doesNotMatch(renderStory(story()), /class="sitebar"/);
});

// ---------------------------------------------------------------- imágenes de contenido

test("imagen: el hero renderiza su foto con lazy, alt y dimensiones del asset", () => {
  const s = story();
  const hero = s.content.body.find((b) => b.component === "hero")!;
  (hero as { image?: unknown }).image = {
    src: "https://a.storyblok.com/f/1/1600x900/abc/portada.jpg",
    alt: "Fachada del restaurante",
  };
  const html = renderStory(s);

  assert.match(html, /class="hero-img"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /alt="Fachada del restaurante"/);
  assert.match(html, /width="1600" height="900"/, "las dimensiones salen de la URL de Storyblok (anti-CLS)");
});

test("🔴 imagen: una src no-http no se renderiza (una img rota es peor que ninguna)", () => {
  const s = story();
  const hero = s.content.body.find((b) => b.component === "hero")!;
  (hero as { image?: unknown }).image = { src: "javascript:alert(1)", alt: "x" };
  // Ojo: `.hero-img` está siempre en el CSS; lo que NO debe aparecer es la etiqueta <img>.
  assert.doesNotMatch(renderStory(s), /<img class="hero-img"/);
});

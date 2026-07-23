import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHome, renderStory } from "./html.js";
import { pageToStory } from "../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../fixtures.js";
import type { NavItem } from "../types.js";

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

// ---------------------------------------------------------------- navegación entre páginas

const nav: NavItem[] = [
  { slug: "menu", name: "La carta" },
  { slug: "reservas", name: "Reservas" },
];

test("nav: renderStory pinta una barra con enlace a cada página", () => {
  const html = renderStory(story(), validProfile(), "es", nav);
  assert.match(html, /<nav class="nav"/, "hay barra de navegación");
  assert.match(html, /href="\/menu"[^>]*>La carta<\/a>/);
  assert.match(html, /href="\/reservas"[^>]*>Reservas<\/a>/);
});

test("nav: la página actual se marca como activa y no se pierde el resto", () => {
  // La story de fixture tiene slug 'restaurante-italiano-madrid-centro'; incluímos esa entrada.
  const conActual: NavItem[] = [...nav, { slug: story().slug, name: "Inicio real" }];
  const html = renderStory(story(), validProfile(), "es", conActual);
  assert.match(html, /href="\/restaurante-italiano-madrid-centro"[^>]*aria-current="page"/);
});

test("🔴 nav: el nombre de una página se escapa (no inyecta markup)", () => {
  // El `name` viene del space (Storyblok) → superficie de inyección en el texto del enlace.
  const veneno: NavItem[] = [{ slug: "x", name: "</a><script>alert(1)</script>" }];
  const html = renderStory(story(), validProfile(), "es", veneno);
  assert.doesNotMatch(html, /<\/a><script>alert/, "el markup del nombre no puede salir crudo");
  assert.match(html, /&lt;script&gt;/, "el nombre queda escapado");
});

test("🔴 nav: un slug hostil sale como ruta, nunca como esquema ni con salto de atributo", () => {
  // El `slug` va dentro de un href. `javascript:` no puede quedar como esquema; unas comillas no
  // pueden cerrar el atributo; un `..` no puede escalar la ruta.
  const veneno: NavItem[] = [
    { slug: 'javascript:alert(1)', name: "js" },
    { slug: '"><script>alert(1)</script>', name: "quote" },
    { slug: "../../secreto", name: "escape" },
  ];
  const html = renderStory(story(), validProfile(), "es", veneno);
  assert.doesNotMatch(html, /href="javascript:/i, "nunca un esquema ejecutable en el href");
  assert.doesNotMatch(html, /"><script>/, "las comillas no cierran el atributo");
  assert.doesNotMatch(html, /href="\/\.\.\//, "los segmentos de navegación se descartan");
});

test("nav: se limita el número de enlaces (una nav no son 200 páginas)", () => {
  const muchas: NavItem[] = Array.from({ length: 30 }, (_, i) => ({
    slug: `p-${i}`,
    name: `Página ${i}`,
  }));
  const html = renderStory(story(), validProfile(), "es", muchas);
  const enlaces = html.match(/class="nav"[^>]*>([\s\S]*?)<\/nav>/)![1]!.match(/<a /g) ?? [];
  assert.ok(enlaces.length <= 8, `la barra no debe pintar 30 enlaces, pintó ${enlaces.length}`);
});

test("sin nav (y sin cambio de firma) el render sigue igual: no hay barra", () => {
  assert.doesNotMatch(renderStory(story(), validProfile()), /<nav class="nav"/);
});

// ---------------------------------------------------------------- home sintetizada

test("home: sintetiza una portada válida con el nombre del negocio y el índice de páginas", () => {
  const html = renderHome(validProfile(), nav, "es");
  assert.match(html, /^<!doctype html>/, "es una página completa");
  assert.match(html, /<h1>Trattoria Bella Napoli<\/h1>/, "el hero es el nombre del negocio");
  assert.match(html, /class="card" href="\/menu"><h3>La carta<\/h3>/);
  assert.match(html, /class="card" href="\/reservas"><h3>Reservas<\/h3>/);
  assert.match(html, /application\/ld\+json/, "la home también lleva JSON-LD");
  assert.match(html, /"@type": "LocalBusiness"/, "con perfil, la home es un LocalBusiness");
});

test("home: sin páginas publicadas la portada no rompe, avisa que vendrán", () => {
  const html = renderHome(validProfile(), [], "es");
  assert.match(html, /<h1>Trattoria Bella Napoli<\/h1>/);
  assert.doesNotMatch(html, /class="cards"/, "sin páginas no hay grid");
  assert.match(html, /class="pending"/, "hay un aviso en su lugar");
});

test("🔴 home: el nombre y el slug de una tarjeta se escapan/sanean como en la nav", () => {
  const veneno: NavItem[] = [{ slug: 'javascript:alert(1)', name: "</h3><script>x</script>" }];
  const html = renderHome(validProfile(), veneno, "es");
  assert.doesNotMatch(html, /<\/h3><script>/, "el nombre de la tarjeta no sale crudo");
  assert.doesNotMatch(html, /href="javascript:/i, "el slug de la tarjeta tampoco es un esquema");
});

test("home: sin perfil cae a un WebSite y un título neutro (falla suave)", () => {
  const html = renderHome(null, nav, "es");
  assert.match(html, /<h1>Inicio<\/h1>/);
  assert.match(html, /"@type": "WebSite"/);
});

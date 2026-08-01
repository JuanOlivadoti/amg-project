import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBlogIndex, renderHome, renderMenu, renderStory } from "./html.js";
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

test("JSON-LD: con solo `locations` (sin address/telephone de nivel superior, como el perfil real de La Birra Bar), el LocalBusiness toma el primer local", () => {
  const perfil = validProfile({
    address: undefined,
    telephone: undefined,
    opening_hours: undefined,
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
        telephone: "+34 900 000 000",
      },
      {
        name: "Salamanca",
        address: { streetAddress: "Ortega y Gasset 79", addressLocality: "Madrid" },
      },
    ],
  });
  const graph = extractLd(renderStory(story(), perfil))["@graph"];
  const lb = graph.find((n) => n["@type"] === "LocalBusiness") as unknown as {
    telephone?: string;
    address?: { "@type": string; streetAddress: string };
  };
  assert.equal(lb.address?.streetAddress, "Carrera de San Jerónimo 3", "toma la dirección del PRIMER local");
  assert.equal(lb.telephone, "+34 900 000 000", "toma el teléfono del PRIMER local");
});

test("🔴 revisión externa #2 — con AMBOS (telephone/address clásicos Y locations con datos distintos), LOCATIONS manda — el comentario ya lo decía, el código hacía lo contrario", () => {
  const perfil = validProfile({
    telephone: "+34 000",
    address: { streetAddress: "Calle Vieja 1", addressLocality: "Madrid" },
    locations: [
      {
        name: "Centro",
        telephone: "+34 111",
        address: { streetAddress: "Calle Nueva 5", addressLocality: "Madrid" },
      },
    ],
  });

  const graphStory = extractLd(renderStory(story(), perfil))["@graph"];
  const lbStory = graphStory.find((n) => n["@type"] === "LocalBusiness") as unknown as {
    telephone?: string;
    address?: { streetAddress: string };
  };
  assert.equal(lbStory.telephone, "+34 111", "renderStory: locations manda sobre el teléfono clásico");
  assert.equal(lbStory.address?.streetAddress, "Calle Nueva 5", "renderStory: locations manda sobre la dirección clásica");

  const htmlHome = renderHome(perfil, [], "es");
  const ldHome = JSON.parse(htmlHome.split('<script type="application/ld+json">')[1]!.split("</script>")[0]!);
  assert.equal(ldHome.telephone, "+34 111", "renderHome: locations manda también acá");
  assert.equal(ldHome.address?.streetAddress, "Calle Nueva 5", "renderHome: idem para la dirección");
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

test("nav: la barra son las secciones del sitio, no las páginas de research", () => {
  const perfil = validProfile({ menu: [{ name: "Golden Burger" }] });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.match(html, /<a href="\/"[^>]*>Inicio<\/a>/);
  assert.match(html, /<a href="\/menu"[^>]*>Menú<\/a>/);
  assert.match(html, /<a href="#ubicaciones"[^>]*>Ubicaciones<\/a>/);
  assert.match(html, /<a href="#contacto"[^>]*>Contacto<\/a>/);
  // Y NO el título SEO de la página, que es lo que la hacía parecer un blog.
  assert.ok(!/<nav[^>]*>[\s\S]*?Menú del día[\s\S]*?<\/nav>/.test(html));
});

test("nav: sin carta cargada no hay enlace a Menú (un enlace a una sección vacía es peor que ninguno)", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es");
  assert.ok(!html.includes(">Menú<"));
  assert.match(html, /<a href="\/"[^>]*>Inicio<\/a>/);
});

test("nav: sin locales ni dirección no hay enlace a Ubicaciones", () => {
  const perfil = validProfile({ address: undefined, opening_hours: undefined, telephone: undefined });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.ok(!html.includes(">Ubicaciones<"));
});

test("nav: el link a Menú lleva aria-current en la propia página /menu", () => {
  const perfil = validProfile({ menu: [{ name: "Golden Burger" }] });
  const html = renderMenu(perfil, "es");
  assert.match(html, /<a href="\/menu" class="activo" aria-current="page">Menú<\/a>/);
});

// ---------------------------------------------------------------- la página /menu

test("menu: agrupa la carta por categoría, en orden de aparición", () => {
  const perfil = validProfile({
    menu: [
      { category: "Hamburguesas", name: "Golden Burger", description: "La insignia", price: "12,50 €" },
      { category: "Cervezas", name: "Ale" },
      { category: "Hamburguesas", name: "Clásica" },
    ],
  });
  const html = renderMenu(perfil, "es");
  assert.match(html, /Hamburguesas/);
  assert.match(html, /Golden Burger/);
  assert.match(html, /12,50 €/);
  assert.match(html, /Cervezas/);
  assert.match(html, /Ale/);
  // Las dos hamburguesas van juntas, antes de Cervezas.
  assert.ok(html.indexOf("Clásica") < html.indexOf("Cervezas"));
});

test("menu: los ítems sin categoría van juntos al final", () => {
  const perfil = validProfile({
    menu: [{ name: "Suelto" }, { category: "Cervezas", name: "Ale" }],
  });
  const html = renderMenu(perfil, "es");
  assert.ok(html.indexOf("Ale") < html.indexOf("Suelto"));
});

test("menu: JSON-LD Menu con sus secciones", () => {
  const perfil = validProfile({ menu: [{ category: "Cervezas", name: "Ale", price: "5 €" }] });
  const ld = JSON.parse(renderMenu(perfil, "es").split('<script type="application/ld+json">')[1]!.split("</script>")[0]!);
  assert.equal(ld["@type"], "Menu");
  assert.equal(ld.hasMenuSection[0]["@type"], "MenuSection");
  assert.equal(ld.hasMenuSection[0].hasMenuItem[0].name, "Ale");
});

test("🔴 menu: el nombre y el precio de un ítem se escapan", () => {
  const perfil = validProfile({ menu: [{ name: "<script>alert(1)</script>", price: '"><b>' }] });
  const html = renderMenu(perfil, "es");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes('"><b>'));
});

test("menu: sin carta, la página no promete nada (no rompe)", () => {
  const html = renderMenu(validProfile(), "es");
  assert.match(html, /<h1>/);
  assert.ok(!html.includes("<script type=\"application/ld+json\">\n{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"Menu\",\n  \"hasMenuSection\": []"));
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

test("home JSON-LD: con solo `locations` (sin address/telephone de nivel superior), el LocalBusiness de la home toma el primer local", () => {
  const perfil = validProfile({
    address: undefined,
    telephone: undefined,
    opening_hours: undefined,
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
        telephone: "+34 900 000 000",
      },
    ],
  });
  const html = renderHome(perfil, nav, "es");
  const ld = JSON.parse(html.split('<script type="application/ld+json">')[1]!.split("</script>")[0]!);
  assert.equal(ld.address?.streetAddress, "Carrera de San Jerónimo 3", "toma la dirección del PRIMER local");
  assert.equal(ld.telephone, "+34 900 000 000", "toma el teléfono del PRIMER local");
});

test("home: sin perfil cae a un WebSite y un título neutro (falla suave)", () => {
  const html = renderHome(null, nav, "es");
  assert.match(html, /<h1>Inicio<\/h1>/);
  assert.match(html, /"@type": "WebSite"/);
});

// ---------------------------------------------------------------- footer compartido (contacto + ubicaciones + blog)

test("footer: el contacto vive en el pie y está en todas las páginas", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es");
  const pie = html.slice(html.indexOf("<footer"));
  assert.match(pie, /id="contacto"/);
  assert.match(pie, /Trattoria Bella Napoli/);
  // Y ya NO está dentro de <main>: era una sección repetida en cada landing.
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  assert.ok(!main.includes('id="contacto"'));
});

test("footer: lista todos los locales, cada uno con su dirección y horario", () => {
  const perfil = validProfile({
    locations: [
      { name: "Centro", address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" }, opening_hours: "11:00-01:00" },
      { name: "Salamanca", address: { streetAddress: "Ortega y Gasset 79", addressLocality: "Madrid" }, opening_hours: "hasta la 01:00" },
    ],
  });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.match(html, /id="ubicaciones"/);
  assert.match(html, /Centro/);
  assert.match(html, /San Jerónimo 3/);
  assert.match(html, /Salamanca/);
  assert.match(html, /Ortega y Gasset 79/);
});

test("footer: la dirección de un local lleva coma entre la calle y la ciudad, con o sin código postal", () => {
  const perfil = validProfile({
    locations: [
      { name: "Sin CP", address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" } },
      {
        name: "Con CP",
        address: { streetAddress: "Ortega y Gasset 79", addressLocality: "Madrid", postalCode: "28006" },
      },
    ],
  });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.match(html, /Carrera de San Jerónimo 3, Madrid/, "sin código postal, la coma va después de la calle");
  assert.match(html, /Ortega y Gasset 79, 28006 Madrid/, "con código postal, la coma sigue yendo después de la calle");
  assert.ok(!html.includes("Carrera de San Jerónimo 3 Madrid"), "nunca sin coma entre calle y ciudad");
});

test("footer: un perfil clásico (sin locations) sigue mostrando su dirección", () => {
  // Compatibilidad hacia atrás: el negocio de un solo local no tiene que tocar su JSON.
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es");
  assert.match(html, /id="ubicaciones"/);
  assert.match(html, /Calle Mayor 12/);
});

test("🔴 revisión externa #2 — el footer 'Contacto' también respeta la precedencia de locations sobre el teléfono clásico", () => {
  const perfil = validProfile({
    telephone: "+34 000",
    locations: [{ name: "Centro", telephone: "+34 111" }],
  });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  const inicio = html.indexOf('id="contacto"');
  const contacto = html.slice(inicio, html.indexOf("</section>", inicio));
  assert.match(contacto, /\+34 111/, "el Contacto muestra el teléfono de locations");
  assert.ok(!contacto.includes("+34 000"), "no el teléfono clásico de nivel superior, que quedó viejo");
});

test("footer: sin páginas de blog no hay enlace al blog", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es", false);
  assert.ok(!/href="\/blog"/.test(html));
});

test("footer: con páginas de blog aparece el enlace, solo en el pie", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), validProfile(), "es", true);
  assert.match(html.slice(html.indexOf("<footer")), /href="\/blog"/);
  const cabecera = html.slice(html.indexOf("<header"), html.indexOf("</header>"));
  assert.ok(!cabecera.includes('href="/blog"'));
});

test("🔴 footer: el nombre de un local se escapa (viene de la base, sin Zod)", () => {
  const perfil = validProfile({
    locations: [{ name: '</p><script>alert(1)</script>', opening_hours: "11:00" }],
  });
  const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es");
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

test("footer: sin perfil queda solo la línea técnica (falla suave)", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), null, "es");
  assert.match(html, /contrato web\.v0\.1/);
  assert.ok(!html.includes('id="contacto"'));
});

// ---------------------------------------------------------------- el índice /blog

test("blog: lista los posts como tarjetas enlazadas", () => {
  const posts: NavItem[] = [
    { slug: "mejor-hamburguesa-dubai", name: "La mejor hamburguesa del mundo" },
    { slug: "burger-bash-miami", name: "Premiados en Miami" },
  ];
  const html = renderBlogIndex(validProfile(), posts, "es");
  assert.match(html, /href="\/mejor-hamburguesa-dubai"/);
  assert.match(html, /La mejor hamburguesa del mundo/);
  assert.match(html, /href="\/burger-bash-miami"/);
});

test("🔴 blog: el nombre y el slug de un post se escapan/sanean", () => {
  const posts: NavItem[] = [{ slug: "javascript:alert(1)", name: "<img src=x onerror=alert(1)>" }];
  const html = renderBlogIndex(validProfile(), posts, "es");
  assert.ok(!html.includes("<img src=x onerror=alert(1)>"));
  assert.ok(!html.includes('href="javascript:alert(1)"'));
});

test("blog: en el índice del blog el pie no se autoenlaza (con o sin artículos)", () => {
  const posts: NavItem[] = [{ slug: "mejor-hamburguesa-dubai", name: "La mejor hamburguesa del mundo" }];

  const sinPosts = renderBlogIndex(validProfile(), [], "es");
  assert.match(sinPosts, /<h1>/);
  assert.ok(!sinPosts.includes('href="/blog"'), "sin artículos, el pie tampoco ofrece /blog");

  const conPosts = renderBlogIndex(validProfile(), posts, "es");
  assert.ok(!conPosts.includes('href="/blog"'), "con artículos, el pie de /blog no se enlaza a sí mismo");
});

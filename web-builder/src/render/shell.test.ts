import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToStory } from "../handoff/adapter.js";
import { perfilConManual, perfilLegacy, validBrief, validPage, validProfile } from "../fixtures.js";
import { perfilCompleto } from "./ctx-de-prueba.js";
import { renderBlogIndex, renderHome, renderMenu, renderStory } from "./html.js";

/**
 * **El shell es lo que la receta NO puede tocar.**
 *
 * `cabecera`, `contacto` y `locales` no son contenido: son obligaciones del documento y de la
 * navegación. El nav ancla a `#ubicaciones` y a `#contacto` desde *todas* las páginas, así que esas
 * regiones tienen que existir en todas **por construcción**. El tipo `Plantilla` solo tiene
 * `contenido`, así que ninguna receta puede omitirlas ni duplicarlas — y esto lo confirma sobre el
 * HTML emitido, que es donde importa.
 */

const PERFIL = perfilCompleto();
const PAGINAS = [{ slug: "pizzeria-chamberi", name: "Pizzería en Chamberí" }];

/** Las cuatro páginas que el renderizador sabe servir, con una ficha que dispara todas las piezas. */
function lasCuatro(): Array<[string, string]> {
  return [
    ["landing", renderStory(pageToStory(validPage(), validBrief()), PERFIL, "es", true)],
    ["home", renderHome(PERFIL, PAGINAS, "es", true)],
    ["/menu", renderMenu(PERFIL, "es", true)],
    ["/blog", renderBlogIndex(PERFIL, PAGINAS, "es")],
  ];
}

test("`id=\"ubicaciones\"` aparece EXACTAMENTE una vez en la landing, la home, /menu y /blog", () => {
  // Ni cero (el nav apuntaría a la nada desde todas las páginas) ni dos (un `id` duplicado hace que
  // el navegador salte al primero y el segundo sea inalcanzable). Es dueña una sola pieza, `locales`.
  for (const [nombre, html] of lasCuatro()) {
    assert.equal((html.match(/id="ubicaciones"/g) ?? []).length, 1, `${nombre}: id="ubicaciones"`);
  }
});

test("`id=\"contacto\"` aparece EXACTAMENTE una vez en las cuatro, y siempre en el pie", () => {
  for (const [nombre, html] of lasCuatro()) {
    assert.equal((html.match(/id="contacto"/g) ?? []).length, 1, `${nombre}: id="contacto"`);
    const pie = html.slice(html.indexOf("<footer"));
    assert.match(pie, /id="contacto"/, `${nombre}: el contacto tiene que vivir en el pie`);
    const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
    assert.ok(!main.includes('id="contacto"'), `${nombre}: y NO dentro de <main>`);
  }
});

test("ninguna receta puede omitir la cabecera ni el pie: las cuatro páginas los llevan", () => {
  for (const [nombre, html] of lasCuatro()) {
    assert.match(html, /<div class="p-cabecera">/, `${nombre}: falta la cabecera`);
    assert.match(html, /<footer>/, `${nombre}: falta el pie`);
    assert.match(html, /class="tecnica"/, `${nombre}: falta la línea técnica`);
    // Y en el orden del shell: cabecera antes de <main>, pie después.
    assert.ok(html.indexOf('class="p-cabecera"') < html.indexOf("<main>"), `${nombre}: cabecera fuera de sitio`);
    assert.ok(html.indexOf("</main>") < html.indexOf("<footer"), `${nombre}: el pie no puede subir al cuerpo`);
  }
});

test("la receta manda SOLO dentro de <main>: el nav ancla y el JSON-LD viven fuera", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), PERFIL, "es", true);
  const main = html.slice(html.indexOf("<main>"), html.indexOf("</main>"));
  assert.ok(!main.includes('id="ubicaciones"'), "las ubicaciones son del pie, no del contenido");
  assert.ok(!main.includes("ld+json"), "el JSON-LD es una propiedad del documento, no de una pieza");
  assert.ok(!main.includes('class="sitebar"'), "la cabecera es del shell");
});

test("sin locales, `id=\"ubicaciones\"` no existe — y el nav tampoco lo ofrece (no queda ancla huérfana)", () => {
  const pelado = validProfile({
    address: undefined,
    telephone: undefined,
    opening_hours: undefined,
    locations: [],
  });
  for (const html of [
    renderStory(pageToStory(validPage(), validBrief()), pelado, "es", false),
    renderHome(pelado, PAGINAS, "es", false),
    renderMenu(pelado, "es", false),
    renderBlogIndex(pelado, PAGINAS, "es"),
  ]) {
    assert.ok(!html.includes('id="ubicaciones"'), "sin datos, la región no se dibuja");
    assert.ok(!html.includes('href="#ubicaciones"'), "y el enlace tampoco: las dos salen del mismo dato");
  }
});

test("sin perfil el documento sigue siendo válido: sin cabecera, con la línea técnica", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), null, "es", false);
  assert.match(html, /^<!doctype html>/);
  assert.ok(!html.includes('class="sitebar"'), "una página suelta sin sitio no lleva barra");
  assert.ok(!html.includes('id="contacto"'));
  assert.match(html, /contrato web\.v0\.1/, "la línea técnica siempre");
  assert.match(html, /<\/html>$/);
});

test("el <head> lleva title, canonical y og:url resueltos de la MISMA fuente", () => {
  const html = renderStory(pageToStory(validPage(), validBrief()), PERFIL);
  const canonical = html.match(/rel="canonical" href="([^"]*)"/)?.[1];
  const ogUrl = html.match(/property="og:url" content="([^"]*)"/)?.[1];
  assert.equal(canonical, ogUrl, "canonical y og:url no pueden divergir: es el mismo hecho dicho dos veces");
});

// ─────────────────────────────────────────────────────────────────────────────
// La conducta del `<head>`, que el gate de paridad NO cubre.
//
// El gate compara texto visible, `href`, `id`, JSON-LD y la traza de research: el `<head>` queda casi
// entero fuera. Estos tests fijan las dos decisiones que se tomaron ahí, para que la próxima persona
// las cambie a propósito y no de paso.
// ─────────────────────────────────────────────────────────────────────────────

test("una descripción vacía NO emite `<meta name=\"description\">` — decisión declarada, ver shell.ts", () => {
  // El render viejo era mixto: `renderStory` la emitía con `content=""` y `renderHome` la omitía.
  // Se unificó en omitirla. Alcanzable en PROD: la story llega de la CDA sin pasar por Zod, así que
  // un `seo_description` vacío en el Visual Editor produce exactamente este caso.
  const story = pageToStory(validPage(), validBrief());
  story.content.seo.description = "";
  story.content.seo.og_description = "";
  const html = renderStory(story, PERFIL, "es", true);

  assert.doesNotMatch(html, /<meta name="description"/, "no debe emitir la etiqueta con content vacío");
  assert.doesNotMatch(html, /<meta property="og:description"/);
  // Pero el resto del <head> sigue entero: omitir una etiqueta no puede llevarse las demás.
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<link rel="canonical"/);
  assert.match(html, /<meta property="og:title"/);
});

test("con descripción, las dos etiquetas salen y van escapadas", () => {
  const story = pageToStory(validPage(), validBrief());
  story.content.seo.description = 'Pizza & pasta "de verdad"';
  story.content.seo.og_description = "<script>alert(1)</script>";
  const html = renderStory(story, PERFIL, "es", true);

  assert.match(html, /<meta name="description" content="Pizza &amp; pasta &quot;de verdad&quot;">/);
  assert.doesNotMatch(html, /<meta property="og:description" content="<script>/);
  assert.match(html, /&lt;script&gt;/);
});

// ─────────────────────────────────────────────────────────────────────────────
// El `preload` de la fuente de titulares (entrega 3, mitad C).
//
// «`preload` **solo** de la fuente de titulares. Precargar tres familias es competir contra el propio
// LCP» — spec, §Enmienda 2026-08-02 › Las tipografías, self-hosted, punto 3.
// ─────────────────────────────────────────────────────────────────────────────

/** Las mismas cuatro páginas, con la ficha que SÍ pide familias self-hosted. */
function lasCuatroConManual(): Array<[string, string]> {
  const p = perfilConManual();
  return [
    ["landing", renderStory(pageToStory(validPage(), validBrief()), p, "es", true)],
    ["home", renderHome(p, PAGINAS, "es", true)],
    ["/menu", renderMenu(p, "es", true)],
    ["/blog", renderBlogIndex(p, PAGINAS, "es")],
  ];
}

function preloadsDe(html: string): string[] {
  return [...html.matchAll(/<link\b[^>]*\brel="preload"[^>]*>/g)].map((m) => m[0]);
}

test("🔴 se precarga UNA sola fuente —la de titulares— en las cuatro páginas", () => {
  // `perfilConManual` pide TRES familias (condensada, humanista, script). Precargarlas todas sería
  // competir contra el propio LCP: las tres viajarían con prioridad alta peleándose el ancho de banda
  // con el HTML y la imagen del hero, que es lo que de verdad se mide.
  for (const [nombre, html] of lasCuatroConManual()) {
    const preloads = preloadsDe(html);
    assert.equal(preloads.length, 1, `${nombre}: se esperaba exactamente 1 preload, hay ${preloads.length}`);
    assert.match(preloads[0]!, /href="\/_assets\/fonts\/oswald-700\.[0-9a-f]{8}\.woff2"/, `${nombre}: familia/peso`);
    assert.match(preloads[0]!, /as="font"/, `${nombre}: sin \`as\` el navegador no sabe la prioridad ni el modo`);
    assert.match(preloads[0]!, /type="font\/woff2"/, `${nombre}`);
    // Y va ANTES del `<style>`: un preload declarado después del CSS que lo necesita llega tarde.
    assert.ok(html.indexOf('rel="preload"') < html.indexOf("<style>"), `${nombre}: el preload va tras el <style>`);
  }
});

test("🔴 el preload lleva `crossorigin`: sin él el navegador DESCARGA LA FUENTE DOS VECES", () => {
  // El fallo más común de esta etiqueta, y no da error en ningún log. Las fuentes se piden SIEMPRE en
  // modo CORS anónimo (lo manda la spec de CSS Fonts, también para el mismo origen). Un preload sin
  // `crossorigin` va en modo distinto, no casa con la petición que después hace el `@font-face`, y el
  // navegador se baja el archivo otra vez: el preload pasa de ahorrar tiempo a costar bytes.
  for (const [nombre, html] of lasCuatroConManual()) {
    const link = preloadsDe(html)[0] ?? "";
    assert.match(link, /\bcrossorigin(=|\s|>)/, `${nombre}: preload de fuente sin crossorigin → doble descarga`);
  }
});

test("🔴 sin ninguna familia self-hosted NO se emite preload: no hay nada que precargar", () => {
  for (const [nombre, perfil] of [
    ["sin ficha", null],
    ["sin marca", validProfile()],
    ["legacy {color, font}", perfilLegacy()],
  ] as const) {
    const html = renderStory(pageToStory(validPage(), validBrief()), perfil, "es", true);
    assert.equal(preloadsDe(html).length, 0, `${nombre}: precarga algo que no usa`);
    assert.ok(!html.includes("/_assets/fonts/"), `${nombre}: ni siquiera nombra la ruta de fuentes`);
  }
});

test("🔴 sin `fuentes.titulo`, se precarga la familia que los titulares HEREDAN del cuerpo", () => {
  // `--marca-fuente-titulo:var(--marca-fuente-texto)` es el default del CSS base, y existe para que
  // una ficha legacy no vea su cuerpo en Georgia y sus titulares en system-ui. La consecuencia es que
  // «la fuente de titulares» no es `fuentes.titulo` sino `titulo ?? texto`: precargar solo cuando hay
  // `titulo` explícito dejaría sin preload justo al caso más común de una ficha a medio llenar.
  const html = renderStory(
    pageToStory(validPage(), validBrief()),
    validProfile({ brand: { fuentes: { texto: "geometrica" } } }),
    "es",
    true,
  );
  assert.match(preloadsDe(html)[0] ?? "", /href="\/_assets\/fonts\/jost-700\.[0-9a-f]{8}\.woff2"/);
});

test("el preload sigue al rol de titulares, no al de la decorativa ni al del cuerpo", () => {
  const html = renderStory(
    pageToStory(validPage(), validBrief()),
    validProfile({ brand: { fuentes: { titulo: "script", texto: "condensada", decorativa: "geometrica" } } }),
    "es",
    true,
  );
  const link = preloadsDe(html)[0] ?? "";
  assert.match(link, /dancingscript-600\./, "el rol de titulares es `script` en esta ficha");
  assert.ok(!link.includes("oswald"), "el cuerpo no se precarga");
  assert.ok(!link.includes("jost"), "la decorativa tampoco");
});

// ─────────────────────────────────────────────────────────────────────────────
// CERO terceros en la ruta de render bloqueante.
//
// Lo pide la spec con esas palabras («un test que recorra el `<style>` del documento y falle ante
// cualquier host externo»), y es la garantía de ADR-19 —el renderizador es la única superficie
// anónima— convertida en test en vez de en costumbre.
//
// ⚠️ El test INGENUO —"que no aparezca ningún host externo en el HTML"— daría falsos positivos y no
// serviría de nada: `canonical`, `og:url`, `og:image` y `brand.logo` son externos y LEGÍTIMOS. Lo que
// se prohíbe es un tercero que el navegador tenga que buscar ANTES de pintar.
// ─────────────────────────────────────────────────────────────────────────────

function estiloDe(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "el documento tiene que llevar un <style>");
  return m![1]!;
}

test("🔴 CERO terceros bloqueantes: todo `url()` del <style> es nuestro, y no hay hoja externa ni @import", () => {
  const casos = [...lasCuatroConManual(), ...lasCuatro()];

  for (const [nombre, html] of casos) {
    const css = estiloDe(html);

    // 1. Todo lo que el CSS manda pedir sale de nuestro propio dominio, por la ruta del manifiesto.
    for (const m of css.matchAll(/url\(([^)]*)\)/g)) {
      const u = (m[1] ?? "").replace(/^['"]|['"]$/g, "");
      assert.ok(
        u.startsWith("/_assets/fonts/"),
        `${nombre}: el <style> manda pedir «${u}», que no es una fuente nuestra`,
      );
    }

    // 2. Ni una hoja de estilo externa ni un `@import`: las dos son una petición bloqueante más, y un
    //    `@import` la encadena DETRÁS del CSS que ya se está descargando.
    assert.ok(!/rel="stylesheet"/.test(html), `${nombre}: hay un <link rel="stylesheet">`);
    assert.ok(!html.includes("@import"), `${nombre}: hay un @import`);

    // 3. Y Google Fonts por su nombre, que es de donde venía el template de referencia.
    for (const host of ["fonts.googleapis.com", "fonts.gstatic.com"]) {
      assert.ok(!html.includes(host), `${nombre}: aparece ${host}`);
    }
  }
});

test("🔴 …y el test anterior NO es vacío: la ficha con manual sí trae `url()` que revisar", () => {
  // Sin esto, quitar `cssDeFuentes` del ensamblado dejaría el test de cero terceros en verde feliz:
  // un bucle sobre cero `url()` no prueba nada. Este es el que hace que ese bucle tenga trabajo.
  for (const [nombre, html] of lasCuatroConManual()) {
    const urls = [...estiloDe(html).matchAll(/url\(([^)]*)\)/g)];
    assert.ok(urls.length >= 3, `${nombre}: solo ${urls.length} url() en el <style>; se esperaban las @font-face`);
  }
});

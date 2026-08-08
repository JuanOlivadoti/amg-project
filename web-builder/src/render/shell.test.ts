import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToStory } from "../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../fixtures.js";
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

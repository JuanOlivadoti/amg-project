import assert from "node:assert/strict";
import { test } from "node:test";
import { hrefsDe, huellaDe, idsDe, jsonLdDe, researchTraceDe, textoVisibleDe } from "./comparar.js";

/**
 * **Los tests del gate, no del render.** Quién vigila al vigilante.
 *
 * El gate de paridad decide qué puede cambiar el refactor y qué no. Si un extractor tiene un agujero,
 * el gate queda verde mientras el sitio cambia — y eso es peor que no tener gate, porque el verde se
 * lee como una garantía. Ya pasó una vez acá: el `research-trace` no lo veía ninguno de los cuatro
 * extractores originales, y se descubrió auditándolos, no escribiéndolos.
 *
 * Cada caso de abajo es un cambio que un refactor podría introducir y que el gate TIENE que detectar.
 */

test("gate — el texto visible ignora la indentación y los envoltorios: eso es lo que el refactor puede cambiar", () => {
  const antes = `<div class="hero"><h1>Bar Pepe</h1>\n  <p>Cocina de barrio</p></div>`;
  const despues = `<section class="p-hero">\n\t<div class="p-hero__caja">\n\t\t<h1>Bar Pepe</h1>\n\t\t<p>Cocina de barrio</p>\n\t</div>\n</section>`;
  assert.equal(textoVisibleDe(antes), textoVisibleDe(despues));
  assert.equal(textoVisibleDe(antes), "Bar Pepe Cocina de barrio");
});

test("gate — pero SÍ detecta que cambió una palabra", () => {
  assert.notEqual(textoVisibleDe("<p>Aún no hay páginas</p>"), textoVisibleDe("<p>Todavía no hay páginas</p>"));
});

test("gate — el CSS y el JSON-LD no cuentan como texto visible (cada uno tiene su comprobación)", () => {
  const html = `<style>.a{color:red}</style><script type="application/ld+json">{"@type":"X"}</script><p>Hola</p>`;
  assert.equal(textoVisibleDe(html), "Hola");
});

test("gate — un comentario HTML tampoco es texto visible", () => {
  assert.equal(textoVisibleDe("<!-- nota interna --><p>Hola</p>"), "Hola");
});

test("gate — las entidades NO se des-escapan: cambiar el escapado es cambiar la defensa, no la presentación", () => {
  // Si el extractor des-escapara, `&amp;` y `&` darían el mismo texto y una regresión de escapado
  // —o sea, una inyección— pasaría el gate en verde.
  assert.notEqual(textoVisibleDe("<p>Tapas &amp; vinos</p>"), textoVisibleDe("<p>Tapas & vinos</p>"));
});

test("gate — los href se comparan EN ORDEN: mover el pie arriba no puede pasar desapercibido", () => {
  assert.deepEqual(hrefsDe(`<a href="/menu">M</a><a href="#contacto">C</a>`), ["/menu", "#contacto"]);
  assert.notDeepEqual(hrefsDe(`<a href="/a">1</a><a href="/b">2</a>`), hrefsDe(`<a href="/b">2</a><a href="/a">1</a>`));
});

test("gate — los id se capturan, y `data-id` no se confunde con `id`", () => {
  assert.deepEqual(idsDe(`<div id="ubicaciones"><span data-id="x"></span><p id="contacto">`), [
    "ubicaciones",
    "contacto",
  ]);
});

test("gate — perder un id de ancla se detecta (el enlace sigue existiendo y deja de llevar a ningún lado)", () => {
  assert.notDeepEqual(idsDe(`<section id="ubicaciones">`), idsDe(`<section class="p-locales">`));
});

test("gate — el JSON-LD se extrae entero y en orden", () => {
  const html = `<script type="application/ld+json">\n{"@type":"LocalBusiness"}\n</script><script type="application/ld+json">{"@type":"FAQPage"}</script>`;
  assert.deepEqual(jsonLdDe(html), ['{"@type":"LocalBusiness"}', '{"@type":"FAQPage"}']);
});

test("🔴 gate — el research-trace tiene su propio extractor, o se caía por el hueco entre los otros dos", () => {
  const html = `<script type="application/json" id="research-trace">\n{"source_keyword":"pizza madrid"}\n</script>`;

  // El agujero que esto cierra, demostrado: los otros dos extractores no lo ven.
  assert.equal(textoVisibleDe(html), "", "textoVisibleDe lo borra por ser un <script>");
  assert.deepEqual(jsonLdDe(html), [], "jsonLdDe no lo ve: su tipo es application/json, no ld+json");

  assert.equal(researchTraceDe(html), '{"source_keyword":"pizza madrid"}');
});

test("🔴 gate — perder el research-trace hace que la huella cambie (antes no cambiaba nada)", () => {
  const con = `<p>Hola</p><script type="application/json" id="research-trace">{"a":1}</script>`;
  const sin = `<p>Hola</p>`;
  assert.notDeepEqual(huellaDe(con), huellaDe(sin));
});

test("gate — una página sin research-trace da `null`, no `\"\"`: la home y /menu no salen de un research", () => {
  assert.equal(researchTraceDe("<p>Hola</p>"), null);
  // La distinción importa: `""` sería "hay trace y está vacío", que es un defecto distinto.
  assert.notEqual(researchTraceDe(`<script type="application/json" id="research-trace"></script>`), null);
});

test("gate — la huella tiene las CINCO caras: si alguien agrega una y no la compara, no sirve de nada", () => {
  const huella = huellaDe(`<p>x</p>`);
  assert.deepEqual(Object.keys(huella).sort(), ["hrefs", "ids", "jsonLd", "researchTrace", "texto"]);
});

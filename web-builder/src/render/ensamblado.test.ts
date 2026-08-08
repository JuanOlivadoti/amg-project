import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToStory } from "../handoff/adapter.js";
import { perfilConManual, perfilLegacy, validBrief, validPage, validProfile } from "../fixtures.js";
import type { BrandTheme, Story } from "../types.js";
import { tokensDeMarca } from "./css.js";
import { tokenResuelto } from "./css-de-prueba.js";
import { ctxDe, perfilCompleto } from "./ctx-de-prueba.js";
import { renderBlogIndex, renderHome, renderMenu, renderStory } from "./html.js";
import { CATALOGO, piezaPorId } from "./piezas/index.js";
import { juegoDe } from "./plantilla.js";
import { renderDocumento } from "./shell.js";

/**
 * El ensamblado: qué CSS viaja, en qué orden, y qué elige la receta.
 *
 * Las dos garantías que la spec pide y que este archivo tiene que hacer caer si se rompen:
 *  - **una pieza que devolvió `""` no aporta su CSS** (una landing sin galería no paga la galería);
 *  - **el `<style>` es idéntico byte a byte** para dos páginas con las mismas piezas usadas, sin
 *    importar el orden de la receta.
 */

function estilo(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "el documento tiene que llevar un <style>");
  return m![1]!;
}

function storySin(componente: "hero" | "section" | "faq"): Story {
  const s = pageToStory(validPage(), validBrief());
  s.content.body = s.content.body.filter((b) => b.component !== componente);
  return s;
}

// ---------------------------------------------------------------- el CSS que viaja

test("el CSS de una pieza que devolvió '' NO aparece en el <style>", () => {
  const conFaq = estilo(renderStory(pageToStory(validPage(), validBrief()), validProfile()));
  const sinFaq = estilo(renderStory(storySin("faq"), validProfile()));

  assert.match(conFaq, /\.p-faq /, "con FAQ, su CSS viaja");
  assert.ok(!sinFaq.includes(".p-faq"), "sin FAQ, ni un byte de su CSS");
  assert.ok(sinFaq.length < conFaq.length, "el documento sin la pieza tiene que pesar menos");
});

test("una landing NO paga el CSS de las piezas de otras páginas (carta, índices)", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilCompleto()));
  for (const ausente of [".p-carta", ".p-indice", ".p-blogIndice"]) {
    assert.ok(!css.includes(ausente), `una landing no debería llevar ${ausente}`);
  }
});

test("sin perfil no viaja el CSS de las piezas de shell que dependen del perfil", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief())));
  assert.ok(!css.includes(".p-cabecera"), "sin cabecera dibujada, su CSS tampoco");
  assert.ok(!css.includes(".p-contacto"));
  assert.ok(!css.includes(".p-locales"));
});

test("el CSS base y los tokens viajan SIEMPRE, aunque no se dibuje ni una pieza", () => {
  const receta = { id: "vacia", contenido: [] };
  const html = renderDocumento({
    cabeza: { lang: "es", title: "x", canonical: "/x", ogTitle: "x" },
    receta,
    ctx: ctxDe({ activeSlug: "x" }),
    pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog: false },
  });
  const css = estilo(html);
  assert.match(css, /:root\{--fg:/, "los tokens son del base");
  assert.match(css, /^\s*:root|main\{/, "y el reset también");
  assert.ok(!css.includes(".p-"), "pero ni una pieza");
});

// ---------------------------------------------------------------- determinismo

test("el <style> es idéntico BYTE A BYTE para dos recetas con las mismas piezas en distinto orden", () => {
  const base = {
    cabeza: { lang: "es", title: "x", canonical: "/x", ogTitle: "x" },
    ctx: ctxDe({ story: pageToStory(validPage(), validBrief()), profile: validProfile(), activeSlug: "x" }),
    pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog: false },
  };
  const enOrden = renderDocumento({ ...base, receta: { id: "a", contenido: ["hero", "seccionProsa", "faq"] } });
  const alReves = renderDocumento({ ...base, receta: { id: "b", contenido: ["faq", "seccionProsa", "hero"] } });

  assert.notEqual(enOrden, alReves, "el HTML sí cambia: la receta ordena el contenido");
  assert.equal(estilo(enOrden), estilo(alReves), "el <style> NO puede cambiar: se emite en orden de catálogo");
});

test("el CSS de las piezas sale en orden de CATÁLOGO, no de receta", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilCompleto()));
  const posiciones = CATALOGO.filter((p) => css.includes(`.${p.raiz}`)).map((p) => css.indexOf(`.${p.raiz}`));
  const ordenadas = [...posiciones].sort((a, b) => a - b);
  assert.deepEqual(posiciones, ordenadas, "las piezas usadas aparecen en el orden del catálogo");
});

// ---------------------------------------------------------------- las recetas

test("toda receta de todo juego nombra piezas que EXISTEN en el catálogo", () => {
  // Una receta rota no lanza (el renderizador sirve la página igual, sin ese bloque): el error de
  // programación tiene que doler acá, no en la web de un cliente.
  const juego = juegoDe(null);
  for (const receta of [juego.story, juego.home, juego.menu, juego.blog]) {
    for (const id of receta.contenido) {
      assert.ok(piezaPorId(id), `la receta "${receta.id}" nombra la pieza inexistente "${id}"`);
    }
  }
});

test("una plantilla desconocida NO es un error: cae a `base` (una web servida > un 503 por un typo)", () => {
  assert.equal(juegoDe({ plantilla: "no-existe" }).id, "base");
  assert.equal(juegoDe({}).id, "base");
  assert.equal(juegoDe(null).id, "base");
  // Y tampoco por un nombre heredado de Object.prototype.
  assert.equal(juegoDe({ plantilla: "constructor" }).id, "base");
});

test("la receta NO puede tocar el shell: con `contenido: []` siguen saliendo cabecera y pie", () => {
  const html = renderDocumento({
    cabeza: { lang: "es", title: "x", canonical: "/x", ogTitle: "x" },
    receta: { id: "vacia", contenido: [] },
    ctx: ctxDe({ profile: perfilCompleto(), activeSlug: "x" }),
    pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog: false },
  });
  assert.match(html, /class="sitebar"/, "la cabecera no está en el tipo de la receta: no se puede omitir");
  assert.match(html, /id="ubicaciones"/);
  assert.match(html, /id="contacto"/);
  assert.match(html, /<main>\s*<\/main>/, "y el <main> queda vacío, sin excepción");
});

// ---------------------------------------------------------------- los tokens del manual de marca

test("el CSS base emite los tokens del manual con los valores actuales como default", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief())));
  for (const token of [
    "--marca-primario:#b91c1c",
    "--marca-secundario:#6b7280",
    "--marca-titulo:#1a1a1a",
    "--marca-texto:#1a1a1a",
    "--marca-fondo:#fff",
    "--marca-fondo-alt:#f8f7f5",
    "--marca-fuente-titulo:",
    "--marca-fuente-texto:",
    "--marca-fuente-decorativa:",
  ]) {
    assert.ok(css.includes(token), `falta el token ${token}`);
  }
});

test("`colores.primario` SÍ pisa el acento: la entrega 3 es la que enchufa el manual", () => {
  // Este test estaba escrito al revés hasta la entrega 2 —"NO pisa `--accent`"— y era correcto
  // entonces: los tokens se emitían sin consumirse para que el gate de paridad siguiera siendo
  // exigible. Invertirlo es el trabajo de esta entrega, no una regresión.
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilConManual()));
  assert.match(css, /--marca-primario:#0a7d34/, "el token del manual sale");
  assert.match(css, /--marca-fuente-texto:'Segoe UI'/);
  // Y el que se ve, ya resuelto (la cadena completa se prueba en `tema.test.ts`).
  assert.equal(tokenResuelto(css, "--accent"), "#0a7d34");
  assert.match(tokenResuelto(css, "--font"), /^'Segoe UI'/);
});

test("la ficha legacy `{color, font}` sigue alimentando los tokens del manual (resolución legacy→nuevo)", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilLegacy()));
  assert.match(css, /--marca-primario:#0a7d34/);
  assert.match(css, /--marca-fuente-texto:Georgia/);
  // ⚠️ `--accent`/`--font` ya NO se emiten desde el legacy: los declara la capa semántica del base
  // apuntando al token de marca. Emitirlos acá era justo lo que impedía que el manual ganara.
  assert.ok(!css.includes("--accent:#0a7d34"), "el legacy no puede volver a declarar el semántico");
  assert.ok(!css.includes("--font:Georgia"));
});

test("🔴 con AMBAS formas gana la específica: `colores.primario` sobre `color`", () => {
  const css = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      validProfile({ brand: { color: "#111111", colores: { primario: "#0a7d34" } } }),
    ),
  );
  assert.match(css, /--marca-primario:#0a7d34/, "la decisión explícita gana a la herencia");
  assert.ok(!css.includes("#111111"), "y la herencia no puede quedar declarada en ningún sitio");
});

test("🔴 un token de marca que no valida se DESCARTA y cae al default, no rompe la página", () => {
  const css = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      validProfile({
        brand: {
          colores: { primario: "red;}body{display:none}", secundario: "#0a7d34" } as never,
          fuentes: { texto: "</style><script>" } as never,
        },
      }),
    ),
  );
  assert.ok(!css.includes("display:none"), "el valor malicioso no llega a la hoja de estilo");
  assert.ok(!css.includes("</style><script>"));
  assert.match(css, /--marca-secundario:#0a7d34/, "y el token vecino, que sí valida, sigue saliendo");
});

test("🔴 la allowlist de fuentes usa hasOwn, no `in`: `toString` no es una fuente", () => {
  // `"toString" in FUENTE_STACKS` es `true` por la cadena de prototipos, y habría metido el código de
  // una función dentro del `<style>`. En PROD el perfil puede venir de Storyblok sin pasar por Zod.
  const css = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      validProfile({ brand: { font: "toString", fuentes: { titulo: "constructor" } } as never }),
    ),
  );
  assert.ok(!css.includes("native code"), "no puede colarse un método del prototipo como stack");
  assert.ok(!/--font:function/.test(css));
});

// ---------------------------------------------------------------- los cuatro puntos de entrada

test("los cuatro puntos de entrada usan el mismo ensamblador y emiten un documento completo", () => {
  const perfil = perfilCompleto();
  const paginas = [{ slug: "x", name: "X" }];
  for (const [nombre, html] of [
    ["story", renderStory(pageToStory(validPage(), validBrief()), perfil, "es", true)],
    ["home", renderHome(perfil, paginas, "es", true)],
    ["menu", renderMenu(perfil, "es", true)],
    ["blog", renderBlogIndex(perfil, paginas, "es")],
  ] as const) {
    assert.match(html, /^<!doctype html>/, `${nombre}: falta el doctype`);
    assert.match(html, /<html lang="es">/, `${nombre}: falta el lang`);
    assert.match(html, /<style>/, `${nombre}: falta el <style>`);
    assert.match(html, /<\/html>$/, `${nombre}: el documento no cierra`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Los NUEVE tokens del manual, uno por uno.
//
// La spec lo pide con esas palabras: «Por token: hex válido emite; hex inválido, `</style>`,
// `url(javascript:…)` y un objeto en vez de un string no emiten nada. **Uno por token, no uno de
// muestra**». Había tres cubiertos; una revisión contó los otros seis.
//
// No es celo: los seis salen de dos arrays literales en `css.ts`, y si a uno se le cayera la entrada
// el default seguiría llegando desde el CSS base — la web se vería BIEN y el token del cliente no
// llegaría nunca. Es el modo de fallo silencioso que las cuatro fronteras existen para cerrar,
// repetido en la última capa.
// ─────────────────────────────────────────────────────────────────────────────

const TOKENS_COLOR: Array<[keyof NonNullable<NonNullable<BrandTheme["colores"]>>, string]> = [
  ["primario", "--marca-primario"],
  ["secundario", "--marca-secundario"],
  ["titulo", "--marca-titulo"],
  ["texto", "--marca-texto"],
  ["fondo", "--marca-fondo"],
  ["fondoAlt", "--marca-fondo-alt"],
];

for (const [campo, token] of TOKENS_COLOR) {
  test(`token de marca — \`colores.${campo}\` llega al <style> como ${token}`, () => {
    const css = tokensDeMarca({ colores: { [campo]: "#0a7d34" } });
    assert.match(css, new RegExp(`${token}:#0a7d34(?![\\w-])`), `${campo} no se emitió`);
  });

  test(`token de marca — un \`colores.${campo}\` que no es hex se descarta y cae al default`, () => {
    for (const hostil of ["red;}", "#fff</style>", "url(javascript:alert(1))", "rgb(0,0,0)"]) {
      const css = tokensDeMarca({ colores: { [campo]: hostil } });
      assert.doesNotMatch(css, new RegExp(token), `${campo} dejó pasar «${hostil}»`);
    }
    // Un objeto en vez de un string tampoco: en PROD el perfil puede venir de la base sin Zod.
    assert.doesNotMatch(tokensDeMarca({ colores: { [campo]: { toString: () => "#fff" } } as never }), new RegExp(token));
  });
}

const TOKENS_FUENTE: Array<[keyof NonNullable<NonNullable<BrandTheme["fuentes"]>>, string]> = [
  ["titulo", "--marca-fuente-titulo"],
  ["texto", "--marca-fuente-texto"],
  ["decorativa", "--marca-fuente-decorativa"],
];

for (const [campo, token] of TOKENS_FUENTE) {
  test(`token de marca — \`fuentes.${campo}\` llega al <style> como ${token}`, () => {
    assert.match(tokensDeMarca({ fuentes: { [campo]: "condensada" } }), new RegExp(`${token}:`));
  });

  test(`token de marca — un \`fuentes.${campo}\` fuera de la allowlist no emite nada`, () => {
    for (const hostil of ["Oswald, sans-serif", "toString", "constructor", "__proto__"]) {
      assert.doesNotMatch(
        tokensDeMarca({ fuentes: { [campo]: hostil } as never }),
        new RegExp(token),
        `${campo} dejó pasar «${hostil}»`,
      );
    }
  });
}

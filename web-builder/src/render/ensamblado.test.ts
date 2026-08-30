import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToStory } from "../handoff/adapter.js";
import { perfilConManual, perfilLegacy, validBrief, validPage, validProfile } from "../fixtures.js";
import type { BrandTheme, Story } from "../types.js";
import { tokensDeMarca } from "./css.js";
import { propiedadResuelta, reglasDe, tokenResuelto } from "./css-de-prueba.js";
import { ctxDe, perfilCompleto } from "./ctx-de-prueba.js";
import { renderBlogIndex, renderCatalogo, renderHome, renderStory } from "./html.js";
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
  const conFaq = estilo(renderStory(pageToStory(validPage(), validBrief()), validProfile(), "restauracion"));
  const sinFaq = estilo(renderStory(storySin("faq"), validProfile(), "restauracion"));

  assert.match(conFaq, /\.p-faq /, "con FAQ, su CSS viaja");
  assert.ok(!sinFaq.includes(".p-faq"), "sin FAQ, ni un byte de su CSS");
  assert.ok(sinFaq.length < conFaq.length, "el documento sin la pieza tiene que pesar menos");
});

test("una landing NO paga el CSS de las piezas de otras páginas (carta, índices)", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilCompleto(), "restauracion"));
  for (const ausente of [".p-cartaCategorias", ".p-indice", ".p-blogIndice", ".p-hero "]) {
    assert.ok(!css.includes(ausente), `una landing no debería llevar ${ausente}`);
  }
});

test("🔴 una landing sin fotos NO paga el CSS de la galería (el caso que la spec nombra)", () => {
  // «Perfil sin `fotos` → `galeria` devuelve `""` y **su CSS no viaja**» (spec, §Casos borde). Es la
  // mitad que el test de la pieza no puede probar: ahí se comprueba el `""`, acá que ese `""` se
  // traduzca en cero bytes de `<style>`. Y es el caso NORMAL —una ficha recién dada de alta no tiene
  // fotos—, así que si esto se rompiera lo pagaría cada cliente en cada visita.
  const sinFotos = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilCompleto(), "restauracion"));
  assert.ok(!sinFotos.includes(".p-galeria"), "sin fotos, ni un byte de la galería");

  const conFotos = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      perfilCompleto({ fotos: [{ src: "https://a.storyblok.com/f/1/400x300/g/1.jpg" }] }),
      "restauracion",
    ),
  );
  assert.match(conFotos, /\.p-galeria /, "y con fotos sí viaja: el test de arriba no puede pasar por vacío");
  assert.ok(sinFotos.length < conFotos.length, "el documento sin la pieza tiene que pesar menos");
});

test("🔴 `story` y `home` usan `heroSlider`; `/menu` y `/blog` usan `hero` (una sola pieza de titular por receta)", () => {
  // Sin este test, cambiar una receta por la otra no tumbaría nada evidente: las dos emiten un `<h1>`
  // y el gate de paridad ya no cubre estas páginas.
  //
  // ⚠️ **La frontera se movió con el rediseño de la plantilla base** y antes estaba en otro sitio: la
  // spec de la entrega 3 ponía `heroPortada` **solo** en `story` porque las otras tres páginas no
  // salen de una story y no tenían portada propia que dibujar. `heroSlider` sí cubre las dos: saca el
  // titular del blok `hero` cuando hay story y del contexto cuando no, y las fotos del perfil, que la
  // home también tiene. Lo que NO cambió es la garantía que este caso protege: **una receta lleva
  // exactamente UNA pieza de titular**, nunca las dos.
  const juego = juegoDe("restauracion");
  for (const receta of [juego.story, juego.home]) {
    assert.ok(receta.contenido.includes("heroSlider"), `"${receta.id}" perdió su portada`);
    assert.ok(
      !receta.contenido.includes("hero"),
      `"${receta.id}" lleva las dos: serían dos <h1> en la misma página`,
    );
  }
  for (const receta of [juego.menu, juego.blog]) {
    assert.ok(receta.contenido.includes("hero"), `"${receta.id}" perdió su titular`);
    assert.ok(
      !receta.contenido.includes("heroSlider"),
      `"${receta.id}" no es una portada: la carta y el índice del blog no abren con un carrusel`,
    );
  }
});

test("sin perfil no viaja el CSS de las piezas de shell que dependen del perfil", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), undefined, "restauracion"));
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
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilCompleto(), "restauracion"));
  const posiciones = CATALOGO.filter((p) => css.includes(`.${p.raiz}`)).map((p) => css.indexOf(`.${p.raiz}`));
  const ordenadas = [...posiciones].sort((a, b) => a - b);
  assert.deepEqual(posiciones, ordenadas, "las piezas usadas aparecen en el orden del catálogo");
});

// ---------------------------------------------------------------- las recetas

test("toda receta de todo juego nombra piezas que EXISTEN en el catálogo", () => {
  // Una receta rota no lanza (el renderizador sirve la página igual, sin ese bloque): el error de
  // programación tiene que doler acá, no en la web de un cliente.
  //
  // Recorre los DOS juegos —`restauracion` y `correduria_seguros`— y no solo uno: desde que `juegoDe`
  // eligió por vertical (Task 7) hay más de un juego, y el nombre del test («todo juego») ya lo decía
  // antes de que hubiera dos con los que probarlo.
  for (const vertical of ["restauracion", "correduria_seguros"] as const) {
    const juego = juegoDe(vertical);
    for (const receta of [juego.story, juego.home, juego.menu, juego.blog]) {
      for (const id of receta.contenido) {
        assert.ok(piezaPorId(id), `la receta "${receta.id}" nombra la pieza inexistente "${id}"`);
      }
    }
  }
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
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), undefined, "restauracion"));
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
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilConManual(), "restauracion"));
  assert.match(css, /--marca-primario:#0a7d34/, "el token del manual sale");
  // ⚠️ Era `'Segoe UI'` hasta la mitad C: `humanista` caía a un stack del sistema. Ahora resuelve a su
  // familia self-hosted, que es justo lo que esta mitad enchufa. No es una regresión — los roles que
  // NO pueden cambiar son los tres legacy, y esos tienen su propio test en `fuentes.test.ts`.
  assert.match(css, /--marca-fuente-texto:'Source Sans 3',/);
  // Y el que se ve, ya resuelto (la cadena completa se prueba en `tema.test.ts`).
  assert.equal(tokenResuelto(css, "--accent"), "#0a7d34");
  assert.match(tokenResuelto(css, "--font"), /^'Source Sans 3',/);
});

test("la ficha legacy `{color, font}` sigue alimentando los tokens del manual (resolución legacy→nuevo)", () => {
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilLegacy(), "restauracion"));
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
      "restauracion",
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
      "restauracion",
    ),
  );
  // ⚠️ Se comprueba la **regla inyectada entera** (`body{display:none}`) y no el fragmento
  // `display:none` suelto, y el motivo es que desde el rediseño hay un `display:none` LEGÍTIMO en el
  // `<style>`: `.p-heroSlider .pista::-webkit-scrollbar`. Con el fragmento suelto este caso pasó a
  // fallar por el motivo equivocado —denunciaba una regla nuestra, no la inyección—, que es la otra
  // cara de un test que pasa por vacío. La defensa que fija sigue siendo la misma: el payload no
  // puede cerrar la declaración y abrir una regla propia.
  assert.ok(!css.includes("body{display:none}"), "el valor malicioso no llega a la hoja de estilo");
  assert.ok(!css.includes("</style><script>"));
  assert.match(css, /--marca-secundario:#0a7d34/, "y el token vecino, que sí valida, sigue saliendo");
});

test("🔴 las DOS allowlists siguen separadas: el campo legacy `font` no acepta los cuatro nombres nuevos", () => {
  // `brand.font` es un contrato CERRADO de tres nombres (`sistema | serif | moderna`); `brand.fuentes.*`
  // acepta los siete. Fusionarlos ampliaría en silencio el contrato viejo, y el mismo valor pasaría a
  // significar cosas distintas según por qué campo entre.
  //
  // Esta decisión estaba escrita en un comentario de `css.ts` y **no la sostenía ningún test**: fundir
  // las dos allowlists dejaba los 299 en verde. Lo encontró una mutación de esta misma entrega, no una
  // revisión leyendo el diff.
  for (const nuevo of ["condensada", "geometrica", "humanista", "script"]) {
    const css = tokensDeMarca({ font: nuevo as never });
    assert.equal(css, "", `el campo legacy \`font\` aceptó «${nuevo}»: el contrato viejo se amplió solo`);
  }
  // Y por el otro campo el mismo nombre SÍ entra: lo que se prueba es la frontera, no que el rol no valga.
  assert.match(tokensDeMarca({ fuentes: { texto: "condensada" } }), /--marca-fuente-texto:'Oswald',/);
});

test("🔴 la allowlist de fuentes usa hasOwn, no `in`: `toString` no es una fuente", () => {
  // `"toString" in FUENTE_STACKS` es `true` por la cadena de prototipos, y habría metido el código de
  // una función dentro del `<style>`. En PROD el perfil puede venir de Storyblok sin pasar por Zod.
  const css = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      validProfile({ brand: { font: "toString", fuentes: { titulo: "constructor" } } as never }),
      "restauracion",
    ),
  );
  assert.ok(!css.includes("native code"), "no puede colarse un método del prototipo como stack");
  assert.ok(!/--font:function/.test(css));
});

// ─────────────────────────────────────────────────────────────────────────────
// Las `@font-face` de las familias self-hosted.
//
// La mitad C es el cable: hasta ella las `woff2` se SERVÍAN (el renderizador tenía su ruta y su
// manifiesto) y el CSS emitido no las pedía nunca. Una ficha con `fuentes.titulo: "condensada"` veía
// Arial Narrow, y nada fallaba en ningún sitio.
// ─────────────────────────────────────────────────────────────────────────────

test("🔴 el <style> lleva las @font-face de las familias que la ficha pide, y SOLO esas", () => {
  // `perfilConManual`: titulo=condensada, texto=humanista, decorativa=script → tres familias de
  // cuatro. `geometrica` (Jost) no la pide nadie y no puede costar ni una petición.
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilConManual(), "restauracion"));

  assert.match(css, /@font-face\{font-family:'Oswald'/, "condensada → Oswald");
  assert.match(css, /@font-face\{font-family:'Source Sans 3'/, "humanista → Source Sans 3");
  assert.match(css, /@font-face\{font-family:'Dancing Script'/, "script → Dancing Script");
  assert.ok(!css.includes("Jost"), "geometrica no la usa esta ficha: ni un byte, ni una petición");

  // Y el token apunta a la familia, no a un stack del sistema: sin esto las @font-face viajarían y
  // no las consumiría nadie, que es el fallo silencioso de siempre con otro disfraz.
  assert.match(css, /--marca-fuente-titulo:'Oswald',/);
  assert.match(tokenResuelto(css, "--fuente-titulo"), /^'Oswald',/);
});

test("🔴 una ficha sin familias propias no emite NI UN BYTE de @font-face", () => {
  for (const [nombre, perfil] of [
    ["sin ficha", null],
    ["sin marca", validProfile()],
    ["legacy {color, font}", perfilLegacy()],
  ] as const) {
    const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfil, "restauracion"));
    assert.ok(!css.includes("@font-face"), `${nombre}: no pide ninguna familia self-hosted`);
    assert.ok(!css.includes("/_assets/fonts/"), `${nombre}: y por tanto ninguna URL de fuente`);
  }
});

test("las @font-face no rompen el determinismo: mismas piezas, <style> idéntico byte a byte", () => {
  const base = {
    cabeza: { lang: "es", title: "x", canonical: "/x", ogTitle: "x" },
    ctx: ctxDe({ story: pageToStory(validPage(), validBrief()), profile: perfilConManual(), activeSlug: "x" }),
    pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog: false },
  };
  const enOrden = renderDocumento({ ...base, receta: { id: "a", contenido: ["hero", "seccionProsa", "faq"] } });
  const alReves = renderDocumento({ ...base, receta: { id: "b", contenido: ["faq", "seccionProsa", "hero"] } });

  assert.equal(estilo(enOrden), estilo(alReves), "el orden de la receta no puede tocar el <style>");

  // Y el orden de las `@font-face` sale de `FAMILIAS`, no del orden en que la ficha nombra los roles.
  // Se miran SOLO las declaraciones: los tokens `--marca-fuente-*` nombran las mismas familias antes,
  // en el orden de la ficha, y buscar el nombre en el `<style>` entero mediría eso en vez de esto.
  const familiasDeclaradas = (css: string): string[] =>
    [...css.matchAll(/@font-face\{font-family:'([^']+)'/g)].map((m) => m[1]!);

  const scriptPrimero = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      validProfile({ brand: { fuentes: { titulo: "script", texto: "condensada" } } }),
      "restauracion",
    ),
  );
  assert.deepEqual(
    familiasDeclaradas(scriptPrimero).filter((f, i, a) => a.indexOf(f) === i),
    ["Oswald", "Dancing Script"],
    "orden de FAMILIAS (condensada antes que script), no el de la ficha",
  );

  // Y una familia pedida por dos roles se declara UNA vez: `usadas` es un Set.
  const dosRoles = estilo(
    renderStory(
      pageToStory(validPage(), validBrief()),
      validProfile({ brand: { fuentes: { titulo: "condensada", texto: "condensada" } } }),
      "restauracion",
    ),
  );
  assert.deepEqual(familiasDeclaradas(dosRoles), ["Oswald", "Oswald"], "los dos pesos de Oswald, y nada más");
});

test("🔴 los titulares NO declaran font-weight: por eso se precarga el archivo de 700", () => {
  // Es la razón de la decisión, puesta como test en vez de como comentario. `h1`/`h2`/`h3` heredan el
  // `bold` (700) de la hoja del navegador porque ninguna pieza les pone `font-weight`. Si alguna se lo
  // pusiera, el archivo precargado dejaría de ser el que el navegador pide y el preload se volvería
  // una descarga de más: este test cae y obliga a revisar `PESO_TITULARES`.
  //
  // ⚠️ La lista recorre los titulares que EXISTEN en la página que se renderiza. `propiedadResuelta`
  // devuelve `undefined` para un selector ausente, así que un selector viejo dejaría el caso en verde
  // sin medir nada: al cambiar la receta de la landing (`hero` → `heroPortada`, y después
  // `heroPortada` → `heroSlider`) los dos primeros habrían pasado por vacío. El `assert.ok` de abajo
  // es lo que impide que vuelva a pasar — y es lo que hizo caer este caso al retirar `heroPortada`,
  // en vez de dejarlo verde midiendo un selector que ya no está en el `<style>`.
  //
  // ⚠️ **`.encabezado h2` es del CSS BASE, no de una pieza, y por eso está en esta lista.** El
  // rediseño de la plantilla base mudó el título de sección de `galeria`, `platosDestacados`,
  // `cartaCategorias` y `ctaFinal` al encabezado compartido, así que `.p-galeria .galeria h2` y
  // `.p-ctaFinal .cierre h2` —que estaban aquí— dejaron de existir. Ese h2 compartido es hoy el titular
  // de MÁS secciones del sitio que ningún otro: dejarlo fuera de la comprobación habría cambiado la
  // cobertura de dos piezas por la de ninguna.
  const css = estilo(renderStory(pageToStory(validPage(), validBrief()), perfilConManual(), "restauracion"));
  const titulares = [
    ".p-heroSlider h1",
    ".p-seccionProsa h2",
    ".encabezado h2",
    ".p-platosDestacados .plato h3",
    ".card h3",
    // Los rótulos del PIE, que entraron en la lista con el rediseño de la etapa 2: son `h2`/`h3` de
    // verdad y su tentación es justo la contraria a la del titular grande —un rótulo en versalitas
    // pide un peso medio—, así que son el caso donde más fácil se cuela un `font-weight`.
    ".p-contacto h2",
    ".p-locales h3",
  ];
  for (const sel of titulares) {
    assert.ok(
      reglasDe(css).some((r) => r.selector === sel),
      `«${sel}» no está en el <style> de esta página: el caso no mide nada`,
    );
    assert.equal(
      propiedadResuelta(css, sel, "font-weight"),
      undefined,
      `«${sel}» declara font-weight: revisá qué peso se precarga en shell.ts`,
    );
  }
});

// ---------------------------------------------------------------- los cuatro puntos de entrada

test("los cuatro puntos de entrada usan el mismo ensamblador y emiten un documento completo", () => {
  const perfil = perfilCompleto();
  const paginas = [{ slug: "x", name: "X" }];
  for (const [nombre, html] of [
    ["story", renderStory(pageToStory(validPage(), validBrief()), perfil, "restauracion", "es", true)],
    ["home", renderHome(perfil, paginas, "restauracion", "es", true)],
    ["menu", renderCatalogo(perfil, "restauracion", "es", true)],
    ["blog", renderBlogIndex(perfil, paginas, "restauracion", "es")],
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

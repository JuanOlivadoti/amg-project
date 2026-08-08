import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToStory } from "../handoff/adapter.js";
import { perfilLegacy, validBrief, validPage, validProfile } from "../fixtures.js";
import type { BusinessProfile } from "../types.js";
import {
  huecosDeModoOscuro,
  propiedadResuelta,
  reglasDe,
  resolverVars,
  tokenResuelto,
  tokensDe,
  varsConsumidas,
} from "./css-de-prueba.js";
import { ctxDe } from "./ctx-de-prueba.js";
import { renderMenu, renderStory } from "./html.js";
import { CATALOGO } from "./piezas/index.js";
import type { Pieza } from "./piezas/tipos.js";
import { renderDocumento } from "./shell.js";

/**
 * **El tema: los tokens de marca enchufados, y el modo oscuro completo** (entrega 3, mitad A).
 *
 * La entrega 2 emitía los nueve `--marca-*` **sin que nadie los consumiera**, y sus nueve tests de
 * emisión estaban en verde. Este archivo prueba la mitad que faltaba: que el valor que puso el
 * cliente llega hasta la declaración de la pieza que lo dibuja, eslabón por eslabón.
 *
 * Y el arreglo que la entrega 2 dejó a propósito sin hacer: el modo oscuro **completo**, comprobado
 * recorriendo el catálogo en vez de con una lista escrita a mano — una lista se queda corta el día
 * que alguien añade una pieza, que es literalmente cómo nació el bug.
 */

function estilo(html: string): string {
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(m, "el documento tiene que llevar un <style>");
  return m![1]!;
}

/** El `<style>` de una página completa con esta ficha. */
function cssDe(profile?: BusinessProfile | null): string {
  return estilo(renderStory(pageToStory(validPage(), validBrief()), profile));
}

/** El `<style>` de un documento SIN piezas: tokens + base, y nada más. */
function cssBase(): string {
  return estilo(
    renderDocumento({
      cabeza: { lang: "es", title: "x", canonical: "/x", ogTitle: "x" },
      receta: { id: "vacia", contenido: [] },
      ctx: ctxDe({ activeSlug: "x" }),
      pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog: false },
    }),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Primero el DETECTOR, con casos de mentira.
//
// Mismo motivo que en `aislamiento.test.ts`: un detector que no sabe fallar deja el catálogo en verde
// para siempre y el gate entero pasa a ser un adorno.
// ─────────────────────────────────────────────────────────────────────────────

test("🔴 control positivo — un color literal SIN contrapartida oscura se detecta", () => {
  const problemas = huecosDeModoOscuro(".p-x li{border-bottom:1px solid #f5f4f2}");
  assert.equal(problemas.length, 1, `debía detectar 1 hueco, detectó ${problemas.length}`);
  assert.match(problemas[0]!, /\.p-x li/);
});

test("el mismo color literal CON su contrapartida oscura no es un hueco", () => {
  const css = ".p-x li{border-bottom:1px solid #f5f4f2}@media(prefers-color-scheme:dark){.p-x li{border-color:#191919}}";
  assert.deepEqual(huecosDeModoOscuro(css), []);
});

test("el detector empareja `border-bottom` con `border-color`: son la misma decisión con dos nombres", () => {
  // Si pidiera el mismo nombre de propiedad denunciaría a todas las piezas que HOY están bien.
  const css = ".p-x{border-bottom:1px solid #eee}@media(prefers-color-scheme:dark){.p-x{border-color:#222}}";
  assert.deepEqual(huecosDeModoOscuro(css), []);
});

test("un color que NO depende del modo (`transparent`) no exige contrapartida", () => {
  assert.deepEqual(huecosDeModoOscuro(".p-x a{border-bottom:2px solid transparent}"), []);
});

test("un color que viene de un TOKEN no exige contrapartida: el token ya tiene su valor oscuro", () => {
  assert.deepEqual(huecosDeModoOscuro(".p-x{background:var(--soft);color:var(--fg)}"), []);
});

test("resolverVars sigue la cadena hasta el fondo, y deja ver el eslabón roto", () => {
  const tokens = { "--accent": "var(--marca-primario)", "--marca-primario": "#0a7d34" };
  assert.equal(resolverVars("var(--accent)", tokens), "#0a7d34");
  // Si alguien corta el eslabón de abajo, la resolución NO inventa: queda a la vista.
  assert.equal(resolverVars("var(--accent)", { "--accent": "var(--marca-primario)" }), "var(--marca-primario)");
});

// ─────────────────────────────────────────────────────────────────────────────
// El catálogo real.
// ─────────────────────────────────────────────────────────────────────────────

test("modo oscuro — NINGUNA pieza del catálogo deja un color literal sin su contrapartida oscura", () => {
  for (const p of CATALOGO) {
    assert.deepEqual(huecosDeModoOscuro(p.css), [], `la pieza "${p.id}" tiene el modo oscuro incompleto`);
  }
});

test("modo oscuro — el CSS base tampoco (los tokens, `footer` y `.card` son suyos)", () => {
  assert.deepEqual(huecosDeModoOscuro(cssBase()), []);
});

test("toda `var(--x)` que consume una pieza está DECLARADA en el base (§3.6)", () => {
  // Una pieza no declara tokens, así que una variable que nadie declara no cae al default: cae a
  // nada, y la propiedad se pierde en silencio. Es el modo de fallo de un typo en un `var()`.
  const declaradas = new Set(Object.keys(tokensDe(cssBase(), "oscuro")));
  for (const p of CATALOGO) {
    for (const v of varsConsumidas(p.css)) {
      assert.ok(declaradas.has(v), `la pieza "${p.id}" consume ${v}, que el CSS base no declara`);
    }
  }

  // El base también consume las suyas —`.card:hover` usa `--acento-legible`, `footer .tecnica` usa
  // `--muted`— y el bucle de arriba solo miraba las piezas, así que un typo ahí se perdía en el
  // mismo silencio que el test dice cerrar. Lo señaló una revisión.
  for (const v of varsConsumidas(cssBase())) {
    assert.ok(declaradas.has(v), `el CSS base consume ${v}, que él mismo no declara`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Los NUEVE tokens, de la ficha del cliente hasta la declaración que los dibuja.
//
// La spec pide "uno por token, no uno de muestra". Los nueve tests de EMISIÓN están en
// `ensamblado.test.ts` desde la entrega 2; estos son los de CONSUMO, que es la mitad que faltaba.
// ─────────────────────────────────────────────────────────────────────────────

/** Una ficha con los seis colores y las tres fuentes distintos entre sí, para que nada se confunda. */
const PERFIL_MARCA: BusinessProfile = validProfile({
  brand: {
    colores: {
      primario: "#0a7d34",
      secundario: "#c8963e",
      titulo: "#112233",
      texto: "#445566",
      fondo: "#fefdfb",
      fondoAlt: "#f1f2f3",
    },
    fuentes: { titulo: "condensada", texto: "serif", decorativa: "script" },
  },
});

/**
 * Token → la declaración de la pieza que lo dibuja.
 *
 * `body` es del CSS base y no de una pieza: los tres tokens que gobiernan la página entera (texto,
 * fondo y fuente del cuerpo) se aplican ahí por definición, y §3.6 dice que lo compartido sube al base.
 */
/**
 * ⚠️ **`--marca-secundario` NO está en esta tabla, y su ausencia es la decisión.**
 *
 * Se emite pero **todavía no lo consume nadie**. Estuvo alimentando `--muted` —el color del lede, las
 * descripciones, las direcciones, el nav y la línea técnica— hasta que se midió: con la paleta ya
 * decidida para el cliente de demo, su oro `#c8963e` sobre el fondo `#fffdf9` da **2.62:1**, o sea
 * que fallaba AA y habría pintado de oro ilegible todo el texto secundario. «Secundario» en un manual
 * de marca es el segundo color **de marca**, decorativo; no el gris del texto secundario.
 *
 * Espera consumidor en la mitad B, donde hay superficie decorativa de verdad. Cuando lo tenga, vuelve
 * a esta tabla y el test de abajo lo exige otra vez. Mientras tanto: emitido y sin usar es honesto,
 * usado donde rompe el contraste no lo era.
 */
const CONSUMO: Array<{ token: string; selector: string; propiedad: string; espera: string }> = [
  { token: "--marca-primario", selector: ".p-hero .cta", propiedad: "background", espera: "#0a7d34" },
  { token: "--marca-titulo", selector: ".p-hero .hero h1", propiedad: "color", espera: "#112233" },
  { token: "--marca-texto", selector: "body", propiedad: "color", espera: "#445566" },
  { token: "--marca-fondo", selector: "body", propiedad: "background", espera: "#fefdfb" },
  { token: "--marca-fondo-alt", selector: ".p-faq .faq", propiedad: "background", espera: "#f1f2f3" },
  { token: "--marca-fuente-titulo", selector: ".p-hero .hero h1", propiedad: "font-family", espera: "Arial Narrow" },
  { token: "--marca-fuente-texto", selector: "body", propiedad: "font", espera: "Georgia" },
  {
    token: "--marca-fuente-decorativa",
    selector: ".p-cabecera .sitebar .marca",
    propiedad: "font-family",
    espera: "Brush Script MT",
  },
];

for (const { token, selector, propiedad, espera } of CONSUMO) {
  test(`consumo — ${token} llega a \`${propiedad}\` de «${selector}»`, () => {
    const css = cssDe(PERFIL_MARCA);
    const valor = propiedadResuelta(css, selector, propiedad);
    assert.ok(
      valor !== undefined,
      `«${selector}» no declara \`${propiedad}\`: el token ${token} se emite y no lo consume nadie`,
    );
    assert.ok(
      valor!.includes(espera),
      `${token} no llega a «${selector}»: \`${propiedad}\` resuelve a «${valor}» y se esperaba «${espera}»`,
    );
    assert.ok(!valor!.includes("var("), `queda un var() sin resolver en «${valor}»: la cadena está rota`);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy vs manual, en los dos sentidos.
//
// "Ninguna web sembrada cambia de aspecto por esta enmienda" es la única regresión que el manual de
// marca puede causar, y por eso se prueba en las dos direcciones.
// ─────────────────────────────────────────────────────────────────────────────

test("legacy — una ficha `{color, font}` pinta EXACTAMENTE lo que pintaba: acento y cuerpo", () => {
  const css = cssDe(perfilLegacy()); // { color: "#0a7d34", font: "serif" }
  assert.equal(tokenResuelto(css, "--accent"), "#0a7d34", "el acento sigue saliendo del `color` legacy");
  assert.match(propiedadResuelta(css, "body", "font") ?? "", /Georgia/, "y el cuerpo, del `font` legacy");
  assert.equal(propiedadResuelta(css, ".p-hero .cta", "background"), "#0a7d34");
});

test("legacy — sin `fuentes.titulo`, los titulares heredan la fuente del CUERPO, no el default del sistema", () => {
  // Es la trampa del manual de marca: si `--marca-fuente-titulo` cayera al stack del sistema, una
  // ficha legacy con `font: serif` vería su cuerpo en Georgia y sus titulares en system-ui. Nadie lo
  // pidió y sería un cambio de aspecto en TODAS las webs sembradas.
  const css = cssDe(perfilLegacy());
  assert.match(propiedadResuelta(css, ".p-hero .hero h1", "font-family") ?? "", /Georgia/);
  assert.match(propiedadResuelta(css, ".p-cabecera .sitebar .marca", "font-family") ?? "", /Georgia/);
});

test("legacy — sin manual, los seis colores y las tres fuentes caen a los defaults de HOY", () => {
  const css = cssDe(validProfile()); // ficha sin `brand` ninguna
  assert.equal(tokenResuelto(css, "--accent"), "#b91c1c");
  assert.equal(tokenResuelto(css, "--fg"), "#1a1a1a");
  assert.equal(tokenResuelto(css, "--titulo"), "#1a1a1a");
  assert.equal(tokenResuelto(css, "--muted"), "#6b7280");
  assert.equal(tokenResuelto(css, "--bg"), "#fff");
  assert.equal(tokenResuelto(css, "--soft"), "#f8f7f5");
});

test("🔴 manual — con AMBAS formas gana `colores.primario` sobre el `color` legacy, HASTA EL PÍXEL", () => {
  // La entrega 2 tenía este test al revés a propósito (el manual se emitía sin consumirse, para que
  // la paridad siguiera siendo exigible). Esta entrega lo invierte: la nueva es una decisión
  // explícita, la vieja es herencia.
  const css = cssDe(validProfile({ brand: { color: "#111111", colores: { primario: "#0a7d34" } } }));
  assert.equal(tokenResuelto(css, "--marca-primario"), "#0a7d34");
  assert.equal(tokenResuelto(css, "--accent"), "#0a7d34", "el acento que se ve tiene que ser el del manual");
  assert.equal(propiedadResuelta(css, ".p-hero .cta", "background"), "#0a7d34");
  assert.ok(!css.includes("#111111"), "el legacy no puede quedar declarado en ningún sitio: ganaría por cascada");
});

test("🔴 manual — con AMBAS formas gana `fuentes.texto` sobre el `font` legacy", () => {
  const css = cssDe(validProfile({ brand: { font: "serif", fuentes: { texto: "geometrica" } } }));
  const cuerpo = propiedadResuelta(css, "body", "font") ?? "";
  assert.match(cuerpo, /Century Gothic/, "la decisión explícita gana");
  assert.ok(!cuerpo.includes("Georgia"), "y la herencia no puede seguir pintando el cuerpo");
});

// ─────────────────────────────────────────────────────────────────────────────
// El contraste del acento en oscuro.
// ─────────────────────────────────────────────────────────────────────────────

test("el acento legible en oscuro se DERIVA en CSS con color-mix, no en TypeScript", () => {
  const css = cssDe(PERFIL_MARCA);
  // En claro es el acento tal cual: una ficha no cambia de aspecto por existir el arreglo.
  assert.equal(tokenResuelto(css, "--acento-legible", "claro"), "#0a7d34");
  // En oscuro, una MEZCLA que nombra el token de marca. Que la mezcla nombre `--marca-primario` es
  // lo que garantiza que no hay una segunda copia de la paleta: si mañana cambia el hex, la variante
  // oscura cambia sola.
  const oscuro = tokenResuelto(css, "--acento-legible", "oscuro");
  assert.match(oscuro, /color-mix\(/, "la variante oscura tiene que derivarse en CSS");
  assert.ok(oscuro.includes("#0a7d34"), `la mezcla no parte del acento del cliente: «${oscuro}»`);
});

test("el acento legible es lo que pinta el TEXTO de acento; el botón conserva el acento pleno", () => {
  // Son dos necesidades distintas y por eso son dos tokens: aclarar el acento mejora un precio sobre
  // fondo oscuro y EMPEORA el botón, que lleva texto blanco encima.
  // El precio vive en `/menu` (la receta de la landing no lleva `carta`), así que hacen falta las dos.
  const cssMenu = estilo(renderMenu(validProfile({ menu: [{ name: "Pizza", price: "12 €" }] })));
  const cssLanding = cssDe(validProfile());
  assert.equal(propiedadResuelta(cssMenu, ".p-carta .carta .precio", "color"), "#b91c1c");
  assert.equal(propiedadResuelta(cssLanding, ".p-hero .cta", "background"), "#b91c1c");
  const precio = reglasDe(cssMenu).find((r) => r.selector === ".p-carta .carta .precio");
  assert.match(precio?.declaraciones["color"] ?? "", /--acento-legible/);
  const cta = reglasDe(cssLanding).find((r) => r.selector === ".p-hero .cta");
  assert.match(cta?.declaraciones["background"] ?? "", /--accent\)/);
});

// ─────────────────────────────────────────────────────────────────────────────
// El doble borde de la carta y los enlaces del pie.
// ─────────────────────────────────────────────────────────────────────────────

test("la última fila de una categoría de la carta NO dibuja borde: el del contenedor ya está ahí", () => {
  const reglas = reglasDe(carta().css);
  const fila = reglas.find((r) => r.selector === ".p-carta .carta li");
  assert.ok(fila, "la fila de plato tiene que seguir teniendo su separador");
  assert.match(fila!.declaraciones["border-bottom"] ?? "", /solid/);
  const ultima = reglas.find((r) => r.selector === ".p-carta .carta li:last-child");
  assert.ok(ultima, "falta la regla que quita el borde de la última fila (el doble borde de /menu)");
  assert.equal(ultima!.declaraciones["border-bottom"], "0");
});

test("los enlaces del pie toman el color del texto, no el azul del navegador", () => {
  for (const p of CATALOGO.filter((x) => x.id === "contacto" || x.id === "locales")) {
    const regla = reglasDe(p.css).find((r) => r.selector === `.${p.raiz} a`);
    assert.ok(regla, `la pieza "${p.id}" no estila sus enlaces: salen con el azul del navegador`);
    assert.equal(regla!.declaraciones["color"], "inherit");
    assert.match(regla!.declaraciones["text-decoration"] ?? "", /underline/, "y con un subrayado, discreto");
  }
});

test("el enlace al blog del pie tampoco sale azul (es del shell, no de una pieza)", () => {
  const regla = reglasDe(cssBase()).find((r) => r.selector === "footer .mas a");
  assert.ok(regla, "el `<a>` del pie que emite el shell también es un enlace del pie");
  assert.equal(regla!.declaraciones["color"], "inherit");
});

function carta(): Pieza {
  const p = CATALOGO.find((x) => x.id === "carta");
  assert.ok(p, "no existe la pieza carta");
  return p!;
}

test("🔴 `--muted` NO deriva de `--marca-secundario`: el texto secundario tiene que pasar contraste", () => {
  // El test de arriba usa una ficha SIN marca, y el default de `--marca-secundario` es el mismo
  // `#6b7280` que el neutro — así que resolvía al mismo hex por los dos caminos y no distinguía cuál
  // estaba enchufado. Volver a atar `--muted` a la marca no tumbaba nada. Lo cazó una revisión.
  //
  // Acá la ficha declara un `secundario` DISTINTO del neutro, y no uno cualquiera: el `#c8963e` de
  // `docs/plantillas/template1/marca.json`, la paleta ya decidida para el cliente de demo. Sobre su
  // fondo `#fffdf9` da 2.62:1 — falla AA —, y `--muted` pinta el lede, las direcciones, los horarios,
  // el nav y la línea técnica. Si alguien vuelve a atarlos, esa web sale con todo el texto secundario
  // en oro ilegible, y cae este test antes que un cliente.
  const css = cssDe(
    validProfile({ brand: { colores: { secundario: "#c8963e", fondo: "#fffdf9" } } }),
  );

  assert.equal(tokenResuelto(css, "--muted"), "#6b7280", "`--muted` volvió a derivar de la marca");
  // Y el token de marca SÍ se emite: la ficha dice lo que dice; lo que no hace es pintar texto largo.
  assert.equal(tokenResuelto(css, "--marca-secundario"), "#c8963e");
  // El resto de la marca sigue llegando, para que el test no pase por no emitir nada.
  assert.equal(tokenResuelto(css, "--bg"), "#fffdf9");
});

test("🔴 el `color-mix` del acento vive BAJO un `@supports`, y sin él la degradación es peor", () => {
  // Sin el `@supports`, un navegador sin `color-mix` deja `--acento-legible` inválido en tiempo de
  // cómputo y el precio pierde su color de acento. Con él, se queda con el acento pleno de `:root`
  // —el comportamiento de hoy— que es una degradación limpia.
  //
  // El test que había miraba que el token resolviera a un `color-mix(`, pero el parser de
  // `css-de-prueba` entra en los `@supports` siempre, así que no distinguía dentro de fuera: quitar
  // el `@supports` no tumbaba nada. Acá se afirma sobre el texto emitido, que es lo único que
  // distingue las dos formas.
  const css = cssBase();
  const conMix = css.slice(css.indexOf("color-mix"));
  const antes = css.slice(0, css.indexOf("color-mix"));

  assert.match(css, /color-mix/, "el acento derivado desapareció");
  assert.ok(
    antes.lastIndexOf("@supports") > antes.lastIndexOf("}\n"),
    "el `color-mix` tiene que estar dentro de un `@supports`: sin él, el navegador que no lo soporta " +
      "pierde el color del acento en vez de caer al acento pleno",
  );
  assert.ok(conMix.length > 0);
});

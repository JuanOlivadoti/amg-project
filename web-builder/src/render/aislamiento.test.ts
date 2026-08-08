import { test } from "node:test";
import assert from "node:assert/strict";
import { problemasDeAislamiento, selectoresDe } from "./aislamiento.js";
import { CATALOGO } from "./piezas/index.js";
import type { Pieza } from "./piezas/tipos.js";
import { CTX_COMPLETO } from "./ctx-de-prueba.js";

/**
 * El test que la spec (§3) exige que sea **mecánico y no revisión humana**: se parsean los selectores
 * del `css` de cada pieza y se exige el prefijo de su raíz.
 *
 * Este archivo prueba primero **el detector**, con piezas de mentira, y solo después el catálogo real
 * (abajo). El orden no es capricho: un detector que no sabe fallar deja el catálogo en verde para
 * siempre y el gate entero pasa a ser un adorno. Los casos `🔴` son el **control positivo**.
 */

function pieza(css: string, raiz = "p-falsa"): Pieza {
  return { id: raiz.replace(/^p-/, ""), raiz, css, render: () => "" };
}

// ---------------------------------------------------------------- el parser de selectores

test("selectoresDe: saca los selectores de reglas sueltas y separa las listas por coma", () => {
  const sels = selectoresDe(".a{color:red}.b,.c > .d{margin:0}");
  assert.deepEqual(sels, [".a", ".b", ".c > .d"]);
});

test("selectoresDe: entra DENTRO de los @media (si no, el modo oscuro se escaparía del gate)", () => {
  const sels = selectoresDe("@media(prefers-color-scheme:dark){.a{color:red}section{border:0}}");
  assert.deepEqual(sels, [".a", "section"]);
});

test("selectoresDe: un @media anidado en otro sigue contando", () => {
  const sels = selectoresDe("@media screen{@media(min-width:40em){.a{color:red}}}");
  assert.deepEqual(sels, [".a"]);
});

// ---------------------------------------------------------------- el detector

test("una pieza bien aislada no tiene problemas", () => {
  const p = pieza(".p-falsa .x{color:red}.p-falsa .y:hover{color:blue}@media(prefers-color-scheme:dark){.p-falsa .x{color:#111}}");
  assert.deepEqual(problemasDeAislamiento(p, ["p-otra"]), []);
});

test("🔴 control positivo — un selector DESNUDO hace fallar el detector", () => {
  // Es el caso que importa: si esto no falla, el gate no prueba nada y el catálogo queda verde solo.
  const problemas = problemasDeAislamiento(pieza(".sitebar{color:red}"), []);
  assert.equal(problemas.length, 1, `debía detectar 1 problema, detectó ${problemas.length}`);
  assert.match(problemas[0]!, /\.sitebar/);
});

test("🔴 control positivo — un selector de ELEMENTO desnudo (`section`, `details`) también falla", () => {
  // Los cuatro que el CSS de origen tenía globales y que este refactor tiene que repartir.
  for (const sel of ["section", "section h2", "details", "summary"]) {
    assert.equal(problemasDeAislamiento(pieza(`${sel}{padding:0}`), []).length, 1, `"${sel}" tenía que fallar`);
  }
});

test("🔴 control positivo — un selector desnudo ESCONDIDO en un @media oscuro falla igual", () => {
  const p = pieza("@media(prefers-color-scheme:dark){.p-falsa .x{color:#111}section{border-color:#1e1e1e}}");
  assert.equal(problemasDeAislamiento(p, []).length, 1);
});

test("🔴 control positivo — una pieza que declara TOKENS falla (§3.6: los tokens son del base)", () => {
  assert.ok(problemasDeAislamiento(pieza(":root{--accent:#b91c1c}"), []).length > 0);
  // Y también escondido dentro de un @media, que es donde estaba el `:root` del modo oscuro.
  assert.ok(
    problemasDeAislamiento(pieza("@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8}}"), []).length > 0,
  );
});

test("🔴 control positivo — nombrar la raíz de OTRA pieza falla, aunque el selector empiece por la propia", () => {
  const p = pieza(".p-falsa .x .p-otra .y{color:red}");
  assert.equal(problemasDeAislamiento(p, ["p-otra"]).length, 1);
});

test("🔴 control positivo — depender de la adyacencia entre raíces (`+`, `~`) falla", () => {
  assert.ok(problemasDeAislamiento(pieza(".p-falsa + .p-otra{margin:0}"), ["p-otra"]).length > 0);
  assert.ok(problemasDeAislamiento(pieza(".p-falsa ~ .p-otra .z{margin:0}"), ["p-otra"]).length > 0);
});

test("🔴 control positivo — un prefijo que solo COINCIDE por texto no cuenta como raíz", () => {
  // `.p-falsalarga` empieza por la cadena `.p-falsa` pero es otra clase: si el detector usara
  // startsWith a secas, una pieza podría colarse estilando cualquier clase con su prefijo.
  assert.equal(problemasDeAislamiento(pieza(".p-falsalarga .x{color:red}"), []).length, 1);
});

test("la raíz sola, sin descendientes, es un selector válido de la pieza", () => {
  assert.deepEqual(problemasDeAislamiento(pieza(".p-falsa{margin:0}"), []), []);
});

// ---------------------------------------------------------------- el catálogo real

test("§3 — TODO selector de TODA pieza del catálogo empieza por su raíz, y ninguna declara tokens", () => {
  for (const p of CATALOGO) {
    const ajenas = CATALOGO.filter((o) => o.id !== p.id).map((o) => o.raiz);
    assert.deepEqual(problemasDeAislamiento(p, ajenas), [], `la pieza "${p.id}" no está aislada`);
  }
});

test("§3.1 — la raíz de cada pieza es `p-<id>` y es única en el catálogo", () => {
  const vistas = new Set<string>();
  for (const p of CATALOGO) {
    assert.equal(p.raiz, `p-${p.id}`, `la raíz de "${p.id}" no sigue la convención`);
    assert.ok(!vistas.has(p.raiz), `la raíz .${p.raiz} está repetida`);
    vistas.add(p.raiz);
  }
});

test("§3 — el HTML que emite cada pieza va envuelto en su raíz, o no habría nada a lo que aplicar su CSS", () => {
  // El aislamiento son DOS mitades: los selectores llevan el prefijo (arriba) y el markup lleva la
  // clase. Con solo la primera, una pieza pasaría el gate emitiendo HTML que su propio CSS no toca.
  for (const p of CATALOGO) {
    const html = p.render(CTX_COMPLETO);
    assert.ok(html, `la pieza "${p.id}" no dibujó nada con un contexto que tiene TODOS los datos`);
    assert.ok(
      html.startsWith(`<div class="${p.raiz}">`),
      `la pieza "${p.id}" no envuelve su HTML en .${p.raiz}: ${html.slice(0, 60)}`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §3.3, la mitad que faltaba: adyacencia que CRUZA a la pieza vecina sin nombrarla.
//
// El detector original solo cazaba `+`/`~` cuando el selector mencionaba la raíz ajena por su nombre,
// y una revisión encontró tres selectores que pasaban y no debían. En el documento emitido las piezas
// de la receta son HERMANAS (el shell las une dentro de `<main>`), así que un combinador aplicado al
// wrapper selecciona el interior de las piezas de al lado — el acoplamiento que §3 existe para
// prohibir, y el que hace que reordenar una receta pueda cambiar cómo se ve otra pieza.
// ─────────────────────────────────────────────────────────────────────────────

const RAICES_AJENAS = CATALOGO.map((p) => p.raiz);
const piezaDeMentira = (css: string): Pieza => ({ id: "falsa", raiz: "p-falsa", css, render: () => "" });

for (const sel of [".p-falsa + section", ".p-falsa ~ footer", ".p-falsa + *", ".p-falsa+section"]) {
  test(`§3.3 — «${sel}» cruza a la pieza vecina y tiene que fallar`, () => {
    const problemas = problemasDeAislamiento(piezaDeMentira(`${sel}{margin:0}`), RAICES_AJENAS);
    assert.equal(problemas.length, 1, `«${sel}» pasó el detector`);
    assert.match(problemas[0] ?? "", /combinador hermano/);
  });
}

for (const sel of [".p-falsa li + li", ".p-falsa .a + .b", ".p-falsa .a ~ .b"]) {
  test(`§3.3 — «${sel}» es adyacencia DENTRO de la pieza y tiene que pasar`, () => {
    // Sin esto la regla sería inservible: `.p-carta li + li` es adyacencia legítima y está en uso.
    // Un detector que prohíbe todo `+` obliga a desactivarlo, y un detector desactivado no protege.
    assert.deepEqual(problemasDeAislamiento(piezaDeMentira(`${sel}{margin:0}`), RAICES_AJENAS), []);
  });
}

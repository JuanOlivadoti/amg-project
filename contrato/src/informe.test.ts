import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./index.js";
// El mismo fixture de emisión, desde `fixtures.ts` y NO desde `esquema.test.ts`: importar un módulo de
// test haría que node:test corra sus casos dos veces.
import { briefM2 } from "./fixtures.js";

/*
 * Los dos tests de abajo asignan `{}` SIN `as`, y eso es la mitad de tipos del arreglo de la review
 * final de rama. Hasta entonces el tipo declaraba los tres campos del desglose obligatorios, así que
 * el caso que estos tests reproducen —el default `'{}'::jsonb` de la columna, que es lo que el seed de
 * la demo deja— solo se podía escribir mintiéndole a `tsc` con
 * `{} as KeywordResearchBrief["meta_run"]["coste_breakdown"]`. Un cast en un test es el tipo
 * admitiendo que no describe el dato: si vuelve a hacer falta acá, el tipo se rompió otra vez.
 */

test("el informe nunca contiene NaN, con cualquier dato incompleto", () => {
  const b = briefM2();
  // El default de la columna `coste_breakdown` es '{}' y el seed de la demo no lo puebla.
  b.meta_run.coste_breakdown = {};
  b.meta_run.calidad_datos = {
    cobertura_volumen: null,
    cobertura_kd: null,
    endpoints_degradados: null,
  };

  const md = renderReport(b);
  assert.ok(!md.includes("NaN"), `el informe emitió NaN:\n${md}`);
  assert.ok(!md.includes("undefined"), `el informe emitió undefined:\n${md}`);
});

test("sin desglose, NO se pinta la tabla de desglose, y el total sigue estando", () => {
  const b = briefM2();
  b.meta_run.coste_breakdown = {};

  const md = renderReport(b);
  // Una tabla de tres `n/d` ocupa el lugar del argumento comercial sin decirlo, y parece un fallo del
  // sistema en vez de un dato que falta. El total SÍ es un dato: se muestra.
  assert.ok(!md.includes("| DataForSEO |"), "pintó el desglose sin tener los datos");
  assert.ok(md.includes("0.3097"), "perdió el total, que sí se conoce");
  assert.match(md, /desglose.*no.*registr/i, "no dijo que el desglose falta");
});

test("una cobertura null sale n/d, no 0% ni NaN%", () => {
  const b = briefM2();
  b.meta_run.calidad_datos.cobertura_kd = null;
  const md = renderReport(b);
  assert.match(md, /dificultad \(KD\).*\bn\/d\b/i);
  assert.ok(!md.includes("0%"), "un dato ausente se mostró como 0%");
});

test("endpoints_degradados null dice que no se sabe; [] no dice nada", () => {
  const sinSaber = briefM2();
  sinSaber.meta_run.calidad_datos.endpoints_degradados = null;
  assert.match(renderReport(sinSaber), /no.*se.*registr/i);

  const ninguno = briefM2();
  ninguno.meta_run.calidad_datos.endpoints_degradados = [];
  const md = renderReport(ninguno);
  assert.ok(!md.includes("🔴"), "avisó de un fallo que no hubo");
  assert.ok(!/no.*se.*registr/i.test(md), "dijo 'no se sabe' cuando sí se sabe: ninguno falló");
});

test("un backlog vacío no pinta la sección", () => {
  const md = renderReport(briefM2({ backlog: [] }));
  assert.ok(!md.includes("Backlog"), "pintó una sección vacía");
});

/**
 * Cuenta las columnas de una fila de tabla Markdown (los `|` de los extremos no cuentan).
 *
 * Un `\|` NO separa celdas: es la forma que define GFM para poner una barra LITERAL dentro de una
 * celda, y es exactamente lo que produce el escapado. Contarlo como separador haría que este test no
 * pudiera pasar ni con el escapado correcto.
 */
function columnas(fila: string): number {
  return fila
    .replace(/\\\|/g, "")
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|").length;
}

/**
 * Anchos (en columnas) de las filas de las tablas de PÁGINAS del informe.
 *
 * Solo las de páginas: el informe también tiene las de coste y de calidad, que son de DOS columnas a
 * propósito, así que "todas las filas del documento miden lo mismo" no es un invariante del informe.
 * La cabecera de páginas es `| # |` y sus filas `| 1 |`, `| 2 |`…
 */
function anchosDeTablaDePaginas(md: string): Set<number> {
  const filas = md.split("\n").filter((l) => /^\| (#|\d+) \|/.test(l));
  assert.ok(filas.length >= 2, "no se encontró la tabla de páginas: el test pasaría en vacío");
  return new Set(filas.map(columnas));
}

test("un | en una keyword no agrega columnas a la tabla", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.keyword_principal = "hamburguesa | madrid";

  const anchos = anchosDeTablaDePaginas(renderReport(b));
  assert.equal(anchos.size, 1, `filas con distinto número de columnas: ${[...anchos].join(", ")}`);
});

/**
 * El compañero del test de arriba, y cubre el OTRO punto: `celda()` colapsa los saltos. El escapado
 * no alcanza acá — un `\n` no es un delimitador de Markdown, es un salto de línea— y parte la fila en
 * dos (una de 3 columnas y una huérfana), rompiendo la tabla de ahí para abajo.
 *
 * No estaba en el brief de la tarea: se descubrió porque quitar el colapso de `celda()` no tumbaba
 * ningún test, y una mutación que no tumba nada significa que falta el test o que la línea no hace lo
 * que dice. Acá era lo primero.
 */
test("un salto de línea en una keyword no parte la fila de la tabla", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.keyword_principal = "hamburguesa\n## madrid";

  const anchos = anchosDeTablaDePaginas(renderReport(b));
  assert.equal(anchos.size, 1, `filas con distinto número de columnas: ${[...anchos].join(", ")}`);
});

test("un salto de línea en un h1 no inventa un encabezado", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.content_brief.h1 = "Hamburguesería\n## Sección falsa";

  const md = renderReport(b);
  // `{0,3}` no es adorno: CommonMark acepta hasta TRES espacios de sangría en un encabezado ATX, así
  // que anclar en la columna 0 dejaba pasar un ` ## …` que el parser sí renderiza como encabezado.
  assert.ok(!/^ {0,3}## Sección falsa/m.test(md), "el dato se convirtió en estructura del documento");
});

test("backticks en un slug no abren un bloque de código", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.url_slug = "/pizza```madrid";

  const md = renderReport(b);
  // Un número impar de ``` deja el resto del documento dentro de un bloque de código.
  const cercas = (md.match(/```/g) ?? []).length;
  assert.equal(cercas % 2, 0, "quedó una cerca de código sin cerrar");
});

test("el escapado no destruye el texto legible", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.keyword_principal = "hamburguesa | madrid";
  const md = renderReport(b);
  // Escapar no es borrar: la keyword tiene que seguir siendo legible para un humano.
  assert.match(md, /hamburguesa .* madrid/);
});

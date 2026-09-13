import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MAX_BYTES_ENTRADA, MAX_FILAS, parsearCsv, validarFilas, type Filas } from "./filas.js";

/**
 * Parser de CSV a mano (RFC 4180 mínimo) y los topes de entrada del módulo de comparativas de
 * seguros. Nada de esto toca red ni base: son funciones puras sobre texto que ya bajó como CSV
 * (Task 3, desde Google Sheets) o que el navegador ya convirtió de un .xlsx/.csv (Task 7, portal).
 *
 * Por qué un parser propio: son ~40 líneas de máquina de estados, y un `split(",")` se rompe con el
 * primer campo entrecomillado. El proyecto ya rechazó una dependencia externa para un caso análogo
 * (parseo de PDF, 2026-08-07) por el mismo razonamiento — el texto ya es texto, no hace falta una lib.
 *
 * `CASOS_CSV` se exporta a propósito: Task 7 va a duplicar este parser en `portal/` (que no puede
 * importar de `api/` por estar fuera del monorepo), y el test cruzado que compare los dos parsers
 * sobre el mismo cuerpo de casos necesita esta lista sin reescribirla.
 */

export interface CasoCsv {
  nombre: string;
  entrada: string;
  esperado: Filas;
}

/**
 * Casos que `parsearCsv` debe RECHAZAR (comilla sin cerrar): no tienen un `esperado: Filas` posible
 * porque no hay filas correctas que devolver — el texto está malformado o truncado. Se exportan junto
 * a `CASOS_CSV` por el mismo motivo: el test cruzado de Task 7 le va a exigir este mismo rechazo al
 * parser del portal.
 */
export interface CasoCsvInvalido {
  nombre: string;
  entrada: string;
  /** Línea (1-indexada) donde abrió la comilla que nunca se cerró. El mensaje de error debe nombrarla. */
  lineaComillaAbierta: number;
}

export const CASOS_CSV_INVALIDOS: CasoCsvInvalido[] = [
  {
    nombre: "comilla sin cerrar absorbe el resto del texto, incluida una fila entera",
    entrada: `a,"b,c\nd,e`,
    lineaComillaAbierta: 1,
  },
];

export const CASOS_CSV: CasoCsv[] = [
  { nombre: "fila simple sin comillas", entrada: "a,b,c", esperado: [["a", "b", "c"]] },
  {
    nombre: "campo entrecomillado con coma adentro no parte la fila",
    entrada: `a,"b,c",d`,
    esperado: [["a", "b,c", "d"]],
  },
  {
    nombre: "comillas escapadas dobles",
    entrada: `"dice ""hola"""`,
    esperado: [[`dice "hola"`]],
  },
  {
    nombre: "salto de línea DENTRO de un campo entrecomillado no abre fila nueva",
    entrada: `a,"linea1\nlinea2",c`,
    esperado: [["a", "linea1\nlinea2", "c"]],
  },
  {
    nombre: "CRLF y LF mezclados, última línea sin salto también vale",
    entrada: "a,b\r\nc,d\ne,f",
    esperado: [
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ],
  },
  { nombre: "campo vacío entre comas", entrada: "a,,c", esperado: [["a", "", "c"]] },
  {
    nombre: "una sola columna, varias filas",
    entrada: "solo\nuna\ncolumna",
    esperado: [["solo"], ["una"], ["columna"]],
  },
  { nombre: "texto vacío no produce filas", entrada: "", esperado: [] },
  {
    nombre: "termina con salto de línea no produce una fila vacía espuria",
    entrada: "a,b\n",
    esperado: [["a", "b"]],
  },
];

test("campos entre comillas con coma adentro no se parten", () => {
  assert.deepEqual(parsearCsv(`a,"b,c",d`), [["a", "b,c", "d"]]);
});

test("comillas escapadas dobles", () => {
  assert.deepEqual(parsearCsv(`"dice ""hola"""`), [[`dice "hola"`]]);
});

test("🔴 un salto de línea DENTRO de un campo entrecomillado no abre fila nueva", () => {
  assert.deepEqual(parsearCsv(`a,"linea1\nlinea2",c`), [["a", "linea1\nlinea2", "c"]]);
});

test("CRLF y LF valen los dos, y la última línea sin salto también", () => {
  assert.deepEqual(parsearCsv("a,b\r\nc,d\ne,f"), [
    ["a", "b"],
    ["c", "d"],
    ["e", "f"],
  ]);
});

test("CASOS_CSV: la batería completa reusada por el test cruzado con el portal", () => {
  for (const caso of CASOS_CSV) {
    assert.deepEqual(parsearCsv(caso.entrada), caso.esperado, caso.nombre);
  }
});

test("🔴 una comilla sin cerrar lanza en vez de corromper filas en silencio", () => {
  // Caso exacto del revisor: sin el arreglo, esto devolvía [["a","b,c\nd,e"]] — la fila "d,e" quedaba
  // absorbida dentro del campo de la primera fila, y validarFilas nunca se enteraba de que faltaba.
  assert.throws(() => parsearCsv(`a,"b,c\nd,e`), /línea 1/);
});

test("CASOS_CSV_INVALIDOS: la batería de comillas sin cerrar, reusada por el test cruzado con el portal", () => {
  for (const caso of CASOS_CSV_INVALIDOS) {
    assert.throws(
      () => parsearCsv(caso.entrada),
      new RegExp(`línea ${caso.lineaComillaAbierta}\\b`),
      caso.nombre,
    );
  }
});

test("control: un campo entrecomillado bien CERRADO que contiene saltos de línea sigue funcionando", () => {
  // El arreglo de la comilla sin cerrar no puede romper este caso, que es legítimo y ya cubierto
  // arriba por CASOS_CSV — se repite acá con nombre explícito para que quede junto a la mutación.
  assert.deepEqual(parsearCsv(`a,"linea1\nlinea2\nlinea3",c`), [["a", "linea1\nlinea2\nlinea3", "c"]]);
});

test("una fila entera después de la comilla sin cerrar no se filtra en silencio", () => {
  // Antes del arreglo: parsearCsv(`a,"b,c\nd,e`) devolvía UNA fila con el texto fusionado, y
  // validarFilas nunca veía que faltaban dos filas. Ahora tiene que lanzar, no devolver datos parciales.
  assert.throws(() => parsearCsv(`nombre,precio\n"corredor,x\n99`));
});

test("🔴 MAX_FILAS es 200 — default de PRODUCCIÓN, no un parámetro del test", () => {
  assert.equal(MAX_FILAS, 200);
});

test("🔴 MAX_BYTES_ENTRADA son 512 KB", () => {
  assert.equal(MAX_BYTES_ENTRADA, 512 * 1024);
});

test("🔴 pasar de MAX_FILAS se rechaza, y el motivo dice el número", () => {
  const r = validarFilas(Array.from({ length: MAX_FILAS + 1 }, () => ["x"]));
  assert.equal(r.ok, false);
  assert.match((r as { motivo: string }).motivo, /200/);
});

test("validarFilas: exactamente MAX_FILAS se acepta (el borde, no el exceso)", () => {
  const filas = Array.from({ length: MAX_FILAS }, () => ["x"]);
  const r = validarFilas(filas);
  assert.equal(r.ok, true);
  assert.deepEqual((r as { filas: Filas }).filas, filas);
});

/*
 * Test cruzado con el portal (Task 7). `portal/` está fuera del monorepo a propósito y no puede
 * importar de `api/`, así que el parser de CSV está DUPLICADO en `portal/src/app/core/csv.ts`
 * (`parsearCsvPortal`). Un puntero en un comentario no es una garantía de que los dos parsers se
 * mantengan iguales — esto sí lo es: importa el archivo del portal por ruta, en runtime, y exige el
 * MISMO comportamiento que `parsearCsv` sobre el MISMO cuerpo de casos (`CASOS_CSV`,
 * `CASOS_CSV_INVALIDOS`), con el mecanismo de `contrato/src/una-sola-fuente.test.ts:102-106`
 * (`import(pathToFileURL(RUTA).href)`).
 */
test("🔴 el parser del portal (parsearCsvPortal) y el de la API (parsearCsv) se comportan IGUAL sobre los mismos casos", async () => {
  const RUTA = fileURLToPath(new URL("../../../portal/src/app/core/csv.ts", import.meta.url));
  let parsearCsvPortal: (t: string) => Filas;
  try {
    ({ parsearCsvPortal } = (await import(pathToFileURL(RUTA).href)) as {
      parsearCsvPortal: (t: string) => Filas;
    });
  } catch (e) {
    throw new Error(
      `no pude cargar el parser del portal en ${RUTA}: ${(e as Error).message}\n` +
        "Si el portal se movió, actualizá la ruta — pero NO borres este test: es lo único que ata " +
        "los dos parsers de CSV entre sí.",
    );
  }

  // Control de no-vacuidad: un barrido de cero casos pasa feliz, y eso sería un guard que nadie
  // verifica — la mitad de "peor que no tenerlo".
  assert.ok(CASOS_CSV.length >= 5, "control de no-vacuidad: CASOS_CSV no puede estar vacío");
  assert.ok(
    CASOS_CSV_INVALIDOS.length >= 1,
    "control de no-vacuidad: CASOS_CSV_INVALIDOS no puede estar vacío",
  );

  for (const caso of CASOS_CSV) {
    assert.deepEqual(
      parsearCsvPortal(caso.entrada),
      parsearCsv(caso.entrada),
      `divergen en "${caso.nombre}": ${JSON.stringify(caso.entrada)}`,
    );
  }

  for (const caso of CASOS_CSV_INVALIDOS) {
    assert.throws(
      () => parsearCsv(caso.entrada),
      undefined,
      `parsearCsv (API) tendría que lanzar en "${caso.nombre}"`,
    );
    assert.throws(
      () => parsearCsvPortal(caso.entrada),
      undefined,
      `parsearCsvPortal (portal) tendría que lanzar en "${caso.nombre}", igual que la API`,
    );
  }
});

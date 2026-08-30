import { test } from "node:test";
import assert from "node:assert/strict";
import { leerVertical } from "./build.js";

/**
 * `leerVertical` es la única pieza de `build.ts` que tiene sentido testear de forma aislada: el
 * resto de `main()` es orquestación de I/O (leer un brief, publicar) que ya cubren otros tests del
 * paquete. Esta función es la que decide si un `--vertical` que no está en el enum de `Vertical`
 * puede llegar a `juegoDe` sin control — la corrección que pidió la revisión de la Task 9.
 *
 * `main()` NO corre al importar este módulo: `build.ts` guarda su invocación detrás de
 * `process.argv[1]?.endsWith("build.ts")`, igual que `render/paridad/capturar.ts`.
 */

test("leerVertical: default 'restauracion' sin flag", () => {
  assert.equal(leerVertical([]), "restauracion");
});

test("leerVertical: acepta 'correduria_seguros'", () => {
  assert.equal(leerVertical(["--vertical=correduria_seguros"]), "correduria_seguros");
});

test("leerVertical: acepta 'restauracion' explícito", () => {
  assert.equal(leerVertical(["--vertical=restauracion"]), "restauracion");
});

test("leerVertical: rechaza un valor fuera del enum", () => {
  assert.throws(() => leerVertical(["--vertical=peluqueria"]), /inválida/);
});

test("leerVertical: rechaza un valor vacío después del '='", () => {
  // `--vertical=` sin valor no es "ausente" (eso da el default): es un valor explícito e inválido.
  assert.throws(() => leerVertical(["--vertical="]), /inválida/);
});

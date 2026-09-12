import { test } from "node:test";
import assert from "node:assert";
import { getComparativaProvider } from "./provider.js";
import { PREFIJO_MOCK_COMPARATIVA } from "./mock-provider.js";

/**
 * Datos de fixture para los tests. Misma estructura que saldría de parsearCsv:
 * array de filas, cada fila es un array de celdas.
 */
const FILAS = [
  ["Mapfre", "Responsabilidad Civil", "1200", "Hasta 1M", "Sin restricciones", "Cobertura estándar"],
  ["AXA", "Responsabilidad Civil Plus", "1500", "Hasta 2M", "Deducible 500€", "Mejor cobertura"],
  ["Zurich", "Básica", "900", "Hasta 500K", "", ""],
];

test("el mock es determinista: dos llamadas iguales dan lo mismo", async () => {
  const p = getComparativaProvider("mock");
  const resultado1 = await p.generar(FILAS, "Ana");
  const resultado2 = await p.generar(FILAS, "Ana");
  assert.deepEqual(resultado1, resultado2);
});

test("🔴 el informe del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(c.informeMd.includes(PREFIJO_MOCK_COMPARATIVA));
});

test("🔴 el asunto del mail del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(
    c.mailAsunto.includes(PREFIJO_MOCK_COMPARATIVA),
    "el mail se copia literalmente al cliente final sin pasar por la vista del informe: " +
      "el asunto tiene que llevar la marca de mock igual que el informe",
  );
});

test("🔴 el cuerpo del mail del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(
    c.mailCuerpoMd.includes(PREFIJO_MOCK_COMPARATIVA),
    "el mail se copia literalmente al cliente final sin pasar por la vista del informe: " +
      "el cuerpo tiene que llevar la marca de mock igual que el informe",
  );
});

test("el mock no cuesta nada", async () => {
  assert.equal((await getComparativaProvider("mock").generar(FILAS, "Ana")).costoUsd, 0);
});

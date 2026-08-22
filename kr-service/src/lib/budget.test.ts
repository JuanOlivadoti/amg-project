import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget, BudgetExceededError, DEFAULT_ESTIMATES, estimateEnrichment } from "./budget.js";

test("DEFAULT_ESTIMATES: calibradas contra la corrida real del 2026-08-22, no a ojo (default de producción, no lo elige el test)", () => {
  assert.equal(DEFAULT_ESTIMATES.dfsSearchVolumeBase, 90_000);
  assert.equal(DEFAULT_ESTIMATES.dfsSearchVolumePerKeyword, 2_000);
  assert.equal(DEFAULT_ESTIMATES.dfsBulkKdBase, 55_000);
  assert.equal(DEFAULT_ESTIMATES.dfsBulkKdPerKeyword, 1_000);
});

test("estimateEnrichment con los defaults reales cubre, con margen, el gasto real medido (23 kw → $0.1831 DFS de enriquecimiento)", () => {
  const estimado = estimateEnrichment(DEFAULT_ESTIMATES, 23);
  const realMicros = 183_100; // out/brief.json de la corrida del 2026-08-22 (docs/proyecto/15-plan-plataforma.md § Bloque D)
  assert.ok(
    estimado >= realMicros,
    `la estimación ($${estimado / 1e6}) tiene que cubrir el gasto real ($${realMicros / 1e6}) — un preflight que subestima no protege nada`,
  );
  assert.ok(estimado <= realMicros * 1.3, "el margen de seguridad no debería superar ~30% del gasto real conocido");
});

/** Medidor falso: expone un total controlable por el test. */
const meter = (totalMicros: number) => ({ totalMicros });

test("Budget: sin tope (null) nunca bloquea", () => {
  const b = new Budget(null, meter(999_999_999));
  assert.equal(b.enabled, false);
  assert.doesNotThrow(() => b.assertCanSpend(1_000_000, "fase"));
  assert.doesNotThrow(() => b.assertNotExceeded("fase"));
});

test("#5 Budget: preflight BLOQUEA antes de gastar si la estimación no entra", () => {
  const b = new Budget(10_000, meter(0));
  assert.throws(() => b.assertCanSpend(10_001, "expansión"), BudgetExceededError);
});

test("#5 Budget: preflight permite si la estimación entra justo", () => {
  const b = new Budget(10_000, meter(0));
  assert.doesNotThrow(() => b.assertCanSpend(10_000, "expansión"));
});

test("#5 Budget: el preflight tiene en cuenta lo YA gastado", () => {
  const b = new Budget(10_000, meter(8_000)); // quedan 2.000
  assert.doesNotThrow(() => b.assertCanSpend(2_000, "fase"));
  assert.throws(() => b.assertCanSpend(2_001, "fase"), BudgetExceededError);
});

test("#5 Budget: el mensaje de error identifica la fase y no la ejecuta", () => {
  const b = new Budget(1_000, meter(0));
  assert.throws(
    () => b.assertCanSpend(5_000, "clustering"),
    /clustering[\s\S]*No se ejecutó la fase/,
  );
});

test("#5 Budget: corte post-fase si el gasto real superó el tope", () => {
  const b = new Budget(10_000, meter(10_001)); // la estimación se quedó corta
  assert.throws(() => b.assertNotExceeded("enriquecimiento"), BudgetExceededError);
});

test("Budget: remainingMicros refleja el remanente", () => {
  const b = new Budget(10_000, meter(3_000));
  assert.equal(b.remainingMicros, 7_000);
  assert.equal(b.spentMicros, 3_000);
});

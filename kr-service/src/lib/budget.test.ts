import { test } from "node:test";
import assert from "node:assert/strict";
import { Budget, BudgetExceededError } from "./budget.js";

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

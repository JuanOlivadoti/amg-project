import { test } from "node:test";
import assert from "node:assert/strict";
import { CostMeter } from "./cost.js";

// Tarifas fijas para el test (no dependen de los defaults ni del entorno).
const PRICES = {
  "test-gen": { input: 10, output: 30 }, // USD por 1M tokens
  "test-embed": { input: 1, output: 0 },
};

test("CostMeter: acumula el costo real en USD de un proveedor (DataForSEO)", () => {
  const m = new CostMeter(PRICES);
  m.addUsd("dataforseo", 0.0123);
  assert.equal(m.breakdown.dataforseo_micros, 12_300);
  assert.equal(m.totalMicros, 12_300);
});

test("CostMeter: calcula el costo del LLM desde los tokens", () => {
  const m = new CostMeter(PRICES);
  // 1M input @ $10 + 1M output @ $30 = $40 = 40.000.000 micros
  m.addTokens("llm_generation", "test-gen", 1_000_000, 1_000_000);
  assert.equal(m.breakdown.llm_generation_micros, 40_000_000);
});

test("CostMeter: los embeddings solo pagan la entrada", () => {
  const m = new CostMeter(PRICES);
  m.addTokens("llm_embeddings", "test-embed", 2_000_000, 0);
  assert.equal(m.breakdown.llm_embeddings_micros, 2_000_000); // 2M @ $1/M = $2
});

test("#5 CostMeter: el total suma TODOS los proveedores (no solo DataForSEO)", () => {
  const m = new CostMeter(PRICES);
  m.addUsd("dataforseo", 1);
  m.addTokens("llm_generation", "test-gen", 100_000, 0); // $1
  m.addTokens("llm_embeddings", "test-embed", 1_000_000, 0); // $1
  assert.equal(m.totalMicros, 3_000_000); // $3
});

test("#5 CostMeter: un modelo sin tarifa NO inventa costo, lo marca como incompleto", () => {
  const m = new CostMeter(PRICES);
  m.addTokens("llm_generation", "modelo-desconocido", 1_000_000, 1_000_000);
  assert.equal(m.totalMicros, 0, "no se inventa un costo");
  assert.deepEqual(m.unpricedModels, ["modelo-desconocido"], "queda registrado");
});

test("CostMeter: ignora valores no finitos o negativos", () => {
  const m = new CostMeter(PRICES);
  m.addUsd("dataforseo", Number.NaN);
  m.addUsd("dataforseo", -5);
  assert.equal(m.totalMicros, 0);
});

test("CostMeter: reset() limpia importes y modelos sin precio", () => {
  const m = new CostMeter(PRICES);
  m.addUsd("dataforseo", 1);
  m.addTokens("llm_generation", "desconocido", 100, 0);
  m.reset();
  assert.equal(m.totalMicros, 0);
  assert.deepEqual(m.unpricedModels, []);
});

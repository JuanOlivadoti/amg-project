import { test } from "node:test";
import assert from "node:assert/strict";
import { costoEstimadoUsd } from "./openai-provider.js";

test("costoEstimadoUsd calcula el costo a partir de tokens de entrada/salida", () => {
  const costo = costoEstimadoUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, "gpt-4o-mini");
  assert.equal(costo, 0.15 + 0.6, "1M in a $0.15 + 1M out a $0.60");
});

test("🔴 costoEstimadoUsd devuelve null para un modelo sin tarifa conocida, no inventa un número", () => {
  const costo = costoEstimadoUsd({ prompt_tokens: 100, completion_tokens: 100 }, "modelo-inexistente");
  assert.equal(costo, null);
});

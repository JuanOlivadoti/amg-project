import { test } from "node:test";
import assert from "node:assert/strict";
import { costoEstimadoUsd, leerModeloBorrador } from "./openai-provider.js";

test("🔴 leerModeloBorrador cae a gpt-4o-mini con OPENAI_MODEL vacía, no solo ausente", () => {
  // env:sync escribe "" (no borra la clave) cuando OPENAI_MODEL falta en credenciales.env — un
  // `??` en vez de `?.trim() || ...` dejaría pasar "" como modelo real, y OpenAI la rechazaría.
  const previo = process.env["OPENAI_MODEL"];
  try {
    process.env["OPENAI_MODEL"] = "";
    assert.equal(leerModeloBorrador(), "gpt-4o-mini");
  } finally {
    if (previo === undefined) delete process.env["OPENAI_MODEL"];
    else process.env["OPENAI_MODEL"] = previo;
  }
});

test("leerModeloBorrador respeta OPENAI_MODEL cuando trae un valor real", () => {
  const previo = process.env["OPENAI_MODEL"];
  try {
    process.env["OPENAI_MODEL"] = "gpt-4o";
    assert.equal(leerModeloBorrador(), "gpt-4o");
  } finally {
    if (previo === undefined) delete process.env["OPENAI_MODEL"];
    else process.env["OPENAI_MODEL"] = previo;
  }
});

test("leerModeloBorrador cae a gpt-4o-mini cuando OPENAI_MODEL no está declarada", () => {
  const previo = process.env["OPENAI_MODEL"];
  try {
    delete process.env["OPENAI_MODEL"];
    assert.equal(leerModeloBorrador(), "gpt-4o-mini");
  } finally {
    if (previo !== undefined) process.env["OPENAI_MODEL"] = previo;
  }
});

test("costoEstimadoUsd calcula el costo a partir de tokens de entrada/salida", () => {
  const costo = costoEstimadoUsd({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 }, "gpt-4o-mini");
  assert.equal(costo, 0.15 + 0.6, "1M in a $0.15 + 1M out a $0.60");
});

test("🔴 costoEstimadoUsd devuelve null para un modelo sin tarifa conocida, no inventa un número", () => {
  const costo = costoEstimadoUsd({ prompt_tokens: 100, completion_tokens: 100 }, "modelo-inexistente");
  assert.equal(costo, null);
});

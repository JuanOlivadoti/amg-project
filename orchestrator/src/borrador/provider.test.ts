import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBorradorProvider, PREFIJO_MOCK_BORRADOR } from "./mock-provider.js";
import { OpenAIBorradorProvider } from "./openai-provider.js";
import { getBorradorProvider } from "./provider.js";

const RESEÑA = { googleReviewId: "r1", puntuacion: 5, autor: "Ana", texto: "Buenísimo", publicadaEn: new Date().toISOString() };

test("MockBorradorProvider.generar lleva el prefijo inconfundible", async () => {
  const texto = await new MockBorradorProvider().generar(RESEÑA);
  assert.ok(texto.startsWith(PREFIJO_MOCK_BORRADOR), "🔴 sin el prefijo, un mock se confunde con un borrador real");
});

// ------------------------------------------------------- el selector

test("getBorradorProvider('mock') devuelve el mock", () => {
  const p = getBorradorProvider("mock");
  assert.ok(p instanceof MockBorradorProvider);
});

test("getBorradorProvider('openai') devuelve el provider de OpenAI (sin llamar a la red)", () => {
  const p = getBorradorProvider("openai");
  assert.ok(p instanceof OpenAIBorradorProvider, "construir el cliente no dispara ninguna llamada");
});

test("getBorradorProvider() sin argumento resuelve el modo desde la config (mock por defecto)", () => {
  const original = process.env["BORRADOR_RESENAS_MODO"];
  const originalKey = process.env["OPENAI_API_KEY"];
  delete process.env["BORRADOR_RESENAS_MODO"];
  delete process.env["OPENAI_API_KEY"];
  try {
    const p = getBorradorProvider();
    assert.ok(p instanceof MockBorradorProvider);
  } finally {
    if (original === undefined) delete process.env["BORRADOR_RESENAS_MODO"];
    else process.env["BORRADOR_RESENAS_MODO"] = original;
    if (originalKey === undefined) delete process.env["OPENAI_API_KEY"];
    else process.env["OPENAI_API_KEY"] = originalKey;
  }
});

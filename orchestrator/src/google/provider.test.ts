import { test } from "node:test";
import assert from "node:assert/strict";
import { MockGoogleReviewsProvider } from "./mock-provider.js";
import { getGoogleReviewsProvider } from "./provider.js";

test("MockGoogleReviewsProvider.listarResenas devuelve siempre los mismos googleReviewId para la misma location", async () => {
  const p = new MockGoogleReviewsProvider();
  const primera = await p.listarResenas("tok", "loc-1");
  const segunda = await p.listarResenas("tok", "loc-1");
  assert.deepEqual(
    primera.map((r) => r.googleReviewId),
    segunda.map((r) => r.googleReviewId),
  );
});

test("🔴 refrescarToken rechaza un refresh token vacío", async () => {
  const p = new MockGoogleReviewsProvider();
  await assert.rejects(() => p.refrescarToken(""));
});

// ------------------------------------------------------- el selector

test("getGoogleReviewsProvider('mock') devuelve el mock", () => {
  const p = getGoogleReviewsProvider("mock");
  assert.ok(p instanceof MockGoogleReviewsProvider);
});

/**
 * 🔴 Bloque F fase 1 es mock-first a propósito: `live` no tiene implementación todavía y tiene que
 * lanzar un error explícito, no un `Provider` a medio escribir que reviente en el primer uso real.
 */
test("🔴 getGoogleReviewsProvider('live') lanza un error explícito: fase 1 no lo implementa", () => {
  assert.throws(
    () => getGoogleReviewsProvider("live"),
    /GOOGLE_REVIEWS_MODO=live sin implementación todavía/,
  );
});

/**
 * Sin argumento, resuelve el modo desde `leerConfig()` — el mismo criterio que `crearConexiones` en
 * `deps.ts`. Sin `GOOGLE_REVIEWS_MODO` en el entorno de test, el default es `mock` (config.test.ts lo
 * fija); acá se comprueba que el selector realmente lo usa y no un valor propio.
 */
test("getGoogleReviewsProvider() sin argumento resuelve el modo desde la config (mock por defecto)", () => {
  const original = process.env["GOOGLE_REVIEWS_MODO"];
  delete process.env["GOOGLE_REVIEWS_MODO"];
  try {
    const p = getGoogleReviewsProvider();
    assert.ok(p instanceof MockGoogleReviewsProvider);
  } finally {
    if (original === undefined) delete process.env["GOOGLE_REVIEWS_MODO"];
    else process.env["GOOGLE_REVIEWS_MODO"] = original;
  }
});

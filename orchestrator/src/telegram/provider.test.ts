import { test } from "node:test";
import assert from "node:assert/strict";
import { MockTelegramProvider } from "./mock-provider.js";
import { LiveTelegramProvider } from "./live-provider.js";
import { getTelegramProvider } from "./provider.js";

test("getTelegramProvider('mock') devuelve el mock", () => {
  const p = getTelegramProvider("mock");
  assert.ok(p instanceof MockTelegramProvider);
});

test("🔴 getTelegramProvider('live') sin token lanza", () => {
  assert.throws(
    () => getTelegramProvider("live", undefined),
    /TELEGRAM_MODO=live sin TELEGRAM_BOT_TOKEN/,
  );
});

/** Construir el cliente no dispara ninguna llamada a la red -- mismo criterio que `getBorradorProvider('openai')`. */
test("getTelegramProvider('live') con token devuelve un LiveTelegramProvider (sin llamar a ningún método)", () => {
  const p = getTelegramProvider("live", "token-de-prueba");
  assert.ok(p instanceof LiveTelegramProvider);
});

/**
 * Sin argumento, resuelve el modo desde `leerConfig()` -- el mismo criterio que
 * `getGoogleReviewsProvider()`/`getBorradorProvider()`. Sin `TELEGRAM_MODO` en el entorno de test, el
 * default es `mock` (config.test.ts lo fija); acá se comprueba que el selector realmente lo usa y no
 * un valor propio.
 */
test("getTelegramProvider() sin argumento resuelve el modo desde la config (mock por defecto)", () => {
  const original = process.env["TELEGRAM_MODO"];
  delete process.env["TELEGRAM_MODO"];
  try {
    const p = getTelegramProvider();
    assert.ok(p instanceof MockTelegramProvider);
  } finally {
    if (original === undefined) delete process.env["TELEGRAM_MODO"];
    else process.env["TELEGRAM_MODO"] = original;
  }
});

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { leerConfig } from "./deps.js";

/**
 * Tests de `leerConfig()` — no existían. Bloque G (2026-08-23): al bajar `CACHE_TTL_MS` para acotar
 * la propagación en multi-instancia, ese valor pasa de ser "una red de seguridad" a "el mecanismo"
 * (ver el comentario de `invalidarSpace()` en cache.ts). Un default de producción que decide la
 * propagación de un SLA y no tiene test es exactamente la clase de cosa que AGENTS.md llama "una
 * decisión sin dueño".
 */

const VARS = [
  "DATABASE_URL_RENDER",
  "STORYBLOK_WEBHOOK_SECRET",
  "PREVIEW_SECRET",
  "DOMINIO_PREVIEW",
  "CACHE_TTL_MS",
  "TRUST_PROXY",
];

const GUARDADO = { ...process.env };
afterEach(() => {
  process.env = { ...GUARDADO };
});

function conEntorno(vars: Record<string, string>): void {
  process.env = { ...GUARDADO };
  for (const k of VARS) delete process.env[k];
  Object.assign(process.env, vars);
}

const OBLIGATORIAS = {
  DATABASE_URL_RENDER: "postgres://amg_render:x@host/db",
  STORYBLOK_WEBHOOK_SECRET: "secreto-webhook",
};

test("leerConfig: falla si falta DATABASE_URL_RENDER", () => {
  conEntorno({ STORYBLOK_WEBHOOK_SECRET: "x" });
  assert.throws(() => leerConfig(), /DATABASE_URL_RENDER/);
});

test("leerConfig: falla si falta STORYBLOK_WEBHOOK_SECRET", () => {
  conEntorno({ DATABASE_URL_RENDER: "postgres://x" });
  assert.throws(() => leerConfig(), /STORYBLOK_WEBHOOK_SECRET/);
});

test("leerConfig: el mensaje nombra las DOS variables si faltan las dos", () => {
  conEntorno({});
  assert.throws(() => leerConfig(), /DATABASE_URL_RENDER[\s\S]*STORYBLOK_WEBHOOK_SECRET/);
});

test("leerConfig: sin CACHE_TTL_MS, no manda cacheTtlMs (CacheRender usa su propio default)", () => {
  conEntorno(OBLIGATORIAS);
  const cfg = leerConfig();
  assert.equal("cacheTtlMs" in cfg, false);
});

test("leerConfig: CACHE_TTL_MS válido se propaga tal cual", () => {
  conEntorno({ ...OBLIGATORIAS, CACHE_TTL_MS: "60000" });
  const cfg = leerConfig();
  assert.equal(cfg.cacheTtlMs, 60_000);
});

test("leerConfig: CACHE_TTL_MS=0 se ignora (0 no es un TTL válido, es 'nunca cachear' por accidente)", () => {
  conEntorno({ ...OBLIGATORIAS, CACHE_TTL_MS: "0" });
  const cfg = leerConfig();
  assert.equal("cacheTtlMs" in cfg, false);
});

test("leerConfig: CACHE_TTL_MS negativo se ignora", () => {
  conEntorno({ ...OBLIGATORIAS, CACHE_TTL_MS: "-1000" });
  const cfg = leerConfig();
  assert.equal("cacheTtlMs" in cfg, false);
});

test("leerConfig: CACHE_TTL_MS no numérico se ignora en vez de crashear", () => {
  conEntorno({ ...OBLIGATORIAS, CACHE_TTL_MS: "treinta-segundos" });
  const cfg = leerConfig();
  assert.equal("cacheTtlMs" in cfg, false);
});

test("leerConfig: PREVIEW_SECRET vacío no se manda (mismo criterio que su .env.example)", () => {
  conEntorno({ ...OBLIGATORIAS, PREVIEW_SECRET: "   " });
  const cfg = leerConfig();
  assert.equal("previewSecret" in cfg, false);
});

test("leerConfig: TRUST_PROXY solo habilita con el valor exacto '1'", () => {
  conEntorno({ ...OBLIGATORIAS, TRUST_PROXY: "true" });
  assert.equal(leerConfig().confiarEnProxy, false);

  conEntorno({ ...OBLIGATORIAS, TRUST_PROXY: "1" });
  assert.equal(leerConfig().confiarEnProxy, true);
});

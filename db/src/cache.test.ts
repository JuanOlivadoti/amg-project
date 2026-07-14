import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones } from "./migrate.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PgKeywordCache } from "./cache.js";
import type { CacheMeta } from "./cache.js";

/**
 * La cache de proveedor contra Postgres REAL (PGlite). Valida el SQL de `kr_metrics_cache` /
 * `kr_serp_cache` antes de que exista el proyecto de Supabase: el upsert, el filtro por
 * `expires_at` y —lo más delicado— que un `null` cacheado ("el proveedor no tiene dato") se
 * distinga de "no hay entrada".
 */

const here = dirname(fileURLToPath(import.meta.url));

let pg: PGlite;
let metrics: PgKeywordCache;
let serp: PgKeywordCache;

const meta = (key: string): CacheMeta => ({
  endpoint: "search_volume",
  canonical_key: key.split("|").pop() ?? key,
  location_code: 2724,
  language_code: "es",
  depth: 10,
});

before(async () => {
  pg = new PGlite();
  await aplicarMigraciones(pg);
  metrics = new PgKeywordCache(pg, "kr_metrics_cache", meta);
  serp = new PgKeywordCache(pg, "kr_serp_cache", meta);
});

after(async () => {
  await pg.close();
});

const DIA = 24 * 3600_000;

test("cache pg: guarda y devuelve el valor", async () => {
  await metrics.setMany([["sv|2724|es|pizza napolitana madrid", { search_volume: 390 }]], 30 * DIA);

  const hit = await metrics.getMany<{ search_volume: number }>(["sv|2724|es|pizza napolitana madrid"]);

  assert.equal(hit.get("sv|2724|es|pizza napolitana madrid")?.search_volume, 390);
});

test("cache pg: una clave que no está NO devuelve nada", async () => {
  const hit = await metrics.getMany(["sv|2724|es|no existe"]);
  assert.equal(hit.size, 0);
});

/**
 * El caso delicado. En jsonb, un `null` crudo es indistinguible de "no hay fila", y `null` es un
 * valor legítimo y valioso: significa "DataForSEO no tiene dato para esta keyword" (le pasó a 41 de
 * 60 en la corrida real). Si no se distingue, cada corrida vuelve a PAGAR por preguntar lo mismo y
 * recibir nada. Por eso el payload se envuelve en `{v: ...}`.
 */
test("cache pg: un null CACHEADO es un hit, no una ausencia", async () => {
  await metrics.setMany([["sv|2724|es|long tail rarisima", null]], 7 * DIA);

  const hit = await metrics.getMany<unknown>(["sv|2724|es|long tail rarisima"]);

  assert.equal(hit.has("sv|2724|es|long tail rarisima"), true, "la clave DEBE estar presente");
  assert.equal(hit.get("sv|2724|es|long tail rarisima"), null, "y su valor es null");
});

test("cache pg: una entrada VENCIDA no se devuelve", async () => {
  await metrics.setMany([["sv|2724|es|vencida", { search_volume: 1 }]], -1000); // ya expiró

  const hit = await metrics.getMany(["sv|2724|es|vencida"]);

  assert.equal(hit.size, 0);
});

test("cache pg: volver a guardar la misma clave ACTUALIZA (upsert), no duplica", async () => {
  await metrics.setMany([["sv|2724|es|upsert", { search_volume: 100 }]], 30 * DIA);
  await metrics.setMany([["sv|2724|es|upsert", { search_volume: 999 }]], 30 * DIA);

  const hit = await metrics.getMany<{ search_volume: number }>(["sv|2724|es|upsert"]);
  const { rows } = await pg.query("select count(*)::int as n from kr_metrics_cache where cache_key = $1", [
    "sv|2724|es|upsert",
  ]);

  assert.equal(hit.get("sv|2724|es|upsert")?.search_volume, 999, "gana el valor nuevo");
  assert.equal((rows[0] as { n: number }).n, 1, "una sola fila");
});

test("cache pg: getMany trae varias claves de una sola query", async () => {
  await metrics.setMany(
    [
      ["sv|2724|es|a", { search_volume: 1 }],
      ["sv|2724|es|b", { search_volume: 2 }],
    ],
    30 * DIA,
  );

  const hit = await metrics.getMany(["sv|2724|es|a", "sv|2724|es|b", "sv|2724|es|no-esta"]);

  assert.equal(hit.size, 2);
});

test("cache pg: el SERP guarda sus columnas de clave (engine/device/tipo/depth)", async () => {
  await serp.setMany([["serp|google|desktop|organic|10|2724|es|pizza", ["https://a.com"]]], 7 * DIA);

  const { rows } = await pg.query<{ engine: string; depth: number; serp_type: string }>(
    "select engine, depth, serp_type from kr_serp_cache where cache_key = $1",
    ["serp|google|desktop|organic|10|2724|es|pizza"],
  );

  assert.equal(rows[0]!.engine, "google");
  assert.equal(rows[0]!.depth, 10);
  assert.equal(rows[0]!.serp_type, "organic");
});

test("cache pg: purgar() borra solo lo vencido", async () => {
  await metrics.setMany([["sv|2724|es|viva", { search_volume: 1 }]], 30 * DIA);
  await metrics.setMany([["sv|2724|es|muerta", { search_volume: 1 }]], -1000);

  const borradas = await metrics.purgar();

  assert.ok(borradas >= 1);
  const hit = await metrics.getMany(["sv|2724|es|viva"]);
  assert.equal(hit.size, 1, "la entrada viva sobrevive a la purga");
});

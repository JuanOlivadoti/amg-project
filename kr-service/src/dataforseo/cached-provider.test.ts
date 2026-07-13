import { test } from "node:test";
import assert from "node:assert/strict";
import { CachedProvider } from "./cached-provider.js";
import { TTL, cacheKeys } from "./cache.js";
import type { KeywordCache } from "./cache.js";
import { MARKET_ES } from "../config.js";
import type { KeywordDataProvider, SearchVolumeRow } from "./provider.js";
import type { Market } from "../types.js";

/** Cache en memoria: alcanza para los tests (lo que se prueba es el decorador, no el backend). */
class MemCache implements KeywordCache {
  private data = new Map<string, { value: unknown; expiresAt: number }>();
  /** TTL con el que se guardó cada clave — para verificar que las ausencias caducan antes. */
  readonly ttls = new Map<string, number>();

  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const now = Date.now();
    const out = new Map<string, T>();
    for (const k of keys) {
      const e = this.data.get(k);
      if (e && e.expiresAt > now) out.set(k, e.value as T);
    }
    return out;
  }

  async setMany<T>(items: Array<[string, T]>, ttlMs: number): Promise<void> {
    for (const [k, v] of items) {
      this.data.set(k, { value: v, expiresAt: Date.now() + ttlMs });
      this.ttls.set(k, ttlMs);
    }
  }
}

/** Provider espía: registra EXACTAMENTE qué keywords se le pidieron (= qué se pagó). */
class SpyProvider implements KeywordDataProvider {
  costMicros = 0;
  readonly volumeCalls: string[][] = [];
  readonly kdCalls: string[][] = [];
  readonly serpCalls: string[] = [];
  readonly suggestionCalls: string[] = [];

  /** Keywords para las que el proveedor SÍ tiene datos. El resto no vuelve (= sin dato). */
  constructor(private readonly conDatos = new Set<string>()) {}

  async keywordSuggestions(keyword: string): Promise<string[]> {
    this.suggestionCalls.push(keyword);
    return [`${keyword} barato`, `${keyword} cerca`];
  }

  async searchVolume(keywords: string[]): Promise<SearchVolumeRow[]> {
    this.volumeCalls.push([...keywords]);
    return keywords
      .filter((k) => this.conDatos.has(k))
      .map((k) => ({ keyword: k, search_volume: 100, cpc: null, competition: null }) as SearchVolumeRow);
  }

  async bulkKeywordDifficulty(keywords: string[]): Promise<Map<string, number | null>> {
    this.kdCalls.push([...keywords]);
    return new Map(keywords.map((k) => [k, this.conDatos.has(k) ? 42 : null]));
  }

  async serp(keyword: string): Promise<string[]> {
    this.serpCalls.push(keyword);
    return ["https://a.com", "https://b.com"];
  }
}

const M: Market = MARKET_ES;
const NS = "dfs:prod";

// ---------------------------------------------------------------- lo esencial

test("cache: la segunda corrida NO vuelve a pedir NADA (costo cero)", async () => {
  const spy = new SpyProvider(new Set(["pizza napolitana madrid"]));
  const cache = new MemCache();
  const kws = ["pizza napolitana madrid"];

  await new CachedProvider(spy, cache, NS).searchVolume(kws, M);
  assert.equal(spy.volumeCalls.length, 1, "la 1ª corrida paga");

  // Provider NUEVO (otro proceso), MISMA cache: es el escenario real.
  const spy2 = new SpyProvider(new Set(["pizza napolitana madrid"]));
  const res = await new CachedProvider(spy2, cache, NS).searchVolume(kws, M);

  assert.equal(spy2.volumeCalls.length, 0, "la 2ª corrida NO debe llamar a la API");
  assert.equal(res.length, 1, "pero devuelve el dato igual");
  assert.equal(res[0]!.search_volume, 100);
});

/**
 * El corazón del asunto: si se cacheara el LOTE, una sola keyword nueva invalidaría las otras 51 y
 * se pagarían todas otra vez. Cada research comparte casi todas sus keywords con el anterior del
 * mismo rubro, así que ese caso es el HABITUAL, no el raro.
 */
test("cache: con una keyword nueva se pide SOLO esa, no el lote entero", async () => {
  const conDatos = new Set(["a", "b", "c", "nueva"]);
  const cache = new MemCache();

  await new CachedProvider(new SpyProvider(conDatos), cache, NS).searchVolume(["a", "b", "c"], M);

  const spy = new SpyProvider(conDatos);
  const res = await new CachedProvider(spy, cache, NS).searchVolume(["a", "b", "c", "nueva"], M);

  assert.equal(spy.volumeCalls.length, 1);
  assert.deepEqual(spy.volumeCalls[0], ["nueva"], "solo la keyword que falta");
  assert.equal(res.length, 4, "el resultado igual trae las 4");
});

/**
 * En la corrida real, DataForSEO devolvió KD `null` para 41 de 60 keywords. Sin cachear la
 * AUSENCIA, cada corrida vuelve a pagar por preguntar lo mismo y recibir nada.
 */
test("cache: se cachea el 'no tengo dato' (si no, se paga por la nada una y otra vez)", async () => {
  const cache = new MemCache();
  const sinDatos = ["keyword long tail rarisima"];

  await new CachedProvider(new SpyProvider(), cache, NS).bulkKeywordDifficulty(sinDatos, M);

  const spy = new SpyProvider();
  const kd = await new CachedProvider(spy, cache, NS).bulkKeywordDifficulty(sinDatos, M);

  assert.equal(spy.kdCalls.length, 0, "NO se vuelve a preguntar por una keyword sin datos");
  assert.equal(kd.get(sinDatos[0]!), null, "y se sigue reportando como null (≠ 0)");
});

test("cache: la ausencia caduca ANTES que la presencia (puede aparecer volumen después)", async () => {
  const cache = new MemCache();
  await new CachedProvider(new SpyProvider(new Set(["con datos"])), cache, NS).bulkKeywordDifficulty(
    ["con datos", "sin datos"],
    M,
  );

  const ttlPresente = cache.ttls.get(cacheKeys.keywordDifficulty(NS, "con datos", M));
  const ttlAusente = cache.ttls.get(cacheKeys.keywordDifficulty(NS, "sin datos", M));

  assert.equal(ttlPresente, TTL.metrics);
  assert.equal(ttlAusente, TTL.negative);
  assert.ok(TTL.negative < TTL.metrics, "una keyword sin datos hoy puede tenerlos en un mes");
});

// ---------------------------------------------------------------- claves completas

test("cache: el mismo keyword en OTRO mercado NO es un hit (clave completa, ADR-10)", async () => {
  const cache = new MemCache();
  const otroMercado: Market = { ...M, location_code: 2840, language_code: "en", country: "US" };

  await new CachedProvider(new SpyProvider(new Set(["pizza"])), cache, NS).searchVolume(["pizza"], M);

  const spy = new SpyProvider(new Set(["pizza"]));
  await new CachedProvider(spy, cache, NS).searchVolume(["pizza"], otroMercado);

  assert.equal(spy.volumeCalls.length, 1, "otro mercado = otro dato: hay que pedirlo");
});

test("cache: un SERP con otra profundidad NO es un hit", async () => {
  const cache = new MemCache();
  await new CachedProvider(new SpyProvider(), cache, NS).serp("pizza", M, 10);

  const spy = new SpyProvider();
  await new CachedProvider(spy, cache, NS).serp("pizza", M, 20);

  assert.equal(spy.serpCalls.length, 1);
});

test("cache: variantes de casing son el MISMO dato (clave canónica)", async () => {
  const cache = new MemCache();
  await new CachedProvider(new SpyProvider(new Set(["Pizza Napolitana Madrid"])), cache, NS).searchVolume(
    ["Pizza Napolitana Madrid"],
    M,
  );

  const spy = new SpyProvider();
  await new CachedProvider(spy, cache, NS).searchVolume(["pizza napolitana madrid"], M);

  assert.equal(spy.volumeCalls.length, 0, "no se paga dos veces por la misma keyword con otro casing");
});

// ---------------------------------------------------------------- métricas

test("cache: las stats reportan cuántas consultas se ahorraron", async () => {
  const cache = new MemCache();
  const conDatos = new Set(["a", "b"]);
  await new CachedProvider(new SpyProvider(conDatos), cache, NS).searchVolume(["a", "b"], M);

  const p = new CachedProvider(new SpyProvider(conDatos), cache, NS);
  await p.searchVolume(["a", "b", "c"], M);

  assert.equal(p.stats.hits, 2);
  assert.equal(p.stats.misses, 1);
});

// ================================================================
// Regresiones de la 3ª review
// ================================================================

/**
 * El namespace (proveedor + entorno) va en TODAS las claves.
 *
 * Sin él, una corrida contra el SANDBOX dejaba 217 entradas con `volume: null` (el sandbox no
 * devuelve volúmenes). Al cambiar la URL base a producción —UN renglón del .env, y es exactamente
 * lo que dice la guía de la corrida real— esas entradas se servían como ACIERTOS: la corrida "de
 * producción" salía barata, sin volúmenes, y con un brief basura que parecía legítimo.
 */
test("🔴 el entorno va en la clave: el sandbox NO puede envenenar producción", async () => {
  const cache = new MemCache();

  // Corrida de sandbox: no devuelve volumen para nada.
  await new CachedProvider(new SpyProvider(), cache, "dfs:sandbox").searchVolume(["pizza napolitana madrid"], M);

  // Ahora producción, con la MISMA cache.
  const prod = new SpyProvider(new Set(["pizza napolitana madrid"]));
  const res = await new CachedProvider(prod, cache, "dfs:prod").searchVolume(["pizza napolitana madrid"], M);

  assert.equal(prod.volumeCalls.length, 1, "producción DEBE preguntarle al proveedor real");
  assert.equal(res[0]?.search_volume, 100, "y obtener el dato de verdad, no la ficción del sandbox");
});

/**
 * Un `SearchVolumeRow` con `search_volume: null` es un OBJETO no nulo. Con el filtro anterior
 * (`v !== null`) caía en el TTL de 30 días: un mes declarando "sin datos" una keyword que podría
 * ganar volumen. Justo lo contrario de lo que el diseño dice hacer.
 */
test("🔴 un volumen null EXPLÍCITO recibe el TTL corto, no el de 30 días", async () => {
  const cache = new MemCache();

  class SinVolumen extends SpyProvider {
    override async searchVolume(keywords: string[]): Promise<SearchVolumeRow[]> {
      this.volumeCalls.push([...keywords]);
      // El proveedor SÍ devuelve la fila, pero sin volumen.
      return keywords.map((k) => ({ keyword: k, search_volume: null, cpc: null, competition: null }) as SearchVolumeRow);
    }
  }

  await new CachedProvider(new SinVolumen(), cache, NS).searchVolume(["long tail"], M);

  assert.equal(cache.ttls.get(cacheKeys.searchVolume(NS, "long tail", M)), TTL.negative);
});

/**
 * Si el proveedor LANZA (p. ej. una task de DataForSEO falló), no se puede cachear nada: no sabemos
 * qué keywords faltan, y tomarlas por ausentes fosilizaría un fallo transitorio durante 7-30 días.
 */
test("🔴 si el proveedor falla, NO se cachea nada (un fallo no se fosiliza como 'sin datos')", async () => {
  const cache = new MemCache();

  class Roto extends SpyProvider {
    override async searchVolume(): Promise<SearchVolumeRow[]> {
      throw new Error("2 task(s) fallaron: 50301 (internal error)");
    }
  }

  await assert.rejects(() => new CachedProvider(new Roto(), cache, NS).searchVolume(["pizza"], M));

  // La cache quedó intacta: la próxima corrida vuelve a preguntar.
  const spy = new SpyProvider(new Set(["pizza"]));
  await new CachedProvider(spy, cache, NS).searchVolume(["pizza"], M);
  assert.equal(spy.volumeCalls.length, 1, "se vuelve a preguntar, no se sirve un null fosilizado");
});

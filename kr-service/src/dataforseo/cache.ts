import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { canonicalKey } from "../lib/text.js";
import type { Market } from "../types.js";

/**
 * Cache de las respuestas de DataForSEO (ADR-10: cache split, claves completas, `expires_at`).
 *
 * Por qué importa: **el 81% del costo de un research es DataForSEO**, y un research cuesta ~$0.31.
 * Repetir el mismo prompt —o cualquier prompt que comparta keywords, que en un mismo vertical es
 * casi todo— vuelve a pagarlo entero. Con cache, la segunda corrida cuesta centavos.
 *
 * El volumen de búsqueda de "pizza napolitana madrid" es un dato del MERCADO, no de un cliente:
 * se puede compartir entre clientes y entre tenants sin problema. Por eso las tablas de cache no
 * llevan `tenant_id` (ver db/migrations) — y por eso mismo van deny-all: solo el backend las toca.
 */

export interface CacheEntry<T> {
  value: T;
  /** Epoch ms. Pasado este instante la entrada se ignora (y se vuelve a pedir). */
  expiresAt: number;
}

export interface KeywordCache {
  getMany<T>(keys: string[]): Promise<Map<string, T>>;
  setMany<T>(items: Array<[key: string, value: T]>, ttlMs: number): Promise<void>;
}

// ---------------------------------------------------------------- TTLs

/**
 * Cuánto vale una respuesta antes de volver a pagarla.
 *
 * El volumen y la dificultad se mueven despacio (Google Ads publica medias de 12 meses): 30 días
 * es conservador. El SERP cambia todo el tiempo — es lo que se usa para fusionar clusters, así que
 * un dato viejo agrupa páginas mal: 7 días.
 */
export const TTL = {
  metrics: 30 * 24 * 3600_000,
  suggestions: 30 * 24 * 3600_000,
  serp: 7 * 24 * 3600_000,
  /**
   * Los "no tengo dato" se cachean MÁS CORTO.
   *
   * Cachear la ausencia es esencial: en la corrida real DataForSEO devolvió KD `null` para 41 de
   * 60 keywords. Sin cachear el null, cada corrida vuelve a PAGAR por preguntar lo mismo y recibir
   * nada. Pero se cachea con TTL corto porque una keyword sin datos hoy puede tenerlos en un mes
   * (justo lo que pasa con la long-tail que empieza a tener volumen).
   */
  negative: 7 * 24 * 3600_000,
} as const;

// ---------------------------------------------------------------- claves
//
// ADR-10 exige claves COMPLETAS. Una clave incompleta es peor que no cachear: devuelve el dato de
// otro mercado, otro idioma o otra profundidad de SERP como si fuera el pedido, y el error es
// silencioso. Todo lo que cambia la respuesta tiene que estar en la clave.

const k = (...parts: Array<string | number>) => parts.join("|");

export const cacheKeys = {
  searchVolume: (kw: string, m: Market) => k("sv", m.location_code, m.language_code, canonicalKey(kw)),
  keywordDifficulty: (kw: string, m: Market) => k("kd", m.location_code, m.language_code, canonicalKey(kw)),
  suggestions: (seed: string, m: Market, limit: number) =>
    k("sugg", m.location_code, m.language_code, limit, canonicalKey(seed)),
  serp: (kw: string, m: Market, depth: number) =>
    k("serp", "google", "desktop", "organic", depth, m.location_code, m.language_code, canonicalKey(kw)),
};

// ---------------------------------------------------------------- implementaciones

/** Sin cache. Cada corrida paga todo de nuevo. */
export class NoopCache implements KeywordCache {
  async getMany<T>(): Promise<Map<string, T>> {
    return new Map();
  }
  async setMany(): Promise<void> {}
}

/**
 * Cache en un archivo JSON. Es el default de desarrollo: persiste ENTRE corridas y entre procesos,
 * que es donde está el ahorro real (una cache en memoria no ahorraría un centavo: el CLI corre un
 * research por proceso).
 *
 * En producción se reemplaza por la de Postgres (`kr_metrics_cache` / `kr_serp_cache`), que además
 * se comparte entre todos los clientes. Misma interfaz.
 */
export class FileCache implements KeywordCache {
  private data: Record<string, CacheEntry<unknown>> | null = null;
  private dirty = false;

  constructor(private readonly path: string) {}

  private async load(): Promise<Record<string, CacheEntry<unknown>>> {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.path, "utf8")) as Record<string, CacheEntry<unknown>>;
    } catch {
      this.data = {}; // no existe o está corrupta: se arranca de cero, no es un error
    }
    return this.data;
  }

  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const data = await this.load();
    const now = Date.now();
    const out = new Map<string, T>();
    for (const key of keys) {
      const e = data[key];
      if (e && e.expiresAt > now) out.set(key, e.value as T);
    }
    return out;
  }

  async setMany<T>(items: Array<[string, T]>, ttlMs: number): Promise<void> {
    if (items.length === 0) return;
    const data = await this.load();
    const expiresAt = Date.now() + ttlMs;
    for (const [key, value] of items) data[key] = { value, expiresAt };
    this.dirty = true;
    await this.flush();
  }

  /** Escritura atómica: un corte a mitad de write no debe dejar la cache corrupta. */
  async flush(): Promise<void> {
    if (!this.dirty || !this.data) return;
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data), "utf8");
    await rename(tmp, this.path);
    this.dirty = false;
  }
}

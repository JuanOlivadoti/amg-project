import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

/**
 * `ns` = proveedor + entorno (p. ej. `dfs:prod`). Es OBLIGATORIO y va primero.
 *
 * Omitirlo fue un bug de corrección, no de higiene: el sandbox devuelve ficción, así que una
 * entrada de sandbox servida en producción es un dato FALSO presentado como real. Ver
 * `cacheNamespace()` en index.ts.
 */
export const cacheKeys = {
  searchVolume: (ns: string, kw: string, m: Market) =>
    k(ns, "sv", m.location_code, m.language_code, canonicalKey(kw)),
  keywordDifficulty: (ns: string, kw: string, m: Market) =>
    k(ns, "kd", m.location_code, m.language_code, canonicalKey(kw)),
  suggestions: (ns: string, seed: string, m: Market, limit: number) =>
    k(ns, "sugg", m.location_code, m.language_code, limit, canonicalKey(seed)),
  serp: (ns: string, kw: string, m: Market, depth: number) =>
    k(ns, "serp", "google", "desktop", "organic", depth, m.location_code, m.language_code, canonicalKey(kw)),
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

  /**
   * Cola de operaciones: serializa load/set/flush.
   *
   * `searchVolume` y `bulkKeywordDifficulty` corren en `Promise.all`, así que **dentro de un mismo
   * run** dos `setMany()` entraban a la vez: ambos leían, ambos escribían el MISMO `.tmp` y ambos
   * hacían `rename` — uno pisaba al otro y el segundo podía fallar con ENOENT.
   */
  private cola: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** Encola: la operación siguiente no arranca hasta que termina la anterior. */
  private serializar<T>(fn: () => Promise<T>): Promise<T> {
    const siguiente = this.cola.then(fn, fn);
    // La cola no debe romperse si una operación falla.
    this.cola = siguiente.catch(() => undefined);
    return siguiente;
  }

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
    return this.serializar(async () => {
      const data = await this.load();
      const now = Date.now();
      const out = new Map<string, T>();
      for (const key of keys) {
        const e = data[key];
        if (e && e.expiresAt > now) out.set(key, e.value as T);
      }
      return out;
    });
  }

  /**
   * Guardar en la cache NUNCA debe hacer fallar la llamada al proveedor.
   *
   * Antes, un error de escritura (disco lleno, permisos, una carrera de `rename`) rechazaba el
   * método decorado y **tiraba a la basura datos frescos que ya se habían PAGADO**. La cache es una
   * optimización: si falla, se avisa y se sigue.
   */
  async setMany<T>(items: Array<[string, T]>, ttlMs: number): Promise<void> {
    if (items.length === 0) return;
    try {
      await this.serializar(async () => {
        const data = await this.load();
        const expiresAt = Date.now() + ttlMs;
        for (const [key, value] of items) data[key] = { value, expiresAt };
        await this.flushInterno(data);
      });
    } catch (e) {
      console.warn(
        `  [cache] no se pudo persistir (${(e as Error).message}). El dato se devuelve igual; ` +
          `solo se perderá el ahorro en la próxima corrida.`,
      );
    }
  }

  /**
   * Escritura atómica. El temporal es ÚNICO por escritura: compartir un `.tmp` fijo era
   * exactamente la carrera del comentario de arriba.
   *
   * Entre PROCESOS distintos sigue habiendo una carrera (el último en escribir gana y puede perder
   * las entradas del otro). No se resuelve acá a propósito: `FileCache` es la cache de DESARROLLO,
   * monoproceso. Para ejecución concurrente va `PgKeywordCache` (db/), donde el upsert es atómico.
   */
  private async flushInterno(data: Record<string, CacheEntry<unknown>>): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(data), "utf8");
      await rename(tmp, this.path);
    } catch (e) {
      await rm(tmp, { force: true }); // no dejar basura si el rename falló
      throw e;
    }
  }
}

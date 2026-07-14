import { canonicalKey } from "../lib/text.js";
import { TTL, cacheKeys } from "./cache.js";
import type { KeywordCache } from "./cache.js";
import type { KeywordDataProvider, SearchVolumeRow } from "./provider.js";
import type { Market } from "../types.js";

export interface CacheStats {
  hits: number;
  misses: number;
  /** Llamadas a la API que la cache evitó (aproximado: keywords no pedidas). */
  ahorradas: number;
}

/**
 * Decorador que cachea las respuestas de un `KeywordDataProvider` (ADR-10).
 *
 * El punto fino está en los endpoints EN LOTE (`searchVolume`, `bulkKeywordDifficulty`): no se
 * cachea la llamada, se cachea **cada keyword por separado**. Si se cacheara el lote entero, una
 * sola keyword nueva invalidaría las otras 51 y se pagarían todas de nuevo — que es justo el caso
 * habitual, porque cada research comparte casi todas sus keywords con el anterior del mismo rubro.
 *
 * Se parte el lote: lo cacheado se sirve de la cache, y al proveedor se le piden SOLO las que
 * faltan. Si no falta ninguna, no se hace ni una llamada y el costo es cero.
 */
export class CachedProvider implements KeywordDataProvider {
  readonly stats: CacheStats = { hits: 0, misses: 0, ahorradas: 0 };

  constructor(
    private readonly inner: KeywordDataProvider,
    private readonly cache: KeywordCache,
    /** Proveedor + entorno (p. ej. `dfs:prod`). Va en TODAS las claves. Ver index.ts. */
    private readonly ns: string,
  ) {}

  get costMicros(): number {
    return this.inner.costMicros;
  }

  async keywordSuggestions(keyword: string, market: Market, limit = 30): Promise<string[]> {
    const key = cacheKeys.suggestions(this.ns, keyword, market, limit);
    const hit = await this.cache.getMany<string[]>([key]);

    const cached = hit.get(key);
    if (cached) {
      this.stats.hits++;
      this.stats.ahorradas++;
      return cached;
    }

    this.stats.misses++;
    const fresh = await this.inner.keywordSuggestions(keyword, market, limit);
    await this.cache.setMany([[key, fresh]], TTL.suggestions);
    return fresh;
  }

  async searchVolume(keywords: string[], market: Market): Promise<SearchVolumeRow[]> {
    const keys = keywords.map((kw) => cacheKeys.searchVolume(this.ns, kw, market));
    // `null` cacheado = "el proveedor no tiene dato para esta keyword". Se cachea A PROPÓSITO:
    // sin eso, cada corrida vuelve a pagar por preguntar lo mismo y recibir nada.
    const cached = await this.cache.getMany<SearchVolumeRow | null>(keys);

    const faltantes: string[] = [];
    const resultados: SearchVolumeRow[] = [];

    keywords.forEach((kw, i) => {
      const key = keys[i]!;
      if (cached.has(key)) {
        this.stats.hits++;
        this.stats.ahorradas++;
        const v = cached.get(key)!;
        if (v !== null) resultados.push(v);
      } else {
        this.stats.misses++;
        faltantes.push(kw);
      }
    });

    if (faltantes.length === 0) return resultados; // ni una llamada: costo cero

    // Si esto lanza (p. ej. una task de DataForSEO falló), la excepción se propaga y NO se cachea
    // nada: no sabemos qué keywords faltan, y tomarlas por ausentes fosilizaría un fallo transitorio.
    const frescas = await this.inner.searchVolume(loteCanonico(faltantes), market);
    const porClave = new Map(frescas.map((r) => [canonicalKey(r.keyword), r]));

    const aCachear: Array<[string, SearchVolumeRow | null]> = [];
    for (const kw of faltantes) {
      const row = porClave.get(canonicalKey(kw)) ?? null;
      aCachear.push([cacheKeys.searchVolume(this.ns, kw, market), row]);
      if (row) resultados.push(row);
    }

    // Se clasifica por si HAY VOLUMEN, no por si hay fila.
    //
    // Un `SearchVolumeRow` con `search_volume: null` es un OBJETO no nulo, así que con el filtro
    // anterior (`v !== null`) caía en el TTL largo: 30 días declarando "sin datos" una keyword que
    // podría ganar volumen el mes que viene. Justo lo contrario de lo que el diseño dice hacer.
    const sinVolumen = (v: SearchVolumeRow | null) => v === null || v.search_volume == null;

    await this.cache.setMany(
      aCachear.filter(([, v]) => !sinVolumen(v)),
      TTL.metrics,
    );
    await this.cache.setMany(
      aCachear.filter(([, v]) => sinVolumen(v)),
      TTL.negative,
    );

    return resultados;
  }

  async bulkKeywordDifficulty(keywords: string[], market: Market): Promise<Map<string, number | null>> {
    const keys = keywords.map((kw) => cacheKeys.keywordDifficulty(this.ns, kw, market));
    const cached = await this.cache.getMany<number | null>(keys);

    const faltantes: string[] = [];
    const out = new Map<string, number | null>();

    keywords.forEach((kw, i) => {
      const key = keys[i]!;
      if (cached.has(key)) {
        this.stats.hits++;
        this.stats.ahorradas++;
        out.set(kw, cached.get(key)!);
      } else {
        this.stats.misses++;
        faltantes.push(kw);
      }
    });

    if (faltantes.length === 0) return out;

    const frescas = await this.inner.bulkKeywordDifficulty(loteCanonico(faltantes), market);
    const porClave = new Map([...frescas].map(([k, v]) => [canonicalKey(k), v]));

    const aCachear: Array<[string, number | null]> = [];
    for (const kw of faltantes) {
      const kd = porClave.get(canonicalKey(kw)) ?? null;
      out.set(kw, kd);
      aCachear.push([cacheKeys.keywordDifficulty(this.ns, kw, market), kd]);
    }

    await this.cache.setMany(
      aCachear.filter(([, v]) => v !== null),
      TTL.metrics,
    );
    await this.cache.setMany(
      aCachear.filter(([, v]) => v === null),
      TTL.negative,
    );

    return out;
  }

  async serp(keyword: string, market: Market, depth = 10): Promise<string[]> {
    const key = cacheKeys.serp(this.ns, keyword, market, depth);
    const hit = await this.cache.getMany<string[]>([key]);

    const cached = hit.get(key);
    if (cached) {
      this.stats.hits++;
      this.stats.ahorradas++;
      return cached;
    }

    this.stats.misses++;
    const fresh = await this.inner.serp(keyword, market, depth);
    // TTL corto: el SERP se usa para fusionar clusters, y un SERP viejo agrupa páginas mal.
    await this.cache.setMany([[key, fresh]], TTL.serp);
    return fresh;
  }
}

/**
 * El lote que se ENVÍA, en forma canónica: deduplicado y ordenado.
 *
 * Para DataForSEO, `["pizza","pasta"]` y `["pasta","pizza"]` son **la misma consulta y el mismo
 * cobro** — el array es un conjunto de keywords, no una secuencia. Pero el `payload_hash` se calcula
 * sobre el cuerpo, así que dos procesos que pedían lo mismo en distinto orden producían **hashes
 * distintos**: ninguno veía la reserva del otro y **se pagaba dos veces**.
 *
 * Canonizar acá —en el punto donde se forma el lote facturable— arregla el cuerpo Y el hash de una
 * sola vez. El mapeo de vuelta va por `canonicalKey`, así que reordenar no rompe nada.
 *
 * OJO con lo que esto NO arregla: dos procesos con lotes que SE SOLAPAN (`[a,b]` y `[b,c]`) siguen
 * pagando `b` dos veces, porque cada uno reserva su lote entero. Cerrarlo exige reservar por keyword
 * y no por lote. Está anotado en ADR-14: hoy la ventana es estrecha (los dos tendrían que perder la
 * cache a la vez), pero existe.
 */
function loteCanonico(keywords: string[]): string[] {
  return [...new Set(keywords.map((k) => k.trim()))].sort();
}

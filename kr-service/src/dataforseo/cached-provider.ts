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
  ) {}

  get costMicros(): number {
    return this.inner.costMicros;
  }

  async keywordSuggestions(keyword: string, market: Market, limit = 30): Promise<string[]> {
    const key = cacheKeys.suggestions(keyword, market, limit);
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
    const keys = keywords.map((kw) => cacheKeys.searchVolume(kw, market));
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

    const frescas = await this.inner.searchVolume(faltantes, market);
    const porClave = new Map(frescas.map((r) => [canonicalKey(r.keyword), r]));

    const aCachear: Array<[string, SearchVolumeRow | null]> = [];
    for (const kw of faltantes) {
      const row = porClave.get(canonicalKey(kw)) ?? null;
      aCachear.push([cacheKeys.searchVolume(kw, market), row]);
      if (row) resultados.push(row);
    }

    // Las presencias duran más que las ausencias: una keyword sin datos hoy puede tenerlos pronto.
    await this.cache.setMany(
      aCachear.filter(([, v]) => v !== null),
      TTL.metrics,
    );
    await this.cache.setMany(
      aCachear.filter(([, v]) => v === null),
      TTL.negative,
    );

    return resultados;
  }

  async bulkKeywordDifficulty(keywords: string[], market: Market): Promise<Map<string, number | null>> {
    const keys = keywords.map((kw) => cacheKeys.keywordDifficulty(kw, market));
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

    const frescas = await this.inner.bulkKeywordDifficulty(faltantes, market);
    const porClave = new Map([...frescas].map(([k, v]) => [canonicalKey(k), v]));

    const aCachear: Array<[string, number | null]> = [];
    for (const kw of faltantes) {
      const kd = porClave.get(canonicalKey(kw)) ?? null;
      out.set(kw, kd);
      aCachear.push([cacheKeys.keywordDifficulty(kw, market), kd]);
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
    const key = cacheKeys.serp(keyword, market, depth);
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

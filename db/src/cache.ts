/**
 * Cache de proveedor sobre Postgres (`kr_metrics_cache` / `kr_serp_cache`).
 *
 * Es la implementación de producción de la misma interfaz `KeywordCache` que usa `kr-service`
 * (allí, en desarrollo, se resuelve con un archivo JSON). El salto de valor es que acá la cache se
 * comparte entre **todos los clientes y todos los tenants** de la plataforma: el volumen de
 * "pizza napolitana madrid" se paga UNA vez y sirve para siempre, para cualquier restaurante
 * italiano de Madrid que la agencia sume después.
 *
 * Estas tablas NO llevan `tenant_id` a propósito (es un dato del mercado, no de un cliente) y por
 * eso van RLS deny-all: solo se tocan con la service-role. Ver `migrations/0001_init.sql`.
 */

/** Ejecuta SQL parametrizado. Lo cumple PGlite (tests) y cualquier cliente de Postgres (prod). */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface KeywordCache {
  getMany<T>(keys: string[]): Promise<Map<string, T>>;
  setMany<T>(items: Array<[key: string, value: T]>, ttlMs: number): Promise<void>;
}

type Tabla = "kr_metrics_cache" | "kr_serp_cache";

/**
 * Los campos que componen la clave viajan aparte del `cache_key` porque ADR-10 los quiere como
 * columnas: sirven para purgar por mercado, auditar la cobertura o invalidar un endpoint entero
 * sin tener que parsear strings.
 */
export interface CacheMeta {
  endpoint: string;
  canonical_key: string;
  location_code: number;
  language_code: string;
  engine?: string;
  device?: string;
  serp_type?: string;
  depth?: number;
}

export class PgKeywordCache implements KeywordCache {
  constructor(
    private readonly sql: SqlExecutor,
    private readonly tabla: Tabla,
    /** Cómo derivar las columnas de la clave. El decorador ya sabe qué pidió; acá solo se guarda. */
    private readonly meta: (key: string) => CacheMeta,
  ) {}

  /**
   * Solo devuelve entradas VIVAS: el filtro `expires_at > now()` va en SQL, no en JS. Una entrada
   * vencida no se borra acá (eso lo hace una purga periódica); simplemente no se ve, y el
   * decorador la vuelve a pedir.
   */
  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    if (keys.length === 0) return new Map();

    const { rows } = await this.sql.query<{ cache_key: string; payload: { v: T } }>(
      `select cache_key, payload from ${this.tabla}
       where cache_key = any($1) and expires_at > now()`,
      [keys],
    );

    // El payload se envuelve en {v}: un valor cacheado puede ser `null` (= "el proveedor no tiene
    // dato"), y en jsonb un null crudo no se distingue de la ausencia de fila.
    return new Map(rows.map((r) => [r.cache_key, r.payload.v]));
  }

  async setMany<T>(items: Array<[string, T]>, ttlMs: number): Promise<void> {
    if (items.length === 0) return;
    const ttlSegundos = Math.round(ttlMs / 1000);

    for (const [key, value] of items) {
      const m = this.meta(key);
      const payload = JSON.stringify({ v: value });

      if (this.tabla === "kr_metrics_cache") {
        await this.sql.query(
          `insert into kr_metrics_cache
             (cache_key, endpoint, canonical_key, location_code, language_code, payload, fetched_at, expires_at)
           values ($1, $2, $3, $4, $5, $6::jsonb, now(), now() + ($7 || ' seconds')::interval)
           on conflict (cache_key) do update set
             payload = excluded.payload,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
          [key, m.endpoint, m.canonical_key, m.location_code, m.language_code, payload, String(ttlSegundos)],
        );
      } else {
        await this.sql.query(
          `insert into kr_serp_cache
             (cache_key, canonical_key, engine, device, serp_type, depth,
              location_code, language_code, payload, fetched_at, expires_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now(), now() + ($10 || ' seconds')::interval)
           on conflict (cache_key) do update set
             payload = excluded.payload,
             fetched_at = excluded.fetched_at,
             expires_at = excluded.expires_at`,
          [
            key,
            m.canonical_key,
            m.engine ?? "google",
            m.device ?? "desktop",
            m.serp_type ?? "organic",
            m.depth ?? 10,
            m.location_code,
            m.language_code,
            payload,
            String(ttlSegundos),
          ],
        );
      }
    }
  }

  /** Borra las entradas vencidas. Va en un cron; sin esto la tabla crece para siempre. */
  async purgar(): Promise<number> {
    const { rows } = await this.sql.query<{ n: string }>(
      `with borradas as (delete from ${this.tabla} where expires_at <= now() returning 1)
       select count(*)::text as n from borradas`,
    );
    return Number(rows[0]?.n ?? 0);
  }
}

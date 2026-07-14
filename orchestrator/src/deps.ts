import { NodePgPool, PglitePool, PgStore, PgTaskLog, PgKeywordCache, aplicarMigraciones, ejecutorDe } from "db";
import type { CacheMeta, DbPool, KeywordCache } from "db";
import { canonicalKey, config as krConfig, runResearch } from "kr-service";
import {
  applyProse,
  briefToStories,
  getPublisher,
  parseBrief,
  parseProfile,
  renderStory,
} from "web-builder";
import type { BusinessProfile } from "web-builder";
import type { Deps, KeywordParaGuardar } from "./workflow.js";

/**
 * El COMPOSITION ROOT: el único punto del sistema que conoce a los tres módulos a la vez.
 *
 * `kr-service` sigue sin saber que existe una base de datos, y `web-builder` sigue sin importar
 * nada de `kr-service` (ADR-06/07: la frontera entre M2 y M1 es el brief JSON validado con Zod, no
 * un `import`). Quien los une es este archivo, y lo hace pasando por el contrato: el brief que se
 * publica se reconstruye DESDE LA BASE y se valida con `parseBrief` antes de tocar Storyblok.
 */

/**
 * Las conexiones. **Una por credencial, y eso es la mitad del modelo de seguridad.**
 *
 * Antes había UN `DATABASE_URL` y el código elegía con qué rol vestirse (`set local role`). Postgres
 * autoriza `SET ROLE` según el `session_user`, sin contraseña: el mismo login podía ponerse
 * `app_user` **o** `app_service`. Era una frontera de código disfrazada de frontera de credenciales.
 *
 * Ahora:
 *  · `DATABASE_URL_ORQUESTADOR` → login `amg_orquestador`, autorizado SOLO a `app_service`.
 *  · `DATABASE_URL_CACHE`       → login `amg_cache`, que SOLO ve las caches y el registro de tareas
 *                                 (no tiene acceso a NINGUNA tabla de tenant).
 *
 * La API usa el suyo (`amg_api` → `app_user`), y **no puede** asumir `app_service`: Postgres lo
 * rechaza. Ver `db/migrations/0003_credenciales.sql` y `docs/proyecto/12-credenciales.md`.
 */
export interface Conexiones {
  /** Rol `app_service`. Escribe los resultados del research bajo RLS. */
  orquestador: DbPool;
  /** Rol `amg_cache`. Solo caches y registro de tareas. Sin acceso a datos de tenant. */
  cache: DbPool;
  cerrar: () => Promise<void>;
}

export async function crearConexiones(): Promise<Conexiones> {
  const urlOrq = process.env["DATABASE_URL_ORQUESTADOR"] ?? process.env["DATABASE_URL"];
  const urlCache = process.env["DATABASE_URL_CACHE"];

  /*
   * Con Postgres real, `DATABASE_URL_CACHE` es OBLIGATORIA. No tiene fallback, y el fallback que
   * tenía era imposible de cumplir:
   *
   *   `urlCache = DATABASE_URL_CACHE ?? urlOrq`
   *
   * O sea que sin esa variable la cache se abría con `amg_orquestador` — un login que, POR DISEÑO,
   * no tiene permiso sobre las caches ni sobre el registro de tareas (0003_credenciales.sql). El
   * primer acceso explotaba. Falla cerrado, sí, pero explotaba **en producción, en el primer
   * research**, con una configuración que parecía válida.
   *
   * Mejor abortar al arrancar y decir exactamente qué falta.
   */
  if (urlOrq && !urlCache) {
    throw new Error(
      "Falta DATABASE_URL_CACHE. Con Postgres real es obligatoria y NO hereda de " +
        "DATABASE_URL_ORQUESTADOR: el login del orquestador no puede tocar las caches ni el " +
        "registro de tareas (un proceso, un login, un rol — ADR-17). " +
        "Ver docs/proyecto/12-credenciales.md.",
    );
  }

  if (!urlOrq) {
    // Sin credenciales: PGlite en memoria. El sistema entero sigue corriendo sin una sola clave.
    // Acá los dos "pools" son el mismo (es una base en proceso): la separación real es de
    // credenciales, y en un test no hay credenciales que separar.
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    await aplicarMigraciones(pg);
    console.warn("  [db] sin DATABASE_URL → PGlite EN MEMORIA (los datos se pierden al salir).");
    const pool = new PglitePool(pg);
    return { orquestador: pool, cache: pool, cerrar: () => pg.close() };
  }

  const { Pool } = await import("pg");
  const pOrq = new Pool({ connectionString: urlOrq });
  const pCache = new Pool({ connectionString: urlCache });
  return {
    orquestador: new NodePgPool(pOrq),
    cache: new NodePgPool(pCache),
    cerrar: async () => {
      await pOrq.end();
      await pCache.end();
    },
  };
}

export function crearDeps(cx: Conexiones): Deps {
  // El orquestador asume `app_service`. Su login NO puede asumir `app_user` — ni al revés.
  const store = new PgStore(cx.orquestador, "app_service");

  /*
   * El registro de peticiones facturables y la cache van por la conexión `amg_cache`, que NO tiene
   * acceso a ninguna tabla de tenant. Antes esto lo hacía "la service-role", que en la práctica era
   * el superusuario de las migraciones: matar una mosca a cañonazos.
   *
   * El namespace lleva el ENTORNO: sandbox y producción no comparten ni una fila. Es la misma
   * lección que envenenó la cache — el sandbox devuelve ficción, y una reserva suya no puede hacer
   * que producción se crea ya pagada.
   */
  const ns = `dfs:${krConfig.dataforseo.isSandbox ? "sandbox" : "prod"}`;
  const taskLog = new PgTaskLog(cx.cache, ns);
  const cache = new CacheRouter(cx.cache);

  return {
    store,

    research: async ({ prompt, market, maxCostMicros, maxPages, onKeywords }) => {
      const brief = await runResearch(
        {
          prompt,
          market: { ...market, country: market.country },
          options: {
            ...(maxCostMicros != null ? { max_cost_micros: maxCostMicros } : {}),
            ...(maxPages != null ? { max_pages: maxPages } : {}),
          },
        },
        // Checkpoint del dataset: se dispara en cuanto las keywords pagas existen. Persistirlas acá
        // —y no al final— es lo que hace que un fallo posterior no tire a la basura lo que ya se le
        // pagó a DataForSEO.
        async (dataset) => {
          await onKeywords(dataset.keywords.map(aKeywordDeLaBase));
        },
        // La cache de POSTGRES, no un archivo local: se comparte entre instancias y entre clientes,
        // que es donde está el ahorro real. Y el registro de idempotencia del gasto (ADR-14).
        { taskLog, cache },
      );

      return {
        schema_version: brief.schema_version,
        paginas_propuestas: brief.paginas_propuestas.map((p) => ({
          cluster_id: p.cluster_id,
          tipo: p.tipo,
          page_strategy: p.page_strategy,
          url_slug: p.url_slug,
          keyword_principal: p.keyword_principal,
          keywords_secundarias: p.keywords_secundarias,
          intencion: p.intencion,
          local: p.local,
          volumen: p.volumen,
          dificultad: p.dificultad,
          evidencia: p.evidencia,
          opportunity_score: p.opportunity_score,
          score_confidence: p.score_confidence,
          seo: { ...p.seo },
          content_brief: { ...p.content_brief },
          preguntas_frecuentes: p.preguntas_frecuentes,
        })),
        meta_run: {
          coste_micros_usd: brief.meta_run.coste_micros_usd,
          coste_breakdown: { ...brief.meta_run.coste_breakdown },
          calidad_datos: { ...brief.meta_run.calidad_datos },
          modelos_sin_precio: brief.meta_run.modelos_sin_precio ?? [],
        },
      };
    },

    validarContrato: (raw) => parseBrief(raw),

    /*
     * Publicar es lo ÚNICO que escribe fuera de nuestra base, y por eso es donde el aislamiento
     * multi-tenant se puede perder sin que RLS se entere.
     *
     * El destino (space + perfil) llega del CLIENTE, leído bajo RLS por el workflow. Ya no hay un
     * `STORYBLOK_SPACE_ID` global ni un `BUSINESS_PROFILE_PATH` global: con ellos, la `/menu` de un
     * cliente pisaba la del otro y el JSON-LD de todos llevaba los datos del mismo restaurante.
     *
     * El publisher se construye POR PUBLICACIÓN, no una vez al arrancar. Un publisher de proceso es
     * exactamente lo que hacía imposible tener dos destinos.
     */
    publicar: async (briefValidado, destino) => {
      const brief = briefValidado as Parameters<typeof briefToStories>[0];
      const stories = briefToStories(brief);

      // El perfil del CLIENTE. Si no tiene, se sigue sin él (el JSON-LD sale más pobre, pero no
      // lleva los datos de otro negocio, que es lo que pasaba antes).
      const perfil = perfilDelCliente(destino.perfil);

      await applyProse(stories, brief, perfil);
      const html = new Map(
        stories.map((s) => [s.slug, renderStory(s, perfil, brief.market.language_code)]),
      );

      return getPublisher(destino.storyblokSpaceId).publish(stories, html);
    },

    log: (msg) => console.log(msg),
  };
}

/**
 * El perfil del negocio, validado.
 *
 * Viene de `clients.business_profile` (jsonb), o sea `unknown`. Se valida con el MISMO Zod que usa
 * el M1 para el perfil de archivo: un perfil corrupto tiene que **fallar ruidosamente**, no
 * disfrazarse de "este cliente no tiene perfil" y publicar un JSON-LD mutilado.
 */
function perfilDelCliente(raw: Record<string, unknown> | null): BusinessProfile | null {
  if (raw == null) return null;
  return parseProfile(raw) as BusinessProfile;
}

// ---------------------------------------------------------------- la cache

/**
 * Reparte las claves entre las DOS tablas de cache (ADR-10 pide el split).
 *
 * `kr-service` produce las claves y no sabe nada de tablas; acá se traducen. El formato es
 * `ns|tipo|…` (ver `cacheKeys` en kr-service): el `tipo` decide la tabla y las columnas.
 *
 * Las columnas de la clave (mercado, endpoint, profundidad) NO son decorativas: ADR-10 las quiere
 * como columnas para poder purgar por mercado, auditar la cobertura o invalidar un endpoint entero
 * sin parsear strings.
 */
class CacheRouter implements KeywordCache {
  private readonly metricas: PgKeywordCache;
  private readonly serp: PgKeywordCache;

  constructor(pool: DbPool) {
    const sql = ejecutorDe(pool);
    this.metricas = new PgKeywordCache(sql, "kr_metrics_cache", metaDeClave);
    this.serp = new PgKeywordCache(sql, "kr_serp_cache", metaDeClave);
  }

  private esSerp = (k: string) => k.split("|")[1] === "serp";

  async getMany<T>(keys: string[]): Promise<Map<string, T>> {
    const [serp, metricas] = particionar(keys, this.esSerp);
    const [a, b] = await Promise.all([
      this.metricas.getMany<T>(metricas),
      this.serp.getMany<T>(serp),
    ]);
    return new Map([...a, ...b]);
  }

  async setMany<T>(items: Array<[string, T]>, ttlMs: number): Promise<void> {
    const [serp, metricas] = particionar(items, ([k]) => this.esSerp(k));
    await Promise.all([this.metricas.setMany(metricas, ttlMs), this.serp.setMany(serp, ttlMs)]);
  }
}

function particionar<T>(xs: T[], pred: (x: T) => boolean): [T[], T[]] {
  const si: T[] = [];
  const no: T[] = [];
  for (const x of xs) (pred(x) ? si : no).push(x);
  return [si, no];
}

/**
 * Deriva las columnas de la clave a partir de la clave misma.
 *
 * Formatos (ver `cacheKeys` en kr-service/src/dataforseo/cache.ts):
 *   `ns|sv|loc|lang|kw`
 *   `ns|kd|loc|lang|kw`
 *   `ns|sugg|loc|lang|limit|seed`
 *   `ns|serp|google|desktop|organic|depth|loc|lang|kw`
 */
function metaDeClave(key: string): CacheMeta {
  const p = key.split("|");
  const tipo = p[1];

  if (tipo === "serp") {
    return {
      endpoint: "serp",
      canonical_key: p.slice(8).join("|"),
      engine: p[2] ?? "google",
      device: p[3] ?? "desktop",
      serp_type: p[4] ?? "organic",
      depth: Number(p[5] ?? 10),
      location_code: Number(p[6]),
      language_code: p[7] ?? "es",
    };
  }

  if (tipo === "sugg") {
    return {
      endpoint: "keyword_suggestions",
      canonical_key: p.slice(5).join("|"),
      location_code: Number(p[2]),
      language_code: p[3] ?? "es",
    };
  }

  // sv | kd
  return {
    endpoint: tipo === "kd" ? "bulk_keyword_difficulty" : "search_volume",
    canonical_key: p.slice(4).join("|"),
    location_code: Number(p[2]),
    language_code: p[3] ?? "es",
  };
}

// ---------------------------------------------------------------- mapeo

/**
 * `EnrichedKeyword` (M2) → fila de `kr_keywords`.
 *
 * La `canonical_key` se calcula con la MISMA función que usa la cache de DataForSEO: si acá se
 * canonizara distinto, la clave única `(run_id, canonical_key)` agruparía cosas que el proveedor
 * considera keywords distintas (o al revés), y el upsert idempotente pisaría datos pagos.
 */
function aKeywordDeLaBase(k: {
  keyword: string;
  source: string;
  volume: number | null;
  difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  intent: string | null;
  is_local: boolean;
  business_relevance: number | null;
  opportunity_score: number | null;
  score_confidence: number | null;
  discarded: boolean;
  discard_reason?: string | undefined;
}): KeywordParaGuardar {
  return {
    keyword: k.keyword,
    canonical_key: canonicalKey(k.keyword),
    source: k.source,
    volume: k.volume,
    difficulty: k.difficulty,
    cpc: k.cpc,
    competition: k.competition,
    intent: k.intent,
    is_local: k.is_local,
    business_relevance: k.business_relevance,
    opportunity_score: k.opportunity_score,
    score_confidence: k.score_confidence,
    discarded: k.discarded,
    discard_reason: k.discard_reason,
  };
}

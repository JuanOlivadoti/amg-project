import { NodePgPool, PglitePool, PgStore, PgTaskLog, aplicarMigraciones } from "db";
import type { DbPool } from "db";
import { canonicalKey, config as krConfig, runResearch } from "kr-service";
import {
  applyProse,
  briefToStories,
  config as webConfig,
  getPublisher,
  loadProfile,
  parseBrief,
  renderStory,
} from "web-builder";
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
 * La base de datos.
 *
 * Con `DATABASE_URL` → Postgres real por pool. Sin ella → PGlite en memoria, para que el sistema
 * siga corriendo entero sin credenciales (el mismo principio que los proveedores mock).
 */
export async function crearPool(): Promise<{ pool: DbPool; cerrar: () => Promise<void> }> {
  const url = process.env["DATABASE_URL"];

  if (!url) {
    const { PGlite } = await import("@electric-sql/pglite");
    const pg = new PGlite();
    await aplicarMigraciones(pg);
    console.warn("  [db] sin DATABASE_URL → PGlite EN MEMORIA (los datos se pierden al salir).");
    return { pool: new PglitePool(pg), cerrar: () => pg.close() };
  }

  const { Pool } = await import("pg");
  const pg = new Pool({ connectionString: url });
  return { pool: new NodePgPool(pg), cerrar: () => pg.end() };
}

export function crearDeps(pool: DbPool): Deps {
  const store = new PgStore(pool);

  /*
   * El registro de peticiones facturables.
   *
   * El namespace lleva el ENTORNO: sandbox y producción no comparten ni una fila. Es la misma
   * lección que envenenó la cache — el sandbox devuelve ficción, y una reserva suya no puede hacer
   * que producción se crea ya pagada.
   */
  const taskLog = new PgTaskLog(pool, `dfs:${krConfig.dataforseo.isSandbox ? "sandbox" : "prod"}`);

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
        // Registro de idempotencia de las peticiones facturables (ADR-10). Acá es donde más falta
        // hacía: un reintento de Inngest re-ejecuta el pipeline ENTERO, así que sin esto una
        // petición que ya se cobró se volvía a pagar.
        { taskLog },
      );

      return {
        schema_version: brief.schema_version,
        paginas_propuestas: brief.paginas_propuestas.map((p) => ({
          cluster_id: p.cluster_id,
          tipo: p.tipo,
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

    publicar: async (briefValidado) => {
      // `briefValidado` ya pasó por `parseBrief` en el workflow: acá no se vuelve a confiar en nada
      // que venga de afuera, se reusa lo validado.
      const brief = briefValidado as Parameters<typeof briefToStories>[0];
      const stories = briefToStories(brief);
      const perfil = await loadProfile(webConfig.businessProfilePath);
      await applyProse(stories, brief, perfil);
      const html = new Map(
        stories.map((s) => [s.slug, renderStory(s, perfil, brief.market.language_code)]),
      );
      return getPublisher().publish(stories, html);
    },

    log: (msg) => console.log(msg),
  };
}

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

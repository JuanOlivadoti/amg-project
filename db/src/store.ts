import type { SqlExecutor } from "./cache.js";

/**
 * Capa de acceso a datos de un research (`kr_runs` / `kr_keywords` / `kr_pages`).
 *
 * ## Dos decisiones de fondo
 *
 * **1. `kr-service` NO conoce esta capa.** El pipeline sigue siendo una librería pura que corre sin
 * credenciales y sin base de datos. Quien une pipeline y persistencia es el orquestador. Es la
 * misma disciplina que ya separa M2 de M1 mediante el brief JSON: una frontera explícita en vez de
 * un acoplamiento cómodo.
 *
 * **2. Todo se escribe BAJO RLS, como `app_user`, no con la service-role.** Podría usarse la
 * service-role (salta RLS) y "confiar" en que el código pone bien el `tenant_id` — pero entonces el
 * aislamiento entre clientes dependería de que yo no me equivoque nunca. Escribiendo bajo RLS, un
 * bug de aplicación **no puede** cruzar tenants: lo frena Postgres. La service-role queda reservada
 * para lo que RLS no cubre (las caches, que no tienen `tenant_id`).
 */

export interface TenantContext {
  tenantId: string;
  role: "maestro" | "equipo" | "cliente";
  clientId?: string | null;
  userId?: string | null;
}

/** Ejecuta SQL y además permite abrir transacciones (necesario para `set local`). */
export interface Db extends SqlExecutor {
  exec(sql: string): Promise<unknown>;
}

export type RunStatus = "running" | "pending_approval" | "approved" | "rejected" | "failed";

export interface NewRun {
  clientId: string;
  schemaVersion: string;
  prompt: string;
  market: { country: string; language_code: string };
  config?: Record<string, unknown>;
  projectRunId?: string;
}

export interface KeywordRow {
  keyword: string;
  canonical_key: string;
  source: string;
  volume: number | null;
  difficulty: number | null;
  cpc?: number | null;
  competition?: number | null;
  intent: string | null;
  is_local: boolean;
  business_relevance: number | null;
  opportunity_score: number | null;
  score_confidence: number | null;
  discarded: boolean;
  discard_reason?: string | undefined;
}

export interface PageRow {
  cluster_id: string;
  tipo: string;
  url_slug: string;
  keyword_principal: string;
  keywords_secundarias: string[];
  intencion: string;
  local: boolean;
  volumen: number | null;
  dificultad: number | null;
  evidencia: string;
  opportunity_score: number;
  score_confidence: number;
  seo: Record<string, unknown>;
  content_brief: Record<string, unknown>;
  preguntas_frecuentes: string[];
}

export interface RunSummary {
  id: string;
  client_id: string;
  status: RunStatus;
  prompt: string;
  coste_micros_usd: number;
  calidad_datos: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

export class PgStore {
  constructor(private readonly db: Db) {}

  /**
   * Corre `fn` dentro de una transacción con el contexto del usuario aplicado y el rol `app_user`
   * activo — es decir, CON las políticas RLS en vigor.
   *
   * `set local` ata el contexto a la transacción: no se filtra a la petición siguiente, que en un
   * pool de conexiones compartido sería una fuga de datos entre usuarios (el bug clásico de
   * multi-tenancy: la conexión reciclada conserva el tenant del anterior).
   */
  private async withTenant<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
    await this.db.exec("begin");
    try {
      await this.db.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await this.db.query("select set_config('app.role', $1, true)", [ctx.role]);
      await this.db.query("select set_config('app.client_id', $1, true)", [ctx.clientId ?? ""]);
      await this.db.exec("set local role app_user");

      const out = await fn();
      await this.db.exec("commit");
      return out;
    } catch (e) {
      await this.db.exec("rollback");
      throw e;
    }
  }

  /** Abre el run. Nace en `running`: si el proceso muere, queda visible que quedó a medias. */
  async createRun(ctx: TenantContext, run: NewRun): Promise<string> {
    return this.withTenant(ctx, async () => {
      const { rows } = await this.db.query<{ id: string }>(
        `insert into kr_runs
           (tenant_id, client_id, project_run_id, schema_version, status, prompt,
            market_country, market_language, config)
         values ($1, $2, coalesce($3::uuid, gen_random_uuid()), $4, 'running', $5, $6, $7, $8::jsonb)
         returning id`,
        [
          ctx.tenantId,
          run.clientId,
          run.projectRunId ?? null,
          run.schemaVersion,
          run.prompt,
          run.market.country,
          run.market.language_code,
          JSON.stringify(run.config ?? {}),
        ],
      );
      return rows[0]!.id;
    });
  }

  /**
   * Checkpoint de las keywords enriquecidas: son los datos que se le PAGARON a DataForSEO.
   *
   * Se guardan TODAS, no solo las que llegaron a página. Tirarlas obliga a pagar otra corrida para
   * cualquier ajuste de scoring o clustering — la lección que ya costó plata en `out/keywords.json`.
   *
   * Idempotente (`on conflict`): un reintento del orquestador no duplica ni falla.
   */
  async saveKeywords(ctx: TenantContext, runId: string, keywords: KeywordRow[]): Promise<void> {
    if (keywords.length === 0) return;
    await this.withTenant(ctx, async () => {
      for (const k of keywords) {
        await this.db.query(
          `insert into kr_keywords
             (tenant_id, run_id, keyword, canonical_key, source, volume, difficulty, cpc, competition,
              intent, is_local, business_relevance, opportunity_score, score_confidence,
              discarded, discard_reason)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
           on conflict (run_id, canonical_key) do update set
             volume = excluded.volume,
             difficulty = excluded.difficulty,
             intent = excluded.intent,
             is_local = excluded.is_local,
             business_relevance = excluded.business_relevance,
             opportunity_score = excluded.opportunity_score,
             score_confidence = excluded.score_confidence,
             discarded = excluded.discarded,
             discard_reason = excluded.discard_reason`,
          [
            ctx.tenantId,
            runId,
            k.keyword,
            k.canonical_key,
            k.source,
            k.volume,
            k.difficulty,
            k.cpc ?? null,
            k.competition ?? null,
            k.intent,
            k.is_local,
            k.business_relevance,
            k.opportunity_score,
            k.score_confidence,
            k.discarded,
            k.discard_reason ?? null,
          ],
        );
      }
    });
  }

  /** Páginas propuestas. Nacen SIEMPRE con `approved = false` (ADR-06): la compuerta es humana. */
  async savePages(ctx: TenantContext, runId: string, pages: PageRow[]): Promise<void> {
    if (pages.length === 0) return;
    await this.withTenant(ctx, async () => {
      for (const p of pages) {
        await this.db.query(
          `insert into kr_pages
             (tenant_id, run_id, cluster_id, tipo, url_slug, keyword_principal, keywords_secundarias,
              intencion, local, volumen, dificultad, evidencia, opportunity_score, score_confidence,
              seo, content_brief, preguntas_frecuentes, approved)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,false)
           on conflict (run_id, url_slug) do update set
             keyword_principal = excluded.keyword_principal,
             seo = excluded.seo,
             content_brief = excluded.content_brief,
             evidencia = excluded.evidencia`,
          [
            ctx.tenantId,
            runId,
            p.cluster_id,
            p.tipo,
            p.url_slug,
            p.keyword_principal,
            p.keywords_secundarias,
            p.intencion,
            p.local,
            p.volumen,
            p.dificultad,
            p.evidencia,
            p.opportunity_score,
            p.score_confidence,
            JSON.stringify(p.seo),
            JSON.stringify(p.content_brief),
            p.preguntas_frecuentes,
          ],
        );
      }
    });
  }

  /** Cierra el run: pasa a `pending_approval` y queda esperando a un humano (ADR-06). */
  async finishRun(
    ctx: TenantContext,
    runId: string,
    meta: {
      costeMicros: number;
      costeBreakdown: Record<string, unknown>;
      calidadDatos: Record<string, unknown>;
      modelosSinPrecio: string[];
    },
  ): Promise<void> {
    await this.withTenant(ctx, async () => {
      await this.db.query(
        `update kr_runs set
           status = 'pending_approval',
           coste_micros_usd = $2,
           coste_breakdown = $3::jsonb,
           calidad_datos = $4::jsonb,
           modelos_sin_precio = $5,
           finished_at = now()
         where id = $1`,
        [
          runId,
          meta.costeMicros,
          JSON.stringify(meta.costeBreakdown),
          JSON.stringify(meta.calidadDatos),
          meta.modelosSinPrecio,
        ],
      );
    });
  }

  /** El run murió. Se registra el error en vez de dejarlo colgado en `running` para siempre. */
  async failRun(ctx: TenantContext, runId: string, error: string): Promise<void> {
    await this.withTenant(ctx, async () => {
      await this.db.query(
        "update kr_runs set status = 'failed', error = $2, finished_at = now() where id = $1",
        [runId, error.slice(0, 2000)],
      );
    });
  }

  // -------------------------------------------------------------- compuerta (ADR-06)

  /**
   * Aprueba UNA página. La compuerta es doble: aprobar el run no aprueba sus páginas.
   *
   * Que sea página por página no es burocracia: en la corrida real, 5 de 8 páginas no tenían datos
   * de mercado que las respaldaran. Quien aprueba tiene que poder aceptar unas y rechazar otras.
   */
  async approvePage(ctx: TenantContext, pageId: string): Promise<boolean> {
    return this.withTenant(ctx, async () => {
      const { rows } = await this.db.query<{ id: string }>(
        "update kr_pages set approved = true, approved_by = $2, approved_at = now() where id = $1 returning id",
        [pageId, ctx.userId ?? null],
      );
      return rows.length > 0;
    });
  }

  /**
   * Aprueba el run. NO aprueba sus páginas: es la mitad global de la compuerta doble.
   *
   * Se niega a aprobar un run sin ninguna página aprobada — publicar "todo" cuando el revisor no
   * aceptó nada sería justo el accidente que la compuerta existe para evitar.
   */
  async approveRun(ctx: TenantContext, runId: string): Promise<void> {
    await this.withTenant(ctx, async () => {
      const { rows } = await this.db.query<{ n: string }>(
        "select count(*)::text as n from kr_pages where run_id = $1 and approved",
        [runId],
      );
      if (Number(rows[0]?.n ?? 0) === 0) {
        throw new Error(
          `No se puede aprobar el run ${runId}: no tiene ninguna página aprobada. ` +
            `La compuerta es doble (ADR-06): primero se aprueban las páginas, después el run.`,
        );
      }
      await this.db.query("update kr_runs set status = 'approved' where id = $1", [runId]);
    });
  }

  async rejectRun(ctx: TenantContext, runId: string): Promise<void> {
    await this.withTenant(ctx, async () => {
      await this.db.query("update kr_runs set status = 'rejected' where id = $1", [runId]);
    });
  }

  // -------------------------------------------------------------- lectura

  async getRun(ctx: TenantContext, runId: string): Promise<RunSummary | null> {
    return this.withTenant(ctx, async () => {
      const { rows } = await this.db.query<RunSummary>(
        `select id, client_id, status, prompt, coste_micros_usd::int as coste_micros_usd,
                calidad_datos, created_at, finished_at
         from kr_runs where id = $1`,
        [runId],
      );
      return rows[0] ?? null;
    });
  }

  async listRuns(ctx: TenantContext, clientId: string): Promise<RunSummary[]> {
    return this.withTenant(ctx, async () => {
      const { rows } = await this.db.query<RunSummary>(
        `select id, client_id, status, prompt, coste_micros_usd::int as coste_micros_usd,
                calidad_datos, created_at, finished_at
         from kr_runs where client_id = $1 order by created_at desc`,
        [clientId],
      );
      return rows;
    });
  }

  /**
   * Las páginas listas para PUBLICAR: exige las DOS condiciones de la compuerta (ADR-06).
   *
   * Es el único camino que debería usar el Módulo 1 para publicar. Si un run está `approved` pero
   * una página quedó sin aprobar, esa página no sale de acá.
   */
  async getPublishablePages(ctx: TenantContext, runId: string): Promise<PageRow[]> {
    return this.withTenant(ctx, async () => {
      const { rows } = await this.db.query<PageRow>(
        `select p.cluster_id, p.tipo, p.url_slug, p.keyword_principal, p.keywords_secundarias,
                p.intencion, p.local, p.volumen, p.dificultad, p.evidencia,
                p.opportunity_score::float8 as opportunity_score,
                p.score_confidence::float8 as score_confidence,
                p.seo, p.content_brief, p.preguntas_frecuentes
         from kr_pages p
         join kr_runs r on r.id = p.run_id
         where p.run_id = $1 and p.approved and r.status = 'approved'
         order by p.opportunity_score desc`,
        [runId],
      );
      return rows;
    });
  }
}

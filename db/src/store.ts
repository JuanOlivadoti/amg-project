import type { DbPool, Tx } from "./pool.js";

/**
 * Capa de acceso a datos de un research (`kr_runs` / `kr_keywords` / `kr_pages`).
 *
 * ## Tres decisiones de fondo
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
 *
 * **3. Toda query va por una conexión RESERVADA (`Tx`).** El Store no tiene ningún `query()` suelto
 * al que llamar: el contexto de tenant se aplica con `set local`, que es local a la transacción, y
 * una transacción vive en una conexión. Ver `pool.ts` para por qué la versión anterior era una
 * brecha esperando un pool.
 */

/**
 * Quién hace la petición. **Nada más que eso.**
 *
 * Fijate en lo que NO hay acá: un rol. Antes el llamador declaraba `role: "maestro"` y la base le
 * creía. Con un portal HTTP del otro lado, eso es una escalada de privilegios servida en bandeja.
 *
 * Ahora el contexto solo dice **quién eres**; **qué podés hacer** lo decide Postgres, derivándolo de
 * `memberships` (ver `migrations/0002_auth.sql`). Declararse maestro no tiene ningún efecto porque
 * ya no hay dónde declararlo.
 */
export type TenantContext =
  | {
      tenantId: string;
      /** Usuario autenticado (el `sub` del JWT ya verificado). Su rol se DERIVA, no se declara. */
      userId: string;
      servicio?: false;
    }
  | {
      tenantId: string;
      /**
       * El proceso del backend (el orquestador). Se conecta como el rol de Postgres `app_service`.
       *
       * Su autoridad es una CREDENCIAL DE BASE DE DATOS, no un campo en una petición — y eso sí es
       * una autoridad: para falsificarla hace falta la contraseña de Postgres, y quien la tiene ya
       * ganó. No suplanta a ninguna persona, así que no necesita membresía.
       */
      servicio: true;
      userId?: undefined;
    };

export type RunStatus = "running" | "pending_approval" | "approved" | "rejected" | "failed";

/** El market es parte de la IDENTIDAD del run (ADR-10: 1 run = 1 market), no un adorno. */
export interface RunMarket {
  country: string;
  language_code: string;
  location_code: number;
}

export interface NewRun {
  clientId: string;
  schemaVersion: string;
  prompt: string;
  market: RunMarket;
  config?: Record<string, unknown>;
  projectRunId?: string;
  /**
   * Id del run, generado por el LLAMADOR (no por la base).
   *
   * Dos motivos, los dos del orquestador:
   *  · **Idempotencia real.** Si el mismo evento se reprocesa (reintento, replay, doble entrega), el
   *    `on conflict do nothing` hace que no nazca un segundo run. Con el id generado por la base,
   *    cada reintento creaba OTRO run y volvía a pagarle a DataForSEO.
   *  · **Poder marcarlo `failed`.** El manejador de fallos solo recibe el evento original; si el id
   *    naciera dentro del step que reventó, no habría forma de saber QUÉ run quedó colgado.
   */
  runId?: string;
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
  schema_version: string;
  market_country: string;
  market_language: string;
  market_location_code: number;
  coste_micros_usd: number;
  calidad_datos: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

/** Las columnas de `RunSummary`. Una sola definición: el select no puede quedar desalineado. */
const RUN_SUMMARY_COLS = `id, client_id, status, prompt, schema_version,
       market_country, market_language, market_location_code,
       coste_micros_usd::int as coste_micros_usd, calidad_datos, created_at, finished_at`;

export class PgStore {
  constructor(private readonly pool: DbPool) {}

  /**
   * Corre `fn` en una conexión reservada, dentro de una transacción, con el contexto del usuario
   * aplicado y el rol `app_user` activo — es decir, CON las políticas RLS en vigor.
   *
   * `set local` ata el contexto a la transacción: no sobrevive al commit, así que la conexión que
   * vuelve al pool no arrastra el tenant del usuario anterior (el bug clásico de multi-tenancy).
   * Pero eso solo vale si **la query protegida corre en esa misma conexión** — por eso `fn` recibe
   * el `tx` y no hay forma de consultar la base sin él.
   */
  private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      // Solo la IDENTIDAD. El rol y el client_id ya no se mandan: los deriva Postgres de
      // `memberships`. Mandar `app.role` no haría nada — la función ya no lo lee.
      await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await tx.exec(ctx.servicio ? "set local role app_service" : "set local role app_user");
      return fn(tx);
    });
  }

  /**
   * Abre el run. Nace en `running`: si el proceso muere, queda visible que quedó a medias.
   *
   * Idempotente cuando el llamador aporta el `runId`: reprocesar el mismo evento no crea un segundo
   * run ni vuelve a pagarle a DataForSEO.
   */
  async createRun(ctx: TenantContext, run: NewRun): Promise<string> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into kr_runs
           (id, tenant_id, client_id, project_run_id, schema_version, status, prompt,
            market_country, market_language, market_location_code, config)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, coalesce($4::uuid, gen_random_uuid()),
                 $5, 'running', $6, $7, $8, $9, $10::jsonb)
         on conflict (id) do nothing
         returning id`,
        [
          run.runId ?? null,
          ctx.tenantId,
          run.clientId,
          run.projectRunId ?? null,
          run.schemaVersion,
          run.prompt,
          run.market.country,
          run.market.language_code,
          run.market.location_code,
          JSON.stringify(run.config ?? {}),
        ],
      );
      if (rows[0]) return rows[0].id;

      // Conflicto: el id ya existía. Puede ser un reproceso legítimo del MISMO run… o un id ajeno
      // que el llamador se inventó. Bajo RLS solo vemos los nuestros: si no lo vemos, no es nuestro.
      const { rows: propio } = await tx.query<{ id: string }>(
        "select id from kr_runs where id = $1 and client_id = $2",
        [run.runId, run.clientId],
      );
      if (!propio[0]) {
        throw new Error(`El run ${run.runId} ya existe y no pertenece a este cliente.`);
      }
      return propio[0].id;
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
  async saveKeywords(
    ctx: TenantContext,
    runId: string,
    clientId: string,
    keywords: KeywordRow[],
  ): Promise<void> {
    if (keywords.length === 0) return;
    await this.withTenant(ctx, async (tx) => {
      for (const k of keywords) {
        await tx.query(
          `insert into kr_keywords
             (tenant_id, run_id, client_id, keyword, canonical_key, source, volume, difficulty, cpc, competition,
              intent, is_local, business_relevance, opportunity_score, score_confidence,
              discarded, discard_reason)
           values ($1,$2,$17,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
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
            clientId,
          ],
        );
      }
    });
  }

  /**
   * Páginas propuestas. Nacen SIEMPRE con `approved = false` (ADR-06): la compuerta es humana.
   *
   * ## El upsert NO puede conservar una aprobación sobre contenido cambiado
   *
   * Antes actualizaba `keyword_principal`, SEO, contenido y evidencia **conservando `approved`**.
   * Un reintento tardío del orquestador, o una recalibración, podía cambiar materialmente una página
   * YA APROBADA y dejarla publicable **sin que ningún humano volviera a mirarla** — exactamente lo
   * que la compuerta existe para impedir. Peor: actualizaba solo algunos campos, así que volumen,
   * KD, intención y score quedaban de la versión anterior. Una página Frankenstein.
   *
   * Ahora se actualizan TODOS los campos derivados y, si el contenido REALMENTE cambió, la
   * aprobación se revoca. Un reintento idéntico (el caso normal) no toca nada: el `where` compara
   * los valores, así que la fila ni se escribe y la aprobación sobrevive.
   */
  async savePages(ctx: TenantContext, runId: string, clientId: string, pages: PageRow[]): Promise<void> {
    if (pages.length === 0) return;
    await this.withTenant(ctx, async (tx) => {
      for (const p of pages) {
        await tx.query(
          `insert into kr_pages
             (tenant_id, run_id, client_id, cluster_id, tipo, url_slug, keyword_principal,
              keywords_secundarias, intencion, local, volumen, dificultad, evidencia,
              opportunity_score, score_confidence, seo, content_brief, preguntas_frecuentes, approved)
           values ($1,$2,$18,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,$16::jsonb,$17,false)
           on conflict (run_id, url_slug) do update set
             cluster_id = excluded.cluster_id,
             tipo = excluded.tipo,
             keyword_principal = excluded.keyword_principal,
             keywords_secundarias = excluded.keywords_secundarias,
             intencion = excluded.intencion,
             local = excluded.local,
             volumen = excluded.volumen,
             dificultad = excluded.dificultad,
             evidencia = excluded.evidencia,
             opportunity_score = excluded.opportunity_score,
             score_confidence = excluded.score_confidence,
             seo = excluded.seo,
             content_brief = excluded.content_brief,
             preguntas_frecuentes = excluded.preguntas_frecuentes,
             -- El contenido cambió → la aprobación anterior ya no vale para ESTA página.
             approved = false,
             approved_by = null,
             approved_at = null
           where
             -- Solo se escribe si algo MATERIAL cambió. Un reintento idéntico no revoca nada.
             kr_pages.keyword_principal is distinct from excluded.keyword_principal
             or kr_pages.tipo            is distinct from excluded.tipo
             or kr_pages.intencion       is distinct from excluded.intencion
             or kr_pages.volumen         is distinct from excluded.volumen
             or kr_pages.dificultad      is distinct from excluded.dificultad
             or kr_pages.evidencia       is distinct from excluded.evidencia
             or kr_pages.seo             is distinct from excluded.seo
             or kr_pages.content_brief   is distinct from excluded.content_brief
             or kr_pages.preguntas_frecuentes is distinct from excluded.preguntas_frecuentes`,
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
            clientId,
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
    await this.withTenant(ctx, async (tx) => {
      await tx.query(
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
    await this.withTenant(ctx, async (tx) => {
      await tx.query(
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
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
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
    await this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ n: string }>(
        "select count(*)::text as n from kr_pages where run_id = $1 and approved",
        [runId],
      );
      if (Number(rows[0]?.n ?? 0) === 0) {
        throw new Error(
          `No se puede aprobar el run ${runId}: no tiene ninguna página aprobada. ` +
            `La compuerta es doble (ADR-06): primero se aprueban las páginas, después el run.`,
        );
      }
      await tx.query("update kr_runs set status = 'approved' where id = $1", [runId]);
    });
  }

  async rejectRun(ctx: TenantContext, runId: string): Promise<void> {
    await this.withTenant(ctx, async (tx) => {
      await tx.query("update kr_runs set status = 'rejected' where id = $1", [runId]);
    });
  }

  // -------------------------------------------------------------- lectura

  /**
   * SQL arbitrario BAJO el contexto RLS del usuario. **Solo para tests.**
   *
   * Es el modelo de amenaza realista: alguien que llega a ejecutar SQL con el rol `app_user` y un
   * contexto de tenant válido. Si RLS lo frena acá, lo frena de verdad; probar el aislamiento solo
   * a través de los métodos del Store probaría que el Store es correcto, no que la BASE lo es.
   */
  async sqlCrudo<T = Record<string, unknown>>(
    ctx: TenantContext,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<T>(sql, params);
      return rows;
    });
  }

  /** Solo tests: lo que un atacante vería con `select * from kr_keywords`. */
  leerKeywordsCrudo(ctx: TenantContext): Promise<Array<{ id: string }>> {
    return this.sqlCrudo<{ id: string }>(ctx, "select id from kr_keywords");
  }

  /** Solo tests: lo que un atacante vería con `select * from kr_pages`. */
  leerPaginasCrudo(ctx: TenantContext): Promise<Array<{ id: string }>> {
    return this.sqlCrudo<{ id: string }>(ctx, "select id from kr_pages");
  }

  async getRun(ctx: TenantContext, runId: string): Promise<RunSummary | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<RunSummary>(
        `select ${RUN_SUMMARY_COLS} from kr_runs where id = $1`,
        [runId],
      );
      return rows[0] ?? null;
    });
  }

  async listRuns(ctx: TenantContext, clientId: string): Promise<RunSummary[]> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<RunSummary>(
        `select ${RUN_SUMMARY_COLS} from kr_runs where client_id = $1 order by created_at desc`,
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
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<PageRow>(
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

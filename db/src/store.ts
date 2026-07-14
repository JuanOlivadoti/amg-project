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
export interface TenantContext {
  tenantId: string;
  /**
   * Usuario autenticado (el `sub` del JWT ya verificado). Su rol se DERIVA de `memberships`.
   *
   * El orquestador no tiene: no es una persona, y su autoridad no viene de acá.
   */
  userId?: string | null;
}

/**
 * El rol de Postgres que la conexión asume. **No es un campo de la petición: es la credencial.**
 *
 * Antes esto vivía en el `TenantContext` (`servicio: true`) y era una mentira cómoda: había UN
 * `DATABASE_URL`, y el código elegía con qué rol vestirse. Postgres autoriza `SET ROLE` según el
 * `session_user`, sin contraseña, así que el mismo login podía ponerse `app_user` **o**
 * `app_service`. Era una frontera de código disfrazada de frontera de credenciales.
 *
 * Ahora cada proceso tiene su login (`amg_api`, `amg_orquestador`), con `NOINHERIT` y autorizado a
 * UN SOLO rol. Si la API intentara construir un Store de servicio, **Postgres rechaza el
 * `set role`**: no es que el código no lo haga, es que no puede. Ver `0003_credenciales.sql`.
 */
export type RolConexion = "app_user" | "app_service";

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
  /** `single` | `hub` | `spoke`. El M2 la calcula y la capa de datos la TIRABA. */
  page_strategy?: string | null;
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
  /** Config del run (topes de gasto y de páginas). Es de donde el orquestador los lee: del evento
   *  NO puede leerlos, porque el evento no porta autoridad. */
  config: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

/** Las columnas de `RunSummary`. Una sola definición: el select no puede quedar desalineado. */
const RUN_SUMMARY_COLS = `id, client_id, status, prompt, schema_version,
       market_country, market_language, market_location_code,
       coste_micros_usd::int as coste_micros_usd, calidad_datos, config, created_at, finished_at`;

export class PgStore {
  /**
   * @param pool  Pool ATADO a un login concreto (`amg_api` o `amg_orquestador`).
   * @param rol   El rol que la conexión asume. Tiene que ser uno que el login TENGA CONCEDIDO —
   *              si no, Postgres rechaza el `set role` y la operación falla. Esa es la garantía.
   */
  constructor(
    private readonly pool: DbPool,
    private readonly rol: RolConexion = "app_user",
  ) {}

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
      // El rol viene del STORE (= del login del proceso), no de la petición. Si el login no lo
      // tiene concedido, esto LANZA: es Postgres quien lo impide, no una comprobación mía.
      await tx.exec(`set local role ${this.rol}`);
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
    // Ojo: NO se sale temprano con `pages.length === 0`. Un research que ahora no propone NINGUNA
    // página tiene que RETIRAR las que había, no dejarlas aprobadas y publicables.
    await this.withTenant(ctx, async (tx) => {
      for (const p of pages) {
        await tx.query(
          `insert into kr_pages
             (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug, keyword_principal,
              keywords_secundarias, intencion, local, volumen, dificultad, evidencia,
              opportunity_score, score_confidence, seo, content_brief, preguntas_frecuentes,
              approved, retirada)
           values ($1,$2,$19,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,
                   false, false)
           on conflict (run_id, url_slug) do update set
             cluster_id = excluded.cluster_id,
             tipo = excluded.tipo,
             page_strategy = excluded.page_strategy,
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
             -- Vuelve a estar propuesta.
             retirada = false,
             -- El contenido cambió → la aprobación anterior ya no vale para ESTA página.
             approved = false,
             approved_by = null,
             approved_at = null
           where
             -- Solo se escribe si algo MATERIAL cambió. Un reintento idéntico no revoca nada.
             --
             -- Antes esta lista estaba INCOMPLETA: faltaban cluster_id, keywords_secundarias, local,
             -- opportunity_score y score_confidence. Un cambio SOLO en esos campos no se persistía
             -- (la fila quedaba vieja) ni revocaba la aprobación. Ahora se comparan todos.
             kr_pages.retirada
             or kr_pages.cluster_id        is distinct from excluded.cluster_id
             or kr_pages.tipo              is distinct from excluded.tipo
             or kr_pages.page_strategy     is distinct from excluded.page_strategy
             or kr_pages.keyword_principal is distinct from excluded.keyword_principal
             or kr_pages.keywords_secundarias is distinct from excluded.keywords_secundarias
             or kr_pages.intencion         is distinct from excluded.intencion
             or kr_pages.local             is distinct from excluded.local
             or kr_pages.volumen           is distinct from excluded.volumen
             or kr_pages.dificultad        is distinct from excluded.dificultad
             or kr_pages.evidencia         is distinct from excluded.evidencia
             or kr_pages.opportunity_score is distinct from excluded.opportunity_score
             or kr_pages.score_confidence  is distinct from excluded.score_confidence
             or kr_pages.seo               is distinct from excluded.seo
             or kr_pages.content_brief     is distinct from excluded.content_brief
             or kr_pages.preguntas_frecuentes is distinct from excluded.preguntas_frecuentes`,
          [
            ctx.tenantId,
            runId,
            p.cluster_id,
            p.tipo,
            p.page_strategy ?? null,
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

      /*
       * RECONCILIACIÓN — lo que faltaba, y era una brecha de la compuerta.
       *
       * El upsert solo tocaba las páginas PRESENTES. Una página que el research ya no propone —el
       * clustering la disolvió, o le cambió el slug— se quedaba en la base **con su aprobación
       * intacta**, y `getPublishablePages()` la seguía devolviendo. Se publicaba una página aprobada
       * para una versión anterior del brief, que el research actual ya no respalda.
       *
       * Va en la MISMA transacción que los upserts: no puede existir un instante en el que las
       * páginas nuevas ya estén y las viejas sigan siendo publicables.
       */
      await tx.query(
        `update kr_pages set
           retirada = true,
           approved = false,
           approved_by = null,
           approved_at = null
         where run_id = $1
           and not (url_slug = any($2::text[]))
           and not retirada`,
        [runId, pages.map((p) => p.url_slug)],
      );
    });
  }

  /**
   * Registra que una página SE PUBLICÓ de verdad. Es un hecho del mundo, no del workflow.
   *
   * Sin esto, un fallo posterior del orquestador podía marcar el run como `failed` con las páginas
   * ya visibles en Storyblok: el estado mentía sobre la realidad.
   */
  async marcarPublicadas(
    ctx: TenantContext,
    runId: string,
    publicadas: Array<{ slug: string; storyId: string }>,
  ): Promise<void> {
    if (publicadas.length === 0) return;
    await this.withTenant(ctx, async (tx) => {
      for (const p of publicadas) {
        await tx.query(
          `update kr_pages set published_at = now(), storyblok_story_id = $3
           where run_id = $1 and url_slug = $2`,
          [runId, p.slug, p.storyId],
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

  /**
   * El run murió. Se registra el error en vez de dejarlo colgado en `running` para siempre.
   *
   * ## Pero SOLO si todavía estaba corriendo
   *
   * Antes actualizaba el estado fuera cual fuera. Escenario real: Storyblok publica, la respuesta se
   * pierde, el step se reintenta y acaba fallando → `onFailure` ponía el run en `failed`… **con las
   * páginas ya publicadas y visibles en internet.** El estado mentía sobre el mundo.
   *
   * Un fallo del workflow no puede deshacer un hecho externo. Si el run ya estaba aprobado,
   * rechazado o esperando a un humano, el error se REGISTRA pero el estado no se toca: la
   * aprobación humana y la publicación sobreviven.
   */
  async failRun(ctx: TenantContext, runId: string, error: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update kr_runs set status = 'failed', error = $2, finished_at = now()
         where id = $1 and status = 'running'
         returning id`,
        [runId, error.slice(0, 2000)],
      );
      if (rows.length > 0) return true;

      // Ya no estaba corriendo: el error se anota, pero el estado es un hecho que no se pisa.
      await tx.query(
        `update kr_runs set error = $2 where id = $1 and status <> 'running'`,
        [runId, error.slice(0, 2000)],
      );
      return false;
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
        "select count(*)::text as n from kr_pages where run_id = $1 and approved and not retirada",
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

  /*
   * `sqlCrudo()` VIVÍA ACÁ. Se movió a `testing.ts`, que NO se exporta desde `index.ts`.
   *
   * Un método que ejecuta SQL arbitrario bajo el contexto del usuario es exactamente la palanca que
   * convierte un bug de la API en ejecución de SQL. Existía solo para los tests de RLS — y para eso
   * sigue existiendo, pero fuera del artefacto que se despliega.
   */

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
        `select p.cluster_id, p.tipo, p.page_strategy, p.url_slug, p.keyword_principal,
                p.keywords_secundarias, p.intencion, p.local, p.volumen, p.dificultad, p.evidencia,
                p.opportunity_score::float8 as opportunity_score,
                p.score_confidence::float8 as score_confidence,
                p.seo, p.content_brief, p.preguntas_frecuentes
         from kr_pages p
         join kr_runs r on r.id = p.run_id
         where p.run_id = $1
           and p.approved
           -- Una página que el research ya no propone NO se publica, aunque siga aprobada.
           and not p.retirada
           and r.status = 'approved'
         order by p.opportunity_score desc`,
        [runId],
      );
      return rows;
    });
  }
}

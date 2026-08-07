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
 * **2. Todo se escribe BAJO RLS, con el rol del PROCESO, nunca con la service-role.** Podría usarse
 * la service-role (salta RLS) y "confiar" en que el código pone bien el `tenant_id` — pero entonces
 * el aislamiento entre clientes dependería de que yo no me equivoque nunca. Escribiendo bajo RLS, un
 * bug de aplicación **no puede** cruzar tenants: lo frena Postgres. La service-role queda reservada
 * para lo que RLS no cubre (las caches, que no tienen `tenant_id`).
 *
 * "El rol del proceso" son **dos**, y decirlo importa: `app_user` para la API (`amg_api`) y
 * `app_service` para el orquestador (`amg_orquestador`), cada uno atado a su login con `NOINHERIT`
 * (ADR-17). Los dos están sujetos a RLS. Esta línea decía "como `app_user`" a secas hasta la 13ª
 * review, y esa simplificación se propagó a la skill `datos-postgres` convertida en instrucción: un
 * agente que la siguiera al pie de la letra podría "unificar" los roles y borrar la separación que
 * ADR-17 existe para imponer.
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

/**
 * Cuánto puede estar un run en `running` antes de que el barrido lo dé por muerto.
 *
 * **De dónde sale el número, porque un umbral sin origen es un número inventado.** La única duración
 * real medida de un research es **16m15s** (2026-07-30, corrida contra DataForSEO en producción).
 * Tres horas es ~11x eso: no puede matar trabajo legítimo ni con reintentos y backoff encima, y un
 * run parado tres horas está muerto de verdad.
 *
 * **NO se deriva de `PLAZO_APROBACION`** (`"7d"`, en `orchestrator/src/workflow.ts`), y la confusión
 * es fácil: ése es el plazo de la espera POSTERIOR, cuando el run ya llegó a `pending_approval` y
 * espera a un humano. Éste mide la fase de research, que dura minutos. Atarlos dejaría un run colgado
 * una semana antes de que nadie se enterara.
 *
 * Es un **default de producción**, así que tiene test propio (`store.test.ts`): el que lo consume es
 * la función programada del orquestador, y si el test eligiera el valor no estaría fijando nada.
 * El formato es un `interval` de Postgres, no milisegundos: lo parsea la base.
 */
export const PLAZO_RUN_COLGADO = "3 hours";

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
  /**
   * `single` | `hub_spoke` | `merge` | `backlog` — el vocabulario del contrato (`PageStrategy`), y lo
   * impone el check `estrategia_del_contrato` (migración 0017), no esta línea. Decía
   * "`single` | `hub` | `spoke`", que son los PAPELES de una página en un hub y no una estrategia: es el
   * vocabulario que el seed de la demo escribía en la base y que el M1 rechaza al reconstruir el brief.
   *
   * `null` = el brief no la traía (`consumoM1` ni siquiera valida este campo).
   */
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

/**
 * Una página tal como la ve el revisor en el portal: los datos de `PageRow` **más** su `id` (para
 * aprobarla o editarla) y su `approved` (para pintar el estado de la compuerta). `getPublishablePages`
 * devuelve `PageRow` a secas porque publicar no necesita el id ni preguntar si está aprobada — ya
 * filtró por eso.
 */
export interface PaginaPropuesta extends PageRow {
  id: string;
  approved: boolean;
  /**
   * Posición en el brief que produjo el M2 (0 = primera), y el ÚNICO orden con el que se muestran las
   * páginas de un run (KR-3, migración 0015).
   *
   * Está acá y **no en `PageRow`** a propósito, y no es un detalle: `PageRow` es lo que ENTRA desde el
   * M2, y ahí el orden no es un campo — **es la posición en el array** `brief.paginas_propuestas`.
   * `savePages` lo deriva del índice. Que el tipo lo diga es parte del contrato: si `PageRow` lo
   * llevara, alguien podría mandar un orden que no se corresponde con el array que manda.
   *
   * `null` = fila escrita antes de la 0015 (base ya desplegada). Se ordena al final, por score.
   */
  orden_brief: number | null;
}

/**
 * El cliente, incluido **su destino de publicación**.
 *
 * `storyblok_space_id` existía en el esquema desde el día uno y **no lo leía nadie**: se publicaba
 * todo en el `STORYBLOK_SPACE_ID` del proceso. Con dos clientes, la página `/menu` del segundo
 * **pisaba** la del primero. El aislamiento entre tenants era impecable dentro de Postgres y se
 * perdía al salir por la puerta.
 *
 * Se lee **bajo RLS**: un tenant no puede ni nombrar el destino de otro.
 */
export interface ClientRow {
  id: string;
  nombre: string;
  /** Space de Storyblok de ESTE cliente. **Sin él no se publica** (ADR-04: uno por cliente). */
  storyblok_space_id: string | null;
  /** Perfil NAP del negocio → JSON-LD. Antes era un archivo global: el mismo para todos. */
  business_profile: Record<string, unknown> | null;
}

/** Lo que un humano puede corregir de una página propuesta antes de aprobarla (ADR-06). */
export interface CambiosPagina {
  url_slug?: string;
  keyword_principal?: string;
  seo?: Record<string, unknown>;
  content_brief?: Record<string, unknown>;
  preguntas_frecuentes?: string[];
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
  /**
   * Lo que la agencia le pagó a los proveedores por este run, en micros de USD — **su margen**.
   *
   * `null` = quien pregunta NO es staff. No es "el run salió gratis" ni "todavía no se sabe": es la
   * ausencia del dato, y por eso el tipo la nombra en vez de mandar un 0 que un consumidor sumaría.
   * Quien lo pinta tiene que NO pintar nada cuando es `null`; `$0.00` sería afirmar que el research
   * fue gratis.
   *
   * La decisión la toma Postgres dentro del `select` (`app.es_staff()`, ver `RUN_SUMMARY_COLS`), no un
   * `if` de la API: el rol se DERIVA de `memberships` (ADR-15). El rol `cliente` VE sus runs
   * —`run_select` usa `app.ve_cliente(client_id)`— así que la fila le llega entera salvo esta columna.
   */
  coste_micros_usd: number | null;
  calidad_datos: Record<string, unknown>;
  /** Config del run (topes de gasto y de páginas). Es de donde el orquestador los lee: del evento
   *  NO puede leerlos, porque el evento no porta autoridad. */
  config: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

/**
 * Lo que la API devuelve del informe de keyword research ya renderizado (KR-2b, migración 0016).
 *
 * `generado_at` es la fecha del ÚLTIMO render, no la del primero: el step del orquestador es durable y un
 * reintento la actualiza a propósito, porque la pantalla la muestra junto al texto que está pintando.
 *
 * **Y es un `string` ISO 8601 de verdad, no un `Date` disfrazado.** El driver entrega los `timestamptz`
 * como `Date` de JS (medido en PGlite; `node-postgres` hace lo mismo), así que `getInforme` convierte en
 * el borde. Sin esa conversión el tipo diría `string` con un `Date` dentro, y **cualquier** operación de
 * cadena sobre el campo —`slice`, `split`, `startsWith`— pasaría `tsc` y lanzaría un `TypeError` en
 * producción. Es el defecto que KR-2a ya arregló dos veces (`parseBrief`, `coste_breakdown`): un tipo que
 * promete algo que el runtime no cumple es peor que no tenerlo, porque desactiva al único que podía avisar.
 *
 * Para que quede dicho sin inflarlo: **hoy ningún consumidor hace esa operación.** El único que lee este
 * campo es `GET /runs/:id/informe` (`api/src/app.ts`), que lo pasa tal cual al JSON — y ahí un `Date` se
 * serializaría a la misma cadena ISO, así que la conversión no arregla ningún fallo en curso. Lo que hace
 * es quitar la trampa antes de que la pise el primer consumidor que sí opere la cadena. El de la pantalla
 * del informe (T7) todavía no existe. (La descarga `informe.md` no la usa: su `filename` sale del nombre
 * del cliente, saneado por allowlist, y no lleva fecha.)
 *
 * ⚠️ `RunSummary.created_at` / `finished_at` **siguen teniendo ese defecto** (dicen `string`, entregan
 * `Date`). Es deuda vieja y anotada; se arregla cuando alguien toque ese contrato. No se propaga a éste.
 *
 * No lleva `tenant_id` ni `client_id`: quien lee ya está dentro de su tenant (lo impone RLS, no un
 * `where`), y devolverlos solo daría a la API la oportunidad de tomar una decisión con ellos.
 */
export interface InformeRow {
  informe_md: string;
  /** ISO 8601 en UTC (`2026-08-05T21:04:41.597Z`), garantizado por `getInforme`. */
  generado_at: string;
}

/**
 * Los datos crudos con los que se arma el **entregable del restaurante** (el informe SIN el bloque de
 * coste). Lo lee la API, que los convierte en un `KeywordResearchBrief` y lo pasa por `renderReport`.
 *
 * ## Por qué esto no es un `RunSummary` y por qué no se guarda
 *
 * El informe interno (`kr_informes`) se congela al terminar el run, y para él está bien: describe lo que
 * el research produjo. El entregable tiene que reflejar **lo que pasó la compuerta** — las páginas que un
 * humano aprobó, con las ediciones que les hizo. Congelarlo mandaría al restaurante el brief original en
 * vez de lo aprobado. Por eso se genera al vuelo y no hay tabla ni migración nueva.
 *
 * ## Lo que NO viene acá
 *
 * `prompt` y `config` no viajan: el prompt es cómo la agencia le pidió el research al sistema, y el
 * documento del restaurante no lo lleva. Que no estén en el tipo es más barato que acordarse de no
 * imprimirlos.
 *
 * `coste_micros_usd` y `coste_breakdown` SÍ vienen, y esa es una decisión con motivo — ver
 * `getDatosEntregable`.
 */
export interface DatosEntregable {
  run_id: string;
  schema_version: string;
  status: RunStatus;
  /** El NOMBRE del cliente (no su uuid): es el encabezado del documento que lee el restaurante. */
  cliente: string;
  market_country: string;
  market_language: string;
  market_location_code: number;
  /** ISO 8601 en UTC, garantizado por `getDatosEntregable` (el driver entrega `Date`). */
  generated_at: string;
  /** `kr_runs.calidad_datos` tal cual. Es jsonb: puede ser `{}`, y la API lo normaliza. */
  calidad_datos: Record<string, unknown>;
  /** Micros de USD. Llega porque quien pregunta ya demostró ser staff; NO se imprime. */
  coste_micros_usd: number;
  coste_breakdown: Record<string, unknown>;
  keywords_analizadas: number;
  /** Las páginas APROBADAS y no retiradas, en el orden del brief. */
  paginas: PageRow[];
}

/**
 * El orden en que se ven las páginas de un run. **Una sola definición** para las dos lecturas: si el
 * brief y lo que se publica se ordenaran distinto, el revisor aprobaría una lista y se publicaría otra.
 *
 * `orden_brief` es la posición que le dio el M2 (KR-3, migración 0015). Los otros dos criterios son el
 * desempate:
 *
 *  · **`nulls last`** — las filas escritas antes de la 0015 no tienen posición y tienen que caer al
 *    final. **Es REDUNDANTE y está a propósito**: `nulls last` ya es el default de Postgres para `asc`
 *    (medido: `order by n asc` sobre `1, null, 0` devuelve `0, 1, null`; en `desc` es al revés).
 *    Se escribe explícito para que el orden no dependa de un default que hay que recordar — pero no
 *    hay que creerle a este comentario más de lo que dice: **quitarlo no cambia nada, y por eso
 *    ningún test cae si se quita.** La mutación que sí lo tumba es cambiarlo por `nulls first`.
 *  · **`url_slug`** — cierra el orden. Dos filas viejas con el mismo score, sin este último criterio,
 *    salen en orden indefinido: un test intermitente esperando a pasar. `unique (run_id, url_slug)`
 *    garantiza que el desempate es total.
 */
const ORDEN_DEL_BRIEF = `order by p.orden_brief asc nulls last, p.opportunity_score desc, p.url_slug asc`;

/**
 * Las columnas de `RunSummary`. Una sola definición: el select no puede quedar desalineado.
 *
 * ## El `case when` del coste NO es cosmético: es dónde vive el margen de la agencia
 *
 * `coste_micros_usd` es lo que la agencia le paga a DataForSEO y al LLM. La política `run_select`
 * (`0001_init.sql`) usa `app.ve_cliente(client_id)`, así que el rol `cliente` —el dueño del
 * restaurante— **ve la fila de su propio run**, y con ella veía esta columna. No era fuga activa (no
 * hay usuarios con ese rol todavía) pero el rol existe, RLS lo contempla y la demo está en producción.
 *
 * Se cierra donde se cierran las cosas en este proyecto: **en Postgres**. `app.es_staff()` deriva el rol
 * de `memberships` (ADR-15); un `if (rol === 'cliente')` en la API sería la misma decisión tomada donde
 * nadie la audita, y habría que acordarse de repetirla en el próximo endpoint que lea runs.
 *
 * **Medido** (PostgreSQL 16.4 en `db/`, 18.3 en `api/` — los dos majors, porque uno no se puede
 * extrapolar del otro): `app.es_staff()` es evaluable en la lista del `select` con el rol `app_user` y
 * devuelve `true` para staff, `false` para `cliente` y **`null`** para quien no tiene membresía. Los
 * tres fallan cerrado: sin `else`, el `case` da NULL para todo lo que no sea TRUE.
 *
 * RLS es por FILA, no por columna, y esto no la contradice: la fila sigue llegando (tiene que llegar,
 * es su run) y lo que se recorta es una celda. El caso en que la columna entera es el secreto —el
 * informe con su desglose— sí se llevó una tabla propia con su política (`kr_informes`, 0016).
 */
const RUN_SUMMARY_COLS = `id, client_id, status, prompt, schema_version,
       market_country, market_language, market_location_code,
       case when app.es_staff() then coste_micros_usd::int end as coste_micros_usd,
       calidad_datos, config, created_at, finished_at`;

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
   * cualquier ajuste de scoring o clustering — la lección que ya costó plata con el dataset crudo, que
   * se escribía en `out/` (gitignoreado) y se perdió; hoy va a `datasets/keywords.json`.
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
   *
   * ## El orden del brief va aparte, y por qué (KR-3, migración 0015)
   *
   * **El orden ES la posición en `pages`.** `orden_brief` se escribe desde el índice del array — el M2
   * no manda un campo con la posición porque el orden no es un campo del brief, es su forma.
   *
   * Pero `orden_brief` **no es material**, y eso lo deja fuera de los dos sitios obvios:
   *
   *  · **No puede ir en el `where`.** Revocaría la aprobación de una página que subió del puesto 5 al
   *    4 sin que nada de su contenido cambiara. La compuerta certifica que un humano miró ESA página,
   *    no en qué posición estaba.
   *  · **Tampoco alcanza ponerlo solo en el `set`.** El `where` gobierna el update ENTERO: en un
   *    reintento donde SOLO cambió el orden, ninguna condición material se cumple, el update no ocurre
   *    y el orden nuevo se perdería en silencio — la fila quedaría con la posición vieja.
   *
   * Por eso va en una sentencia propia, después de los upserts: escribe la posición sin tocar
   * `approved`. Es una sola sentencia para todas las páginas (no una por página).
   */
  async savePages(ctx: TenantContext, runId: string, clientId: string, pages: PageRow[]): Promise<void> {
    /*
     * PRECONDICIÓN: los `url_slug` del array son únicos. Antes vivía sin dueño —la generan los slugs de
     * `kr-service`, y acá nada la imponía— y romperla NO daba un error: daba un orden roto en silencio.
     *
     * Medido con `[{/dup}, {/otra}, {/dup}]`: el resultado era `[['/otra',1], ['/dup',2]]`. No existía
     * la posición 0, el brief arrancaba en 1, y `/dup` (índice 0 del array) terminaba DESPUÉS de
     * `/otra` (índice 1) — o sea el invariante que KR-3 protege, invertido. La causa es la sentencia del
     * orden de más abajo: `update … from unnest(...)` matchea la misma fila dos veces y Postgres elige
     * una de las dos filas de origen **sin garantizar cuál**, así que ni siquiera es reproducible.
     *
     * Se RECHAZA en vez de deduplicar porque no hay una respuesta correcta que adivinar: dos páginas al
     * mismo slug se pisarían al publicar (el slug ES la URL). Un brief así está roto en origen, y un run
     * `failed` con el motivo escrito es mejor que publicar en silencio una página menos de las que el
     * revisor aprobó. Va ANTES del `withTenant`: si el brief no es válido, no se abre transacción.
     */
    const slugs = new Set<string>();
    const repetidos = pages.map((p) => p.url_slug).filter((s) => slugs.size === slugs.add(s).size);
    if (repetidos.length > 0) {
      throw new Error(
        `El brief del run ${runId} trae url_slug repetido: ${[...new Set(repetidos)].join(", ")}. ` +
          `Dos páginas con el mismo slug se pisarían al publicar, y la posición de una de las dos se ` +
          `perdería. El brief se rechaza entero.`,
      );
    }

    // Ojo: NO se sale temprano con `pages.length === 0`. Un research que ahora no propone NINGUNA
    // página tiene que RETIRAR las que había, no dejarlas aprobadas y publicables.
    await this.withTenant(ctx, async (tx) => {
      /*
       * SERIALIZAR POR RUN. Lo primero de la transacción, antes de escribir nada.
       *
       * Las tres fases de abajo (upserts → orden → reconciliación) son atómicas *juntas*, pero eso no
       * las serializa contra OTRA llamada para el mismo run. En READ COMMITTED —que es lo que abre
       * `NodePgPool.transaction`— dos `savePages` concurrentes con conjuntos de slugs distintos no ven
       * las filas no confirmadas de la otra, así que **ninguna reconciliación retira las páginas
       * ajenas**: quedan las de los dos briefs activas, con posiciones repetidas (dos en la 0) y
       * páginas que el último brief no proponía. El síntoma es el invariante que KR-3 protege, roto.
       *
       * `for update` sobre la fila del run pone a la segunda a esperar el commit de la primera, y
       * entonces su reconciliación **sí** ve lo que la otra escribió. Se elige la fila de `kr_runs` y
       * no un advisory lock porque es el objeto que ya define el ámbito, viaja con la transacción y se
       * suelta solo en el commit o el rollback.
       *
       * ⚠️ **Esta propiedad NO tiene test, y no puede tenerlo acá:** `PglitePool` serializa todas sus
       * transacciones sobre una única conexión (ver `pool.ts`), así que la carrera es invisible para la
       * batería entera. Lo detectó la 13ª review externa por lectura, no por ejecución. Lo que sí está
       * testeado es el contrato observable: si el run no se puede bloquear, no se escribe nada.
       *
       * Y de paso arregla un mensaje que mentía: un `runId` inexistente o de otro tenant fallaba más
       * abajo con el 23503 de la FK compuesta, que la API traduce a *"revisá clientId, market y los
       * campos obligatorios"* — un 400 que culpa al payload cuando el problema es el run.
       */
      const { rows: run } = await tx.query<{ id: string }>(
        "select id from kr_runs where id = $1 for update",
        [runId],
      );
      if (!run[0]) {
        throw new Error(
          `El run ${runId} no existe o no es visible para este tenant: no se guardan páginas. ` +
            `Bajo RLS un run ajeno no se ve, así que este error cubre los dos casos a propósito.`,
        );
      }

      for (const [i, p] of pages.entries()) {
        await tx.query(
          `insert into kr_pages
             (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug, keyword_principal,
              keywords_secundarias, intencion, local, volumen, dificultad, evidencia,
              opportunity_score, score_confidence, seo, content_brief, preguntas_frecuentes,
              approved, retirada, orden_brief)
           values ($1,$2,$19,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17::jsonb,$18,
                   false, false, $20)
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
             -- orden_brief NO está acá ni en el WHERE: no es material, y el WHERE gobierna el update
             -- entero (ver la cabecera del método). Lo escribe la sentencia de abajo.
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
            i, // orden_brief: 0 = primera. El orden ES la posición en el array (KR-3).
          ],
        );
      }

      /*
       * EL ORDEN DEL BRIEF — en su propia sentencia, y sin tocar `approved`.
       *
       * Va aparte porque `orden_brief` no es material: no puede ir en el `where` del upsert (revocaría
       * aprobaciones por un cambio de posición) ni solo en su `set` (el `where` bloquearía el update
       * cuando SOLO cambió el orden, y la posición nueva se perdería). Ver la cabecera del método.
       *
       * `is distinct from` evita reescribir las que ya están en su sitio — el caso normal de un
       * reintento idéntico no escribe ni una fila.
       *
       * Una sola sentencia para todas las páginas, y eso es lo que permite PERMUTAR posiciones: con un
       * `unique (run_id, orden_brief)` esto reventaría a mitad de sentencia (Postgres comprueba fila
       * por fila), y de ahí que la 0015 no lo lleve.
       */
      await tx.query(
        `update kr_pages p set orden_brief = o.orden
         from unnest($2::text[], $3::int[]) as o(slug, orden)
         where p.run_id = $1
           and p.url_slug = o.slug
           and p.orden_brief is distinct from o.orden`,
        [runId, pages.map((p) => p.url_slug), pages.map((_, i) => i)],
      );

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
           approved_at = null,
           -- Una página que el research ya no propone no está EN el brief, así que no tiene posición
           -- en él. Dejarle la vieja invitaría a que un lector futuro ordenara retiradas por un puesto
           -- que ya ocupa otra página. Si vuelve a proponerse, la sentencia de arriba le da la nueva.
           orden_brief = null
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

  /**
   * Cierra el run: pasa a `pending_approval` y queda esperando a un humano (ADR-06).
   *
   * ## Pero SOLO si todavía estaba corriendo — la simetría con `failRun`
   *
   * Antes movía el estado fuera cual fuera (`where id = $1` pelado). Hoy nada más lo escribe mientras
   * el workflow vive, así que no mordía; el **barrido de runs colgados** (bloque A2 del plan) es
   * exactamente eso, y sin esta guarda el escenario sería: el barrido marca `failed` un research
   * legítimamente lento, el workflow termina cinco minutos después y lo devuelve a `pending_approval`,
   * con `finished_at` reescrito. La red de seguridad quedaría deshecha por lo que vigila.
   *
   * Es la misma regla que `failRun` ya aplicaba desde el otro lado: **un estado terminal es un hecho y
   * no se pisa.** Lo destapó verificar un hallazgo de la 15ª review sobre el diseño del barrido, que
   * todavía no existe.
   *
   * ## Lo que SÍ se escribe igual, y por qué
   *
   * El `case` guarda **solo el estado**. El coste, el desglose y la calidad se anotan pase lo que pase:
   * ese dinero se gastó de verdad contra DataForSEO y el LLM, y no registrarlo lo perdería de la
   * contabilidad — un run `failed` que costó $0.31 costó $0.31. `finished_at` va con el estado, porque
   * es el sello de la transición y no un hecho del mundo.
   *
   * Devuelve si **movió el estado**, para que el llamador no dé por hecha una compuerta que no se abrió.
   */
  async finishRun(
    ctx: TenantContext,
    runId: string,
    meta: {
      costeMicros: number;
      costeBreakdown: Record<string, unknown>;
      calidadDatos: Record<string, unknown>;
      modelosSinPrecio: string[];
    },
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const datos = [
        runId,
        meta.costeMicros,
        JSON.stringify(meta.costeBreakdown),
        JSON.stringify(meta.calidadDatos),
        meta.modelosSinPrecio,
      ];

      const { rows } = await tx.query<{ id: string }>(
        `update kr_runs set
           status = 'pending_approval',
           finished_at = now(),
           coste_micros_usd = $2,
           coste_breakdown = $3::jsonb,
           calidad_datos = $4::jsonb,
           modelos_sin_precio = $5
         where id = $1 and status = 'running'
         returning id`,
        datos,
      );
      if (rows.length > 0) return true;

      /*
       * Ya no estaba corriendo. El estado no se pisa, pero el gasto sí se anota.
       *
       * Dos sentencias y no un `case … returning`: `RETURNING` ve la fila NUEVA, así que un
       * `returning (status = 'pending_approval')` diría `true` en un reintento sobre un run que ya
       * estaba en `pending_approval` — o sea, mentiría justo en el caso que este booleano existe para
       * distinguir. `RETURNING OLD` lo resolvería en una, pero es de PG18 y esto corre contra 16.4.
       */
      await tx.query(
        `update kr_runs set
           coste_micros_usd = $2,
           coste_breakdown = $3::jsonb,
           calidad_datos = $4::jsonb,
           modelos_sin_precio = $5
         where id = $1 and status <> 'running'`,
        datos,
      );
      return false;
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

  /**
   * El barrido de runs colgados: marca `failed` los que siguen en `running` pasado el plazo, en
   * TODOS los tenants, y devuelve cuáles fueron.
   *
   * ## Por qué existe, si ya está `failRun`
   *
   * `failRun` lo llama el `onFailure` del workflow, y su única acción es escribir en Postgres. Cuando
   * el workflow muere porque no alcanza la base, el manejador muere por lo mismo: **la red de
   * seguridad comparte su punto de fallo con lo que protege** (medido en producción el 2026-08-07). Y
   * si nadie llega a consumir el evento del run, el workflow ni siquiera arranca — el único plazo del
   * sistema (`PLAZO_APROBACION`) vive dentro del workflow, así que no hay reloj. Éste es el reloj de
   * afuera.
   *
   * ## Por qué no lleva `TenantContext`
   *
   * Porque no hay ninguno que sea verdad: un barrido es cross-tenant por naturaleza y del otro lado no
   * hay ninguna persona. Inventarle un tenant sería un control autoexpedido, igual que en `PgSitios`
   * (que tampoco tiene contexto, por el mismo motivo, y ver el comentario de esa clase).
   *
   * Lo que sí hay es un ROL: `app_service`. Si un `PgStore` construido con `app_user` llama a esto,
   * **Postgres lo rechaza con 42501** (la función solo tiene `grant execute` para `app_service`); no
   * hay ningún `if` mío en el medio, y hay un test que lo exige.
   *
   * El cruce de tenants NO lo hace este método: lo hace `app.expirar_runs_colgados`, una
   * `security definer` cuyo cuerpo entero es esta operación. Ver `0018_barrido_runs_colgados.sql`
   * para por qué es la única forma que no exige un rol que vea todos los tenants.
   *
   * @param plazo  Intervalo de Postgres (`"3 hours"`). En producción va `PLAZO_RUN_COLGADO`; la base
   *               impone un piso de 1 hora y rechaza cualquier cosa por debajo con 22023, así que un
   *               plazo mal calculado no puede matar trabajo vivo.
   */
  async expirarRunsColgados(plazo: string): Promise<Array<{ id: string; tenantId: string }>> {
    return this.sinTenant(async (tx) => {
      const { rows } = await tx.query<{ id: string; tenant_id: string }>(
        "select id, tenant_id from app.expirar_runs_colgados($1::interval)",
        [plazo],
      );
      return rows.map((r) => ({ id: r.id, tenantId: r.tenant_id }));
    });
  }

  /**
   * ¿Puede este proceso hacer lo que hace? Lanza si no. **La sonda de `/_health`.**
   *
   * Un `select 1` sobre la conexión cruda habría probado que hay TCP y que la contraseña es correcta,
   * y **nada más**. Lo que el orquestador hace de verdad es abrir una transacción con conexión
   * reservada y asumir `app_service` (ADR-13, ADR-17), y ese `set local role` es exactamente lo que
   * falla cuando el login no tiene el rol concedido — un fallo que el `select 1` declararía sano.
   *
   * Por eso la sonda va por `sinTenant`: recorre el mismo camino, no uno parecido. Sigue siendo
   * baratísima (una transacción vacía), y **no toca ninguna tabla de tenant**: no hay contexto que
   * poner, así que RLS no dejaría ver nada aunque se intentara.
   */
  async comprobarAcceso(): Promise<void> {
    await this.sinTenant(async (tx) => {
      await tx.query("select 1");
    });
  }

  /**
   * Como `withTenant`, pero SIN identidad: aplica el rol del proceso y nada más.
   *
   * No es un atajo para saltarse el contexto — es que hay una operación (el barrido) donde no existe
   * ninguno. Que no reciba `TenantContext` es la misma garantía en el tipo que da `asRender` al no
   * aceptarlo: no se puede llamar accidentalmente con la identidad de alguien.
   *
   * Sigue siendo una transacción con conexión reservada (ADR-13): el `set local role` es local a la
   * transacción igual que el contexto, y sin la conexión reservada podría irse a otra conexión.
   */
  private sinTenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.exec(`set local role ${this.rol}`);
      return fn(tx);
    });
  }

  /**
   * Guarda el informe ya renderizado del run. Lo llama el ORQUESTADOR (rol `app_service`).
   *
   * El `client_id` NO lo aporta el llamador: se lee del propio run, dentro de la misma sentencia. Un
   * parámetro sería una forma de que la fila mintiera sobre a qué cliente pertenece el informe, y aunque
   * la FK compuesta `(run_id, tenant_id, client_id)` de la 0016 lo cazaría con un 23503, es mejor que no
   * haya nada que cazar.
   *
   * Idempotente: el step del orquestador es durable y se reintenta, así que un segundo intento tiene que
   * reescribir en vez de reventar con 23505 y dejar el run sin cerrar. `generado_at` se actualiza a
   * propósito — es la fecha del render que se está guardando, y la pantalla la muestra junto al texto.
   */
  async guardarInforme(ctx: TenantContext, runId: string, informeMd: string): Promise<void> {
    await this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ run_id: string }>(
        `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
         select $1, $2, r.client_id, $3
           from kr_runs r
          where r.id = $1
         on conflict (run_id) do update
            set informe_md  = excluded.informe_md,
                generado_at = now()
         returning run_id`,
        [runId, ctx.tenantId, informeMd],
      );

      /*
       * Sin este guard, un run inexistente o de otro tenant NO da error: bajo RLS el `select` no devuelve
       * filas, el insert escribe CERO y todo parece haber funcionado. El orquestador cerraría el run en
       * `pending_approval` sin informe, y el invariante "un run en pending_approval siempre tiene informe"
       * —del que dependen el endpoint de T4 y la pantalla— quedaría roto sin que nada avisara.
       *
       * El mensaje cubre los dos casos a propósito: bajo RLS un run ajeno no se ve, así que desde acá no
       * se puede (ni se debe) distinguir "no existe" de "no es tuyo". Distinguirlos sería confirmarle a
       * quien pregunta que ese run existe en otro tenant.
       */
      if (!rows[0]) {
        throw new Error(
          `El run ${runId} no existe o no es visible para este tenant: no se guarda informe.`,
        );
      }
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
   * Edita una página propuesta **y le quita la aprobación** (ADR-06).
   *
   * ADR-06 siempre dijo que el humano *"revisa y **edita**"* el brief antes de crear la web. Lo de
   * editar **no existía**: solo se podía aprobar o rechazar. Si una página estaba casi bien, la única
   * salida era tirarla — y volver a pagar un research.
   *
   * **Editar REVOCA la aprobación, siempre.** No es una cortesía: la compuerta certifica que un
   * humano miró *esto*, y si `esto` cambió después de que lo mirara, la certificación ya no vale de
   * nada. Sin esta línea, alguien aprueba una página inocua, la reescribe entera y se publica sin
   * que nadie haya visto lo que salió.
   *
   * Los campos son una **allowlist**: `approved`, `run_id`, `client_id` y `tenant_id` no se tocan
   * desde acá ni por accidente. Construir el `update` a partir de las claves que mande el llamador
   * es cómo un endpoint de edición se convierte en una escalada de privilegios.
   */
  async editPage(
    ctx: TenantContext,
    pageId: string,
    cambios: CambiosPagina,
  ): Promise<boolean> {
    const COLUMNAS = ["url_slug", "keyword_principal", "seo", "content_brief", "preguntas_frecuentes"] as const;

    const sets: string[] = [];
    const params: unknown[] = [pageId];
    for (const col of COLUMNAS) {
      const v = cambios[col];
      if (v === undefined) continue;
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
    if (sets.length === 0) return false;

    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update kr_pages
            set ${sets.join(", ")},
                approved = false,          -- editar SIEMPRE revoca: ver arriba
                approved_by = null,
                approved_at = null,
                edited_by = $${params.length + 1},
                edited_at = now()
          where id = $1
            and not retirada
          returning id`,
        [...params, ctx.userId ?? null],
      );
      return rows.length > 0;
    });
  }

  /**
   * Aprueba el run. NO aprueba sus páginas: es la mitad global de la compuerta doble.
   *
   * Se niega a aprobar un run sin ninguna página aprobada — publicar "todo" cuando el revisor no
   * aceptó nada sería justo el accidente que la compuerta existe para evitar.
   *
   * Devuelve `false` si el `update` no tocó ninguna fila. **Esto importa para un lector-no-escritor**
   * (el rol `cliente`): RLS lo deja VER el run —así que pasa el conteo de páginas— pero no
   * ACTUALIZARLO, con lo que el update afecta 0 filas **en silencio**. Sin este booleano, la API
   * creería que aprobó, devolvería 200 y **despertaría al workflow** por algo que la base no cambió.
   */
  async approveRun(ctx: TenantContext, runId: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
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
      const { rows: upd } = await tx.query<{ id: string }>(
        "update kr_runs set status = 'approved' where id = $1 returning id",
        [runId],
      );
      return upd.length > 0;
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

  /**
   * El cliente y **su destino de publicación**, bajo RLS.
   *
   * Es lo que impide que el research del tenant A termine escrito en el space de Storyblok del
   * tenant B. Antes el destino salía de una variable de entorno del proceso —la misma para todos—,
   * así que el aislamiento multi-tenant se evaporaba justo en el paso que escribe hacia afuera.
   */
  async getClient(ctx: TenantContext, clientId: string): Promise<ClientRow | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<ClientRow>(
        "select id, nombre, storyblok_space_id, business_profile from clients where id = $1",
        [clientId],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * El informe del run, o `null` si no hay. Lo llama la API (rol `app_user`; solo staff lo recibe).
   *
   * **No hay ningún filtro de rol acá, y es la decisión.** La política `informe_staff` (0016) exige
   * `app.es_staff()`, así que para el rol `cliente` —el dueño del negocio, que SÍ ve sus runs— esta misma
   * query devuelve cero filas. El informe lleva el desglose de lo que la agencia le paga a DataForSEO: un
   * `if` acá sería una segunda fuente de verdad que alguien podría olvidarse de escribir en el próximo
   * endpoint. `null` y no una excepción porque "no hay informe todavía" es un estado normal de un run.
   */
  async getInforme(ctx: TenantContext, runId: string): Promise<InformeRow | null> {
    return this.withTenant(ctx, async (tx) => {
      /*
       * La fila CRUDA se tipa `Date | string` porque es lo que el driver entrega de verdad: `timestamptz`
       * llega como `Date` de JS. Tiparla `InformeRow` acá sería la mentira que este método existe para no
       * contar — y `tx.query<T>` no valida nada en runtime, así que el `T` que se le pase es una promesa
       * que nadie comprueba.
       */
      const { rows } = await tx.query<{ informe_md: string; generado_at: Date | string }>(
        "select informe_md, generado_at from kr_informes where run_id = $1",
        [runId],
      );
      const fila = rows[0];
      if (!fila) return null;

      return {
        informe_md: fila.informe_md,
        /*
         * La conversión va ACÁ y no en el endpoint: si viviera en la API, el próximo consumidor del store
         * heredaría la trampa entera, y la garantía dependería de que cada llamador se acuerde. El borde
         * del store es el único sitio donde se paga una vez.
         *
         * `toISOString()` normaliza a UTC con milisegundos. No pierde precisión respecto de lo que había:
         * un `Date` de JS solo guarda milisegundos, así que los microsegundos de Postgres ya los había
         * descartado el driver antes de llegar hasta acá.
         */
        generado_at: new Date(fila.generado_at).toISOString(),
      };
    });
  }

  /**
   * Los datos del **entregable del restaurante**, o `null` si quien pregunta no puede producirlo.
   *
   * ## El `and app.es_staff()` del `where` ES el control de acceso, y por eso vive ahí
   *
   * El entregable lo envía la agencia: decide cuándo el research está listo para mostrarse (decisión del
   * dueño del proyecto, 2026-08-07). Para el rol `cliente` esta consulta devuelve **cero filas**, no un
   * error — así el endpoint responde 404 sin poder distinguirlo de un run inexistente, y de paso no
   * filtra que el run existe. Un `if (rol === 'cliente')` en la API daría el mismo 404 y sería una
   * segunda fuente de verdad que alguien tiene que acordarse de repetir; acá la decisión la toma el
   * mismo mecanismo que ya gobierna todo lo demás (ADR-15).
   *
   * **La consulta de las páginas NO lleva el mismo guard, a propósito.** Solo corre si la de arriba
   * devolvió fila, así que sería una condición que ninguna mutación puede tumbar — ceremonia con filo. Y
   * las páginas no son el secreto: `getRunPages` ya se las muestra al `cliente`, que tiene derecho a ver
   * el brief de su propio negocio. Lo que es de la agencia es el DOCUMENTO.
   *
   * ## Qué páginas entran: `approved and not retirada`
   *
   * Las que pasaron la compuerta de página (ADR-06). **No** se exige además `run.status = 'approved'`:
   * esa es la condición para PUBLICAR (`getPublishablePages`), y publicar es otra acción. Quien lee esto
   * ya es staff, y tiene que poder ver el entregable antes de cerrar el run — es justo el control
   * editorial que la decisión de arriba le da.
   *
   * ## Por qué el coste viaja hasta acá si el documento no lo lleva
   *
   * Porque quien excluye el coste es `renderReport(brief, { audiencia: "restaurante" })`, en `contrato`, donde
   * está probado por mutación — **una garantía, un lugar**. Si en cambio esta consulta no leyera el
   * coste, la API tendría que inventar un `0` para satisfacer el tipo del brief, y el día que alguien
   * invirtiera esa opción el documento imprimiría **«$0.00»**: afirmarle al restaurante que el research
   * fue gratis, en silencio y sin que ningún test lo viera. Con el número real, esa misma equivocación
   * imprime el coste de verdad y **cae el test** que exige que no aparezca.
   */
  async getDatosEntregable(ctx: TenantContext, runId: string): Promise<DatosEntregable | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<Omit<DatosEntregable, "paginas" | "generated_at"> & {
        generated_at: Date | string;
      }>(
        `select r.id as run_id, r.schema_version, r.status,
                c.nombre as cliente,
                r.market_country, r.market_language, r.market_location_code,
                r.created_at as generated_at,
                r.calidad_datos,
                -- bigint: sin el cast el driver lo entrega como STRING y una resta empieza a concatenar.
                r.coste_micros_usd::int as coste_micros_usd,
                r.coste_breakdown,
                -- count(*) es bigint por la misma razón. El número sale del DATO y no del brief: es lo
                -- que de verdad quedó guardado del research que se pagó.
                (select count(*)::int from kr_keywords k where k.run_id = r.id) as keywords_analizadas
           from kr_runs r
           join clients c on c.id = r.client_id
          where r.id = $1
            and app.es_staff()`,
        [runId],
      );
      const run = rows[0];
      if (!run) return null;

      const { rows: paginas } = await tx.query<PageRow>(
        `select p.cluster_id, p.tipo, p.page_strategy, p.url_slug, p.keyword_principal,
                p.keywords_secundarias, p.intencion, p.local, p.volumen, p.dificultad, p.evidencia,
                -- numeric: sin el cast llegan como string, y una comparacion empieza a ordenar texto.
                p.opportunity_score::float8 as opportunity_score,
                p.score_confidence::float8 as score_confidence,
                p.seo, p.content_brief, p.preguntas_frecuentes
           from kr_pages p
          where p.run_id = $1
            and p.approved
            and not p.retirada
          ${ORDEN_DEL_BRIEF}`,
        [runId],
      );

      return {
        ...run,
        // El driver entrega los `timestamptz` como `Date`. La conversión va en el borde del store, igual
        // que en `getInforme`: si viviera en la API, el próximo consumidor heredaría la trampa entera.
        generated_at: new Date(run.generated_at).toISOString(),
        paginas,
      };
    });
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
   * Todos los runs que el usuario PUEDE ver, sin filtrar por cliente. Lo usa `GET /runs`.
   *
   * No hace falta un `where` por rol: RLS ya lo aplica. Un `maestro`/`equipo` ve los de su tenant;
   * un `cliente` ve solo los de SU negocio. La misma query devuelve conjuntos distintos según quién
   * pregunte — y esa diferencia la impone Postgres, no un `if` de la API.
   */
  async listAllRuns(ctx: TenantContext): Promise<RunSummary[]> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<RunSummary>(
        `select ${RUN_SUMMARY_COLS} from kr_runs order by created_at desc`,
      );
      return rows;
    });
  }

  /**
   * Las páginas PROPUESTAS de un run (para mostrar el brief y manejar la compuerta), con su `id` y su
   * estado de aprobación. Distinto de `getPublishablePages`: aquí NO se exige `approved` ni que el run
   * esté aprobado — es lo que el revisor mira ANTES de decidir. Las retiradas no se muestran.
   */
  async getRunPages(ctx: TenantContext, runId: string): Promise<PaginaPropuesta[]> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<PaginaPropuesta>(
        `select p.id, p.approved, p.cluster_id, p.tipo, p.page_strategy, p.url_slug,
                p.keyword_principal, p.keywords_secundarias, p.intencion, p.local, p.volumen,
                p.dificultad, p.evidencia,
                p.opportunity_score::float8 as opportunity_score,
                p.score_confidence::float8 as score_confidence,
                p.orden_brief, p.seo, p.content_brief, p.preguntas_frecuentes
         from kr_pages p
         where p.run_id = $1 and not p.retirada
         ${ORDEN_DEL_BRIEF}`,
        [runId],
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
         ${ORDEN_DEL_BRIEF}`,
        [runId],
      );
      return rows;
    });
  }
}

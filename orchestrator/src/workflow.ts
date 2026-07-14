import type { PgStore, TenantContext, PageRow, RunSummary } from "db";

/**
 * El workflow del research, de punta a punta: pipeline → persistencia → compuerta humana →
 * publicación.
 *
 * ## Por qué está separado de Inngest
 *
 * Lo que hay acá es la LÓGICA (qué pasos, en qué orden, con qué autoridad). Inngest aporta la
 * durabilidad (memoización de steps, reintentos, esperar días a un humano sin un proceso vivo).
 * Separarlos permite testear la lógica —incluidos los caminos de fallo y los de seguridad— sin
 * levantar el runtime, y deja `functions.ts` como un adaptador fino.
 *
 * ## Las fronteras de gasto son las fronteras de los steps
 *
 * Un step que falla se REINTENTA ENTERO. Por eso `crear-run` está separado de `research`: si el
 * research revienta a mitad, el reintento no crea un segundo run ni vuelve a abrir la cuenta. Y
 * dentro del research, lo que ya se pagó queda persistido en el checkpoint del dataset apenas
 * existe, así que un reintento lo encuentra en la cache de DataForSEO (el 81% del costo) en vez de
 * volver a comprarlo.
 */

export interface Pasos {
  /** Ejecuta `fn` UNA vez y memoiza el resultado. Un reintento posterior no la vuelve a correr. */
  run<T>(id: string, fn: () => Promise<T>): Promise<T>;
  /** Duerme hasta que llegue el evento (o venza el plazo). No hay proceso vivo esperando. */
  esperarEvento(
    id: string,
    opts: { evento: string; timeout: string; runId: string },
  ): Promise<{ data: unknown } | null>;
}

/** Todo lo externo, inyectado: así el test corre el workflow real contra una base real y sin red. */
export interface Deps {
  store: PgStore;
  /** El pipeline del M2. Devuelve el brief; el dataset pago se persiste por el checkpoint. */
  research: (args: {
    prompt: string;
    market: { country: string; language_code: string; location_code: number };
    maxCostMicros?: number | undefined;
    maxPages?: number | undefined;
    /** Se invoca en cuanto las keywords pagas existen. Es el checkpoint de lo que costó dinero. */
    onKeywords: (keywords: KeywordParaGuardar[]) => Promise<void>;
  }) => Promise<BriefDelPipeline>;
  /**
   * Publica en el M1. Recibe el brief RECONSTRUIDO DESDE LA BASE, ya validado contra el contrato,
   * y el **destino del cliente** (su space de Storyblok y su perfil), resuelto bajo RLS.
   *
   * Devuelve, por página, si el proveedor **confirma** que quedó publicada. No es lo mismo que
   * "se la mandamos".
   */
  publicar: (
    brief: unknown,
    destino: DestinoPublicacion,
  ) => Promise<Array<{ slug: string; location: string; published: boolean }>>;
  /** Valida el brief contra el contrato del M1 (Zod). Lanza si no cuadra. */
  validarContrato: (raw: unknown) => unknown;
  log?: (msg: string) => void;
}

export interface KeywordParaGuardar {
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

export interface BriefDelPipeline {
  schema_version: string;
  paginas_propuestas: PageRow[];
  meta_run: {
    coste_micros_usd: number;
    coste_breakdown: Record<string, unknown>;
    calidad_datos: Record<string, unknown>;
    modelos_sin_precio?: string[];
  };
}

/**
 * Lo que el evento trae. **Solo coordenadas, cero autoridad.**
 *
 * El prompt, el cliente, el mercado y los topes NO viajan acá: salen de la fila del run, que creó la
 * API bajo RLS con la identidad del humano. Si esto llevara el `clientId`, quien emita el evento
 * elegiría a nombre de quién se gasta.
 */
export interface EntradaResearch {
  runId: string;
  tenantId: string;
}

/**
 * A dónde se publica. **Sale de la fila del cliente, bajo RLS — nunca de una variable de entorno.**
 *
 * Antes el destino era el `STORYBLOK_SPACE_ID` del proceso, el mismo para todos los clientes. Como
 * los slugs de un restaurante son siempre los mismos (`/menu`, `/contacto`…), publicar el research
 * del cliente A **sobrescribía las páginas del cliente B**. El aislamiento entre tenants era
 * impecable dentro de Postgres y se perdía justo en el paso que escribe hacia afuera.
 */
export interface DestinoPublicacion {
  clientId: string;
  storyblokSpaceId: string | null;
  perfil: Record<string, unknown> | null;
}

export interface ResultadoWorkflow {
  runId: string;
  estado: "publicado" | "rechazado" | "sin_respuesta" | "nada_que_publicar";
  paginasPublicadas: number;
}

/** Cuánto se espera al humano. Vencido el plazo NO se publica: se deja donde está. */
export const PLAZO_APROBACION = "7d";

/**
 * El workflow, disparado por `research/solicitado`.
 *
 * `entrada` lleva **solo coordenadas**, no autoridad: el run YA EXISTE, creado por la API bajo RLS
 * con la identidad del humano. Acá se carga de la base y se trabaja con lo que diga la FILA — nunca
 * con lo que diga el mensaje. Ver `events.ts`.
 */
export async function workflowResearch(
  paso: Pasos,
  entrada: EntradaResearch,
  deps: Deps,
): Promise<ResultadoWorkflow> {
  const log = deps.log ?? (() => {});
  const { runId } = entrada;
  const ctx: TenantContext = { tenantId: entrada.tenantId };

  /*
   * ---- 1. Cargar el run. NO crearlo. ---------------------------------------
   *
   * Este paso es la comprobación de autorización, y es la razón de que gaste cero.
   *
   * El evento ya no puede crear un run: si la fila no existe —porque el `runId` es inventado, o
   * porque el `tenantId` no cuadra y RLS no la deja ver— **abortamos antes de tocar DataForSEO**.
   * Antes, el evento traía tenant y cliente elegidos por quien lo emitía y el workflow los elevaba a
   * autoridad de servicio: bastaba conocer dos UUID ajenos para hacer que la agencia pagara el
   * research de otra.
   */
  const run = await paso.run("cargar-run", async () => {
    const r = await deps.store.getRun(ctx, runId);
    if (!r) {
      throw new Error(
        `El run ${runId} no existe para el tenant ${entrada.tenantId}. El evento NO crea runs: los ` +
          `crea la API, con la identidad del humano y bajo RLS. No se gasta nada.`,
      );
    }
    return r;
  });

  /*
   * ---- 2. El research — solo si el run TODAVÍA no lo hizo -------------------
   *
   * La memoización de steps de Inngest cubre los replays de UNA ejecución. No cubre una ejecución
   * NUEVA: su clave de idempotencia dura 24 h y la compuerta humana espera 7 DÍAS. Pasadas las 24 h,
   * un evento duplicado arrancaba una ejecución nueva con los steps en blanco → **volvía a pagar el
   * LLM y reescribía las páginas** sobre un run ya cerrado.
   *
   * La fase durable vive en la BASE, no en la memoria de Inngest: si el run ya no está `running`, el
   * research ya se hizo, y se reanuda desde la compuerta.
   */
  if (run.status === "running") {
    const brief = await paso.run("research", async () => {
      return deps.research({
        prompt: run.prompt,
        market: {
          country: run.market_country,
          language_code: run.market_language,
          location_code: run.market_location_code,
        },
        maxCostMicros: numeroDe(run.config?.["max_cost_micros"]),
        maxPages: numeroDe(run.config?.["max_pages"]),
        // Checkpoint: las keywords se guardan APENAS existen, dentro del mismo step. Si el paso
        // revienta después (clustering, LLM de contenido), lo que ya se le pagó a DataForSEO queda
        // en la base y en la cache — el reintento no lo vuelve a comprar.
        onKeywords: (keywords) => deps.store.saveKeywords(ctx, runId, run.client_id, keywords),
      });
    });

    await paso.run("guardar-paginas", async () => {
      await deps.store.savePages(ctx, runId, run.client_id, brief.paginas_propuestas);
      return brief.paginas_propuestas.length;
    });

    await paso.run("cerrar-run", async () => {
      await deps.store.finishRun(ctx, runId, {
        costeMicros: brief.meta_run.coste_micros_usd,
        costeBreakdown: brief.meta_run.coste_breakdown,
        calidadDatos: brief.meta_run.calidad_datos,
        modelosSinPrecio: brief.meta_run.modelos_sin_precio ?? [],
      });
      return "pending_approval";
    });
  } else {
    log(`[run ${runId}] el research ya estaba hecho (${run.status}) → no se vuelve a pagar`);
  }

  log(`[run ${runId}] esperando aprobación humana (hasta ${PLAZO_APROBACION})`);

  // ---- 4. La compuerta humana (ADR-06) -------------------------------------
  //
  // Acá el workflow se DUERME. No hay proceso esperando siete días: Inngest lo revive cuando llega
  // el evento. Es la razón principal por la que esto es un orquestador durable y no un script.
  const aprobacion = await paso.esperarEvento("esperar-aprobacion", {
    evento: "research/aprobado",
    timeout: PLAZO_APROBACION,
    runId,
  });

  if (!aprobacion) {
    // Venció el plazo. NO se publica: el silencio no es un "sí". El run se queda en
    // `pending_approval`, visible en el portal, y alguien lo retoma cuando quiera.
    log(`[run ${runId}] nadie aprobó en ${PLAZO_APROBACION} → no se publica nada`);
    return { runId, estado: "sin_respuesta", paginasPublicadas: 0 };
  }

  // ---- 5. Publicar ---------------------------------------------------------
  return paso.run("publicar", async () => {
    /*
     * LA BASE ES LA AUTORIDAD, NO EL EVENTO.
     *
     * El evento de aprobación solo DESPIERTA al workflow. Lo que se publica se vuelve a preguntar
     * bajo RLS, con el contexto del tenant que PIDIÓ el research (nunca el del evento), y a través
     * de `getPublishablePages`, que exige las DOS condiciones de la compuerta: el run aprobado Y la
     * página aprobada.
     *
     * Si el evento fuera la autoridad, cualquiera capaz de emitirlo publicaría contenido que ningún
     * humano miró — y, con el `runId` de otro tenant, contenido ajeno.
     */
    const paginas = await deps.store.getPublishablePages(ctx, runId);
    if (paginas.length === 0) {
      log(`[run ${runId}] llegó la aprobación pero la base no tiene NADA publicable → no publico`);
      return { runId, estado: "nada_que_publicar" as const, paginasPublicadas: 0 };
    }

    const actual = await deps.store.getRun(ctx, runId);
    if (!actual) throw new Error(`El run ${runId} no es visible para este tenant.`);

    /*
     * EL DESTINO SALE DE LA BASE, BAJO RLS. No de una variable de entorno.
     *
     * `clients.storyblok_space_id` existía desde el día uno y no lo leía nadie: se publicaba todo en
     * el space global del proceso, así que la `/menu` de un cliente PISABA la del otro. Leerlo acá,
     * bajo el contexto del tenant, es lo que impide que un tenant nombre el destino de otro.
     */
    const cliente = await deps.store.getClient(ctx, actual.client_id);
    if (!cliente) {
      throw new Error(
        `El cliente ${actual.client_id} del run ${runId} no es visible para este tenant. No se publica.`,
      );
    }

    // Reconstruir el brief DESDE LA BASE y volver a validarlo contra el contrato del M1 (ADR-06/07).
    // El M1 no confía en que el M2 le mande algo bien formado, y el orquestador tampoco.
    const briefValidado = deps.validarContrato(briefDesdeLaBase(actual, paginas));
    const resultados = await deps.publicar(briefValidado, {
      clientId: cliente.id,
      storyblokSpaceId: cliente.storyblok_space_id,
      perfil: cliente.business_profile,
    });

    /*
     * Solo se marca lo que el proveedor CONFIRMA publicado.
     *
     * El publisher mandaba las stories como **draft** (le faltaba `publish: 1`) y acá se escribía
     * `published_at` igual: el run terminaba en `publicado` con **nada publicado**. La base afirmaba
     * un hecho del mundo exterior que no había ocurrido — que es la peor clase de mentira, porque
     * nadie la va a comprobar.
     *
     * Registrarlo sigue siendo imprescindible al revés: Storyblok ya creó las stories y eso es
     * irreversible. Sin la marca, un fallo en el camino de vuelta dejaba el run en `failed` con las
     * páginas publicadas y visibles.
     */
    const publicadas = resultados.filter((p) => p.published);
    const enDraft = resultados.length - publicadas.length;

    if (publicadas.length > 0) {
      await deps.store.marcarPublicadas(
        ctx,
        runId,
        publicadas.map((p) => ({ slug: p.slug, storyId: p.location })),
      );
    }

    if (enDraft > 0) {
      log(
        `[run ${runId}] ⚠️ ${enDraft} página(s) NO quedaron publicadas (draft o dry-run). ` +
          `No se marcan como publicadas: la base no puede afirmar algo que el proveedor no confirma.`,
      );
    }

    log(`[run ${runId}] publicadas ${publicadas.length} de ${resultados.length} página(s)`);
    return { runId, estado: "publicado" as const, paginasPublicadas: publicadas.length };
  });
}

/** Lee un número de la config del run (que viene de jsonb, o sea `unknown`). */
function numeroDe(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/**
 * Arma el brief del contrato M2→M1 a partir de lo que hay EN LA BASE.
 *
 * Todas las páginas que salen de acá vienen de `getPublishablePages`, o sea que ya pasaron la
 * compuerta doble: por eso `approved: true` no es una suposición, es lo que dice el SQL.
 */
function briefDesdeLaBase(run: RunSummary, paginas: PageRow[]): unknown {
  return {
    schema_version: run.schema_version,
    run_id: run.id,
    cliente: run.client_id,
    generated_at: run.created_at,
    market: {
      country: run.market_country,
      language_code: run.market_language,
      location_code: run.market_location_code,
    },
    status: "approved",
    paginas_propuestas: paginas.map((p) => ({
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
      seo: p.seo,
      content_brief: p.content_brief,
      preguntas_frecuentes: p.preguntas_frecuentes,
      approved: true,
    })),
    backlog: [],
  };
}

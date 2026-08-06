import { renderReport } from "contrato";
import type { KeywordResearchBrief, ProposedPage } from "contrato";
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

/**
 * Lo que el pipeline del M2 devuelve: **el brief del contrato, entero.**
 *
 * Hasta KR-2b esto era un mirror RECORTADO (`schema_version`, las páginas ya en forma de fila de
 * Postgres, y un `meta_run` con cuatro campos), y el composition root traducía el brief del contrato a
 * ese recorte. El recorte tiraba `cliente`, `generated_at`, `market`, `backlog` y
 * `meta_run.keywords_analizadas` — exactamente los datos que el informe necesita y que el pipeline SÍ
 * conoce. Con el step `guardar-informe` acá, el recorte dejaba dos salidas y las dos malas: castear
 * (mentir en el tipo) o emitir un informe con huecos inventados.
 *
 * Así que el workflow habla el contrato, y la traducción a la forma de la base ocurre en el único sitio
 * que la necesita (`aFilaDePagina`, al fondo). Esto NO borra la frontera M2→M1: el brief que se
 * PUBLICA sigue reconstruyéndose desde la base y revalidándose con Zod (`briefDesdeLaBase` +
 * `validarContrato`), y `deps.publicar` sigue recibiendo `unknown`.
 */
export type BriefDelPipeline = KeywordResearchBrief;

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
      const filas = brief.paginas_propuestas.map(aFilaDePagina);
      await deps.store.savePages(ctx, runId, run.client_id, filas);
      return filas.length;
    });

    /*
     * ---- El informe, guardado ANTES de cerrar el run --------------------------
     *
     * Ese orden ES el invariante: **un run en `pending_approval` (o posterior) siempre tiene informe.**
     * Al revés existiría una ventana con el run ya en la compuerta y sin informe, y como los tres steps
     * tienen transacciones separadas no sería una ventana teórica. La pantalla del portal se apoya en
     * esto para poder decir que un run sin informe es uno anterior a la migración 0016 o uno que nunca
     * llegó a la compuerta — y NO un fallo silencioso de persistencia.
     *
     * El brief entero vive en la memoización de `paso.run("research")`, así que un reintento de ESTE
     * step lo tiene completo sin volver a pedirle nada a DataForSEO ni al LLM. Y `guardarInforme` es
     * idempotente (`on conflict (run_id) do update`), así que el reintento reescribe en vez de reventar
     * con 23505.
     *
     * Si el informe NO se puede guardar, el step falla y el run no llega a `pending_approval`: es la
     * decisión deliberada de fallar CERRADO. El caso realista es el tope de la columna
     * (`informe_tamano_razonable`), y el margen está MEDIDO: el informe de la demo —14 páginas, el brief
     * más grande que existe hoy— pesa **13.718 bytes (13,4 KiB)** contra los **262.144** del `check`, o
     * sea un factor de **19,1**. Medido el 2026-08-06 sembrando la demo contra PGlite y preguntando
     * `octet_length(informe_md)`, que es lo que la constraint evalúa; en caracteres son 13.416, **302
     * menos**, porque el informe va en español y con emoji — contar `.length` en JS habría subestimado.
     *
     * Con veinte veces de margen, lo que hace falta para tocar el tope no es un informe grande: es uno
     * ROTO. Tragarse ese error dejaría el run en la compuerta sin informe, que es justo la ventana que
     * este step existe para cerrar.
     *
     * Devuelve el TAMAÑO, no el Markdown: Inngest persiste el resultado de cada step, y devolver el
     * informe lo guardaría dos veces (en `kr_informes` y en la memoria del step). El número sirve de
     * rastro en el panel.
     */
    await paso.run("guardar-informe", async () => {
      const md = renderReport(brief);
      await deps.store.guardarInforme(ctx, runId, md);
      return md.length;
    });

    await paso.run("cerrar-run", async () => {
      await deps.store.finishRun(ctx, runId, {
        costeMicros: brief.meta_run.coste_micros_usd,
        costeBreakdown: brief.meta_run.coste_breakdown,
        // El spread NO es una copia defensiva: `DataQuality` es una `interface`, y una interface no
        // recibe index signature implícita, así que `tsc` la rechaza contra el `Record<string, unknown>`
        // que pide `finishRun` (medido con `tsc --noEmit`: "Index signature for type 'string' is missing
        // in type 'DataQuality'"). El objeto literal del spread sí la recibe. `coste_breakdown` no lo
        // necesita porque es un `Partial<CostBreakdown>` —un tipo mapeado—, y esos sí la reciben.
        calidadDatos: { ...brief.meta_run.calidad_datos },
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

/**
 * `ProposedPage` (el contrato) → `PageRow` (la forma que escribe `savePages`).
 *
 * Los dos tipos describen la misma página y NO son intercambiables, a propósito: `PageRow` es lo que
 * entra a Postgres (`tipo`, `intencion` y `evidencia` como `string`, `seo` y `content_brief` como
 * jsonb), y `approved` no viaja acá — lo escribe la compuerta cuando un humano mira, nunca el M2.
 *
 * El spread de `seo`/`content_brief` es obligatorio y no es una copia defensiva: `PageSeo` y
 * `ContentBrief` son `interface`, y `tsc` rechaza una interface contra un `Record<string, unknown>` por
 * falta de index signature (medido). El objeto literal del spread sí la recibe.
 *
 * Vivía inline en `deps.ts`. Se mueve acá porque acá es donde se usa y porque en el composition root
 * ningún test podía alcanzarla: `deps.ts` solo corre en producción.
 *
 * **Mudarla no la cubrió: lo que la cubre es un test, y hubo que escribirlo.** Con los 21 tests del
 * paquete en verde, una review midió que se podía borrar `page_strategy`, intercambiar
 * `volumen`↔`dificultad` o vaciar `preguntas_frecuentes` sin que cayera ninguno — y las tres mutaciones
 * son type-safe (`page_strategy` es opcional en `PageRow`, y los dos números son `number | null`), así
 * que `tsc` tampoco las ve. Quien fija los 16 campos, uno por uno y contra la fila **releída de la
 * base**, es el test "los 16 campos de la página llegan a la base sin cruzarse".
 */
function aFilaDePagina(p: ProposedPage): PageRow {
  return {
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
  };
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

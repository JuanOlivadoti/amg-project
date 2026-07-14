import { randomUUID } from "node:crypto";
import type { PgStore, TenantContext, PageRow, RunSummary } from "db";
import type { ActorContext } from "./events.js";

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
  /** Publica en el M1. Recibe el brief RECONSTRUIDO DESDE LA BASE, ya validado contra el contrato. */
  publicar: (brief: unknown) => Promise<Array<{ slug: string; location: string }>>;
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

export interface EntradaResearch {
  ctx: ActorContext;
  prompt: string;
  market?: { country: string; language_code: string; location_code: number } | undefined;
  maxCostMicros?: number | undefined;
  maxPages?: number | undefined;
}

export interface ResultadoWorkflow {
  runId: string;
  estado: "publicado" | "rechazado" | "sin_respuesta" | "nada_que_publicar";
  paginasPublicadas: number;
}

const MARKET_POR_DEFECTO = { country: "ES", language_code: "es", location_code: 2724 };

/** Cuánto se espera al humano. Vencido el plazo NO se publica: se deja donde está. */
export const PLAZO_APROBACION = "7d";

/**
 * El orquestador NO es `maestro`: es un proceso, no una persona.
 *
 * Su autoridad es una CREDENCIAL DE POSTGRES (se conecta como el rol `app_service`), no un campo en
 * el evento. Fijate en que ya no declara ningún rol — desde `0002_auth.sql` no hay dónde: los roles
 * humanos se derivan de `memberships` y el del servicio, de con qué credencial se conectó.
 */
function comoServicio(ctx: ActorContext): TenantContext {
  return { tenantId: ctx.tenantId, servicio: true };
}

export async function workflowResearch(
  paso: Pasos,
  entrada: EntradaResearch,
  deps: Deps,
  /** Generado FUERA de los steps: tiene que ser el mismo en cada replay (ver `runId` en NewRun). */
  runId: string,
): Promise<ResultadoWorkflow> {
  const log = deps.log ?? (() => {});
  const ctx = comoServicio(entrada.ctx);
  const market = entrada.market ?? MARKET_POR_DEFECTO;

  // ---- 1. Abrir el run ------------------------------------------------------
  await paso.run("crear-run", async () => {
    await deps.store.createRun(ctx, {
      runId,
      clientId: entrada.ctx.clientId,
      schemaVersion: "kr.v0.5",
      prompt: entrada.prompt,
      market,
      config: { max_cost_micros: entrada.maxCostMicros ?? null, max_pages: entrada.maxPages ?? null },
    });
    return runId;
  });

  // ---- 2. El research (el paso que cuesta dinero) ---------------------------
  const brief = await paso.run("research", async () => {
    return deps.research({
      prompt: entrada.prompt,
      market,
      maxCostMicros: entrada.maxCostMicros,
      maxPages: entrada.maxPages,
      // Checkpoint: las keywords se guardan APENAS existen, dentro del mismo step. Si el paso
      // revienta después (clustering, LLM de contenido), lo que ya se le pagó a DataForSEO queda
      // en la base y en la cache — el reintento no lo vuelve a comprar.
      onKeywords: (keywords) => deps.store.saveKeywords(ctx, runId, entrada.ctx.clientId, keywords),
    });
  });

  // ---- 3. Persistir las páginas y cerrar el run -----------------------------
  await paso.run("guardar-paginas", async () => {
    await deps.store.savePages(ctx, runId, entrada.ctx.clientId, brief.paginas_propuestas);
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

    const run = await deps.store.getRun(ctx, runId);
    if (!run) throw new Error(`El run ${runId} no es visible para este tenant.`);

    // Reconstruir el brief DESDE LA BASE y volver a validarlo contra el contrato del M1 (ADR-06/07).
    // El M1 no confía en que el M2 le mande algo bien formado, y el orquestador tampoco.
    const briefValidado = deps.validarContrato(briefDesdeLaBase(run, paginas));
    const publicadas = await deps.publicar(briefValidado);

    log(`[run ${runId}] publicadas ${publicadas.length} página(s)`);
    return { runId, estado: "publicado" as const, paginasPublicadas: publicadas.length };
  });
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

/** Id del run: se genera una vez, fuera de los steps, y viaja con el evento. */
export function nuevoRunId(): string {
  return randomUUID();
}

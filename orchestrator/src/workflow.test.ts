import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { renderReport } from "contrato";
import type { ProposedPage } from "contrato";
import { PgStore, PglitePool, aplicarMigraciones } from "db";
import type { DbPool, TenantContext } from "db";
import { workflowResearch, workflowDecision } from "./workflow.js";
import type { BriefDelPipeline, Deps, DestinoPublicacion, Pasos } from "./workflow.js";

/**
 * Tests del orquestador contra Postgres REAL (PGlite) y el `PgStore` REAL — solo se falsean el
 * pipeline (que cuesta dinero) y el publicador (que toca Storyblok).
 *
 * Es deliberado: lo que hay que probar acá no es que los steps se llamen en orden, sino que **el
 * evento de aprobación no pueda publicar nada que un humano no haya aprobado en la base**. Eso
 * depende de RLS y del SQL de la compuerta, así que un store mockeado probaría mis suposiciones en
 * vez de la realidad.
 */

const aqui = dirname(fileURLToPath(import.meta.url));

let pg: PGlite;
let pool: DbPool;
let store: PgStore;
/** El orquestador: rol app_service. En prod es OTRO login (amg_orquestador). */
let storeServicio: PgStore;
let tenantA: string;
let tenantB: string;
let clientA: string;
let clientB: string;
/** Humanos con membresía REAL: su rol lo deriva Postgres, ya no se declara (0002_auth.sql). */
let equipoA: string;
let equipoB: string;

// ---------------------------------------------------------------- dobles

/**
 * Motor de steps que MEMOIZA, como Inngest.
 *
 * No es un detalle de fidelidad: sin memoización, un reintento de step volvería a correr
 * `research`, que cuesta dinero, o `cerrar-run`, que devolvería el run a `pending_approval` en
 * medio de un replay. Un doble que ejecuta todo de nuevo haría pasar los tests de idempotencia POR
 * LA RAZÓN EQUIVOCADA.
 *
 * Se reusa la MISMA instancia entre pasadas: eso es exactamente un replay de step.
 */
class MotorPasos implements Pasos {
  private readonly memo = new Map<string, unknown>();
  readonly corridos: string[] = [];

  async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    if (this.memo.has(id)) return this.memo.get(id) as T;
    this.corridos.push(id);
    const out = await fn();
    this.memo.set(id, out);
    return out;
  }

  /**
   * Descarta el resultado memoizado de UN step, que es como se ve un reintento de step desde acá:
   * Inngest vuelve a ejecutar ese step entero y deja los anteriores memoizados (por eso el research, que
   * es el que cuesta dinero, no se vuelve a correr).
   */
  olvidar(id: string): void {
    if (!this.memo.delete(id)) throw new Error(`El step "${id}" nunca corrió: no hay nada que olvidar.`);
  }

  /**
   * `Pasos` todavía la declara, pero ni `workflowResearch` ni `workflowDecision` la llaman más: la
   * compuerta humana dejó de estar embebida en un `esperarEvento` (ver `docs/decisiones-arquitectura.md`,
   * este sub-proyecto) — ahora es una fila en `kr_run_decisiones` que un evento aparte dispara. Se deja
   * una implementación trivial solo para satisfacer el tipo; si algún workflow la llamara de verdad, este
   * error avisaría en el acto.
   */
  async esperarEvento(): Promise<{ data: unknown } | null> {
    throw new Error("esperarEvento: ningún workflow vigente lo usa (la compuerta ya no está embebida)");
  }
}

/**
 * El store del orquestador, REAL, que además anota el orden de sus tres escrituras.
 *
 * **No es un doble de prueba, y eso es el punto.** Hereda de `PgStore` y delega en `super`, así que
 * corre el mismo SQL, con el mismo rol (`app_service`) y las mismas políticas — la razón está en el
 * comentario de la cabecera del archivo: un store mockeado probaría mis suposiciones sobre RLS en vez de
 * la realidad. Lo único que agrega es la observación del ORDEN, que el resultado final no puede dar: los
 * tres steps commitean en transacciones separadas, así que "al terminar hay informe" no dice nada sobre
 * si lo había cuando el run pasó a `pending_approval`, que es lo que el invariante afirma.
 *
 * Cada anotación va DESPUÉS del `await`: lo que se está fijando es qué quedó COMMITEADO antes de qué, no
 * en qué orden se llamó al store.
 */
class StoreQueAnota extends PgStore {
  readonly orden: string[] = [];
  readonly informes: Array<{ runId: string; md: string }> = [];

  constructor(p: DbPool) {
    super(p, "app_service");
  }

  override async savePages(...args: Parameters<PgStore["savePages"]>): Promise<void> {
    await super.savePages(...args);
    this.orden.push("guardar-paginas");
  }

  override async guardarInforme(ctx: TenantContext, runId: string, md: string): Promise<void> {
    await super.guardarInforme(ctx, runId, md);
    this.orden.push("guardar-informe");
    this.informes.push({ runId, md });
  }

  // Devuelve lo que devuelve el real: si el doble se tragara el booleano, el workflow vería `undefined`
  // —falsy— y este espía haría creer que `cerrar-run` nunca mueve el estado.
  override async finishRun(...args: Parameters<PgStore["finishRun"]>): Promise<boolean> {
    const movio = await super.finishRun(...args);
    this.orden.push("cerrar-run");
    return movio;
  }
}

/**
 * Una página tal como la EMITE el M2 (`ProposedPage`, del contrato), no como la guarda Postgres.
 *
 * Era `PageRow` hasta KR-2b, y eso hacía del fixture algo que el pipeline nunca produce: `PageRow` es la
 * forma de la FILA (`tipo`/`intencion`/`evidencia` como `string` suelto, `seo` como jsonb). Con la forma
 * del contrato, el fixture pasa por la misma conversión que la de producción (`aFilaDePagina`) y
 * `renderReport` puede leerlo sin un cast.
 */
const paginaFalsa = (over: Partial<ProposedPage> = {}): ProposedPage => ({
  cluster_id: randomUUID(),
  tipo: "landing_local",
  // La estrategia la calcula el M2 y la capa de datos la TIRABA (ver `PageRow.page_strategy`).
  page_strategy: "single",
  url_slug: "/pizza-napolitana-madrid",
  keyword_principal: "pizza napolitana madrid",
  keywords_secundarias: ["pizza napolitana"],
  intencion: "local",
  local: true,
  volumen: 390,
  dificultad: 15,
  evidencia: "datos_mercado",
  opportunity_score: 84,
  score_confidence: 1,
  seo: {
    meta_title: "Pizza napolitana en Madrid",
    meta_description: "La mejor pizza napolitana del centro de Madrid.",
    schema_type: "LocalBusiness",
    canonical: "/pizza-napolitana-madrid",
  },
  content_brief: {
    h1: "Pizza napolitana en Madrid",
    secciones_sugeridas: ["Nuestra masa", "Dónde estamos"],
    word_count_objetivo: 800,
    enlazado_interno: [],
  },
  preguntas_frecuentes: ["¿Hacen reservas?"],
  // El M2 emite todo SIN aprobar: la aprobación la escribe la compuerta cuando un humano mira.
  approved: false,
  ...over,
});

/**
 * El brief del contrato tal como lo devuelve el pipeline. **Determinista a partir de `paginas`**, y eso
 * es una precondición del test del informe: compara el Markdown guardado con `renderReport(briefFalso(
 * paginas))` por igualdad exacta, así que ni la fecha ni el nombre del cliente pueden moverse.
 *
 * `run_id`, `cliente` y `generated_at` los pone el M2 (`assembleBrief`), no el evento: el pipeline los
 * deriva del prompt y del reloj. Acá van fijos.
 */
const briefFalso = (paginas: ProposedPage[]): BriefDelPipeline => ({
  schema_version: "kr.v0.5",
  run_id: "9c1f3d2a-0000-4000-8000-000000000001",
  cliente: "Restaurante italiano en Madrid centro",
  generated_at: "2026-08-05T08:16:15.000Z",
  market: { country: "ES", language_code: "es", location_code: 2724 },
  status: "pending_approval",
  paginas_propuestas: paginas,
  backlog: [],
  meta_run: {
    keywords_analizadas: 55,
    paginas_propuestas: paginas.length,
    coste_micros_usd: 310_800,
    // Desglose INCOMPLETO a propósito (falta el LLM): el informe muestra el total y dice que el reparto
    // no quedó registrado, en vez de pintar una tabla de `$NaN`. Es el camino endurecido en KR-2a.
    coste_breakdown: { dataforseo_micros: 252_200 },
    calidad_datos: { cobertura_volumen: 0.71, cobertura_kd: 0.31, endpoints_degradados: [] },
    modelos_sin_precio: [],
  },
});

interface Espia {
  deps: Deps;
  /** El store REAL del orquestador (`app_service`), que además anota el orden de sus escrituras. */
  store: StoreQueAnota;
  publicadas: string[][];
  researchCorrido: number;
  keywordsGuardadas: number;
  /** A DÓNDE se publicó cada vez. Es lo que prueba que un cliente no escribe en el space de otro. */
  destinos: DestinoPublicacion[];
  /** Si es `true`, el publisher devuelve `published: false` (draft): nada quedó publicado de verdad. */
  simularDraft: boolean;
}

function depsFalsas(paginas: ProposedPage[]): Espia {
  const espia: Espia = {
    store: new StoreQueAnota(pool),
    publicadas: [],
    researchCorrido: 0,
    keywordsGuardadas: 0,
    destinos: [],
    simularDraft: false,
    deps: undefined as never,
  };

  espia.deps = {
    store: espia.store,
    research: async ({ onKeywords }) => {
      espia.researchCorrido++;
      await onKeywords([
        {
          keyword: "pizza napolitana madrid",
          canonical_key: "pizza napolitana madrid",
          source: "seed",
          volume: 390,
          difficulty: 15,
          intent: "local",
          is_local: true,
          business_relevance: 0.9,
          opportunity_score: 84,
          score_confidence: 1,
          discarded: false,
        },
      ]);
      espia.keywordsGuardadas++;
      return briefFalso(paginas);
    },
    // No se valida de verdad acá: el contrato ya tiene sus propios tests en web-builder.
    validarContrato: (raw) => raw,
    publicar: async (brief, destino) => {
      const b = brief as { paginas_propuestas: Array<{ url_slug: string }> };
      const slugs = b.paginas_propuestas.map((p) => p.url_slug);
      espia.publicadas.push(slugs);
      espia.destinos.push(destino);
      return slugs.map((s) => ({
        slug: s,
        location: `story-${s}`,
        // El publisher real puede dejar la story en DRAFT. Si eso pasa, la base NO puede decir
        // que está publicada.
        published: !espia.simularDraft,
      }));
    },
    // `workflowResearch`/`workflowDecision` no tocan el polling de reseñas -- eso vive en
    // `pollearResenas` (`functions.test.ts`). El stub existe solo para satisfacer el tipo `Deps`.
    resenasProvider: {
      refrescarToken: () => Promise.reject(new Error("workflowResearch no pollea reseñas")),
      listarResenas: () => Promise.reject(new Error("workflowResearch no pollea reseñas")),
      publicarRespuesta: () => Promise.reject(new Error("workflowResearch no publica respuestas")),
    },
    // Mismo motivo que `resenasProvider`: no generan borradores de IA -- eso también vive en
    // `pollearResenas`. El stub existe solo para satisfacer el tipo `Deps`.
    borradorProvider: {
      generar: () => Promise.reject(new Error("workflowResearch no genera borradores")),
    },
    // Mismo motivo: no mandan alertas de Telegram -- eso vive en
    // `pollearResenas`/`vincularTelegramPendientes` (`functions.test.ts`).
    telegramProvider: {
      obtenerActualizaciones: () => Promise.reject(new Error("workflowResearch no pollea Telegram")),
      enviarMensaje: () => Promise.reject(new Error("workflowResearch no manda alertas de Telegram")),
    },
  };

  return espia;
}

/** El evento: SOLO coordenadas. Ni prompt, ni cliente, ni topes — eso vive en la fila del run. */
const entrada = (runId: string, tenantId: string) => ({ runId, tenantId });

/**
 * Crea el run como lo hace la API: **bajo RLS, con la identidad del humano, y marcando la emisión**.
 *
 * Es donde ocurre la autorización. Si esa persona no tiene membresía en el tenant, Postgres rechaza
 * el insert y no se emite ningún evento — o sea que el orquestador nunca llega a gastar.
 *
 * **La marca no es decorado del fixture** (C0, migración `0019`): `solicitarResearch` la escribe
 * después de que `send()` tenga éxito, y el paso a `pending_approval` la exige. Sin ella estos tests
 * estarían ejercitando un run que en producción **no se puede decidir** — un run insertado directo en
 * la base, sin nadie esperando su research—, y el workflow que despierta con `research/solicitado` no
 * existiría. El orden acá reproduce el de la API: fila → (evento) → marca.
 */
async function crearRunComoHumano(tenantId: string, clientId: string, userId: string): Promise<string> {
  const runId = randomUUID();
  const ctx = { tenantId, userId };
  await store.createRun(ctx, {
    runId,
    clientId,
    schemaVersion: "kr.v0.5",
    prompt: "Restaurante italiano en Madrid centro",
    market: { country: "ES", language_code: "es", location_code: 2724 },
  });
  await store.marcarSolicitudEmitida(ctx, runId);
  return runId;
}

/** El humano del portal (equipo), no el orquestador. Es quien tiene permiso de aprobar/decidir. */
const humano = (tenantId: string): TenantContext => ({ tenantId, userId: tenantId === tenantA ? equipoA : equipoB });

/**
 * Corre el research (deja el run en `pending_approval`, con UNA página) y aprueba esa página — lista
 * para que un test la lleve a `registrarDecision`. Reemplaza lo que antes hacía `runConWorkflow` +
 * `approvePage` + `approveRun`: ya no hace falta aprobar el RUN, `registrarDecision` promueve el
 * estado por sí mismo (Task 3/6).
 *
 * El research corre con un espía DESCARTABLE: lo único que le importa a este helper es que la página
 * quede en la base con el `url_slug` pedido, no lo que ese espía observe.
 */
async function crearRunConPaginaAprobada(
  tenantId: string,
  clientId: string,
  userId: string,
  opts: { urlSlug?: string } = {},
): Promise<string> {
  const runId = await crearRunComoHumano(tenantId, clientId, userId);
  const espiaSetup = depsFalsas([paginaFalsa(opts.urlSlug !== undefined ? { url_slug: opts.urlSlug } : {})]);
  await workflowResearch(new MotorPasos(), entrada(runId, tenantId), espiaSetup.deps);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage({ tenantId, userId }, rows[0]!.id);
  return runId;
}

// ---------------------------------------------------------------- setup

before(async () => {
  pg = new PGlite();
  await aplicarMigraciones(pg);
  pool = new PglitePool(pg);
  store = new PgStore(pool); // los humanos: app_user
  storeServicio = new PgStore(pool, "app_service"); // el orquestador
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("delete from kr_runs; delete from memberships; delete from clients; delete from tenants;");
  const { rows: t } = await pg.query<{ id: string }>(
    "insert into tenants (nombre, slug) values ('A', 'a'), ('B', 'b') returning id",
  );
  tenantA = t[0]!.id;
  tenantB = t[1]!.id;

  // CADA CLIENTE, SU PROPIO SPACE DE STORYBLOK (ADR-04). Es el dato que antes no leía nadie: se
  // publicaba todo en el space global del proceso y la `/menu` de uno pisaba la del otro.
  const mk = async (tid: string, n: string, space: string) => {
    const { rows } = await pg.query<{ id: string }>(
      "insert into clients (tenant_id, nombre, storyblok_space_id) values ($1, $2, $3) returning id",
      [tid, n, space],
    );
    return rows[0]!.id;
  };
  clientA = await mk(tenantA, "Trattoria", "space-A");
  clientB = await mk(tenantB, "Sushi Zen", "space-B");

  const mkMiembro = async (tid: string) => {
    const { rows } = await pg.query<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol) values ($1, gen_random_uuid(), 'equipo')
       returning user_id`,
      [tid],
    );
    return rows[0]!.user_id;
  };
  equipoA = await mkMiembro(tenantA);
  equipoB = await mkMiembro(tenantB);
});

// ================================================================
// workflowResearch: research → informe → pending_approval
// ================================================================

test("el run queda en pending_approval tras el research, sin publicar nada (workflowResearch ya no publica)", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const resultado = await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps);

  assert.equal(resultado.estado, "pending_approval");
  const run = await store.getRun(humano(tenantA), runId);
  assert.equal(run?.status, "pending_approval");
});

// ================================================================
// La conversión de la página al escribir en la base
// ================================================================

/**
 * Los 16 campos que `aFilaDePagina` traduce, fijados contra la fila **realmente persistida**.
 *
 * Este test existe porque una review midió que no existía. Al mover la conversión
 * `ProposedPage`→`PageRow` de `deps.ts` a `workflow.ts` afirmé que "pasa a estar cubierta por tests", y
 * era falso: con los 21 tests en verde se podía borrar `page_strategy`, intercambiar
 * `volumen`↔`dificultad` o vaciar `preguntas_frecuentes` **sin que cayera nada**. El único campo que
 * mordía era `url_slug`, y por dos tests de publicación que ya existían. Una conversión de 16 campos
 * que ningún test fija es exactamente lo que se rompe en silencio en el cambio siguiente.
 *
 * Se compara lo RELEÍDO de la base (`getRunPages`), no el objeto que produce la conversión: comparar el
 * intermedio contra sí mismo no prueba nada. Y el lado esperado nombra campo por campo de dónde sale
 * cada valor — si dijera `aFilaDePagina(pagina)` estaría comparando la conversión consigo misma, que es
 * el mismo error una capa más arriba.
 */
test("los 16 campos de la página llegan a la base sin cruzarse (`aFilaDePagina`)", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  /*
   * El slug se cambia a propósito para que NO coincida con `seo.canonical`, que en el fixture son
   * iguales: si coincidieran, una conversión que leyera `p.seo.canonical` en vez de `p.url_slug` pasaría
   * este test. Por el mismo motivo importa que los pares que se podrían confundir lleven valores
   * distintos en el fixture (`volumen` 390 / `dificultad` 15, `opportunity_score` 84 /
   * `score_confidence` 1): si fueran iguales, intercambiarlos no se vería.
   */
  /*
   * `approved: true` es deliberado, y es lo que hace que la aserción de más abajo valga algo. Con el
   * `false` del fixture, comprobar que la fila queda en `false` pasaba por COINCIDENCIA: el valor que
   * entraba y el que la base escribe eran el mismo. Entrando en `true` —un brief que llega
   * pre-aprobado, que es lo que un M2 con un bug produciría— la única forma de que la fila salga en
   * `false` es que nada lo propague.
   */
  const pagina = paginaFalsa({ url_slug: "/pizza-napolitana-en-el-centro", approved: true });
  const espia = depsFalsas([pagina]);

  await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps);

  const filas = await store.getRunPages(humano(tenantA), runId);
  assert.equal(filas.length, 1);

  /*
   * Los tres campos que `PaginaPropuesta` agrega salen del `deepEqual`, y **cada uno por un motivo
   * distinto**. No es una exclusión silenciosa: los tres se comprueban abajo, uno por uno.
   *
   *  · `id` y `orden_brief` **no existen en `ProposedPage`** (medido: tiene 17 campos y ninguno es
   *    esos). El `id` lo pone el default de la columna —`savePages` no lo lista en el insert— y el
   *    `orden_brief` lo deriva `savePages` del índice del array (`i` en el parámetro 20). No hay nada
   *    del M2 contra lo que compararlos.
   *
   *  · `approved` es otro caso, y el motivo que había escrito acá era FALSO. Decía que no viaja en el
   *    brief, y **sí viaja**: `ProposedPage` lo declara, los DOS validadores del contrato lo exigen
   *    (`contrato/src/esquema.ts:129` y `:281`) y el M2 lo emite siempre en `false`. Lo que pasa es
   *    otra cosa: `PageRow` no lleva el campo —así que la conversión no PUEDE propagarlo, lo impide el
   *    tipo— y `savePages` lo escribe con un `false` literal en el `values`. O sea que la fila no es
   *    función del valor que entró, y compararla contra `pagina.approved` afirmaría que se propaga:
   *    exactamente lo contrario de la garantía. Por eso va aparte y en su propia aserción.
   */
  const { id, approved, orden_brief, ...persistida } = filas[0]!;

  assert.deepEqual(persistida, {
    cluster_id: pagina.cluster_id,
    tipo: pagina.tipo,
    page_strategy: pagina.page_strategy,
    url_slug: pagina.url_slug,
    keyword_principal: pagina.keyword_principal,
    keywords_secundarias: pagina.keywords_secundarias,
    intencion: pagina.intencion,
    local: pagina.local,
    volumen: pagina.volumen,
    dificultad: pagina.dificultad,
    evidencia: pagina.evidencia,
    // `opportunity_score` y `score_confidence` son `numeric` en Postgres, o sea `string` al leerlos. Lo
    // que los devuelve como número es el `::float8` de `getRunPages`, no la conversión de acá: por eso
    // se comparan con `===` a un número y no hace falta tolerancia (84 y 1 son exactos en float).
    opportunity_score: pagina.opportunity_score,
    score_confidence: pagina.score_confidence,
    // Van por jsonb: vuelven como objeto, y `deepEqual` no mira el orden de las claves (jsonb no lo
    // conserva). Lo que sí se compara es el contenido entero, campo por campo, sin recortes.
    seo: { ...pagina.seo },
    content_brief: { ...pagina.content_brief },
    preguntas_frecuentes: pagina.preguntas_frecuentes,
  });

  assert.match(id, /^[0-9a-f-]{36}$/, "el `id` lo pone el default de la columna: no existe en ProposedPage");
  assert.equal(
    approved,
    false,
    "el brief llegó con approved: true y la fila quedó en false — la aprobación NO se propaga desde el " +
      "M2: la escribe la compuerta cuando un humano mira",
  );
  assert.equal(orden_brief, 0, "el orden lo deriva `savePages` del índice del array (KR-3, migración 0015)");
});

// ================================================================
// El informe del research (KR-2b)
// ================================================================

/**
 * El invariante de la spec §5.3: **un run en `pending_approval` (o posterior) SIEMPRE tiene informe.**
 *
 * Es el que hace que el mensaje de la pantalla no sea ambiguo: un run sin informe es uno anterior a la
 * migración 0016 o uno que nunca llegó a la compuerta, NO un fallo silencioso de persistencia.
 *
 * El ORDEN es lo que este test fija, y hay que fijarlo aparte porque el estado final no lo revela: si
 * `guardar-informe` fuera DESPUÉS de `cerrar-run`, al terminar habría igualmente informe y run en
 * `pending_approval` — y sin embargo existiría una ventana con el run ya en la compuerta y sin informe.
 * Como los tres steps commitean en transacciones separadas (y entre dos steps Inngest puede reintentar,
 * fallar o simplemente tardar), esa ventana no es teórica: es el intervalo en el que la pantalla de un
 * humano que refresca lee un run aprobable sin informe.
 */
test("🔴 un run que llega a `pending_approval` SIEMPRE tiene informe", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  // Las páginas se guardan en una `const` porque `paginaFalsa()` lleva un `cluster_id` aleatorio: el
  // informe esperado se renderiza a partir de ESTAS, o la comparación exacta de más abajo no cerraría.
  const paginas = [paginaFalsa()];
  const espia = depsFalsas(paginas);

  await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps);

  assert.deepEqual(
    espia.store.orden,
    ["guardar-paginas", "guardar-informe", "cerrar-run"],
    "el informe se guarda ANTES de cerrar el run, o el invariante tiene una ventana",
  );
  assert.equal(espia.store.informes.length, 1, "se guardó exactamente un informe");
  assert.equal(espia.store.informes[0]!.runId, runId, "el informe se guardó contra SU run");

  /*
   * Y lo guardado es el informe de ESTE brief. La igualdad exacta contra `renderReport` es a propósito:
   * con solo comprobar que empieza por `# Keyword Research` pasaría igual el informe de otro run, o el
   * de un brief recortado — y el recorte es exactamente lo que este cambio tuvo que deshacer para que el
   * informe no saliera sin cliente, sin fecha y con las keywords analizadas inventadas.
   */
  const md = espia.store.informes[0]!.md;
  assert.match(md, /^# Keyword Research/, "es el Markdown de renderReport, no otra cosa");
  assert.equal(md, renderReport(briefFalso(paginas), { audiencia: "agencia" }), "es el informe de ESTE brief, no de otro");

  // Y no solo se pidió: quedó en la base, y lo lee el staff con `app_user` — el camino del endpoint.
  const fila = await store.getInforme(humano(tenantA), runId);
  assert.equal(fila?.informe_md, md, "el informe quedó persistido, no solo renderizado");

  // El run está en la compuerta, o sea que el informe ya existía cuando llegó a ella.
  const run = await store.getRun(humano(tenantA), runId);
  assert.equal(run?.status, "pending_approval");
});

/**
 * El reintento del step **no vuelve a pagar y no revienta**. Las dos mitades:
 *
 *  · el brief entero vive en la memoización de `paso.run("research")`, así que el segundo intento lo
 *    tiene completo sin pedirle nada a DataForSEO ni al LLM (`researchCorrido` sigue en 1);
 *  · `guardarInforme` es idempotente (`on conflict (run_id) do update`), así que reescribe en vez de
 *    fallar con 23505.
 *
 * Se simula como Inngest reintenta un step: se descarta el resultado memoizado de ESE step y se vuelve a
 * correr el workflow con el mismo motor. Como `cargar-run` y `research` siguen memoizados, el segundo
 * paso NO vuelve a leer la fila (que ya cambió a `pending_approval`) ni a pagar el research — solo
 * re-ejecuta `guardar-informe`, que es lo que se olvidó.
 */
test("un reintento de `guardar-informe` reescribe y no vuelve a pagar el research", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const paginas = [paginaFalsa()];
  const espia = depsFalsas(paginas);

  const motor = new MotorPasos();
  await workflowResearch(motor, entrada(runId, tenantA), espia.deps);
  const primero = await store.getInforme(humano(tenantA), runId);

  motor.olvidar("guardar-informe");
  await workflowResearch(motor, entrada(runId, tenantA), espia.deps);

  assert.equal(espia.researchCorrido, 1, "el reintento NO volvió a correr el research (ni a pagarlo)");
  assert.equal(espia.store.informes.length, 2, "el step corrió dos veces");
  const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from kr_informes where run_id = $1", [
    runId,
  ]);
  assert.equal(rows[0]!.n, 1, "y dejó UNA fila: el segundo intento reescribió, no duplicó ni reventó");

  const segundo = await store.getInforme(humano(tenantA), runId);
  assert.equal(segundo?.informe_md, primero?.informe_md, "el mismo brief da el mismo informe");
});

// ================================================================
// El evento es un DISPARADOR, no una autoridad (workflowResearch)
// ================================================================

/**
 * 🔴 EL EVENTO NO PUEDE HACER GASTAR. Es la crítica #2 de la 4ª review.
 *
 * Antes el evento traía `tenantId` y `clientId` elegidos por quien lo emitía, y el workflow los
 * elevaba a autoridad de servicio: conocer dos UUID ajenos bastaba para que la agencia PAGARA el
 * research de otra. Ahora el run tiene que existir —creado por un humano autorizado, bajo RLS— o el
 * workflow aborta sin tocar DataForSEO.
 */
test("🔴 un evento con un runId INVENTADO no gasta un centavo", async () => {
  const espia = depsFalsas([paginaFalsa()]);

  await assert.rejects(
    () => workflowResearch(new MotorPasos(), entrada(randomUUID(), tenantA), espia.deps),
    /no existe para el tenant/i,
  );

  assert.equal(espia.researchCorrido, 0, "el research NO se ejecutó: cero gasto");
});

/** El tenant del evento no es una autoridad: si no cuadra con el run, RLS no lo deja ver. */
test("🔴 un evento con el runId de OTRO tenant no gasta un centavo", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);

  // El tenant B intenta poner en marcha el run del tenant A.
  await assert.rejects(
    () => workflowResearch(new MotorPasos(), entrada(runId, tenantB), espia.deps),
    /no existe para el tenant/i,
  );

  assert.equal(espia.researchCorrido, 0);
});

/**
 * 🔴 La idempotencia de Inngest dura 24 h; la compuerta (hoy: la decisión pendiente) puede esperar
 * mucho más. Pasadas las 24 h, un evento duplicado arranca una ejecución NUEVA con los steps en
 * blanco. Sin esta comprobación, volvía a pagar el LLM y reescribía las páginas sobre un run ya
 * cerrado.
 *
 * La fase durable vive en la BASE, no en la memoria de Inngest.
 */
test("🔴 un evento duplicado (motor NUEVO) no vuelve a hacer el research", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);

  await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps);
  assert.equal(espia.researchCorrido, 1);

  // 25 h después: Inngest ya no deduplica y llega el mismo evento. Motor NUEVO, steps en blanco.
  const espia2 = depsFalsas([paginaFalsa()]);
  const motor2 = new MotorPasos();
  const resultado2 = await workflowResearch(motor2, entrada(runId, tenantA), espia2.deps);

  assert.equal(
    resultado2.estado,
    "sin_cambio",
    "el run ya no está 'running': el evento duplicado no vuelve a hacer nada",
  );
  assert.equal(espia2.researchCorrido, 0, "el run ya no está 'running': NO se vuelve a pagar");
  const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from kr_runs");
  assert.equal(rows[0]!.n, 1);
});

/**
 * El checkpoint del dataset: las keywords se guardan DENTRO del step de research, apenas existen.
 * Si el paso revienta después (clustering, LLM de contenido), lo que ya se le pagó a DataForSEO
 * queda en la base en vez de perderse.
 */
test("las keywords pagas se persisten aunque el research reviente DESPUÉS", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);

  espia.deps.research = async ({ onKeywords }) => {
    await onKeywords([
      {
        keyword: "pizza napolitana madrid",
        canonical_key: "pizza napolitana madrid",
        source: "seed",
        volume: 390,
        difficulty: 15,
        intent: "local",
        is_local: true,
        business_relevance: 0.9,
        opportunity_score: 84,
        score_confidence: 1,
        discarded: false,
      },
    ]);
    throw new Error("el LLM de contenido se cayó DESPUÉS de pagarle a DataForSEO");
  };

  await assert.rejects(() =>
    workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps),
  );

  const { rows } = await pg.query<{ n: number }>(
    "select count(*)::int as n from kr_keywords where run_id = $1",
    [runId],
  );
  assert.equal(rows[0]!.n, 1, "lo que costó dinero quedó guardado");
});

// ================================================================
// workflowDecision: la decisión NO es una autoridad prestada por el evento
// ================================================================

/**
 * El escenario que importa: alguien consigue emitir `research/aprobado` (un webhook mal protegido,
 * un bug, un job vecino) con un `decisionId` que no existe. Si el evento fuera la autoridad, se
 * publicaría contenido que NADIE decidió.
 *
 * En la arquitectura nueva no hay camino donde `research/aprobado` se emita sin que
 * `registrarDecision` haya calificado antes — la API los ata (Task 10). El equivalente real de "el
 * evento no es autoridad" es un `decisionId` FALSO/inventado.
 */
test("🔴 workflowDecision con un decisionId INVENTADO no publica nada", async () => {
  const espia = depsFalsas([]);

  await assert.rejects(
    () => workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: randomUUID() }, espia.deps),
    /no existe/i,
  );

  assert.equal(espia.publicadas.length, 0);
});

/**
 * Un tenant no puede leer —ni publicar— la decisión de otro. `workflowDecision` opera SIEMPRE con el
 * `tenantId` del evento: un evento forjado con el `decisionId` ajeno se encuentra con que RLS no le
 * devuelve nada.
 */
test("🔴 el tenant B no puede leer ni publicar una decisión creada por el tenant A", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);
  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  const espia = depsFalsas([]);
  await assert.rejects(
    () => workflowDecision(new MotorPasos(), { tenantId: tenantB, decisionId: decisionId! }, espia.deps),
    /no existe/i,
    "RLS: la fila de A es invisible bajo el contexto de B",
  );
  assert.equal(espia.publicadas.length, 0);
});

// ================================================================
// workflowDecision: publicar
// ================================================================

test("workflowDecision: aprobado con destino crear_web → se publica", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);
  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  assert.equal(resultado.resultado, "completado");
  assert.equal(resultado.destino, "crear_web");
  assert.equal(resultado.paginasPublicadas, 1);
  assert.deepEqual(espia.publicadas[0], ["/pizza-napolitana-madrid"]);
});

test("workflowDecision: solo se publican las páginas que el humano aprobó, no todas las del run", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espiaSetup = depsFalsas([
    paginaFalsa(),
    paginaFalsa({ url_slug: "/menu-del-dia", keyword_principal: "menú del día", evidencia: "sin_validar" }),
  ]);
  await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espiaSetup.deps);

  // Aprueba SOLO la respaldada por datos. La `sin_validar` se queda fuera.
  const { rows } = await pg.query<{ id: string }>(
    "select id from kr_pages where run_id = $1 and url_slug = '/pizza-napolitana-madrid'",
    [runId],
  );
  await store.approvePage(humano(tenantA), rows[0]!.id);

  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  assert.equal(resultado.resultado, "completado");
  assert.deepEqual(espia.publicadas[0], ["/pizza-napolitana-madrid"], "la página sin validar NO se publica");
});

/**
 * EL TEST QUE FALTABA. Es el que cae si alguien vuelve a publicar en un space global.
 *
 * `clients.storyblok_space_id` existía desde el día uno y NO LO LEÍA NADIE: todo se publicaba en el
 * `STORYBLOK_SPACE_ID` del proceso. Y como los slugs de un restaurante son siempre los mismos
 * (`/menu`, `/contacto`…), la página del cliente A **sobrescribía la del cliente B**.
 *
 * El aislamiento entre tenants era impecable DENTRO de Postgres y se perdía al salir por la puerta.
 */
test("🔴 cada cliente publica en SU space: dos tenants, el mismo slug, y no se pisan", async () => {
  // La MISMA página, con el MISMO slug, para los dos clientes. Es el caso real: `/menu` lo tienen
  // todos los restaurantes.
  const runA = await crearRunConPaginaAprobada(tenantA, clientA, equipoA, { urlSlug: "/menu" });
  const runB = await crearRunConPaginaAprobada(tenantB, clientB, equipoB, { urlSlug: "/menu" });

  const decisionA = await store.registrarDecision(humano(tenantA), runA, "crear_web");
  const decisionB = await store.registrarDecision(humano(tenantB), runB, "crear_web");
  assert.ok(decisionA);
  assert.ok(decisionB);

  const espiaA = depsFalsas([]);
  const espiaB = depsFalsas([]);
  await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionA! }, espiaA.deps);
  await workflowDecision(new MotorPasos(), { tenantId: tenantB, decisionId: decisionB! }, espiaB.deps);

  assert.equal(espiaA.destinos[0]?.storyblokSpaceId, "space-A");
  assert.equal(espiaB.destinos[0]?.storyblokSpaceId, "space-B");
  assert.notEqual(
    espiaA.destinos[0]?.storyblokSpaceId,
    espiaB.destinos[0]?.storyblokSpaceId,
    "dos clientes distintos NO pueden publicar en el mismo space: el segundo pisaría al primero",
  );
  assert.equal(espiaA.destinos[0]?.clientId, clientA);
  assert.equal(espiaB.destinos[0]?.clientId, clientB);
});

/**
 * El publisher mandaba las stories como DRAFT (le faltaba `publish: 1`) y la base escribía
 * `published_at` igual: el run terminaba en `publicado` con NADA publicado.
 *
 * La base afirmaba un hecho del mundo exterior que no había ocurrido — la peor clase de mentira,
 * porque nadie la va a comprobar.
 */
test("🔴 si la story queda en DRAFT, la base NO dice que está publicada", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);
  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  const espia = depsFalsas([]);
  espia.simularDraft = true; // el proveedor NO confirma la publicación

  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  assert.equal(resultado.paginasPublicadas, 0, "nada quedó publicado: el proveedor no lo confirmó");

  const { rows } = await pg.query<{ n: number }>(
    "select count(*)::int as n from kr_pages where run_id = $1 and published_at is not null",
    [runId],
  );
  assert.equal(rows[0]!.n, 0, "published_at NO se escribe para una story que quedó en draft");
});

// ================================================================
// La compuerta EDITA, no solo aprueba (ADR-06)
// ================================================================

/**
 * ADR-06 siempre dijo que el humano "revisa y EDITA". Lo de editar no existía: solo aprobar o
 * rechazar. Si una página estaba casi bien, la única salida era tirarla y volver a pagar.
 *
 * Y editar REVOCA la aprobación: la compuerta certifica que un humano miró ESTO. Si `esto` cambió
 * después de que lo mirara, la certificación no vale nada. Con `workflowDecision`, ese caso ya no
 * cierra en `"nada_que_publicar"` (`ResultadoDecision` no tiene ese valor) — colapsa en
 * `resultado: "error"`, como defensa en profundidad: `registrarDecision` ya exige una página
 * aprobada para calificar, así que en el camino normal esto no debería pasar; solo pasa si la edición
 * ocurre DESPUÉS de que la decisión ya calificó.
 */
test("🔴 editar una página aprobada REVOCA su aprobación — workflowDecision cierra en error, no publica", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA, { urlSlug: "/pizza" });
  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.editPage(humano(tenantA), rows[0]!.id, { url_slug: "/pizza-napolitana" });

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  assert.equal(resultado.resultado, "error", "editar revocó la aprobación: no queda nada publicable");
  assert.equal(espia.publicadas.length, 0);
});

test("workflowDecision: editar y volver a aprobar sí publica — con el contenido nuevo", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espiaSetup = depsFalsas([paginaFalsa({ url_slug: "/pizza" })]);
  await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espiaSetup.deps);

  const ctx = humano(tenantA);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  const pageId = rows[0]!.id;

  await store.editPage(ctx, pageId, { url_slug: "/pizza-napolitana" });
  await store.approvePage(ctx, pageId);

  const decisionId = await store.registrarDecision(ctx, runId, "crear_web");
  assert.ok(decisionId);

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  assert.equal(resultado.paginasPublicadas, 1);
  assert.deepEqual(espia.publicadas[0], ["/pizza-napolitana"], "se publicó lo EDITADO");
});

test("🔴 un tenant NO puede editar la página de otro", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  await workflowResearch(new MotorPasos(), entrada(runId, tenantA), espia.deps);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  const pageId = rows[0]!.id;

  // El tenant B intenta editar una página del tenant A. RLS no se la deja ni ver.
  const editada = await store.editPage(humano(tenantB), pageId, { url_slug: "/hackeada" });
  assert.equal(editada, false, "RLS no deja tocar la página de otro tenant");

  const { rows: r2 } = await pg.query<{ url_slug: string }>(
    "select url_slug from kr_pages where id = $1",
    [pageId],
  );
  assert.notEqual(r2[0]!.url_slug, "/hackeada");
});

// ================================================================
// workflowDecision: retomable, guard de reproceso, y los caminos de error nuevos
// ================================================================

/**
 * Retomable: un run puede pasar por `solo_informe` primero (el humano solo quería el informe) y
 * después, sin volver a pagar el research, decidir `crear_web`. `registrarDecision` ya lo permite
 * (Task 3): la segunda decisión promueve el run de `approved` otra vez, siempre que la ÚLTIMA
 * decisión completada haya sido `solo_informe`.
 */
test("workflowDecision: retomable — solo_informe completado, después crear_web publica", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);
  const ctx = humano(tenantA);

  const d1 = await store.registrarDecision(ctx, runId, "solo_informe");
  assert.ok(d1);
  const espia1 = depsFalsas([]);
  const primero = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: d1! }, espia1.deps);
  assert.equal(primero.resultado, "completado");

  const d2 = await store.registrarDecision(ctx, runId, "crear_web");
  assert.ok(d2);
  const espia2 = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: d2! }, espia2.deps);

  assert.equal(resultado.resultado, "completado");
  assert.equal(resultado.paginasPublicadas, 1);
});

/**
 * Guard de reproceso (Major #7 de la ronda de Codex): la idempotencia de Inngest dura 24h, no una
 * garantía. Un replay después de esa ventana encuentra la fila ya cerrada y NO vuelve a llamar a
 * `publicar()` — `workflowDecision` devuelve el resultado ya cerrado en vez de repetir el efecto.
 */
test("workflowDecision: guard de reproceso — llamar dos veces sobre la misma decisión completada no publica dos veces", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);
  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  const espia = depsFalsas([]);
  await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);

  let publicarLlamadas = 0;
  const publicarOriginal = espia.deps.publicar;
  const depsContando: Deps = {
    ...espia.deps,
    publicar: async (...args: Parameters<typeof publicarOriginal>) => {
      publicarLlamadas++;
      return publicarOriginal(...args);
    },
  };
  const segunda = await workflowDecision(
    new MotorPasos(),
    { tenantId: tenantA, decisionId: decisionId! },
    depsContando,
  );

  assert.equal(segunda.resultado, "completado", "informa el resultado ya cerrado, no lo repite");
  assert.equal(publicarLlamadas, 0, "no se llamó a publicar() la segunda vez");
});

/**
 * `crear_posts` no tiene ningún camino que lo emita hoy: la API lo rechaza con 501 antes de
 * `registrarDecision` (Task 10, sub-proyecto 3 sin implementar). Este test simula el bug/evento a
 * mano — una fila insertada directo, sin pasar por la API — y confirma que `workflowDecision` falla
 * CERRADO en vez de intentar publicar algo que no sabe generar.
 */
test("🔴 workflowDecision: crear_posts persistido a mano cierra en error, nunca en completado", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);

  const { rows } = await pg.query<{ id: string }>(
    `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
     values ($1, $2, $3, 'crear_posts') returning id`,
    [runId, tenantA, clientA],
  );

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(
    new MotorPasos(),
    { tenantId: tenantA, decisionId: rows[0]!.id },
    espia.deps,
  );
  assert.equal(resultado.resultado, "error");
});

/**
 * Major #10 de la ronda de Codex: un cliente archivado entre la aprobación y la ejecución del step
 * no se publica. La ventana es real —`registrarDecision` y `workflowDecision` corren en pasos
 * distintos, en momentos distintos—, así que `getClient` se vuelve a consultar en el momento de
 * publicar, no se confía en lo que era cierto cuando se decidió.
 */
test("🔴 workflowDecision: cliente archivado a mitad de camino no publica", async () => {
  const runId = await crearRunConPaginaAprobada(tenantA, clientA, equipoA);
  const decisionId = await store.registrarDecision(humano(tenantA), runId, "crear_web");
  assert.ok(decisionId);

  await pg.query("update clients set archived_at = now() where id = $1", [clientA]);

  const espia = depsFalsas([]);
  const resultado = await workflowDecision(new MotorPasos(), { tenantId: tenantA, decisionId: decisionId! }, espia.deps);
  assert.equal(resultado.resultado, "error");
});

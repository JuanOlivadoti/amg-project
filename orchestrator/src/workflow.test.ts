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
import { workflowResearch } from "./workflow.js";
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

/** Señal de que el workflow se durmió en la compuerta. Inngest suspende; no devuelve. */
class Suspendido extends Error {
  constructor() {
    super("suspendido en la compuerta humana");
  }
}

/**
 * Motor de steps que MEMOIZA, como Inngest.
 *
 * No es un detalle de fidelidad: sin memoización, el replay que despierta tras la aprobación
 * volvería a correr `cerrar-run`, que devuelve el run a `pending_approval` — y entonces la
 * publicación no encontraría nada aprobado. Un doble que ejecuta todo de nuevo haría pasar los
 * tests de seguridad POR LA RAZÓN EQUIVOCADA: no se publicaría nunca, ni siquiera cuando se debe.
 *
 * Se reusa la MISMA instancia entre pasadas: eso es exactamente un replay.
 */
class MotorPasos implements Pasos {
  private readonly memo = new Map<string, unknown>();
  readonly corridos: string[] = [];

  /** `null` = se duerme (aún nadie aprobó). `"timeout"` = venció el plazo. */
  aprobacion: { data: unknown } | null | "timeout" = null;

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

  async esperarEvento(id: string): Promise<{ data: unknown } | null> {
    if (this.memo.has(id)) return this.memo.get(id) as { data: unknown } | null;
    if (this.aprobacion === null) throw new Suspendido(); // el workflow se duerme acá
    const res = this.aprobacion === "timeout" ? null : this.aprobacion;
    this.memo.set(id, res);
    return res;
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

  override async finishRun(...args: Parameters<PgStore["finishRun"]>): Promise<void> {
    await super.finishRun(...args);
    this.orden.push("cerrar-run");
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
  };

  return espia;
}

/** El evento: SOLO coordenadas. Ni prompt, ni cliente, ni topes — eso vive en la fila del run. */
const entrada = (runId: string, tenantId: string) => ({ runId, tenantId });

/**
 * Crea el run como lo hará la API: **bajo RLS, con la identidad del humano**.
 *
 * Es donde ocurre la autorización. Si esa persona no tiene membresía en el tenant, Postgres rechaza
 * el insert y no se emite ningún evento — o sea que el orquestador nunca llega a gastar.
 */
async function crearRunComoHumano(tenantId: string, clientId: string, userId: string): Promise<string> {
  const runId = randomUUID();
  await store.createRun(
    { tenantId, userId },
    {
      runId,
      clientId,
      schemaVersion: "kr.v0.5",
      prompt: "Restaurante italiano en Madrid centro",
      market: { country: "ES", language_code: "es", location_code: 2724 },
    },
  );
  return runId;
}

/** El humano del portal (equipo), no el orquestador. Es quien tiene permiso de aprobar. */
const humano = (tenantId: string): TenantContext => ({ tenantId, userId: tenantId === tenantA ? equipoA : equipoB });

/** Pasa la compuerta DOBLE (ADR-06): primero las páginas, después el run. */
async function aprobarTodo(ctx: TenantContext, runId: string): Promise<void> {
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  for (const r of rows) await store.approvePage(ctx, r.id);
  await store.approveRun(ctx, runId);
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

/**
 * Corre el research y deja el run en `pending_approval`, dormido en la compuerta — como en la vida
 * real. Devuelve el motor: reusarlo para la segunda pasada ES el replay de Inngest.
 */
async function correrHastaLaCompuerta(
  espia: Espia,
  runId: string,
  tenant = tenantA,
  client = clientA,
): Promise<MotorPasos> {
  const motor = new MotorPasos(); // aprobacion = null → se duerme en la compuerta
  await assert.rejects(
    () => workflowResearch(motor, entrada(runId, tenant), espia.deps),
    Suspendido,
    "el workflow tiene que dormirse esperando al humano, no seguir de largo",
  );
  return motor;
}

/** Despierta al workflow con el evento de aprobación. Replay: los steps previos NO se re-ejecutan. */
function despertar(motor: MotorPasos, espia: Espia, runId: string) {
  motor.aprobacion = { data: { runId } };
  return workflowResearch(motor, entrada(runId, tenantA), espia.deps);
}

// ================================================================
// El ciclo
// ================================================================

test("el run queda en pending_approval y NO se publica nada hasta que un humano aprueba", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);

  await correrHastaLaCompuerta(espia, runId);

  const run = await store.getRun(humano(tenantA), runId);
  assert.equal(run?.status, "pending_approval");
  assert.equal(espia.publicadas.length, 0, "no se publicó nada sin aprobación");
});

test("aprobado en la base + evento → se publica", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  // El humano aprueba de verdad: la página Y el run (compuerta doble, ADR-06).
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(humano(tenantA), rows[0]!.id);
  await store.approveRun(humano(tenantA), runId);

  const res = await despertar(motor, espia, runId);

  assert.equal(res.estado, "publicado");
  assert.equal(res.paginasPublicadas, 1);
  assert.deepEqual(espia.publicadas[0], ["/pizza-napolitana-madrid"]);
  assert.equal(espia.researchCorrido, 1, "el replay NO vuelve a correr el research (ni a pagarlo)");
});

test("solo se publican las páginas que el humano aprobó, no todas las del run", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([
    paginaFalsa(),
    paginaFalsa({ url_slug: "/menu-del-dia", keyword_principal: "menú del día", evidencia: "sin_validar" }),
  ]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  // Aprueba SOLO la respaldada por datos. La `sin_validar` se queda fuera.
  const { rows } = await pg.query<{ id: string }>(
    "select id from kr_pages where run_id = $1 and url_slug = '/pizza-napolitana-madrid'",
    [runId],
  );
  await store.approvePage(humano(tenantA), rows[0]!.id);
  await store.approveRun(humano(tenantA), runId);

  await despertar(motor, espia, runId);

  assert.deepEqual(espia.publicadas[0], ["/pizza-napolitana-madrid"], "la página sin validar NO se publica");
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
  const pagina = paginaFalsa({ url_slug: "/pizza-napolitana-en-el-centro" });
  const espia = depsFalsas([pagina]);

  await correrHastaLaCompuerta(espia, runId);

  const filas = await store.getRunPages(humano(tenantA), runId);
  assert.equal(filas.length, 1);

  /*
   * Los tres campos que `PaginaPropuesta` agrega NO se comparan contra la página del M2, y no es una
   * exclusión silenciosa: ninguno de los tres viaja en el brief. Se comprueban aparte, abajo, porque
   * cada uno afirma algo propio.
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

  assert.match(id, /^[0-9a-f-]{36}$/, "el `id` lo genera la base (gen_random_uuid), no viaja en el brief");
  assert.equal(approved, false, "una página recién escrita NACE sin aprobar: el M2 no puede pre-aprobar");
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

  await correrHastaLaCompuerta(espia, runId);

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
  assert.equal(md, renderReport(briefFalso(paginas)), "es el informe de ESTE brief, no de otro");

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
 * correr el workflow con el mismo motor. Si el motor no olvidara nada no habría reintento que probar.
 */
test("un reintento de `guardar-informe` reescribe y no vuelve a pagar el research", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const paginas = [paginaFalsa()];
  const espia = depsFalsas(paginas);

  const motor = await correrHastaLaCompuerta(espia, runId);
  const primero = await store.getInforme(humano(tenantA), runId);

  motor.olvidar("guardar-informe");
  await assert.rejects(() => workflowResearch(motor, entrada(runId, tenantA), espia.deps), Suspendido);

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
// El evento es un DISPARADOR, no una autoridad
// ================================================================

/**
 * El escenario que importa: alguien consigue emitir `research/aprobado` (un webhook mal protegido,
 * un bug, un job vecino). Si el evento fuera la autoridad, se publicaría contenido que NADIE miró.
 *
 * Acá el evento solo despierta al workflow; lo que se publica lo decide la base.
 */
test("🔴 un evento de aprobación NO publica nada si en la base nadie aprobó", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  // Llega el evento, pero NADIE tocó la compuerta en la base.
  const res = await despertar(motor, espia, runId);

  assert.equal(res.estado, "nada_que_publicar");
  assert.equal(espia.publicadas.length, 0, "no se llamó al publicador");
});

/**
 * La otra mitad de la compuerta: las páginas aprobadas pero con el run SIN aprobar tampoco salen.
 * Aprobar una página no es aprobar la web.
 */
test("🔴 con las páginas aprobadas pero el run sin aprobar, no se publica nada", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  await store.approvePage(humano(tenantA), rows[0]!.id);
  // …pero NO se aprueba el run.

  const res = await despertar(motor, espia, runId);

  assert.equal(res.estado, "nada_que_publicar");
  assert.equal(espia.publicadas.length, 0);
});

/**
 * Un tenant no puede aprobar —ni publicar— el research de otro. El workflow opera SIEMPRE con el
 * contexto del evento original (`research/solicitado`), nunca con el del evento de aprobación: un
 * evento forjado con el runId ajeno se encuentra con que RLS no le devuelve nada.
 */
test("🔴 el tenant B no puede hacer que se publique el research del tenant A", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  // B intenta aprobar el run de A. RLS lo frena en seco: no ve ni la página ni el run.
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  const aprobo = await store.approvePage(humano(tenantB), rows[0]!.id);
  assert.equal(aprobo, false, "B no puede aprobar una página de A");
  await assert.rejects(() => store.approveRun(humano(tenantB), runId), /ninguna página aprobada/i);

  // Y aunque B logre emitir el evento con el runId de A, no se publica nada.
  const res = await despertar(motor, espia, runId);

  assert.equal(res.estado, "nada_que_publicar");
  assert.equal(espia.publicadas.length, 0);
});

// ================================================================
// Silencio, fallos e idempotencia
// ================================================================

/** El silencio no es un "sí". Vencido el plazo, el run se queda esperando, no se auto-publica. */
test("🔴 si nadie responde en el plazo, NO se publica (el silencio no aprueba)", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  motor.aprobacion = "timeout"; // vencieron los 7 días
  const res = await workflowResearch(motor, entrada(runId, tenantA), espia.deps);

  assert.equal(res.estado, "sin_respuesta");
  assert.equal(espia.publicadas.length, 0);
  const run = await store.getRun(humano(tenantA), runId);
  assert.equal(run?.status, "pending_approval", "queda esperando a un humano, no se pierde");
});

/**
 * Idempotencia: reprocesar el mismo evento (reintento, doble entrega, replay con memoria perdida)
 * NO puede abrir un segundo run ni volver a pagarle a DataForSEO. Por eso el `runId` viaja EN EL
 * EVENTO. Acá el motor es NUEVO a propósito: es el caso feo, el del reproceso desde cero.
 */
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
 * 🔴 La idempotencia de Inngest dura 24 h; la compuerta espera 7 DÍAS. Pasadas las 24 h, un evento
 * duplicado arranca una ejecución NUEVA con los steps en blanco. Sin esta comprobación, volvía a
 * pagar el LLM y reescribía las páginas sobre un run ya cerrado.
 *
 * La fase durable vive en la BASE, no en la memoria de Inngest.
 */
test("🔴 un evento duplicado (motor NUEVO) no vuelve a hacer el research", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);

  await correrHastaLaCompuerta(espia, runId);
  assert.equal(espia.researchCorrido, 1);

  // 25 h después: Inngest ya no deduplica y llega el mismo evento. Motor NUEVO, steps en blanco.
  const espia2 = depsFalsas([paginaFalsa()]);
  const motor2 = new MotorPasos();
  await assert.rejects(() => workflowResearch(motor2, entrada(runId, tenantA), espia2.deps), Suspendido);

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
// El destino de publicación (review 5, HIGH #1 y #2)
// ================================================================

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
  const runA = await crearRunComoHumano(tenantA, clientA, equipoA);
  const runB = await crearRunComoHumano(tenantB, clientB, equipoB);

  // La MISMA página, con el MISMO slug, para los dos clientes. Es el caso real: `/menu` lo tienen
  // todos los restaurantes.
  const espiaA = depsFalsas([paginaFalsa({ url_slug: "/menu" })]);
  const espiaB = depsFalsas([paginaFalsa({ url_slug: "/menu" })]);

  const motorA = await correrHastaLaCompuerta(espiaA, runA, tenantA, clientA);
  const motorB = await correrHastaLaCompuerta(espiaB, runB, tenantB, clientB);

  await aprobarTodo(humano(tenantA), runA);
  await aprobarTodo(humano(tenantB), runB);

  motorA.aprobacion = { data: { runId: runA } };
  await workflowResearch(motorA, entrada(runA, tenantA), espiaA.deps);
  motorB.aprobacion = { data: { runId: runB } };
  await workflowResearch(motorB, entrada(runB, tenantB), espiaB.deps);

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
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  espia.simularDraft = true; // el proveedor NO confirma la publicación

  const motor = await correrHastaLaCompuerta(espia, runId);
  await aprobarTodo(humano(tenantA), runId);

  const res = await despertar(motor, espia, runId);

  assert.equal(res.paginasPublicadas, 0, "nada quedó publicado: el proveedor no lo confirmó");

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
 * después de que lo mirara, la certificación no vale nada.
 */
test("🔴 editar una página aprobada REVOCA su aprobación (si no, se publica lo que nadie miró)", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa({ url_slug: "/pizza" })]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  const ctx = humano(tenantA);
  const { rows } = await pg.query<{ id: string }>(
    "select id from kr_pages where run_id = $1",
    [runId],
  );
  const pageId = rows[0]!.id;

  await store.approvePage(ctx, pageId);
  await store.approveRun(ctx, runId);

  // El humano aprueba… y DESPUÉS reescribe la página.
  const editada = await store.editPage(ctx, pageId, { url_slug: "/pizza-napolitana" });
  assert.equal(editada, true);

  const publicables = await storeServicio.getPublishablePages({ tenantId: tenantA }, runId);
  assert.equal(
    publicables.length,
    0,
    "la edición revocó la aprobación: no se publica algo que cambió después de que lo miraran",
  );

  // Y al publicar de verdad: nada sale.
  motor.aprobacion = { data: { runId } };
  const res = await workflowResearch(motor, entrada(runId, tenantA), espia.deps);
  assert.equal(res.estado, "nada_que_publicar");
});

test("editar y volver a aprobar sí publica — con el contenido nuevo", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa({ url_slug: "/pizza" })]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  const ctx = humano(tenantA);
  const { rows } = await pg.query<{ id: string }>("select id from kr_pages where run_id = $1", [runId]);
  const pageId = rows[0]!.id;

  await store.editPage(ctx, pageId, { url_slug: "/pizza-napolitana" });
  await store.approvePage(ctx, pageId);
  await store.approveRun(ctx, runId);

  motor.aprobacion = { data: { runId } };
  const res = await workflowResearch(motor, entrada(runId, tenantA), espia.deps);

  assert.equal(res.paginasPublicadas, 1);
  assert.deepEqual(espia.publicadas[0], ["/pizza-napolitana"], "se publicó lo EDITADO");
});

test("🔴 un tenant NO puede editar la página de otro", async () => {
  const runId = await crearRunComoHumano(tenantA, clientA, equipoA);
  const espia = depsFalsas([paginaFalsa()]);
  await correrHastaLaCompuerta(espia, runId);

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

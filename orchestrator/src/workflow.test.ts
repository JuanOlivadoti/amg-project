import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PgStore } from "db";
import { PglitePool } from "db";
import type { PageRow, TenantContext } from "db";
import { workflowResearch } from "./workflow.js";
import type { BriefDelPipeline, Deps, Pasos } from "./workflow.js";

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
let store: PgStore;
let tenantA: string;
let tenantB: string;
let clientA: string;
let clientB: string;

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

  async esperarEvento(id: string): Promise<{ data: unknown } | null> {
    if (this.memo.has(id)) return this.memo.get(id) as { data: unknown } | null;
    if (this.aprobacion === null) throw new Suspendido(); // el workflow se duerme acá
    const res = this.aprobacion === "timeout" ? null : this.aprobacion;
    this.memo.set(id, res);
    return res;
  }
}

const paginaFalsa = (over: Partial<PageRow> = {}): PageRow => ({
  cluster_id: randomUUID(),
  tipo: "landing_local",
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
  ...over,
});

const briefFalso = (paginas: PageRow[]): BriefDelPipeline => ({
  schema_version: "kr.v0.5",
  paginas_propuestas: paginas,
  meta_run: {
    coste_micros_usd: 310_800,
    coste_breakdown: { dataforseo_micros: 252_200 },
    calidad_datos: { cobertura_volumen: 0.71, cobertura_kd: 0.31, endpoints_degradados: [] },
    modelos_sin_precio: [],
  },
});

interface Espia {
  deps: Deps;
  publicadas: string[][];
  researchCorrido: number;
  keywordsGuardadas: number;
}

function depsFalsas(paginas: PageRow[]): Espia {
  const espia: Espia = {
    publicadas: [],
    researchCorrido: 0,
    keywordsGuardadas: 0,
    deps: undefined as never,
  };

  espia.deps = {
    store,
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
    publicar: async (brief) => {
      const b = brief as { paginas_propuestas: Array<{ url_slug: string }> };
      const slugs = b.paginas_propuestas.map((p) => p.url_slug);
      espia.publicadas.push(slugs);
      return slugs.map((s) => ({ slug: s, location: `story-${s}` }));
    },
  };

  return espia;
}

const entrada = (tenantId: string, clientId: string) => ({
  ctx: { tenantId, clientId },
  prompt: "Restaurante italiano en Madrid centro",
  market: { country: "ES", language_code: "es", location_code: 2724 },
});

/** El humano del portal (equipo), no el orquestador. Es quien tiene permiso de aprobar. */
const humano = (tenantId: string): TenantContext => ({ tenantId, role: "equipo" });

// ---------------------------------------------------------------- setup

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(join(aqui, "..", "..", "db", "migrations", "0001_init.sql"), "utf8"));
  store = new PgStore(new PglitePool(pg));
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("delete from kr_runs; delete from clients; delete from tenants;");
  const { rows: t } = await pg.query<{ id: string }>(
    "insert into tenants (nombre, slug) values ('A', 'a'), ('B', 'b') returning id",
  );
  tenantA = t[0]!.id;
  tenantB = t[1]!.id;

  const mk = async (tid: string, n: string) => {
    const { rows } = await pg.query<{ id: string }>(
      "insert into clients (tenant_id, nombre) values ($1, $2) returning id",
      [tid, n],
    );
    return rows[0]!.id;
  };
  clientA = await mk(tenantA, "Trattoria");
  clientB = await mk(tenantB, "Sushi Zen");
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
    () => workflowResearch(motor, entrada(tenant, client), espia.deps, runId),
    Suspendido,
    "el workflow tiene que dormirse esperando al humano, no seguir de largo",
  );
  return motor;
}

/** Despierta al workflow con el evento de aprobación. Replay: los steps previos NO se re-ejecutan. */
function despertar(motor: MotorPasos, espia: Espia, runId: string) {
  motor.aprobacion = { data: { runId } };
  return workflowResearch(motor, entrada(tenantA, clientA), espia.deps, runId);
}

// ================================================================
// El ciclo
// ================================================================

test("el run queda en pending_approval y NO se publica nada hasta que un humano aprueba", async () => {
  const runId = randomUUID();
  const espia = depsFalsas([paginaFalsa()]);

  await correrHastaLaCompuerta(espia, runId);

  const run = await store.getRun(humano(tenantA), runId);
  assert.equal(run?.status, "pending_approval");
  assert.equal(espia.publicadas.length, 0, "no se publicó nada sin aprobación");
});

test("aprobado en la base + evento → se publica", async () => {
  const runId = randomUUID();
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
  const runId = randomUUID();
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
// El evento es un DISPARADOR, no una autoridad
// ================================================================

/**
 * El escenario que importa: alguien consigue emitir `research/aprobado` (un webhook mal protegido,
 * un bug, un job vecino). Si el evento fuera la autoridad, se publicaría contenido que NADIE miró.
 *
 * Acá el evento solo despierta al workflow; lo que se publica lo decide la base.
 */
test("🔴 un evento de aprobación NO publica nada si en la base nadie aprobó", async () => {
  const runId = randomUUID();
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
  const runId = randomUUID();
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
  const runId = randomUUID();
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
  const runId = randomUUID();
  const espia = depsFalsas([paginaFalsa()]);
  const motor = await correrHastaLaCompuerta(espia, runId);

  motor.aprobacion = "timeout"; // vencieron los 7 días
  const res = await workflowResearch(motor, entrada(tenantA, clientA), espia.deps, runId);

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
test("🔴 reprocesar el mismo evento no crea un segundo run", async () => {
  const runId = randomUUID();

  await correrHastaLaCompuerta(depsFalsas([paginaFalsa()]), runId);
  await correrHastaLaCompuerta(depsFalsas([paginaFalsa()]), runId);

  const { rows } = await pg.query<{ n: number }>("select count(*)::int as n from kr_runs");
  assert.equal(rows[0]!.n, 1, "un solo run: el segundo evento no abrió otro");
});

/** Un runId ajeno inventado no puede secuestrar el run de otro cliente. */
test("🔴 no se puede abrir un run con el id de un run ajeno", async () => {
  const runId = randomUUID();
  await correrHastaLaCompuerta(depsFalsas([paginaFalsa()]), runId);

  await assert.rejects(
    () =>
      workflowResearch(
        new MotorPasos(),
        entrada(tenantB, clientB),
        depsFalsas([paginaFalsa()]).deps,
        runId, // el mismo id que ya usó A
      ),
    /no pertenece a este cliente/i,
  );
});

/**
 * El checkpoint del dataset: las keywords se guardan DENTRO del step de research, apenas existen.
 * Si el paso revienta después (clustering, LLM de contenido), lo que ya se le pagó a DataForSEO
 * queda en la base en vez de perderse.
 */
test("las keywords pagas se persisten aunque el research reviente DESPUÉS", async () => {
  const runId = randomUUID();
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
    workflowResearch(new MotorPasos(), entrada(tenantA, clientA), espia.deps, runId),
  );

  const { rows } = await pg.query<{ n: number }>(
    "select count(*)::int as n from kr_keywords where run_id = $1",
    [runId],
  );
  assert.equal(rows[0]!.n, 1, "lo que costó dinero quedó guardado");
});

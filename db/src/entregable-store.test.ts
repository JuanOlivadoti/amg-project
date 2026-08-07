import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seed, TestDb, type Seed } from "./testdb.js";
import { PglitePool } from "./pool.js";
import { PgStore } from "./store.js";

/**
 * El margen de la agencia (`coste_micros_usd`) y los datos con los que se arma el ENTREGABLE del
 * restaurante. Las dos mitades de la misma pregunta: **qué ve alguien que no es la agencia.**
 *
 * ## Por qué el store se construye con `app_user` y los datos se siembran con `asService`
 *
 * Mismo criterio que `informe-store.test.ts`: `asService` es el SUPERUSUARIO —salta RLS y grants— así que
 * sirve para montar la precondición ("la fila existe, y su coste es éste") pero **ninguna aseveración
 * sobre la política puede pasar por él**, porque pasaría siempre. Lo que se afirma va por `PgStore` con
 * rol `app_user`, que es el que corre en producción (`amg_api`, ADR-17).
 *
 * ## Lo que está MEDIDO acá abajo, y no supuesto (PostgreSQL 16.4, PGlite 0.2.17)
 *
 * `app.es_staff()` es evaluable en la lista del `select` con el rol `app_user` y devuelve un booleano —no
 * un error— para los tres casos: `true` para `equipo`, `false` para `cliente` y **`null` para quien no
 * tiene membresía** (`current_role()` es NULL y `NULL in (...)` es NULL). Los tres fallan cerrado: en el
 * `case when` el NULL cae al `else` ausente, y en un predicado un NULL no es TRUE.
 *
 * ⚠️ `api/` corre PostgreSQL **18.3**, otro major. La misma medición está repetida allí
 * (`api/src/entregable.test.ts`) porque un comportamiento del motor medido en un paquete no se puede
 * afirmar del otro.
 */
let db: TestDb;
let s: Seed;
let api: PgStore;

/** El coste del run A1. Un número reconocible: si se filtra, se ve. */
const COSTE_A1 = 312_500;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  api = new PgStore(new PglitePool(db.pglite), "app_user");

  await db.asService("update kr_runs set coste_micros_usd = $2 where id = $1", [s.runA1, COSTE_A1]);
});
after(async () => {
  await db.close();
});

/** El contexto se arma en cada test y no en una `const` de módulo: `s` todavía no existe al cargarse. */
const staffA = () => ({ tenantId: s.tenantA, userId: s.equipoA });
const clienteA1 = () => ({ tenantId: s.tenantA, userId: s.duenoA1 });

// --------------------------------------------------------------- el margen

test("el staff SÍ ve el coste del run: es su argumento comercial", async () => {
  const run = await api.getRun(staffA(), s.runA1);
  assert.equal(run?.coste_micros_usd, COSTE_A1);
});

test("🔴 el rol `cliente` NO ve `coste_micros_usd`, aunque el run SÍ sea suyo", async () => {
  /*
   * El rojo correcto: no es "la query falla", es "el dueño del restaurante ve lo que la agencia le
   * paga a DataForSEO". `run_select` (0001) usa `app.ve_cliente(client_id)`, así que la FILA le llega
   * —y tiene que llegarle, es su run—; lo que no puede llegarle es esa columna. Lo decide
   * `app.es_staff()` dentro del `select`, no un `if` de la API (ADR-15).
   */
  const ctx = clienteA1();

  // Precondición, y no es adorno: si el run no fuera visible para él, este test pasaría por el motivo
  // equivocado (sería el caso "no hay run") y la mutación del `case when` no lo tumbaría.
  const run = await api.getRun(ctx, s.runA1);
  assert.ok(run, "el run de su propio negocio SÍ tiene que serle visible");
  assert.equal(run.id, s.runA1);

  assert.equal(run.coste_micros_usd, null, "el margen de la agencia no sale del tenant");
});

test("🔴 tampoco lo ve por `listRuns` ni por `listAllRuns`: es UNA definición de columnas", async () => {
  // `RUN_SUMMARY_COLS` es una sola constante para los tres lectores. Este test es lo que impide que
  // alguien "arregle" uno y deje los otros dos abiertos.
  const ctx = clienteA1();

  const porCliente = await api.listRuns(ctx, s.clientA1);
  assert.ok(porCliente.length > 0, "el cliente ve los runs de su negocio");
  for (const r of porCliente) assert.equal(r.coste_micros_usd, null);

  const todos = await api.listAllRuns(ctx);
  assert.ok(todos.length > 0);
  for (const r of todos) assert.equal(r.coste_micros_usd, null);

  // Y el staff los sigue viendo por los dos caminos.
  const staff = await api.listAllRuns(staffA());
  const a1 = staff.find((r) => r.id === s.runA1);
  assert.equal(a1?.coste_micros_usd, COSTE_A1);
});

// --------------------------------------------------------------- getDatosEntregable

const UUID_INEXISTENTE = "00000000-0000-4000-8000-000000000000";

/**
 * Una página del run A1. `orden` es su posición en el brief; `aprobada`/`retirada` la compuerta.
 *
 * Una retirada va con `orden_brief` NULL y no con su posición vieja: lo EXIGE la constraint
 * `retirada_sin_posicion` (0015). No es un detalle del test — una página que el research ya no propone
 * no está en el brief, así que no tiene puesto en él.
 */
async function sembrarPagina(
  slug: string,
  opts: { orden: number | null; aprobada: boolean; retirada?: boolean; score: number },
): Promise<void> {
  await db.asService(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug,
                           keyword_principal, keywords_secundarias, intencion, local, volumen,
                           dificultad, evidencia, opportunity_score, score_confidence, seo,
                           content_brief, preguntas_frecuentes, approved, retirada, orden_brief)
     values ($1::uuid, $2::uuid, $3::uuid, gen_random_uuid(), 'servicio', 'single', $4::text,
             'kw ' || $4::text, array['sec'], 'commercial', false, 480, 21, 'datos_mercado',
             $5::numeric, 0.8,
             '{"meta_title":"t","meta_description":"d","schema_type":"WebPage","canonical":"/c"}'::jsonb,
             '{"h1":"H","secciones_sugeridas":["a"],"word_count_objetivo":800,"enlazado_interno":[]}'::jsonb,
             array['¿Reservan?'], $6::boolean, $7::boolean, $8::int)`,
    [s.tenantA, s.runA1, s.clientA1, slug, opts.score, opts.aprobada, opts.retirada ?? false, opts.orden],
  );
}

test("getDatosEntregable: el staff recibe el run, su cliente por NOMBRE y las páginas aprobadas", async () => {
  await sembrarPagina("/segunda", { orden: 1, aprobada: true, score: 90 });
  await sembrarPagina("/primera", { orden: 0, aprobada: true, score: 10 });
  await db.asService(
    `insert into kr_keywords (tenant_id, run_id, client_id, keyword, canonical_key, source, is_local, discarded)
     values ($1,$2,$3,'kw uno','kw-uno','seed',false,false), ($1,$2,$3,'kw dos','kw-dos','seed',false,true)`,
    [s.tenantA, s.runA1, s.clientA1],
  );

  const d = await api.getDatosEntregable(staffA(), s.runA1);
  assert.ok(d, "el staff puede producir el entregable");

  assert.equal(d.run_id, s.runA1);
  assert.equal(d.cliente, "Trattoria Bella Napoli", "el NOMBRE del cliente, no su uuid: es el encabezado");
  assert.equal(d.market_country, "ES");
  assert.equal(d.market_location_code, 2724);
  assert.equal(d.coste_micros_usd, COSTE_A1);

  // Los tres castes que Postgres necesita, comprobados por TIPO y no de vista: `bigint` y `count(*)`
  // llegan como string sin `::int`, y `numeric` como string sin `::float8`.
  assert.equal(typeof d.coste_micros_usd, "number");
  assert.equal(d.keywords_analizadas, 2, "las descartadas también se analizaron: se pagaron igual");
  assert.equal(typeof d.keywords_analizadas, "number");
  assert.equal(typeof d.paginas[0]?.opportunity_score, "number");
  assert.equal(typeof d.paginas[0]?.score_confidence, "number");

  // `generated_at` es un string ISO en RUNTIME, no el `Date` que da el driver: cualquier `slice` o
  // `split` sobre el campo compilaría igual y reventaría en producción.
  assert.equal(typeof d.generated_at, "string");
  assert.match(d.generated_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

  // El ORDEN es el del brief (`orden_brief`), no el del score. La entrada lo CONTRADICE a propósito:
  // con el orden y el score de acuerdo no se podría distinguir cuál de los dos se respetó.
  assert.deepEqual(
    d.paginas.map((p) => p.url_slug),
    ["/primera", "/segunda"],
  );
});

test("🔴 una página SIN aprobar y una RETIRADA no entran en el entregable", async () => {
  await sembrarPagina("/sin-aprobar", { orden: 2, aprobada: false, score: 99 });
  await sembrarPagina("/retirada", { orden: null, aprobada: true, retirada: true, score: 99 });

  const d = await api.getDatosEntregable(staffA(), s.runA1);
  const slugs = d?.paginas.map((p) => p.url_slug) ?? [];

  // Precondición: las dos filas existen de verdad. Sin esto el test pasaría por no haber sembrado nada.
  const crudas = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_pages where run_id = $1 and url_slug in ('/sin-aprobar','/retirada')",
    [s.runA1],
  );
  assert.equal(crudas[0]?.n, "2");

  assert.ok(!slugs.includes("/sin-aprobar"), "el entregable refleja lo que pasó la compuerta, no el brief");
  assert.ok(!slugs.includes("/retirada"), "una página que el research ya no propone no se le manda a nadie");
});

test("🔴 el rol `cliente` NO puede producir el entregable de su propio run", async () => {
  /*
   * No es un `if` de la API: la consulta lleva `app.es_staff()` en su predicado y devuelve CERO filas,
   * así que el endpoint no puede distinguir este caso de un run inexistente. El entregable lo envía la
   * agencia (decisión del 2026-08-07); el cliente no tiene superficie nueva.
   */
  // Precondición: el run SÍ es visible para él. Sin esto el test pasaría por el motivo equivocado.
  assert.ok(await api.getRun(clienteA1(), s.runA1), "el run de su negocio le es visible");

  assert.equal(await api.getDatosEntregable(clienteA1(), s.runA1), null);
});

test("🔴 un run de OTRO tenant y uno inexistente dan el MISMO null", async () => {
  assert.equal(await api.getDatosEntregable(staffA(), s.runB1), null, "el run del tenant B");
  assert.equal(await api.getDatosEntregable(staffA(), UUID_INEXISTENTE), null);
});

test("🔴 sin membresía no hay entregable: `app.es_staff()` es NULL, y NULL no es TRUE", async () => {
  // El tercer caso del `app.es_staff()`, el que se olvida: un usuario sin membresía no da `false`, da
  // NULL. En un predicado eso tampoco es TRUE, así que falla cerrado igual.
  const intruso = { tenantId: s.tenantA, userId: s.intruso };
  assert.equal(await api.getDatosEntregable(intruso, s.runA1), null);
});

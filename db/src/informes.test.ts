import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * La seguridad de `kr_informes` (migración 0016), contra Postgres real (PGlite en WASM).
 *
 * El informe lleva el coste que la agencia le paga a DataForSEO — o sea su margen — así que vive en su
 * propia tabla y NO en una columna de `kr_runs`: RLS es por FILA, no por columna, y cualquiera que pueda
 * ver el run vería la columna. El rol `cliente` existe, es el dueño del negocio, y ve los runs de su
 * cliente. Con la fila propia, la política puede exigir staff.
 *
 * ⚠️ Ninguna ASEVERACIÓN de estos tests puede apoyarse en `db.asService`: es el SUPERUSUARIO de
 * infraestructura y salta RLS (y los grants). Medido: un `insert` sin un solo `grant` pasa como
 * superuser y da 42501 con `set local role app_service`. Lo que se comprueba va con `asUser`
 * (app_user) y `asOrquestador` (app_service).
 *
 * Sí se usa `asService` para dos cosas que NO son comprobaciones, y es exactamente para lo que
 * existe: sembrar un run (`crearRunSinInforme`) y establecer la VERDAD DE BASE de que una fila está
 * en la tabla (`exigirQueElInformeExista`). Justo porque salta RLS es el único rol que puede
 * afirmar "la fila existe" sin que la política bajo prueba influya en la respuesta.
 */
let db: TestDb;
let s: Seed;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
});
after(async () => {
  await db.close();
});

const MD = "# Informe\n\nUn informe cualquiera.";

/**
 * El tope de `informe_tamano_razonable` en la 0016, en BYTES. 256 KiB = 256 * 1024.
 *
 * Está acá y no leído de la base a propósito: si el test lo derivara del esquema, cambiar el esquema
 * cambiaría el test con él y el par de tests del borde no fijaría nada. El número se escribe dos veces
 * —una en la migración, una acá— y que tengan que coincidir es la garantía.
 */
const TOPE_BYTES = 262144;

/**
 * La PRECONDICIÓN de todo test que comprueba que alguien NO ve el informe.
 *
 * Sin esto, los tres tests negativos pasan con la tabla VACÍA: comprueban la ausencia de algo que
 * nunca existió. Medido — corriendo los tres solos, sin el test que escribe la fila, daban `pass 3`.
 * Hoy la fila está por dos motivos que ningún assert defendía: que `asOrquestador` hace `commit` y
 * que el test que escribe está declarado ANTES. Las dos son ciertas y las dos son refactorizables
 * sin que nada avise, y el síntoma sería tres tests de seguridad en verde permanente.
 *
 * Va con `asService` a propósito: es el superusuario, así que su respuesta NO depende de la política
 * que el test está a punto de probar. Preguntárselo a `asUser` sería circular.
 */
async function exigirQueElInformeExista(runId: string): Promise<void> {
  const filas = await db.asService("select run_id from kr_informes where run_id = $1", [runId]);
  assert.equal(
    filas.length,
    1,
    "precondición: el informe TIENE que existir en la tabla. Si no está, comprobar que alguien no lo " +
      "ve no prueba nada",
  );
}

/**
 * Un run del tenant A, del cliente A1, y SIN informe.
 *
 * Hace falta que sea nuevo en los tests que esperan el rechazo de una constraint sobre el `insert`:
 * si el run ya tuviera informe, la sentencia violaría la PK y —medido en PGlite 16.4— Postgres
 * devuelve 23505 antes de evaluar la FK compuesta (el índice único se comprueba al insertar la
 * tupla; las FK son triggers AFTER). El test comprobaría la PK creyendo comprobar otra cosa.
 */
async function crearRunSinInforme(): Promise<string> {
  const [run] = await db.asService<{ id: string }>(
    `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country,
                          market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'run sin informe', 'ES', 'es', 2724) returning id`,
    [s.tenantA, s.clientA1],
  );
  return run!.id;
}

test("los DOS logins pueden usar la tabla: el orquestador escribe y la API lee", async () => {
  // El grant es lo que se prueba acá: sin él, Postgres corta con 42501 ANTES de evaluar RLS.
  await db.asOrquestador(
    { tenantId: s.tenantA },
    `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
     select $1, $2, r.client_id, $3 from kr_runs r where r.id = $1`,
    [s.runA1, s.tenantA, MD],
  );

  const filas = await db.asUser<{ informe_md: string }>(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 1, "el equipo del tenant A lee el informe de su run");
  assert.equal(filas[0]?.informe_md, MD);
});

test("🔴 un tenant NO lee el informe de otro", async () => {
  await exigirQueElInformeExista(s.runA1);

  const filas = await db.asUser(
    { tenantId: s.tenantB, userId: s.equipoB },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 0, "el tenant B no ve el informe del run del tenant A");
});

test("🔴 el rol `cliente` NO recibe el informe de SU PROPIO run", async () => {
  await exigirQueElInformeExista(s.runA1);

  // `duenoA1` es el dueño del negocio A1: ve su run, y NO debe ver el informe — lleva el margen.
  const run = await db.asUser(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    "select id from kr_runs where id = $1",
    [s.runA1],
  );
  assert.equal(run.length, 1, "precondición: el cliente SÍ ve su run (si no, este test no prueba nada)");

  const filas = await db.asUser(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 0, "ve el run pero NO el informe");
});

test("🔴 un usuario SIN membresía tampoco: la allowlist falla cerrado", async () => {
  /*
   * Éste es un test DISTINTO del anterior y por eso son dos. Un `cliente` correctamente puesto NO caza
   * la forma que falla abierto: `'cliente' is distinct from 'cliente'` es FALSE, así que seguiría
   * negando. La forma rota solo se destapa con el rol AUSENTE, donde `NULL is distinct from 'cliente'`
   * da TRUE y concede visibilidad de maestro.
   */
  await exigirQueElInformeExista(s.runA1);

  const filas = await db.asUser(
    { tenantId: s.tenantA, userId: s.intruso },
    "select informe_md from kr_informes where run_id = $1",
    [s.runA1],
  );
  assert.equal(filas.length, 0, "sin membresía no hay rol, y sin rol no hay informe");
});

test("🔴 `app_render` no puede leer `kr_informes`: no tiene grant ni política", async () => {
  /*
   * Exige que el 42501 nombre `kr_informes`, y eso NO es cosmética: es lo que hace que la mutación
   * muerda. Medido en PGlite 16.4 — con las dos mitades puestas (`grant select ... to app_render` Y
   * `app_render` en el `to` de la política), la query SIGUE lanzando 42501, pero por **`memberships`**:
   * la política le aplica, así que Postgres evalúa `app.es_staff()` -> `app.current_role()`, que lee
   * `memberships`, donde `app_render` tampoco tiene grant. Un test que solo mirara `code === '42501'`
   * quedaría VERDE con la tabla ya alcanzable para el rol anónimo — pasaría por la razón equivocada.
   */
  await assert.rejects(
    () => db.asRender("select informe_md from kr_informes"),
    (e: { code?: string; message?: string }) =>
      e.code === "42501" && (e.message ?? "").includes("kr_informes"),
    "el rol del renderizador anónimo no llega a la tabla: 42501 sobre kr_informes, antes de evaluar RLS",
  );
});

test("🔴 la fila NO puede apuntar a un run de otro cliente: FK compuesta", async () => {
  // El run tiene que ser NUEVO: ver el comentario de `crearRunSinInforme`.
  const runId = await crearRunSinInforme();

  await assert.rejects(
    () =>
      db.asOrquestador(
        { tenantId: s.tenantA },
        `insert into kr_informes (run_id, tenant_id, client_id, informe_md) values ($1, $2, $3, $4)`,
        // El run existe y es del tenant A, pero el client_id es de OTRO cliente del mismo tenant.
        [runId, s.tenantA, s.clientA2, MD],
      ),
    (e: { code?: string }) => e.code === "23503",
    "la FK compuesta (run_id, tenant_id, client_id) lo rechaza",
  );
});

test("🔴 un informe de más de 256 KiB se rechaza en la BASE", async () => {
  await assert.rejects(
    () =>
      db.asOrquestador(
        { tenantId: s.tenantA },
        `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
         select $1, $2, r.client_id, $3 from kr_runs r where r.id = $1
         on conflict (run_id) do update set informe_md = excluded.informe_md`,
        [s.runA1, s.tenantA, "x".repeat(TOPE_BYTES + 1)],
      ),
    (e: { code?: string; constraint?: string }) =>
      e.code === "23514" && e.constraint === "informe_tamano_razonable",
    "el check corta el dato patológico donde se escribe, no en el endpoint",
  );
});

/**
 * 🔴 El par del anterior, y el que fija DÓNDE está el corte.
 *
 * El test de arriba prueba que el check EXISTE; no prueba en qué byte corta. Medido: mutar el check a
 * `< 262144` dejaba los 7 tests en verde, o sea que el límite se podía mover sin que nada avisara — y
 * 262144 es un default de producción, que sin test es una decisión sin dueño. Con este par, moverlo en
 * cualquier dirección tumba uno de los dos: bajarlo tumba éste, subirlo tumba el de arriba.
 *
 * `octet_length` cuenta BYTES, no caracteres; 'x' es un byte en UTF-8, así que `repeat(TOPE_BYTES)`
 * son exactamente 262144 bytes. (Un informe real lleva acentos y emojis: el tope es de bytes, y un
 * carácter multibyte gasta más de uno. Eso es lo que la constraint mide y lo que este test fija.)
 */
test("🔴 exactamente 262144 bytes (256 KiB) SÍ entra: el borde está donde dice", async () => {
  const runId = await crearRunSinInforme();
  const alBorde = "x".repeat(TOPE_BYTES);

  await db.asOrquestador(
    { tenantId: s.tenantA },
    `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
     select $1, $2, r.client_id, $3 from kr_runs r where r.id = $1`,
    [runId, s.tenantA, alBorde],
  );

  const [fila] = await db.asUser<{ bytes: number }>(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select octet_length(informe_md)::int as bytes from kr_informes where run_id = $1",
    [runId],
  );
  assert.equal(fila?.bytes, TOPE_BYTES, "el informe del borde se guardó entero, sin truncar");
});

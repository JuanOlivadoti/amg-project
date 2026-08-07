import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { seed, TestDb, type Seed } from "./testdb.js";
import { PglitePool } from "./pool.js";
import { PgStore } from "./store.js";

/**
 * `guardarInforme` / `getInforme`: la escritura del orquestador y la lectura de la API.
 *
 * ## Dos stores, porque el rol es la credencial (ADR-17)
 *
 * El store del orquestador se construye con rol `app_service` —el que su login `amg_orquestador` tiene
 * concedido— y el de la API con `app_user` (`amg_api`). No es un parámetro cosmético: en producción cada
 * proceso tiene UN login con `NOINHERIT` autorizado a UN rol, así que un store de la API que pidiera
 * `app_service` no "haría trampa": Postgres rechazaría el `set role`. Probarlos con un solo rol probaría
 * un escenario que en producción no existe.
 *
 * Los dos pools envuelven la MISMA instancia de PGlite que `TestDb` (`db.pglite`), así que el store real
 * corre contra la base ya sembrada con dos tenants. Es el patrón de `sitios.test.ts` y `clientes.test.ts`.
 *
 * ## Por qué las preconditiones van con `asService` y no con `getInforme`
 *
 * Mismo criterio que la cabecera de `informes.test.ts` (T1): `asService` es el SUPERUSUARIO y salta RLS y
 * grants, así que **ninguna aseveración sobre la política puede pasar por él** —pasaría siempre—, pero una
 * aseveración sobre **si el dato existe** tiene que pasar por él, porque su respuesta no depende de la
 * política. Preguntárselo a `api.getInforme` sería circular: devuelve `null` tanto si la fila falta como
 * si la política la esconde, que es exactamente la confusión que estas preconditiones evitan.
 */
let db: TestDb;
let s: Seed;
let servicio: PgStore;
let api: PgStore;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  const pool = new PglitePool(db.pglite);
  servicio = new PgStore(pool, "app_service"); // el orquestador: escribe
  api = new PgStore(pool, "app_user"); // la API: lee (staff, vía RLS)
});
after(async () => {
  await db.close();
});

const V1 = "# Informe\n\nprimera versión";
const V2 = "# Informe\n\nsegunda versión";
const V3 = "# Informe\n\ntercera versión";

/**
 * La fila cruda, vista por el superusuario. Es la única forma no circular de preguntar "¿existe?".
 *
 * Devuelve `null` y no `[]` para que el sitio de llamada lea igual que `getInforme` y la diferencia entre
 * los dos quede en QUIÉN pregunta, que es lo único que se está distinguiendo.
 */
async function informeCrudo(runId: string): Promise<{ generado_at: string } | null> {
  const filas = await db.asService<{ generado_at: string }>(
    "select generado_at from kr_informes where run_id = $1",
    [runId],
  );
  return filas[0] ?? null;
}

/** Un run del tenant A, del cliente A1, y SIN informe. Sembrar salta RLS a propósito: no asevera nada. */
async function crearRunSinInforme(): Promise<string> {
  const [run] = await db.asService<{ id: string }>(
    `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country,
                          market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'run sin informe', 'ES', 'es', 2724) returning id`,
    [s.tenantA, s.clientA1],
  );
  return run!.id;
}

const enMs = (t: string) => new Date(t).getTime();

test("guarda el informe y lo lee de vuelta", async () => {
  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, V1);

  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);
  assert.equal(informe?.informe_md, V1);
  assert.ok(informe?.generado_at, "trae la fecha de generación");
});

test("🔴 un reintento REESCRIBE el informe en vez de fallar por PK duplicada", async () => {
  /*
   * El step del orquestador es durable y se reintenta. Sin `on conflict`, el segundo intento revienta con
   * 23505 y el run queda sin cerrar.
   *
   * PRECONDICIÓN, y sin ella este test no prueba nada: si NO hubiera fila previa, el segundo
   * `guardarInforme` sería un insert limpio, el `on conflict` no se ejercitaría y el test pasaría en verde
   * con la cláusula borrada. Hoy la fila está porque el test de arriba está declarado antes — cierto, y
   * refactorizable sin que nada avise. Mismo criterio que `exigirQueElInformeExista` en `informes.test.ts`.
   */
  assert.ok(await informeCrudo(s.runA1), "precondición: el informe del primer render ya está en la tabla");

  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, V2);

  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);
  assert.equal(informe?.informe_md, V2, "gana el último render");
});

/**
 * 🔴 La pantalla muestra esta fecha junto al texto del informe, así que tiene que significar UNA sola
 * cosa: la fecha del render que se está mostrando. Si el `do update` no la toca, queda la del primer
 * render y la pantalla afirma una fecha que no corresponde al texto que tiene delante.
 *
 * ## Por qué NO hay un `setTimeout` acá
 *
 * La versión de la spec esperaba 5 ms confiando en que «`now()` tiene resolución de microsegundos».
 * **Medido en este PGlite (PostgreSQL 16.4, `@electric-sql/pglite@0.2.17`): la granularidad real es de 1
 * ms**, no de microsegundos — 200 muestras de `extract(epoch from now())*1000000` salieron todas múltiplos
 * de 1000 µs, y **125 de 199 pares de transacciones consecutivas devolvieron el MISMO `now()`**. O sea que
 * la afirmación del comentario era falsa y sin espera el test sería una moneda al aire. Con los 5 ms sí
 * avanzaba (40/40), pero eso hace depender una garantía de un reloj emulado con 5x de margen.
 *
 * Acá el reloj se saca de la ecuación: se RETRASA la fecha guardada a un instante conocido y se exige que
 * el reintento la mueva hacia adelante. Determinista, y la mutación muerde más fuerte — sin
 * `generado_at = now()` la fila se queda en el año 2000, que no se puede confundir con un empate de reloj.
 * La cota inferior del segundo assert es lo que impide que «avanzó» se cumpla con una fecha cualquiera:
 * tiene que ser >= el `now()` de la propia base leído justo antes del reintento.
 */
test("🔴 un reintento actualiza `generado_at`: es la fecha del ÚLTIMO render", async () => {
  const ANTIGUO = "2000-01-01T00:00:00.000Z";

  // Retrasar la fecha es sembrar, no aseverar sobre la política: va con el superusuario. Y el `returning`
  // es la PRECONDICIÓN: si no hubiera informe que retrasar, no habría nada que este test pudiera probar.
  const retrasadas = await db.asService(
    "update kr_informes set generado_at = $2 where run_id = $1 returning run_id",
    [s.runA1, ANTIGUO],
  );
  assert.equal(retrasadas.length, 1, "precondición: hay un informe al que retrasarle la fecha");

  // Cota inferior tomada del reloj de la BASE, no del de Node: es el reloj que escribe `now()`.
  const [reloj] = await db.asService<{ ahora: string }>("select now() as ahora");

  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, V3);

  const despues = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);
  assert.equal(despues?.informe_md, V3, "precondición: el reintento sí reescribió el texto");
  assert.ok(
    enMs(despues!.generado_at) > enMs(ANTIGUO),
    `generado_at tiene que avanzar con el reintento: quedó en ${despues?.generado_at}`,
  );
  assert.ok(
    enMs(despues!.generado_at) >= enMs(reloj!.ahora),
    `y tiene que ser la fecha de ESTE render, no una cualquiera: ${despues?.generado_at} < ${reloj?.ahora}`,
  );
});

test("🔴 guardar el informe NO revoca las aprobaciones de las páginas", async () => {
  /*
   * La tabla propia hace que este bug ya no se herede de un `where` compartido con el upsert de páginas
   * (que es lo que pasaba cuando el informe era una columna de `kr_runs`). Pero NO es una garantía
   * estructural: `app_service` tiene `update` sobre `kr_pages`, así que nada en el esquema impide que
   * alguien agregue ese `update` acá. Lo que la tabla propia compra es que ahora hay que escribirlo a
   * propósito. El test existe para que escribirlo cueste un rojo.
   */
  await db.asOrquestador(
    { tenantId: s.tenantA },
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy, url_slug,
                           keyword_principal, intencion, local, evidencia, approved, retirada)
     -- El vocabulario es el del CONTRATO, y ya no es una convención: lo imponen los cuatro checks de
     -- la 0017. Este fixture decía 'nueva'/'transaccional'/'respaldada' —tres palabras que no existen
     -- en ningún vocabulario del sistema— y la base las aceptaba porque las columnas eran text pelado.
     values ($1, $2, $3, gen_random_uuid(), 'servicio', 'single', '/aprobada', 'kw', 'transactional',
             false, 'datos_mercado', true, false)`,
    [s.tenantA, s.runA1, s.clientA1],
  );

  /*
   * Las dos lecturas van con `asService` a propósito, y acá se separa del borrador de la spec (que leía
   * con `asUser`): la pregunta es «¿esta fila sigue aprobada?», que es una pregunta sobre el DATO, no
   * sobre la política de `kr_pages` —que no está bajo prueba en este archivo—. Con `asUser`, un cambio en
   * esa política haría fallar este test con un mensaje que culparía a `guardarInforme`.
   */
  const aprobadaDe = async () =>
    (await db.asService<{ approved: boolean }>(
      "select approved from kr_pages where run_id = $1 and url_slug = '/aprobada'",
      [s.runA1],
    ))[0]?.approved;

  assert.equal(await aprobadaDe(), true, "precondición: la página se sembró APROBADA");

  await servicio.guardarInforme({ tenantId: s.tenantA }, s.runA1, "# Informe\n\notra versión");

  assert.equal(await aprobadaDe(), true, "la aprobación de la compuerta sigue en pie");
});

test("🔴 un run que no existe o no es visible LANZA, no guarda en silencio", async () => {
  /*
   * Si el insert no encuentra el run, `select … where r.id = $1` no devuelve filas y el insert no escribe
   * NADA — sin error. El step del orquestador daría por hecho que guardó, el run se cerraría en
   * `pending_approval` y el invariante "un run en pending_approval siempre tiene informe" quedaría roto en
   * silencio. Por eso el método comprueba el `returning` y lanza.
   *
   * PRECONDICIÓN: el run del tenant B tiene que EXISTIR. Si no existiera, este test pasaría por el caso
   * trivial ("no existe") y dejaría sin probar el que importa: existe, y RLS no lo deja ver. Va con el
   * superusuario porque preguntárselo bajo RLS del tenant A daría cero filas por el motivo que se está
   * probando, no por el que se está comprobando.
   */
  const ajeno = await db.asService("select id from kr_runs where id = $1", [s.runB1]);
  assert.equal(ajeno.length, 1, "precondición: el run del tenant B existe de verdad");

  await assert.rejects(
    () => servicio.guardarInforme({ tenantId: s.tenantA }, s.runB1, "# de otro tenant"),
    /no existe o no es visible/,
    "un run de otro tenant no se guarda ni se calla",
  );

  // La otra mitad del nombre del test: además de lanzar, no dejó fila. (Con el guard borrado esto sigue
  // siendo cierto — el insert escribe cero —, y por eso el que muerde es el `assert.rejects` de arriba.)
  assert.equal(await informeCrudo(s.runB1), null, "no quedó informe del run ajeno");
});

test("un run sin informe devuelve null, no lanza", async () => {
  // El caso honesto de "no hay fila": un run PROPIO y visible, sin informe. Con un run de otro tenant
  // (como hacía el borrador) el test no distingue "no hay fila" de "la política la esconde".
  const sinInforme = await crearRunSinInforme();
  assert.equal(await informeCrudo(sinInforme), null, "precondición: ese run no tiene informe");

  assert.equal(
    await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, sinInforme),
    null,
    "no hay fila: null (el endpoint lo traduce a 200 con null)",
  );

  // Y el run que NO es visible tampoco lanza: también null. Son dos caminos distintos al mismo contrato.
  assert.equal(
    await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runB1),
    null,
    "un run invisible no revienta la lectura: null",
  );
});

/**
 * 🔴 Añadido sobre la spec, y por qué: `informes.test.ts` (T1) ya prueba que la política le niega el
 * informe al rol `cliente` con SQL pelado, pero nadie probaba que el CAMINO QUE LA API VA A USAR
 * —`getInforme`— también se lo niegue. Es el método que el endpoint de T4 va a llamar con el usuario que
 * la petición traiga, sin ningún `if` de rol, así que la garantía de la pantalla pasa por acá.
 *
 * El informe lleva el desglose del coste que la agencia le paga a DataForSEO, o sea su margen, y `duenoA1`
 * es el dueño del negocio: ve su run y no puede ver el informe.
 */
/**
 * `generado_at` sale del store como `string` ISO, y esto se comprueba **en runtime**.
 *
 * El tipo `InformeRow` no puede probar nada de esto: `tx.query<T>` no valida, así que el `T` es una
 * promesa que nadie comprueba, y el driver entrega los `timestamptz` como `Date` de JS. Un contrato que
 * dijera `string` con un `Date` dentro haría que **cualquier** operación de cadena sobre el campo —`slice`,
 * `split`, `startsWith`— pasara `tsc` y lanzara un `TypeError` en producción. Es el defecto que KR-2a
 * arregló dos veces (`parseBrief`, `coste_breakdown`).
 *
 * Ningún consumidor de hoy opera la cadena (el único lee el campo y lo pasa al JSON), así que este test no
 * cubre un fallo en curso: fija el contrato para el primero que sí la opere.
 *
 * Por eso los asserts miran `typeof`, la FORMA de la cadena, que el instante no se haya movido, y que una
 * operación de string real funcione. Sin la conversión de `getInforme`, los cuatro se caen.
 */
test("🔴 `generado_at` es un string ISO en RUNTIME, no el `Date` que da el driver", async () => {
  const crudo = await informeCrudo(s.runA1);
  assert.ok(crudo, "precondición: el informe existe (si no, esto no prueba nada)");

  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.equipoA }, s.runA1);

  // `typeof` es lo único que mira el runtime en vez del tipo. Con el `Date` del driver da "object".
  assert.equal(
    typeof informe?.generado_at,
    "string",
    `el store tiene que devolver lo que su tipo promete; devolvió ${typeof informe?.generado_at}`,
  );

  // Y con forma ISO 8601 en UTC: es lo que el portal parsea y lo que el JSON del endpoint va a llevar.
  assert.match(
    informe!.generado_at,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    "ISO 8601 en UTC con milisegundos",
  );

  // La conversión no movió el instante: es la MISMA fecha que hay en la fila, en otra representación.
  assert.equal(
    new Date(informe!.generado_at).getTime(),
    new Date(crudo.generado_at).getTime(),
    "convertir no puede cambiar la fecha que se guardó",
  );

  /*
   * Y una operación de cadena de verdad, que es la FORMA que el fallo tomaría: sobre un `Date` esto lanza
   * `TypeError: ... is not a function`, y es justo lo que el tipo no atajaba. `slice` no está acá porque
   * ningún consumidor la use —ninguno la usa hoy—, sino porque es la operación más corta que distingue un
   * `string` de un `Date` en runtime.
   */
  assert.equal(informe!.generado_at.slice(0, 10).length, 10, "se puede operar como string de verdad");
});

test("🔴 `getInforme` no le da el informe al rol `cliente`, aunque el informe exista", async () => {
  assert.ok(await informeCrudo(s.runA1), "precondición: el informe existe (si no, esto no prueba nada)");

  const informe = await api.getInforme({ tenantId: s.tenantA, userId: s.duenoA1 }, s.runA1);
  assert.equal(informe, null, "el dueño del negocio no recibe el informe: lleva el margen de la agencia");
});

/**
 * 🔴 Añadido sobre la spec, y el hueco que cerró: nada probaba que ESCRIBIR el informe esté cerrado con
 * una CREDENCIAL y no con la buena voluntad del llamador.
 *
 * `guardarInforme` es un método público de `PgStore`, y en producción la API tiene un `PgStore` a mano
 * (`api/src/deps.ts`, rol `app_user`). Si la 0016 le hubiera dado permisos de escritura a `app_user` —un
 * `grant` de más es un renglón—, un endpoint podría escribir el informe de cualquier run que viera, y el
 * orden "primero el research, después el informe" dejaría de ser un hecho. Lo que lo impide es que el
 * grant de `app_user` sobre `kr_informes` es `select` A SECAS: Postgres corta con 42501 antes de RLS
 * (`equipoA` ES staff, así que la política lo dejaría pasar — lo que lo frena es la credencial).
 *
 * **Hacen falta DOS grants de más para abrir esto, medido.** Mutar la 0016 a `grant select, insert` NO
 * tumba este test: sigue dando 42501 sobre `kr_informes`, porque un `insert … on conflict do update`
 * exige los privilegios INSERT **y** UPDATE, y con uno solo Postgres 16.4 corta igual. La mutación que sí
 * lo tumba es `grant select, insert, update`. O sea que la primera mutación que se le ocurre a cualquiera
 * es incompleta, y el test aguanta más de lo que su nombre promete.
 *
 * El 42501 se exige nombrando `kr_informes` por el mismo motivo que en `informes.test.ts`: un test que solo
 * mirara el código podría quedarse verde por un permiso ajeno negado más adentro.
 */
test("🔴 el store de la API no puede ESCRIBIR el informe: le falta el grant, no un `if`", async () => {
  const runId = await crearRunSinInforme();

  await assert.rejects(
    () => api.guardarInforme({ tenantId: s.tenantA, userId: s.equipoA }, runId, "# escrito por la API"),
    (e: { code?: string; message?: string }) =>
      e.code === "42501" && (e.message ?? "").includes("kr_informes"),
    "el rol `app_user` solo tiene select: escribir da 42501 sobre kr_informes",
  );

  // Y no dejó rastro: la aseveración de que el 42501 no fue un falso negativo de un insert a medias.
  assert.equal(await informeCrudo(runId), null, "no quedó fila escrita por el rol de la API");
});

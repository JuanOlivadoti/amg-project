import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TestDb } from "./testdb.js";
import { ConexionReservada } from "./deploy.js";
import { PglitePool } from "./pool.js";
import { sembrarDemo, type ResultadoSeed } from "./seed-demo.js";
import { sembrarIdeasDemo, IDEAS_DEMO, MARCA_EJEMPLO } from "./seed-ideas-demo.js";
import { PgIdeas, ESTADOS_IDEA, type EstadoIdea } from "./ideas.js";

/**
 * Tests del seed de ideas de ejemplo (pieza 3 del portal, Etapa 4).
 *
 * Igual que `seed-demo.test.ts`, **no prueban "el insert corrió"**: prueban qué se ve **bajo RLS**,
 * con `app_user` y el rol derivado de `memberships` —el mismo camino que recorrerá `PgIdeas` desde la
 * API—. Leerlo con `asService` (superusuario) probaría otra cosa: que las filas existen, que es
 * justamente lo que no está en duda.
 *
 * Y prueban una segunda cosa que no es técnica y es la que más importa acá: que **las ideas se ven de
 * ejemplo desde la pantalla**. La Birra Bar es un restaurante real y esto siembra ideas inventadas en
 * su ficha; una idea falsa que un cuentas no pueda distinguir de una real en dos segundos es peor que
 * no tener seed. Por eso hay un test que recorre lo sembrado exigiendo la marca en cada campo que la
 * pantalla pinta, y otro que prohíbe inventar datos del negocio (precios).
 */

const FRANK = "11111111-1111-1111-1111-111111111111"; // maestro del tenant de la demo
const JUAN = "22222222-2222-2222-2222-222222222222"; // equipo
const INTRUSO = "44444444-4444-4444-4444-444444444444"; // sin ninguna membresía: no ve nada

/** PGlite es una sola conexión → una `ConexionReservada` válida para sembrar en los tests. */
const con = (d: TestDb) => ConexionReservada.desdePglite(d.pglite);

let db: TestDb;
let r: ResultadoSeed;
/** Dueño del negocio de la demo: rol `cliente`, atado al `client_id` de La Birra Bar. */
let dueno: string;
/** El OTRO tenant, con su equipo: sin él no hay nada cuya ausencia comprobar. */
let tenantB: string;
let equipoB: string;
/** El camino real del portal para mover una idea: bajo RLS y —a diferencia de `asUser`— con commit. */
let ideas: PgIdeas;

/** Lo que ve quien pregunta, bajo RLS. */
interface FilaIdea {
  id: string;
  titulo: string;
  estado: EstadoIdea;
  resumen: string | null;
  transcripcion: string | null;
  mensaje_de: string | null;
  audio_url: string | null;
  carpeta_url: string | null;
  analisis: Record<string, unknown>;
}

const COLS = "id, titulo, estado, resumen, transcripcion, mensaje_de, audio_url, carpeta_url, analisis";

/** Las ideas que ve `userId` en `tenantId`, con RLS en vigor. */
const verIdeas = (tenantId: string, userId: string): Promise<FilaIdea[]> =>
  db.asUser<FilaIdea>({ tenantId, userId }, `select ${COLS} from ideas order by titulo`);

before(async () => {
  db = await TestDb.create();
  r = await sembrarDemo(con(db), { frankUserId: FRANK, juanUserId: JUAN });
  // Misma instancia de PGlite que `TestDb`: el store va contra la MISMA base ya sembrada.
  ideas = new PgIdeas(new PglitePool(db.pglite));

  // El dueño del negocio: rol `cliente`, atado a SU client_id (lo exige `cliente_exige_client_id`).
  // Se crea acá y no en `sembrarDemo` porque aquel seed es el de producción y no da de alta clientes.
  const [d] = await db.asService<{ user_id: string }>(
    `insert into memberships (tenant_id, user_id, rol, client_id)
     values ($1, gen_random_uuid(), 'cliente', $2) returning user_id`,
    [r.tenantId, r.clientId],
  );
  dueno = d!.user_id;

  // El segundo tenant, con su propio equipo. El patrón de este repo: probar que el OTRO no ve.
  const [t] = await db.asService<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Agencia Rival', 'rival') returning id",
  );
  tenantB = t!.id;
  const [e] = await db.asService<{ user_id: string }>(
    `insert into memberships (tenant_id, user_id, rol, client_id)
     values ($1, gen_random_uuid(), 'equipo', null) returning user_id`,
    [tenantB],
  );
  equipoB = e!.user_id;

  await sembrarIdeasDemo(con(db), { tenantId: r.tenantId, clientId: r.clientId });
});

after(async () => {
  await db.close();
});

test("el seed deja las ideas de ejemplo, y se leen BAJO RLS (no con el superusuario)", async () => {
  const vistas = await verIdeas(r.tenantId, JUAN);
  assert.equal(vistas.length, IDEAS_DEMO.length, "el equipo de la agencia ve todas las ideas sembradas");
  assert.ok(IDEAS_DEMO.length > 0, "…y hay ideas que ver (si no, este test no mediría nada)");
});

/**
 * El propósito del seed: que la pantalla pueda ejercitar los cuatro estados y sus transiciones.
 *
 * Que se puedan INSERTAR los cuatro de una es una propiedad del esquema, no una casualidad: el
 * trigger `ideas_transicion_estado` es `before update`, así que no gobierna el INSERT (0013, y su
 * comentario lo declara explícitamente). Si alguien lo cambiara a `before insert or update`, el seed
 * dejaría de poder sembrar `aprobada` y este test caería.
 */
test("los CUATRO estados están representados (es para lo que existe el seed)", async () => {
  const vistas = await verIdeas(r.tenantId, JUAN);
  const presentes = new Set(vistas.map((i) => i.estado));
  for (const estado of ESTADOS_IDEA) {
    assert.ok(presentes.has(estado), `falta una idea en estado '${estado}'`);
  }
});

/**
 * 🔴 La marca de ejemplo, en TODOS los campos que la pantalla pinta.
 *
 * No alcanza con un comentario en el código ni con una nota en el informe: lo que decide es lo que
 * lee alguien mirando el portal. Misma regla que este proyecto ya aplicó con los precios de la carta
 * ("antes ausente que inventado") y con las fotos de stock, que por eso NO se siembran en la ficha de
 * La Birra Bar.
 *
 * Las aserciones sobre campos anulables llevan su contador: si un día todas las transcripciones
 * fueran `null`, el bucle no comprobaría nada y el test pasaría sin haber mirado una sola.
 */
test("🔴 cada idea sembrada se ve de EJEMPLO en el título, el resumen y la transcripción", async () => {
  const vistas = await verIdeas(r.tenantId, JUAN);
  assert.ok(vistas.length > 0, "sin filas no hay nada que comprobar");

  let conResumen = 0;
  let conTranscripcion = 0;
  let conAnalisis = 0;
  for (const i of vistas) {
    // El título SIEMPRE, sin excepción: en el listado es lo único que se lee.
    assert.ok(
      i.titulo.includes(MARCA_EJEMPLO),
      `el título '${i.titulo}' no lleva la marca ${MARCA_EJEMPLO}: en la tabla del portal es lo único que se ve`,
    );
    assert.match(i.mensaje_de ?? "", /EJEMPLO/, `el remitente de '${i.titulo}' parece una persona real`);

    // Los campos que el LLM rellena pueden faltar (una idea recién llegada no tiene resumen ni
    // transcripción todavía). Si están, van marcados; y los contadores de abajo impiden que el test
    // pase por no haber mirado ninguno.
    if (i.resumen !== null) {
      conResumen++;
      assert.match(i.resumen, /EJEMPLO/, `el resumen de '${i.titulo}' no está marcado`);
    }
    if (i.transcripcion !== null) {
      conTranscripcion++;
      assert.match(
        i.transcripcion.slice(0, 120),
        /EJEMPLO/,
        `la transcripción de '${i.titulo}' no avisa que es de prueba en su PRIMERA línea`,
      );
    }
    const observaciones = i.analisis["observaciones"];
    if (typeof observaciones === "string") {
      conAnalisis++;
      assert.match(observaciones, /EJEMPLO/, `el análisis de '${i.titulo}' no está marcado`);
    }
  }
  assert.ok(conResumen >= 1, "al menos una idea con resumen, o el bucle no miró ninguno");
  assert.ok(conTranscripcion >= 1, "al menos una idea con transcripción, o el bucle no miró ninguna");
  assert.ok(conAnalisis >= 1, "al menos una idea con análisis, o el bucle no miró ninguno");
});

/**
 * 🔴 El seed no inventa datos del negocio REAL.
 *
 * `PERFIL_DEMO` (seed-demo.ts) se niega a poner precios en la carta de La Birra Bar por esto mismo:
 * un importe puesto a ojo se publica y alguien puede ir esperando pagarlo. Una idea de ejemplo que
 * diga "el menú del día son 12,90 €" fabrica el mismo hecho, ahora en la pantalla de un cuentas.
 * Tampoco horarios: los reales están en `PERFIL_DEMO.locations` y una segunda copia inventada acá
 * contradiría a la web.
 */
test("🔴 ninguna idea de ejemplo inventa precios ni horarios de La Birra Bar", async () => {
  const vistas = await verIdeas(r.tenantId, JUAN);
  assert.ok(vistas.length > 0, "sin filas no hay nada que comprobar");

  for (const i of vistas) {
    const texto = [i.titulo, i.resumen, i.transcripcion, JSON.stringify(i.analisis)]
      .filter((t): t is string => t !== null)
      .join("\n");
    assert.doesNotMatch(texto, /€|\beuros?\b/i, `'${i.titulo}' menciona un importe`);
    assert.doesNotMatch(texto, /\b\d{1,2}[:h]\d{2}\b/, `'${i.titulo}' menciona un horario`);
  }
});

/**
 * Las tres claves que la Etapa 5 va a RECORRER tienen que llegar como arrays.
 *
 * `analisis` valida los NOMBRES de sus claves, no la forma de los valores (medido en la Etapa 3: un
 * `canales_comunicacion: {…}` entra y se guarda), y **`@for` sobre un objeto lanza en Angular**. La
 * pantalla comprueba `Array.isArray()` antes de listar, pero el seed no puede ser el dato que la
 * obligue a caer en el fallback: es el que se usa para ver la pantalla funcionando.
 *
 * Se lee de la BASE y no de la constante a propósito: lo que importa es lo que sale del `jsonb`
 * después del viaje de ida y vuelta.
 */
test("las tres claves que la pantalla lista llegan como ARRAY desde el jsonb", async () => {
  const vistas = await verIdeas(r.tenantId, JUAN);
  const conAnalisis = vistas.filter((i) => Object.keys(i.analisis).length > 0);
  assert.ok(conAnalisis.length > 0, "sin análisis no hay nada que comprobar");

  for (const i of conAnalisis) {
    for (const clave of ["canales_comunicacion", "materiales_formatos", "ideas_complementarias"]) {
      assert.ok(
        Array.isArray(i.analisis[clave]),
        `'${i.titulo}': analisis.${clave} no es un array, y la Etapa 5 lo recorre`,
      );
    }
  }
});

/**
 * El caso borde que la pantalla tiene que aguantar, sembrado a propósito.
 *
 * Es además el estado REAL de una idea recién entrada por el flujo de audio: la fila existe antes de
 * que el LLM la analice. Si el seed solo tuviera ideas completas, la Etapa 5 se escribiría contra un
 * dato que en producción no siempre existe.
 */
test("hay una idea SIN analizar (análisis vacío y sin transcripción): el hueco también se ve", async () => {
  const vistas = await verIdeas(r.tenantId, JUAN);
  const sinAnalizar = vistas.filter((i) => Object.keys(i.analisis).length === 0);
  assert.equal(sinAnalizar.length, 1, "exactamente una idea sin analizar");
  assert.equal(sinAnalizar[0]?.transcripcion, null, "tampoco tiene transcripción todavía");
  assert.equal(sinAnalizar[0]?.estado, "nueva", "una idea sin analizar solo puede estar en 'nueva'");
});

/**
 * El listado sale por fecha de creación, y el seed es lo que hace que eso se pueda comprobar.
 *
 * Las cinco ideas nacían con la MISMA `creada_en` —`now()` es el instante de la transacción—, así que
 * el `order by creada_en desc, id desc` de `listarIdeas` se resolvía entero por el desempate: ni el
 * test ni la pantalla veían nunca el criterio principal. Ahora cada idea tiene su antigüedad, y está
 * elegida para que **el orden por fecha contradiga al orden por id** — con los dos de acuerdo no se
 * puede distinguir cuál se aplicó, que es la trampa que la 13ª review encontró en el test de
 * `orden_brief`.
 *
 * Va por `listarIdeas` (el camino real de `GET /ideas`) y no por SQL propio: lo que se prueba es el
 * orden que va a ver el portal.
 */
test("el listado sale por fecha DESC, y ese orden contradice al de los ids", async () => {
  const porFecha = [...IDEAS_DEMO].sort((a, b) => a.dias_creada - b.dias_creada).map((i) => i.id);
  const porId = [...IDEAS_DEMO].map((i) => i.id).sort((a, b) => b.localeCompare(a));
  assert.notDeepEqual(porFecha, porId, "si los dos órdenes coinciden, este test no distingue cuál se aplicó");

  const listadas = await ideas.listarIdeas({ tenantId: r.tenantId, userId: JUAN });
  assert.deepEqual(listadas.map((i) => i.id), porFecha, "la más reciente primero");
});

test("ninguna idea dice que se actualizó ANTES de crearse", async () => {
  const vistas = await db.asUser<{ titulo: string; coherente: boolean }>(
    { tenantId: r.tenantId, userId: JUAN },
    "select titulo, actualizada_en >= creada_en as coherente from ideas",
  );
  assert.equal(vistas.length, IDEAS_DEMO.length);
  for (const i of vistas) assert.ok(i.coherente, `'${i.titulo}' se actualizó antes de existir`);
});

test("sembrar DOS veces no duplica: las mismas filas y los mismos ids", async () => {
  const antes = await verIdeas(r.tenantId, JUAN);
  await sembrarIdeasDemo(con(db), { tenantId: r.tenantId, clientId: r.clientId });
  const despues = await verIdeas(r.tenantId, JUAN);

  assert.equal(despues.length, antes.length, "re-sembrar no agrega filas");
  assert.deepEqual(
    despues.map((i) => i.id).sort(),
    antes.map((i) => i.id).sort(),
    "los ids son fijos: re-sembrar toca exactamente esas filas y ninguna más",
  );
});

/**
 * El caso que decide CÓMO se escribe la idempotencia, y por eso vale su propio test.
 *
 * Las ideas se re-siembran con `delete` + `insert` y no con `on conflict (id) do update`. El motivo
 * es el trigger `ideas_transicion_estado`: un upsert es un UPDATE, así que si la agencia movió la
 * idea a `en_revision` en el portal, re-sembrarla como `nueva` sería la transición `en_revision →
 * nueva` — que la máquina de estados rechaza con un 23514. O sea que el upsert es idempotente **solo
 * mientras nadie haya usado la pantalla**, que es exactamente cuando no hace falta.
 *
 * Mutación que lo tumba: cambiar el `delete` + `insert` de `seed-ideas-demo.ts` por un
 * `on conflict (id) do update`.
 *
 * ## El movimiento tiene que PERSISTIR, y esa es la mitad del test
 *
 * La primera versión movía la idea con `db.asUser`, que hace **`rollback`** al terminar cada llamada
 * ("los tests no se ensucian entre sí", `testdb.ts`). O sea que la idea nunca llegaba a quedar en
 * `en_revision` y el re-seed no se encontraba con nada: el test pasaba **con la mutación puesta**, y
 * lo destapó justamente la mutación. Por eso ahora la transición va por `PgIdeas.cambiarEstado` —el
 * camino real del portal, bajo RLS y con commit— y hay una lectura que confirma que quedó movida
 * ANTES de re-sembrar. Sin esa confirmación, el test volvería a poder mentir en silencio.
 */
test("re-sembrar DEVUELVE las ideas a su estado de ejemplo, aunque la agencia las haya movido", async () => {
  const [nueva] = await db.asUser<{ id: string }>(
    { tenantId: r.tenantId, userId: JUAN },
    "select id from ideas where estado = 'nueva' and transcripcion is not null limit 1",
  );
  assert.ok(nueva, "hace falta una idea 'nueva' analizada para poder moverla");

  // La agencia la pone en revisión desde el portal: transición válida, bajo RLS, como staff.
  const movida = await ideas.cambiarEstado({ tenantId: r.tenantId, userId: JUAN }, nueva.id, "en_revision");
  assert.equal(movida.ok, true, "el equipo SÍ puede mover el estado (si no, el test no prueba nada)");

  const [antesDelSeed] = await verIdeas(r.tenantId, JUAN).then((v) => v.filter((i) => i.id === nueva.id));
  assert.equal(
    antesDelSeed?.estado,
    "en_revision",
    "el movimiento tiene que haber QUEDADO: si se revierte, el re-seed no se encuentra con nada",
  );

  await sembrarIdeasDemo(con(db), { tenantId: r.tenantId, clientId: r.clientId });

  const despues = await verIdeas(r.tenantId, JUAN);
  assert.equal(despues.length, IDEAS_DEMO.length, "sigue sin duplicar");
  assert.equal(
    despues.find((i) => i.id === nueva.id)?.estado,
    "nueva",
    "la idea vuelve al estado de ejemplo: un seed que no se puede re-correr no es idempotente",
  );
});

// ============================================================ aislamiento

/**
 * 🔴 El patrón obligatorio de este repo: probar que el OTRO no ve. Un test que comprueba que el
 * equipo de la demo ve sus ideas pasa igual con RLS borrada.
 */
test("🔴 el OTRO tenant no ve ninguna idea del seed", async () => {
  const suyas = await verIdeas(tenantB, equipoB);
  assert.equal(suyas.length, 0, "las ideas de La Birra Bar no existen para otra agencia");
});

test("🔴 un usuario sin membresía no ve ninguna idea, aunque reclame el tenant correcto", async () => {
  const vistas = await verIdeas(r.tenantId, INTRUSO);
  assert.equal(vistas.length, 0, "sin membresía no hay rol, y sin rol no hay filas");
});

/**
 * 🔴 Que el dueño del negocio las vea es lo que ata el seed al `client_id` que se le pasó.
 *
 * `idea_select` deja a un rol `cliente` ver **solo las de su negocio**: si el seed las hubiera puesto
 * en otro cliente del mismo tenant, el equipo las seguiría viendo (staff ve todo el tenant) y nadie
 * se enteraría. Este es el test que lo nota.
 */
test("🔴 el dueño del negocio (rol cliente) ve las ideas: están en SU client_id", async () => {
  const suyas = await verIdeas(r.tenantId, dueno);
  assert.equal(suyas.length, IDEAS_DEMO.length, "el seed las puso en el cliente de la demo");
});

/**
 * 🔴 Este seed NO está enganchado a producción, y eso es una decisión con dueño.
 *
 * Producción tiene los datos reales de la demo; sembrar ahí ideas inventadas en la ficha de un
 * restaurante que existe es algo que nadie ha decidido. Hoy no pasa porque los dos caminos que
 * escriben en el Supabase real —el CLI `seed:demo` y el `reseed:demo` que lo envuelve— solo llaman a
 * `sembrarDemo`. Sin este test, engancharlo sería un import de una línea que nadie notaría en un
 * diff. Con él, hay que borrar un test que dice por qué, que es exactamente la conversación que
 * corresponde tener.
 *
 * Es un test estructural, así que empieza asegurando que leyó algo: un glob que no matchea, o un
 * archivo renombrado, dejarían el test verde sin haber comprobado nada.
 */
test("🔴 ningún camino que escriba en la base REAL siembra estas ideas", async () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  // Los dos de **siembra** y los dos del **proceso que habla con Supabase**. Los últimos dos no son
  // redundantes: `db/src/index.ts` exporta `sembrarIdeasDemo`, así que `import { sembrarIdeasDemo }
  // from "db"` compila desde cualquier paquete, y el camino real por el que esto llegaría a producción
  // es un import de una línea en el servidor que nadie nota en un diff. Sin ellos, el título de este
  // test («ningún camino que ESCRIBA en la base real») prometía más de lo que la lista cubría — lo
  // señaló la revisión de la etapa 4.
  const caminos = [
    join(raiz, "db", "src", "cli", "seed.ts"),
    join(raiz, "scripts", "reseed-demo.mts"),
    join(raiz, "api", "src", "server.ts"),
    join(raiz, "api", "src", "app.ts"),
  ];

  for (const camino of caminos) {
    const fuente = await readFile(camino, "utf8"); // si no existe, lanza: el test no puede pasar en vacío
    assert.ok(fuente.length > 0, `${camino} está vacío: este test no estaría comprobando nada`);
    assert.doesNotMatch(
      fuente,
      /sembrarIdeasDemo|seed-ideas-demo/,
      `${camino} siembra las ideas de ejemplo en una base REAL. Si es a propósito, decidilo y borrá este test.`,
    );
  }
});

/**
 * 🔴 ADR-20: la agencia revisa, el cliente no. El seed no cambia eso — y conviene fijarlo acá porque
 * es el seed el que pone en pantalla las ideas que un `cliente` podría intentar aprobar.
 */
test("🔴 el dueño del negocio VE sus ideas pero NO las puede tocar", async () => {
  const [suya] = await verIdeas(r.tenantId, dueno);
  assert.ok(suya, "el dueño ve al menos una idea");

  const afectadas = await db.asUser(
    { tenantId: r.tenantId, userId: dueno },
    "update ideas set titulo = 'mío' where id = $1 returning id",
    [suya.id],
  );
  assert.equal(afectadas.length, 0, "ver no es poder editar (idea_update: app.puede_escribir())");
});

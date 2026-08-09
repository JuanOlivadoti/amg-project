import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PGlite } from "@electric-sql/pglite";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { aplicarMigraciones, asegurarAuthStandIn, MIGRATIONS_DIR } from "./migrate.js";
import { PglitePool } from "./pool.js";
import { PgIdeas, ESTADOS_IDEA, TRANSICIONES_IDEA, esTransicionValida, LIMITE_IDEAS } from "./ideas.js";
import type { EstadoIdea } from "./ideas.js";

/**
 * Pieza 3 del portal — el módulo de IDEAS. Etapa 1 (el esquema) y Etapa 2 (la capa de datos).
 * Plan: `docs/superpowers/plans/2026-08-01-modulo-ideas-portal.md`, con la enmienda del 2026-08-02.
 *
 * Una idea es un audio que el cliente le manda a la agencia por WhatsApp: se transcribe, se analiza
 * con un LLM y la agencia lo revisa. O sea que esta tabla guarda **la voz de un cliente real**, y eso
 * fija las tres preguntas que gobiernan este archivo:
 *
 *   1. ¿El esquema guarda la forma prometida y rechaza lo que no lo es (enum, jsonb objeto, FK
 *      compuesta)?
 *   2. ¿Los permisos van **por verbo**? "Ver" y "poder tocar" no son lo mismo: un rol `cliente` ve su
 *      idea y NO puede editarla, aprobarla ni rechazarla — la revisa la agencia (ADR-20). Ese era el
 *      vector que la enmienda del plan encontró abierto, y por eso hay tests de ESCRITURA por rol y
 *      no solo de visibilidad.
 *   3. ¿La transcripción es inalcanzable para el renderizador anónimo (ADR-19)? El test lo exige
 *      afirmando **`permission denied`**, nunca "cero filas": con `force row level security` y sin
 *      policy para `app_render`, un `select` da cero filas AUNQUE exista el grant — un test que
 *      mirara el conteo no podría fallar, y un test de seguridad que no puede fallar es peor que no
 *      tenerlo.
 */

let db: TestDb;
let s: Seed;
let ideas: PgIdeas;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  // PGlite y TestDb comparten instancia: el pool de PgIdeas va contra la MISMA base ya sembrada
  // (mismo criterio que clientes.test.ts / sitios.test.ts). Sin esto habría que sembrar dos veces y
  // los tests probarían un escenario distinto del que dicen probar.
  ideas = new PgIdeas(new PglitePool(db.pglite));
});

after(async () => {
  await db.close();
});

/**
 * Crea una idea con el rol de INFRAESTRUCTURA (superusuario: salta RLS y grants).
 *
 * Es a propósito, y es lo único que puede hacerlo: `app_user` **no tiene grant de insert** sobre
 * `ideas` (ver la migración), porque el ingreso real de ideas es el flujo de audio (n8n) y todavía no
 * existe. Hasta entonces las ideas las crea el seed, que corre con esta misma autoridad.
 */
async function crearIdea(campos: {
  tenantId: string;
  clientId: string;
  titulo?: string;
  estado?: string;
  transcripcion?: string;
  analisis?: Record<string, unknown>;
}): Promise<string> {
  const [row] = await db.asService<{ id: string }>(
    `insert into ideas (tenant_id, client_id, titulo, estado, transcripcion, analisis)
     values ($1, $2, $3, coalesce($4::idea_estado, 'nueva'), $5, coalesce($6::jsonb, '{}'::jsonb))
     returning id`,
    [
      campos.tenantId,
      campos.clientId,
      campos.titulo ?? "Idea de prueba",
      campos.estado ?? null,
      campos.transcripcion ?? null,
      campos.analisis ? JSON.stringify(campos.analisis) : null,
    ],
  );
  return row!.id;
}

// ============================================================ Etapa 1 — el esquema
// Todo esto va con SQL crudo bajo `db.asUser` / `db.asRender` (que hacen rollback por llamada): lo
// que se prueba es LA BASE, no la capa de TypeScript. El modelo de amenaza realista es alguien que
// consigue ejecutar SQL con el rol `app_user` y un contexto de tenant válido; si la base lo frena
// ahí, lo frena de verdad.

test("una idea con todo el análisis se guarda y se lee igual", async () => {
  const analisis = {
    audiencia_objetivo: "familias del barrio de Salamanca",
    canales_comunicacion: ["instagram", "whatsapp"],
    intencion: "promocionar el menú de verano",
    materiales_formatos: ["reel", "cartel A3"],
    observaciones: "el cliente quiere fotos de la terraza",
    checklist_interpretacion: [{ punto: "fecha de inicio", claro: false }],
    ideas_complementarias: ["sorteo de dos menús"],
    tipo_accion: "campaña",
  };

  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1 });
  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    `update ideas set
       titulo = 'Menú de verano en la terraza',
       resumen = 'Campaña para el menú de verano',
       transcripcion = 'hola, buenas, quería comentaros lo del menú de verano...',
       audio_url = 'https://audios.example.com/ideas/abc.ogg',
       carpeta_url = 'https://drive.example.com/carpeta/abc',
       mensaje_de = 'Marco (La Birra Bar)',
       analisis = $2::jsonb
     where id = $1
     returning titulo, resumen, estado, transcripcion, audio_url, carpeta_url, mensaje_de, analisis`,
    [id, JSON.stringify(analisis)],
  );

  assert.equal(row?.["titulo"], "Menú de verano en la terraza");
  assert.equal(row?.["resumen"], "Campaña para el menú de verano");
  assert.equal(row?.["estado"], "nueva");
  assert.equal(row?.["transcripcion"], "hola, buenas, quería comentaros lo del menú de verano...");
  assert.equal(row?.["audio_url"], "https://audios.example.com/ideas/abc.ogg");
  assert.equal(row?.["carpeta_url"], "https://drive.example.com/carpeta/abc");
  assert.equal(row?.["mensaje_de"], "Marco (La Birra Bar)");
  assert.deepEqual(row?.["analisis"], analisis, "el análisis del LLM vuelve tal cual, sin recortes");
});

/**
 * 🔴 EL DEFAULT DE PRODUCCIÓN. `nueva` es el estado con el que nacería una idea que entra por el
 * flujo de audio, así que lleva su propio test — y el test **no pasa el estado como parámetro**: si
 * lo pasara, estaría fijando el valor que elige el test, no el que corre en producción.
 */
test("🔴 una idea insertada SIN estado nace en 'nueva' (el default de producción)", async () => {
  const [row] = await db.asService(
    `insert into ideas (tenant_id, client_id, titulo)
     values ($1, $2, 'Sin estado explícito')
     returning estado, analisis, creada_en, actualizada_en`,
    [s.tenantA, s.clientA1],
  );

  assert.equal(row?.["estado"], "nueva", "el default de la columna, no el que elija quien inserta");
  assert.deepEqual(row?.["analisis"], {}, "y el análisis nace vacío, no NULL");
  assert.ok(row?.["creada_en"], "creada_en tiene default");
  assert.ok(row?.["actualizada_en"], "actualizada_en tiene default");
});

test("🔴 un estado que no existe se rechaza: 'aprovada' no es un idea_estado", async () => {
  await assert.rejects(
    () =>
      db.asService(
        `insert into ideas (tenant_id, client_id, titulo, estado)
         values ($1, $2, 'Con typo', 'aprovada')`,
        [s.tenantA, s.clientA1],
      ),
    /invalid input value for enum|idea_estado/i,
    "un `text` habría aceptado el typo y nadie se entera hasta que la pantalla filtre y no encuentre nada",
  );
});

test("🔴 una idea con el client_id de OTRO tenant se rechaza (FK compuesta)", async () => {
  await assert.rejects(
    () =>
      db.asService(
        `insert into ideas (tenant_id, client_id, titulo)
         values ($1, $2, 'Idea cruzada')`,
        // tenant A + cliente del tenant B: cada uno existe por separado, el PAR no.
        [s.tenantA, s.clientB1],
      ),
    /foreign key|violat/i,
    "RLS controla qué filas ves; la integridad entre tablas la da la FK compuesta. Hacen falta las dos",
  );
});

test("🔴 un análisis que no es un objeto se rechaza (jsonb_typeof)", async () => {
  for (const valor of ['"un string"', "[1, 2, 3]", "42", "null"]) {
    await assert.rejects(
      () =>
        db.asService(
          `insert into ideas (tenant_id, client_id, titulo, analisis)
           values ($1, $2, 'Análisis roto', '${valor}'::jsonb)`,
          [s.tenantA, s.clientA1],
        ),
      /violat|not-null|check/i,
      `analisis = ${valor} tendría que romper: la forma del valor, no solo el nombre de la clave`,
    );
  }
});

// ---------------------------------------------------------------- techos de tamaño

/**
 * TOPES DE TAMAÑO. Mismo argumento que `db/migrations/0016_informe_kr.sql:50-56` y mismo sitio: la
 * migración que crea la tabla, que hoy es **el único punto de escritura**. Con las constraints
 * puestas, ni el endpoint de la Etapa 3 ni la pantalla necesitan lógica de tamaño — no pueden recibir
 * algo que no entró.
 *
 * Los tests van con `db.asService` (la infraestructura, que salta RLS y grants): un `check` no
 * distingue quién escribe, y así se prueba el techo aunque hoy `app_user` ni siquiera tenga `insert`.
 * Cada caso prueba el borde: **justo dentro pasa, un byte más se rechaza**. Sin el "justo dentro" el
 * test pasaría igual con un techo absurdamente bajo, y no estaría fijando el número sino su existencia.
 */
const TECHOS: Array<{ columna: string; limite: number; constraint: string }> = [
  { columna: "titulo", limite: 200, constraint: "idea_titulo_razonable" },
  { columna: "resumen", limite: 2_048, constraint: "idea_resumen_razonable" },
  { columna: "transcripcion", limite: 65_536, constraint: "idea_transcripcion_razonable" },
  { columna: "mensaje_de", limite: 200, constraint: "idea_mensaje_de_razonable" },
  { columna: "audio_url", limite: 2_048, constraint: "idea_url_razonable" },
  { columna: "carpeta_url", limite: 2_048, constraint: "idea_url_razonable" },
];

test("🔴 cada campo de texto tiene un techo en la BASE: justo dentro pasa, un byte más se rechaza", async () => {
  for (const { columna, limite, constraint } of TECHOS) {
    // `titulo` es `not null`, así que ya va en el insert: nombrarlo dos veces sería un error de SQL.
    const insert =
      columna === "titulo"
        ? "insert into ideas (tenant_id, client_id, titulo) values ($1, $2, $3)"
        : `insert into ideas (tenant_id, client_id, titulo, ${columna}) values ($1, $2, 'Techo', $3)`;

    const [ok] = await db.asService<Record<string, string>>(
      `${insert} returning octet_length(${columna}) as n`,
      [s.tenantA, s.clientA1, "a".repeat(limite)],
    );
    assert.equal(Number(ok?.["n"]), limite, `${columna}: el límite exacto tiene que ENTRAR`);

    await assert.rejects(
      () => db.asService(insert, [s.tenantA, s.clientA1, "a".repeat(limite + 1)]),
      new RegExp(constraint, "i"),
      `${columna}: un byte más que ${limite} tiene que caer por ${constraint}`,
    );
  }
});

test("🔴 el techo cuenta BYTES, no caracteres: un texto con acentos ocupa el doble", async () => {
  // 150 caracteres 'ñ' son 300 BYTES en UTF-8. El número está elegido para que la mutación sea
  // alcanzable: con `length` en vez de `octet_length` el check vería 150 (≤ 200) y **dejaría pasar**
  // una fila que ocupa el doble del techo. Con 201 caracteres el test pasaría con las dos versiones y
  // no estaría midiendo nada.
  const acentuado = "ñ".repeat(150);
  await assert.rejects(
    () =>
      db.asService(
        "insert into ideas (tenant_id, client_id, titulo) values ($1, $2, $3)",
        [s.tenantA, s.clientA1, acentuado],
      ),
    /idea_titulo_razonable/i,
    "150 caracteres 'ñ' son 300 bytes: por encima del techo aunque sean pocos caracteres",
  );
});

test("🔴 `analisis` también tiene techo, medido sobre su representación de texto", async () => {
  const cabe = { relleno: "x".repeat(30_000) };
  const [ok] = await db.asService<{ n: string }>(
    `insert into ideas (tenant_id, client_id, titulo, analisis)
     values ($1, $2, 'Análisis', $3::jsonb) returning octet_length(analisis::text) as n`,
    [s.tenantA, s.clientA1, JSON.stringify(cabe)],
  );
  assert.ok(Number(ok?.n) <= 32_768, "el caso normal entra de sobra");

  await assert.rejects(
    () =>
      db.asService(
        `insert into ideas (tenant_id, client_id, titulo, analisis)
         values ($1, $2, 'Análisis enorme', $3::jsonb)`,
        [s.tenantA, s.clientA1, JSON.stringify({ relleno: "x".repeat(40_000) })],
      ),
    /idea_analisis_razonable/i,
    "un jsonb sin tope es una fila que puede crecer sin techo",
  );
});

test("🔴 los techos también frenan un UPDATE, no solo el INSERT", async () => {
  // El camino que va a existir de verdad en la Etapa 3 es `editarIdea`, que es un UPDATE. Un check de
  // columna aplica a los dos, pero eso hay que probarlo: es justo la clase de cosa que se asume.
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1 });
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update ideas set transcripcion = $2 where id = $1",
        [id, "a".repeat(65_537)],
      ),
    /idea_transcripcion_razonable/i,
  );
});

// ---------------------------------------------------------------- RLS: aislamiento entre tenants

test("🔴 el tenant B NO ve las ideas del tenant A", async () => {
  const idA = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "Secreto de A" });

  const filasB = await db.asUser({ tenantId: s.tenantB, userId: s.equipoB }, "select id from ideas");
  const ids = filasB.map((r) => (r as { id: string }).id);
  assert.ok(!ids.includes(idA), "el equipo del tenant B no puede ver una idea del tenant A");

  // Y pedirla por id explícitamente tampoco: cero filas, no el dato.
  const directo = await db.asUser(
    { tenantId: s.tenantB, userId: s.equipoB },
    "select id, transcripcion from ideas where id = $1",
    [idA],
  );
  assert.equal(directo.length, 0, "pedir el id ajeno explícitamente devuelve cero filas");
});

test("🔴 un usuario SIN membresía no ve ninguna idea, aunque reclame un tenant válido", async () => {
  await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1 });
  const filas = await db.asUser({ tenantId: s.tenantA, userId: s.intruso }, "select id from ideas");
  assert.equal(filas.length, 0, "sin membresía no hay rol, y sin rol la allowlist positiva no concede nada");
});

/**
 * 🔴 El caso que la política vieja de `clients` resolvía mal: un rol `cliente` está atado a UN
 * `client_id` (`cliente_exige_client_id`, 0001) y no puede ver las ideas de los otros negocios del
 * mismo tenant.
 */
test("🔴 un rol 'cliente' ve SOLO las ideas de su propio negocio, no las del vecino de tenant", async () => {
  const ideaSuya = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "De A1" });
  const ideaAjena = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA2, titulo: "De A2" });

  const filas = await db.asUser({ tenantId: s.tenantA, userId: s.duenoA1 }, "select id from ideas");
  const ids = filas.map((r) => (r as { id: string }).id);

  assert.ok(ids.includes(ideaSuya), "el dueño de A1 ve su propia idea");
  assert.ok(!ids.includes(ideaAjena), "y NO ve la del otro cliente del mismo tenant");

  // El staff del mismo tenant sí ve las dos: si no, este test pasaría porque no hay nada que ver.
  const staff = await db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select id from ideas");
  const idsStaff = staff.map((r) => (r as { id: string }).id);
  assert.ok(
    idsStaff.includes(ideaSuya) && idsStaff.includes(ideaAjena),
    "control positivo: el equipo de la agencia sí ve las dos",
  );
});

// ---------------------------------------------------------------- permisos POR VERBO

/**
 * 🔴 El vector de la enmienda del 2026-08-02: "ve las suyas" NO implica "no puede tocarlas". Con un
 * grant amplio y una policy de solo `using`, un rol `cliente` podría editar, aprobar o rechazar su
 * propia idea — lo contrario del producto (la agencia revisa, ADR-20).
 */
test("🔴 un rol 'cliente' NO puede editar su propia idea (0 filas), y el equipo SÍ", async () => {
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "Original" });

  const comoCliente = await db.asUser(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    "update ideas set titulo = 'Editada por el cliente' where id = $1 returning id",
    [id],
  );
  assert.equal(comoCliente.length, 0, "el dueño del negocio no afecta ninguna fila al editar su idea");

  const comoEquipo = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update ideas set titulo = 'Editada por la agencia' where id = $1 returning id",
    [id],
  );
  assert.equal(comoEquipo.length, 1, "control positivo: la agencia sí edita");
});

test("🔴 un rol 'cliente' NO puede aprobar ni rechazar su propia idea", async () => {
  const id = await crearIdea({
    tenantId: s.tenantA,
    clientId: s.clientA1,
    estado: "en_revision",
    titulo: "En revisión",
  });

  for (const destino of ["aprobada", "rechazada"]) {
    const filas = await db.asUser(
      { tenantId: s.tenantA, userId: s.duenoA1 },
      "update ideas set estado = $2::idea_estado where id = $1 returning id",
      [id, destino],
    );
    assert.equal(filas.length, 0, `el cliente no puede llevar su idea a '${destino}'`);
  }

  const [row] = await db.asService("select estado from ideas where id = $1", [id]);
  assert.equal(row?.["estado"], "en_revision", "la idea sigue esperando a que la revise la agencia");
});

test("🔴 nadie inserta ideas desde app_user: el ingreso real (audio/n8n) todavía no existe", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "insert into ideas (tenant_id, client_id, titulo) values ($1, $2, 'A mano')",
        [s.tenantA, s.clientA1],
      ),
    /permission denied|no tiene permiso/i,
    "sin grant de insert: una idea la crea el seed o el futuro ingreso, no una pantalla",
  );
});

test("🔴 nadie borra ideas desde app_user", async () => {
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1 });
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "delete from ideas where id = $1", [id]),
    /permission denied|no tiene permiso/i,
    "sin grant de delete: si algún día hace falta, se decide entonces",
  );
});

/**
 * 🔴 El grant de update es POR COLUMNA: mover una idea a otro tenant o a otro cliente no es una
 * edición, es otra operación — y no existe. Que lo impida el grant (y no una allowlist de
 * TypeScript) es lo que hace que no dependa de que nadie se olvide del filtro.
 */
test("🔴 ni el staff puede mover una idea de tenant o de cliente: el grant de update no incluye esas columnas", async () => {
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1 });

  await assert.rejects(
    () =>
      db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "update ideas set tenant_id = $2 where id = $1", [
        id,
        s.tenantB,
      ]),
    /permission denied|no tiene permiso/i,
    "tenant_id no está en el grant de update",
  );

  await assert.rejects(
    () =>
      db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "update ideas set client_id = $2 where id = $1", [
        id,
        s.clientA2,
      ]),
    /permission denied|no tiene permiso/i,
    "client_id tampoco: mover una idea de cliente es otra operación, y no se ofrece",
  );
});

/**
 * Los verbos concedidos, preguntándoselo a Postgres en vez de leyendo la migración. Este test cae si
 * alguien escribe `grant all`, si le concede algo al orquestador "por si acaso", o si le abre la
 * tabla al renderizador.
 *
 * Ojo con `user_update: false` en la tabla de abajo, que parece un error y no lo es: el grant de
 * UPDATE es **por columna**, y `has_table_privilege(..., 'update')` solo da `true` con un privilegio
 * a nivel de TABLA. Que acá sea `false` y que las columnas de más abajo sean `true` es justamente la
 * prueba de que el grant es acotado — si alguien lo cambiara por `grant update on ideas to app_user`,
 * esta línea se pondría `true` y el test caería.
 */
test("🔴 los grants sobre `ideas` son exactamente los enumerados: select para app_user, update POR COLUMNA, y NADA más", async () => {
  const [t] = await db.asService<Record<string, boolean>>(`
    select
      has_table_privilege('app_user',    'ideas', 'select') as user_select,
      has_table_privilege('app_user',    'ideas', 'update') as user_update,
      has_table_privilege('app_user',    'ideas', 'insert') as user_insert,
      has_table_privilege('app_user',    'ideas', 'delete') as user_delete,
      has_table_privilege('app_service', 'ideas', 'select') as service_select,
      has_table_privilege('app_service', 'ideas', 'insert') as service_insert,
      has_table_privilege('app_service', 'ideas', 'update') as service_update,
      has_table_privilege('app_render',  'ideas', 'select') as render_select,
      -- El QUINTO rol de aplicación, que es fácil de olvidar porque nació después (0018): el barrido
      -- de runs colgados. Solo toca kr_runs, y la promesa de este test es "y NADA mas" -- asi que
      -- tiene que preguntarlo, o no cubre lo que su titulo dice.
      has_table_privilege('app_barrido', 'ideas', 'select') as barrido_select,
      has_table_privilege('app_barrido', 'ideas', 'update') as barrido_update
  `);

  assert.deepEqual(t, {
    user_select: true,
    // `false` a propósito: el update se concede POR COLUMNA (ver el comentario del test). Si esto se
    // pusiera `true`, el grant habría dejado de ser acotado.
    user_update: false,
    user_insert: false,
    user_delete: false,
    // El orquestador no participa del módulo de ideas: sin privilegios especulativos. Si el ingreso
    // futuro los necesita, se los da el plan que lo construya.
    service_select: false,
    service_insert: false,
    service_update: false,
    // El renderizador anónimo, jamás.
    render_select: false,
    barrido_select: false,
    barrido_update: false,
  });

  const [c] = await db.asService<Record<string, boolean>>(`
    select
      has_column_privilege('app_user', 'ideas', 'titulo',        'update') as titulo,
      has_column_privilege('app_user', 'ideas', 'estado',        'update') as estado,
      has_column_privilege('app_user', 'ideas', 'transcripcion', 'update') as transcripcion,
      has_column_privilege('app_user', 'ideas', 'analisis',      'update') as analisis,
      has_column_privilege('app_user', 'ideas', 'tenant_id',     'update') as tenant_id,
      has_column_privilege('app_user', 'ideas', 'client_id',     'update') as client_id,
      has_column_privilege('app_user', 'ideas', 'id',            'update') as id,
      has_column_privilege('app_user', 'ideas', 'creada_en',     'update') as creada_en
  `);

  assert.deepEqual(c, {
    titulo: true,
    estado: true,
    transcripcion: true,
    analisis: true,
    tenant_id: false,
    client_id: false,
    id: false,
    creada_en: false,
  });
});

test("🔴 `ideas` tiene RLS FORZADA, no solo habilitada", async () => {
  const [row] = await db.asService<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'ideas'",
  );
  assert.equal(row?.relrowsecurity, true, "enable row level security");
  assert.equal(row?.relforcerowsecurity, true, "force: sin esto, el DUEÑO de la tabla salta las políticas");
});

// ---------------------------------------------------------------- ADR-19: el renderizador anónimo

const COLUMNAS_SENSIBLES = [
  "transcripcion",
  "analisis",
  "audio_url",
  "carpeta_url",
  "mensaje_de",
  "titulo",
  "resumen",
  "estado",
] as const;

/**
 * 🔴 El test de fuga, escrito para que PUEDA FALLAR.
 *
 * Afirma **`permission denied`** (fallo de ACL), no "cero filas". Con `force row level security` y
 * sin policy para `app_render`, un `select` devuelve cero filas *aunque exista el grant*: un test que
 * mirara el conteo pasaría igual y su mutación de control (`grant select on ideas to app_render`) no
 * caería. Verificado por mutación — ver el informe de la etapa.
 */
test("🔴 app_render NO llega a `ideas`: ni a la tabla ni a ninguna columna (permission denied, no cero filas)", async () => {
  await assert.rejects(
    () => db.asRender("select * from ideas"),
    /permission denied|no tiene permiso/i,
    "la tabla entera está fuera del alcance del rol expuesto a internet anónimo",
  );

  for (const columna of COLUMNAS_SENSIBLES) {
    await assert.rejects(
      () => db.asRender(`select ${columna} from ideas`),
      /permission denied|no tiene permiso/i,
      `${columna} no debería tener ningún grant a app_render`,
    );
  }

  // Y contar tampoco: `count(*)` no nombra ninguna columna, así que es el camino que se escaparía de
  // un grant por columna mal puesto.
  await assert.rejects(
    () => db.asRender("select count(*) from ideas"),
    /permission denied|no tiene permiso/i,
    "ni siquiera cuántas ideas hay",
  );
});

test("🔴 el orquestador (app_service) tampoco toca `ideas`", async () => {
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: null, servicio: true }, "select id from ideas"),
    /permission denied|no tiene permiso/i,
    "sin privilegios especulativos: el ingreso futuro se los pedirá cuando exista",
  );
});

// ---------------------------------------------------------------- la máquina de estados, en la base

test("🔴 el trigger rechaza una transición inválida aunque la pida el staff: aprobada → nueva no existe", async () => {
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, estado: "aprobada" });

  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update ideas set estado = 'nueva' where id = $1",
        [id],
      ),
    /transici|invalid/i,
    "el estado cambia por transiciones válidas, no por asignación libre",
  );

  const [row] = await db.asService("select estado from ideas where id = $1", [id]);
  assert.equal(row?.["estado"], "aprobada");
});

test("editar una idea SIN tocar el estado funciona en los cuatro estados", async () => {
  for (const estado of ["nueva", "en_revision", "aprobada", "rechazada"]) {
    const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, estado });
    const filas = await db.asUser(
      { tenantId: s.tenantA, userId: s.equipoA },
      "update ideas set resumen = 'corregido' where id = $1 returning estado",
      [id],
    );
    assert.equal(filas.length, 1, `una idea en '${estado}' se puede seguir editando`);
    assert.equal(filas[0]?.["estado"], estado, "y su estado no se mueve");
  }
});

/**
 * `actualizada_en` la gobierna LA TABLA, no el llamador.
 *
 * El test no compara relojes a propósito, y esto costó una corrida flaky antes de encontrarlo:
 * `now()` es el instante de la TRANSACCIÓN, y contra PGlite dos statements consecutivos comparten
 * marca lo bastante seguido como para que un `>` falle una de cada tres veces. Medir "avanzó" no era
 * medir la garantía, era medir el reloj.
 *
 * Lo que sí es determinista —y además es exactamente la garantía que interesa— es que el trigger
 * PISA lo que el llamador intente escribir: se fuerza `actualizada_en` al año 2000 con la autoridad
 * de la infraestructura (la única que puede nombrar esa columna: no está en el grant de `app_user`) y
 * se comprueba que la fila no quedó en el año 2000. Si el trigger no existe, el 2000 sobrevive.
 */
test("actualizada_en la gobierna la tabla: el trigger pisa lo que escriba el llamador", async () => {
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1 });
  const [antes] = await db.asService<{ creada_en: Date }>("select creada_en from ideas where id = $1", [id]);

  await db.asService(
    "update ideas set resumen = 'tocado', actualizada_en = '2000-01-01T00:00:00Z' where id = $1",
    [id],
  );

  const [despues] = await db.asService<{ creada_en: Date; actualizada_en: Date }>(
    "select creada_en, actualizada_en from ideas where id = $1",
    [id],
  );

  const marca = new Date(despues!.actualizada_en).getTime();
  assert.ok(
    marca > new Date("2001-01-01T00:00:00Z").getTime(),
    "el trigger tiene que haber pisado el valor que trajo el update",
  );
  assert.ok(
    Math.abs(marca - Date.now()) < 5 * 60 * 1000,
    "y haberlo dejado en el momento del cambio, no en una fecha cualquiera",
  );
  assert.equal(
    new Date(despues!.creada_en).getTime(),
    new Date(antes!.creada_en).getTime(),
    "creada_en no se mueve nunca",
  );
});

// ============================================================ Etapa 2 — la capa de datos
//
// Lo de arriba prueba EL ESQUEMA con SQL crudo (el modelo de amenaza realista: alguien que consigue
// ejecutar SQL con el rol `app_user` y un contexto válido). Lo de acá abajo prueba `PgIdeas`, que
// escribe de verdad (commit real, vía `PglitePool`) — por eso cada test crea sus propias ideas en vez
// de reutilizar las de arriba.
//
// Los tests de listado y filtros van sobre el TENANT B a propósito: el tenant A quedó con ideas
// sembradas por la sección anterior, y un test de conteo sobre datos que otro test dejó es un test
// que se rompe solo cuando alguien agregue un caso más arriba.

/**
 * 🔴 EL CONTRATO DE EXPOSICIÓN (enmienda del 2026-08-02, y de esto depende la pieza 4).
 *
 * El listado devuelve un RESUMEN. La transcripción y el análisis son el dato más sensible del
 * sistema; mandarlos en una respuesta de listado para que el dashboard pinte un contador es filtrarlo
 * por comodidad. Y el recorte empieza acá, en el `select`, no en un DTO de la API: lo que no sale de
 * Postgres no se puede olvidar de filtrar después.
 */
test("🔴 listarIdeas devuelve un RESUMEN: nunca transcripción ni análisis, ni siquiera para el staff", async () => {
  await crearIdea({
    tenantId: s.tenantB,
    clientId: s.clientB1,
    titulo: "Con datos sensibles",
    transcripcion: "esto no puede viajar en un listado",
    analisis: { intencion: "tampoco esto" },
  });

  const filas = await ideas.listarIdeas({ tenantId: s.tenantB, userId: s.equipoB });
  assert.ok(filas.length > 0, "sin filas, este test no comprobaría nada");

  for (const fila of filas) {
    const claves = Object.keys(fila).sort();
    assert.deepEqual(
      claves,
      ["client_id", "creada_en", "estado", "id", "titulo"],
      "el resumen tiene exactamente estas cinco claves: agregar una es una decisión, no un descuido",
    );
  }
});

test("listarIdeas filtra por estado y por cliente", async () => {
  const [c] = await db.asService<{ id: string }>(
    "insert into clients (tenant_id, nombre) values ($1, 'Otro negocio de B') returning id",
    [s.tenantB],
  );
  const otroCliente = c!.id;

  const enRevision = await crearIdea({
    tenantId: s.tenantB,
    clientId: s.clientB1,
    titulo: "B1 en revisión",
    estado: "en_revision",
  });
  const aprobada = await crearIdea({
    tenantId: s.tenantB,
    clientId: otroCliente,
    titulo: "Otro cliente, aprobada",
    estado: "aprobada",
  });

  const ctx = { tenantId: s.tenantB, userId: s.equipoB };

  const porEstado = await ideas.listarIdeas(ctx, { estado: "en_revision" });
  const idsEstado = porEstado.map((i) => i.id);
  assert.ok(idsEstado.includes(enRevision), "la idea en revisión está");
  assert.ok(!idsEstado.includes(aprobada), "la aprobada no");
  assert.ok(
    porEstado.every((i) => i.estado === "en_revision"),
    "y ninguna fila del resultado tiene otro estado",
  );

  const porCliente = await ideas.listarIdeas(ctx, { clientId: otroCliente });
  const idsCliente = porCliente.map((i) => i.id);
  assert.ok(idsCliente.includes(aprobada), "la del cliente pedido está");
  assert.ok(!idsCliente.includes(enRevision), "la del otro cliente no");

  const ambos = await ideas.listarIdeas(ctx, { estado: "aprobada", clientId: otroCliente });
  assert.deepEqual(
    ambos.map((i) => i.id),
    [aprobada],
    "los dos filtros se combinan con AND, no se pisan",
  );
});

test("listarIdeas ordena por creada_en descendente, con desempate determinista", async () => {
  const filas = await ideas.listarIdeas({ tenantId: s.tenantB, userId: s.equipoB });
  const fechas = filas.map((i) => new Date(i.creada_en).getTime());
  const ordenadas = [...fechas].sort((a, b) => b - a);
  assert.deepEqual(fechas, ordenadas, "la más reciente primero");
});

test("listarIdeas aplica el límite, y lo acota entre 1 y el máximo", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };
  const todas = await ideas.listarIdeas(ctx);
  assert.ok(todas.length >= 3, "hacen falta al menos 3 ideas para que el límite se note");

  assert.equal((await ideas.listarIdeas(ctx, { limite: 2 })).length, 2);
  assert.equal(
    (await ideas.listarIdeas(ctx, { limite: 0 })).length,
    1,
    "un límite de 0 se acota a 1: un listado que devuelve cero filas por un parámetro raro es un bug mudo",
  );
  assert.equal(
    (await ideas.listarIdeas(ctx, { limite: 10_000 })).length,
    todas.length,
    "y un límite absurdo se acota al máximo, no a lo que pida el llamador",
  );
  assert.ok(LIMITE_IDEAS.maximo >= LIMITE_IDEAS.porDefecto, "el máximo no puede ser menor que el default");
});

test("🔴 listarIdeas aísla por tenant: el tenant A no ve ninguna idea de B", async () => {
  const delB = await ideas.listarIdeas({ tenantId: s.tenantB, userId: s.equipoB });
  const delA = await ideas.listarIdeas({ tenantId: s.tenantA, userId: s.equipoA });

  const idsA = new Set(delA.map((i) => i.id));
  assert.ok(delB.length > 0 && delA.length > 0, "los dos tenants tienen ideas: hay algo cuya ausencia comprobar");
  for (const idea of delB) {
    assert.ok(!idsA.has(idea.id), `el tenant A no puede ver la idea ${idea.id} del tenant B`);
  }
});

test("🔴 listarIdeas con un rol 'cliente' devuelve SOLO las de su negocio", async () => {
  const suya = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "Del dueño de A1" });
  const ajena = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA2, titulo: "Del vecino A2" });

  const comoCliente = await ideas.listarIdeas({ tenantId: s.tenantA, userId: s.duenoA1 });
  const ids = comoCliente.map((i) => i.id);

  assert.ok(ids.includes(suya), "ve la suya");
  assert.ok(!ids.includes(ajena), "y no ve la del otro cliente del mismo tenant");
  assert.ok(
    comoCliente.every((i) => i.client_id === s.clientA1),
    "ninguna fila del resultado es de otro cliente",
  );

  // No hay ningún `if (rol === 'cliente')` en `listarIdeas` que hacer caer: el filtro lo aplica
  // `app.ve_cliente()` dentro de Postgres. El control positivo confirma que sí había algo que ocultar.
  const comoStaff = await ideas.listarIdeas({ tenantId: s.tenantA, userId: s.equipoA });
  assert.ok(comoStaff.map((i) => i.id).includes(ajena), "el staff sí ve la del vecino");
});

// ---------------------------------------------------------------- obtenerIdea (el detalle)

test("obtenerIdea devuelve el detalle completo, transcripción y análisis incluidos", async () => {
  const analisis = { intencion: "abrir los domingos", canales_comunicacion: ["instagram"] };
  const id = await crearIdea({
    tenantId: s.tenantB,
    clientId: s.clientB1,
    titulo: "Abrir los domingos",
    transcripcion: "pues eso, que si abrimos los domingos",
    analisis,
  });

  const idea = await ideas.obtenerIdea({ tenantId: s.tenantB, userId: s.equipoB }, id);
  assert.equal(idea?.id, id);
  assert.equal(idea?.titulo, "Abrir los domingos");
  assert.equal(idea?.estado, "nueva");
  assert.equal(idea?.transcripcion, "pues eso, que si abrimos los domingos");
  assert.deepEqual(idea?.analisis, analisis, "una idea a la vez, abierta a propósito por quien la revisa");
});

test("🔴 obtenerIdea de OTRO tenant devuelve null, no lanza y no revela existencia", async () => {
  const id = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "Solo de B" });
  const desdeA = await ideas.obtenerIdea({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.equal(desdeA, null, "bajo RLS un id ajeno no matchea ninguna fila: null, no un error");
});

test("🔴 obtenerIdea con rol 'cliente': la suya sí, la del vecino null", async () => {
  const suya = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "Detalle propio" });
  const ajena = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA2, titulo: "Detalle ajeno" });
  const ctx = { tenantId: s.tenantA, userId: s.duenoA1 };

  assert.equal((await ideas.obtenerIdea(ctx, suya))?.id, suya);
  assert.equal(await ideas.obtenerIdea(ctx, ajena), null);
});

// ---------------------------------------------------------------- cambiarEstado

test("cambiarEstado acepta las transiciones válidas del ciclo completo", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };

  const aAprobar = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "Camino a aprobada" });
  assert.deepEqual(await ideas.cambiarEstado(ctx, aAprobar, "en_revision"), { ok: true, estado: "en_revision" });
  assert.deepEqual(await ideas.cambiarEstado(ctx, aAprobar, "aprobada"), { ok: true, estado: "aprobada" });

  const aRechazar = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "Camino a rechazada" });
  assert.deepEqual(await ideas.cambiarEstado(ctx, aRechazar, "en_revision"), { ok: true, estado: "en_revision" });
  assert.deepEqual(await ideas.cambiarEstado(ctx, aRechazar, "rechazada"), { ok: true, estado: "rechazada" });
});

test("🔴 cambiarEstado rechaza las transiciones inválidas SIN tocar la fila (y sin lanzar)", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };

  const nueva = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "Nueva" });
  assert.deepEqual(
    await ideas.cambiarEstado(ctx, nueva, "aprobada"),
    { ok: false, motivo: "transicion_invalida", desde: "nueva" },
    "aprobar sin pasar por revisión se saltearía el producto entero: la agencia revisa",
  );

  const aprobada = await crearIdea({
    tenantId: s.tenantB,
    clientId: s.clientB1,
    titulo: "Ya aprobada",
    estado: "aprobada",
  });
  assert.deepEqual(await ideas.cambiarEstado(ctx, aprobada, "nueva"), {
    ok: false,
    motivo: "transicion_invalida",
    desde: "aprobada",
  });

  // Y la fila quedó como estaba: un rechazo no puede dejar la mitad escrita.
  assert.equal((await ideas.obtenerIdea(ctx, nueva))?.estado, "nueva");
  assert.equal((await ideas.obtenerIdea(ctx, aprobada))?.estado, "aprobada");
});

test("cambiarEstado de una idea que no existe (o es de otro tenant) devuelve no_encontrada", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const [fila] = await db.asService<{ id: string }>("select gen_random_uuid() as id");
  const inventado = fila!.id;

  assert.deepEqual(await ideas.cambiarEstado(ctx, inventado, "en_revision"), {
    ok: false,
    motivo: "no_encontrada",
  });

  const deB = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "De B" });
  assert.deepEqual(
    await ideas.cambiarEstado(ctx, deB, "en_revision"),
    { ok: false, motivo: "no_encontrada" },
    "no se revela que exista en otro tenant",
  );
});

/**
 * 🔴 Un `cliente` recibe SIEMPRE el mismo motivo, pida la transición que pida.
 *
 * La primera versión de `cambiarEstado` leía el estado con un `select` liso, y ese `select` SÍ le
 * devuelve la fila a un `cliente` (la ve por `idea_select`). Resultado: si pedía una transición
 * válida recibía `no_encontrada` (el `update` no afectaba filas) y si pedía una inválida recibía
 * `transicion_invalida` — o sea, **404 o 400 según qué pidiera sobre la misma idea que no puede
 * tocar**, una incoherencia de contrato que la Etapa 3 iba a heredar.
 *
 * Lo cierra el `select … for update`: **Postgres aplica también el `using` de las políticas de UPDATE
 * a las filas que se bloquean** (medido: un `equipo` obtiene 1 fila y el dueño del negocio, 0, sobre
 * la MISMA idea), así que un `cliente` ni siquiera llega a la validación de transición.
 *
 * Este test cubre las dos ramas a propósito. Con una sola —la válida, que era lo que había— quitar el
 * `for update` no cambiaría nada y la mutación no caería.
 */
test("🔴 cambiarEstado con rol 'cliente' contesta no_encontrada en TODOS los casos (ADR-20)", async () => {
  const ctxCliente = { tenantId: s.tenantA, userId: s.duenoA1 };
  const id = await crearIdea({
    tenantId: s.tenantA,
    clientId: s.clientA1,
    titulo: "Que la apruebe la agencia",
    estado: "en_revision",
  });

  assert.deepEqual(
    await ideas.cambiarEstado(ctxCliente, id, "aprobada"),
    { ok: false, motivo: "no_encontrada" },
    "transición VÁLIDA: no la puede escribir",
  );
  assert.deepEqual(
    await ideas.cambiarEstado(ctxCliente, id, "nueva"),
    { ok: false, motivo: "no_encontrada" },
    "transición INVÁLIDA: el mismo motivo, no un 400 que revele que la máquina lo evaluó",
  );

  const [row] = await db.asService("select estado from ideas where id = $1", [id]);
  assert.equal(row?.["estado"], "en_revision", "la idea sigue esperando revisión");

  // Control positivo: sobre la MISMA idea, el staff sí distingue los dos motivos. Sin esto, el test
  // pasaría igual con un `cambiarEstado` que devolviera `no_encontrada` para todo el mundo.
  const ctxStaff = { tenantId: s.tenantA, userId: s.equipoA };
  assert.deepEqual(await ideas.cambiarEstado(ctxStaff, id, "nueva"), {
    ok: false,
    motivo: "transicion_invalida",
    desde: "en_revision",
  });
});

// ---------------------------------------------------------------- editarIdea

test("editarIdea escribe los campos de contenido y devuelve true", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };
  const id = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "Antes" });

  const ok = await ideas.editarIdea(ctx, id, {
    titulo: "Después",
    resumen: "resumen corregido",
    transcripcion: "transcripción corregida a mano",
    audio_url: "https://audios.example.com/otro.ogg",
    carpeta_url: "https://drive.example.com/otra",
    mensaje_de: "Ana",
    analisis: { intencion: "corregida" },
  });
  assert.equal(ok, true);

  const idea = await ideas.obtenerIdea(ctx, id);
  assert.equal(idea?.titulo, "Después");
  assert.equal(idea?.resumen, "resumen corregido");
  assert.equal(idea?.transcripcion, "transcripción corregida a mano");
  assert.equal(idea?.mensaje_de, "Ana");
  assert.deepEqual(idea?.analisis, { intencion: "corregida" });
});

/**
 * 🔴 La allowlist de columnas, probada como la prueba `crearCliente`: colándole al método claves que
 * su tipo no tiene. Un endpoint HTTP parseando JSON sin tipos (Etapa 3) es exactamente el caller que
 * lo intentaría.
 */
test("🔴 editarIdea ignora tenant_id, client_id, id y estado aunque se los cuelen en el objeto", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "No me muevas" });

  const ok = await ideas.editarIdea(ctx, id, {
    titulo: "Editada",
    // Nada de esto está en `CambiosIdea`; el `as` simula un caller sin tipos.
    tenant_id: s.tenantB,
    client_id: s.clientA2,
    id: "00000000-0000-0000-0000-000000000000",
    estado: "aprobada",
  } as Parameters<typeof ideas.editarIdea>[2]);
  assert.equal(ok, true, "el campo legítimo sí se escribió");

  const [row] = await db.asService("select tenant_id, client_id, estado, titulo from ideas where id = $1", [id]);
  assert.equal(row?.["tenant_id"], s.tenantA, "el tenant no se movió");
  assert.equal(row?.["client_id"], s.clientA1, "el cliente tampoco: mover una idea de cliente es otra operación");
  assert.equal(row?.["estado"], "nueva", "el estado solo cambia por cambiarEstado, que valida la transición");
  assert.equal(row?.["titulo"], "Editada");
});

test("editarIdea sin ningún cambio devuelve false y no toca la base", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };
  const id = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "Intacta" });

  const [antes] = await db.asService<{ actualizada_en: Date }>(
    "select actualizada_en from ideas where id = $1",
    [id],
  );
  assert.equal(await ideas.editarIdea(ctx, id, {}), false);
  const [despues] = await db.asService<{ actualizada_en: Date }>(
    "select actualizada_en from ideas where id = $1",
    [id],
  );

  assert.equal(
    new Date(despues!.actualizada_en).getTime(),
    new Date(antes!.actualizada_en).getTime(),
    "un PATCH vacío no puede marcar la idea como modificada",
  );
});

test("🔴 editarIdea de una idea de OTRO tenant devuelve false (0 filas), no lanza", async () => {
  const id = await crearIdea({ tenantId: s.tenantB, clientId: s.clientB1, titulo: "De B" });
  assert.equal(await ideas.editarIdea({ tenantId: s.tenantA, userId: s.equipoA }, id, { titulo: "Robada" }), false);

  const [row] = await db.asService("select titulo from ideas where id = $1", [id]);
  assert.equal(row?.["titulo"], "De B");
});

test("🔴 editarIdea con rol 'cliente' devuelve false: la idea la corrige la agencia", async () => {
  const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, titulo: "Del cliente" });
  assert.equal(
    await ideas.editarIdea({ tenantId: s.tenantA, userId: s.duenoA1 }, id, { titulo: "Editada por el cliente" }),
    false,
  );
});

// ---------------------------------------------------------------- las DOS copias de la máquina

/**
 * 🔴 EL TEST QUE ATA LAS DOS COPIAS de la máquina de estados: la de Postgres
 * (`app.idea_transicion_valida`, migración 0013) y la de TypeScript (`TRANSICIONES_IDEA`,
 * `db/src/ideas.ts`).
 *
 * Tener la regla en dos sitios es una decisión, no un descuido: en la base es la GARANTÍA (cualquier
 * `update` que no pase por `cambiarEstado` la respeta igual), y en TypeScript es lo que permite
 * contestar 400 en vez de 500. Lo que no puede pasar es que se desincronicen — es el mismo riesgo que
 * `cartera-portal.test.ts` cierra entre el brief y el portal.
 *
 * Recorre los 12 pares de estados DISTINTOS (el producto cartesiano menos la diagonal), intenta cada
 * uno contra Postgres y exige que el veredicto del motor coincida exactamente con el de
 * `esTransicionValida()`. Si alguien cambia una de las dos copias, este test cae.
 */
test("🔴 la máquina de estados de TypeScript dice EXACTAMENTE lo mismo que el trigger de Postgres", async () => {
  const pares: Array<[EstadoIdea, EstadoIdea]> = [];
  for (const desde of ESTADOS_IDEA) {
    for (const hacia of ESTADOS_IDEA) {
      if (desde !== hacia) pares.push([desde, hacia]);
    }
  }
  assert.equal(pares.length, 12, "4 estados → 12 pares distintos. Si esto cambia, el enum cambió");

  const validasSegunTs = pares.filter(([d, h]) => esTransicionValida(d, h));
  assert.equal(
    validasSegunTs.length,
    3,
    "nueva→en_revision, en_revision→aprobada, en_revision→rechazada. Ni una más",
  );

  for (const [desde, hacia] of pares) {
    const id = await crearIdea({ tenantId: s.tenantA, clientId: s.clientA1, estado: desde });

    let aceptadaPorPostgres = true;
    try {
      // Con el rol de infraestructura: salta RLS y grants, pero NO los triggers. Así lo que se mide
      // es la máquina de estados sola, sin que un rechazo por permisos la disfrace de rechazo válido.
      await db.asService("update ideas set estado = $2::idea_estado where id = $1", [id, hacia]);
    } catch {
      aceptadaPorPostgres = false;
    }

    assert.equal(
      aceptadaPorPostgres,
      esTransicionValida(desde, hacia),
      `${desde} → ${hacia}: Postgres dice ${aceptadaPorPostgres} y TypeScript dice ${esTransicionValida(desde, hacia)}`,
    );
  }
});

test("TRANSICIONES_IDEA cubre los cuatro estados del enum de Postgres, sin sobrar ni faltar", async () => {
  const enPostgres = (
    await db.asService<{ valor: string }>(
      "select unnest(enum_range(null::idea_estado))::text as valor order by 1",
    )
  ).map((r) => r.valor);

  assert.deepEqual(
    [...enPostgres].sort(),
    [...ESTADOS_IDEA].sort(),
    "si alguien agrega un estado al enum y no a TypeScript (o al revés), esto cae",
  );
  assert.deepEqual(
    Object.keys(TRANSICIONES_IDEA).sort(),
    [...ESTADOS_IDEA].sort(),
    "todos los estados tienen una entrada, incluidos los terminales (con lista vacía)",
  );
});

/**
 * 🔴 MOVER UNA IDEA A OTRO TENANT ES IMPOSIBLE, incluso si alguien ampliara el grant de update.
 *
 * Este test existe por un hallazgo de la verificación por mutación, y su enunciado se corrigió DOS
 * veces — vale la pena dejar el rastro, porque la primera versión era un test que pasaba por el
 * motivo equivocado:
 *
 *   1. Abrir el `with check` de `idea_update` a `true` dejaba los 40 tests en verde. Primera
 *      lectura: "falta un test". Se escribió éste, con el grant ampliado a toda la tabla.
 *   2. Con el test puesto, esa mutación SEGUÍA sin caer. Segunda lectura: medirlo en vez de
 *      suponerlo. Resultado (PGlite 16.4): con el `with check` abierto lo frena `idea_select`
 *      —Postgres exige que la fila NUEVA de un UPDATE pase las políticas de SELECT cuando la tabla
 *      tiene alguna, con `returning` y sin él—, y con `idea_select` abierta lo frena el `with check`.
 *      **Hacen falta las dos mutaciones a la vez** para que el update pase, y entonces sí, este test
 *      cae (comprobado).
 *
 * La conclusión no es "el test es débil": es que la garantía la sostienen dos redes independientes y
 * cada una alcanza sola, más el grant por columna delante, que ni siquiera deja nombrar `tenant_id`.
 * Un test que solo cae ante una mutación DOBLE es lo que se espera de una defensa en profundidad —
 * pero hay que saberlo, porque si no la próxima mutación individual que no tumbe nada se va a leer
 * como "esta línea sobra".
 *
 * El update mueve `tenant_id` **y** `client_id` juntos, a un par que existe de verdad en `clients`:
 * si moviera solo el tenant, lo rechazaría la FK compuesta (23503) y el test pasaría sin haber
 * ejercitado ninguna política. Por eso la aserción exige el mensaje de RLS, no un rechazo cualquiera.
 */
/**
 * Montaje de una base APARTE para los dos tests de traslado de tenant: su propio PGlite (no ensucian
 * la base compartida) con dos tenants, un cliente en cada uno, un `equipo` en A y una idea en (A, cA).
 *
 * Deja además el grant de update ampliado a TODA la tabla — el futuro hipotético en el que alguien lo
 * abre "para poder mover una idea de cliente". Sin esa ampliación, los dos tests pasarían por el grant
 * por columna y no llegarían a ejercitar ninguna política.
 */
async function baseParaTrasladoDeTenant() {
  const pg = new PGlite();
  await aplicarMigraciones(pg);

  const uno = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> =>
    (await pg.query<T>(sql, params)).rows[0]!;

  const { a: tA, b: tB } = await uno<{ a: string; b: string }>(`
    with a as (insert into tenants (nombre, slug) values ('A', 'a') returning id),
         b as (insert into tenants (nombre, slug) values ('B', 'b') returning id)
    select a.id as a, b.id as b from a, b
  `);
  const { id: cA } = await uno<{ id: string }>(
    "insert into clients (tenant_id, nombre) values ($1, 'Cliente A') returning id",
    [tA],
  );
  const { id: cB } = await uno<{ id: string }>(
    "insert into clients (tenant_id, nombre) values ($1, 'Cliente B') returning id",
    [tB],
  );
  const { user_id: equipo } = await uno<{ user_id: string }>(
    `insert into memberships (tenant_id, user_id, rol) values ($1, gen_random_uuid(), 'equipo')
     returning user_id`,
    [tA],
  );
  const { id: idea } = await uno<{ id: string }>(
    "insert into ideas (tenant_id, client_id, titulo) values ($1, $2, 'No me mudes') returning id",
    [tA, cA],
  );

  await pg.exec("grant update on ideas to app_user");

  /** Intenta llevarse la idea al tenant B, como `equipo` de A, y devuelve el error o `null`. */
  const intentarTraslado = async (): Promise<Error | null> => {
    await pg.exec("begin");
    try {
      await pg.query("select set_config('app.tenant_id', $1, true)", [tA]);
      await pg.query("select set_config('app.user_id', $1, true)", [equipo]);
      await pg.exec("set local role app_user");
      // El par (cB, tB) SÍ existe en `clients`, así que la FK compuesta se satisface: lo único que
      // puede rechazar este update es una política. Si moviera solo el tenant, lo pararía la FK
      // (23503) y el test pasaría sin haber ejercitado RLS ni una vez.
      await pg.query("update ideas set tenant_id = $2, client_id = $3 where id = $1", [idea, tB, cB]);
      return null;
    } catch (e) {
      return e as Error;
    } finally {
      await pg.exec("rollback");
    }
  };

  return { pg, tA, intentarTraslado, sigueEnSuTenant: async () => (await uno<{ tenant_id: string }>(
    "select tenant_id from ideas where id = $1",
    [idea],
  )).tenant_id === tA };
}

test("🔴 ni con el grant de update ampliado a toda la tabla se puede llevar una idea a otro tenant", async () => {
  const { pg, intentarTraslado, sigueEnSuTenant } = await baseParaTrasladoDeTenant();
  try {
    const error = await intentarTraslado();
    assert.match(
      error?.message ?? "SIN ERROR: el update fue aceptado",
      /row-level security/i,
      "con el grant ampliado, las políticas son lo único que queda en pie",
    );
    assert.ok(await sigueEnSuTenant(), "la idea sigue en su tenant");
  } finally {
    await pg.close();
  }
});

/**
 * 🔴 EL `with check` DE `idea_update`, PROBADO SOLO — y este test existe porque una mutación no caía.
 *
 * `with check (true)` dejaba los 46 tests en verde, incluido el de arriba. El motivo no es que la
 * línea sobre: es que **hay dos redes independientes y cada una alcanza sola**, así que ninguna
 * mutación individual las tumba. Postgres exige que la fila NUEVA de un UPDATE pase las políticas de
 * SELECT cuando la tabla tiene alguna, de modo que con `idea_select` intacta el traslado lo frena
 * ELLA y el `with check` no llega a evaluarse.
 *
 * Para medir esta red hay que **desactivar la otra**. Se hace con `alter policy` en runtime, sobre la
 * base aparte de este test: no se toca ningún archivo del repo, y la garantía deja de depender de un
 * comentario. Con este test puesto, `with check (true)` sí cae.
 */
test("🔴 el `with check` de idea_update aguanta SOLO, con idea_select desactivada", async () => {
  const { pg, intentarTraslado, sigueEnSuTenant } = await baseParaTrasladoDeTenant();
  try {
    // LA OTRA RED, DESACTIVADA A PROPÓSITO.
    await pg.exec("alter policy idea_select on ideas using (true)");

    const error = await intentarTraslado();
    assert.match(
      error?.message ?? "SIN ERROR: el update fue aceptado",
      /row-level security/i,
      "sin idea_select, el with check es la única red que queda — y tiene que aguantar sola",
    );
    assert.ok(await sigueEnSuTenant(), "la idea sigue en su tenant");
  } finally {
    await pg.close();
  }
});

/**
 * 🔴 INDEPENDENCIA DE ORDEN — la 0013 se aplicará en producción DESPUÉS de sus hermanas mayores.
 *
 * El número 0013 estaba reservado para esta pieza desde el programa del portal, pero se escribe
 * cuando la 0014-0019 ya están aplicadas en producción. Y `migrarConRegistro` (`deploy.ts`) saltea
 * las registradas, así que allá la 0013 corre AL FINAL — mientras que en una base nueva
 * (`aplicarMigraciones`, que es lo que usan todos estos tests) corre en su sitio, entre la 0012 y la
 * 0014. **Las dos bases tienen que quedar iguales**, y hasta ahora eso era una afirmación en un
 * comentario de la cabecera de la migración.
 *
 * Esto la convierte en garantía, con el mismo patrón que ya usa `fotos-publicas.test.ts` para la
 * 0014: aplicar los dos órdenes en bases separadas y comparar lo que la 0013 crea — columnas,
 * políticas, grants (de tabla y de columna), triggers y el enum. Si alguien agrega a otra migración
 * algo que toque `ideas`, las dos bases dejan de ser equivalentes y este test cae.
 *
 * El testigo anti-degeneración es la propia tabla: si la 0013 no se aplicó, no hay nada que comparar
 * y la aserción de que existe lo detecta antes de que el test pase comparando dos vacíos.
 */
test("🔴 la 0013 produce el mismo esquema se aplique en su sitio o al final (producción la aplica al final)", async () => {
  const LA_0013 = "0013_ideas.sql";
  const alfabetico = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  assert.ok(alfabetico.includes(LA_0013), `${LA_0013} tiene que existir, o este test no compara nada`);

  const alFinal = [...alfabetico.filter((f) => f !== LA_0013), LA_0013];
  assert.notDeepEqual(
    alfabetico,
    alFinal,
    "los dos órdenes tienen que ser DISTINTOS: si la 0013 ya fuera la última, el test se compararía consigo mismo",
  );

  const aplicar = async (pg: PGlite, archivos: string[]) => {
    await asegurarAuthStandIn(pg);
    for (const f of archivos) await pg.exec(await readFile(join(MIGRATIONS_DIR, f), "utf8"));
  };

  const a = new PGlite();
  const b = new PGlite();
  try {
    await aplicar(a, alfabetico);
    await aplicar(b, alFinal);

    const enAmbas = async <T>(sql: string): Promise<[T[], T[]]> => [
      (await a.query<T>(sql)).rows,
      (await b.query<T>(sql)).rows,
    ];

    const [colsA, colsB] = await enAmbas<Record<string, unknown>>(`
      select column_name, data_type, udt_name, is_nullable, column_default
        from information_schema.columns
       where table_schema = 'public' and table_name = 'ideas'
       order by column_name
    `);
    assert.ok(colsA.length > 0, "testigo: la tabla `ideas` solo existe si la 0013 se aplicó de verdad");
    assert.deepEqual(colsA, colsB, "mismas columnas, mismos tipos y mismos defaults");

    const [polA, polB] = await enAmbas<Record<string, unknown>>(`
      select policyname, cmd, roles::text, qual, with_check
        from pg_policies where tablename = 'ideas' order by policyname
    `);
    assert.equal(polA.length, 2, "idea_select e idea_update, ni una más");
    assert.deepEqual(polA, polB, "las mismas políticas, con el mismo using y el mismo with check");

    const [grantsA, grantsB] = await enAmbas<Record<string, unknown>>(`
      select grantee, privilege_type from information_schema.role_table_grants
       where table_name = 'ideas' order by grantee, privilege_type
    `);
    assert.deepEqual(grantsA, grantsB, "los mismos grants de tabla");

    const [colGrantsA, colGrantsB] = await enAmbas<Record<string, unknown>>(`
      select grantee, column_name, privilege_type from information_schema.column_privileges
       where table_name = 'ideas' order by grantee, column_name, privilege_type
    `);
    assert.ok(colGrantsA.length > 0, "el grant por columna tiene que estar en las dos");
    assert.deepEqual(colGrantsA, colGrantsB, "los mismos grants por columna");

    const [trigA, trigB] = await enAmbas<Record<string, unknown>>(`
      select tgname, pg_get_triggerdef(oid) as def from pg_trigger
       where tgrelid = 'ideas'::regclass and not tgisinternal order by tgname
    `);
    assert.equal(trigA.length, 2, "los dos triggers: transición de estado y actualizada_en");
    assert.deepEqual(trigA, trigB, "los mismos triggers, con la misma definición");

    const [enumA, enumB] = await enAmbas<{ v: string }>(
      "select unnest(enum_range(null::idea_estado))::text as v",
    );
    assert.deepEqual(
      enumA.map((r) => r.v),
      ["nueva", "en_revision", "aprobada", "rechazada"],
      "el enum, en el orden del ciclo de vida",
    );
    assert.deepEqual(enumA, enumB);
  } finally {
    await a.close();
    await b.close();
  }
});

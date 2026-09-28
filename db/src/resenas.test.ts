import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PglitePool } from "./pool.js";
import { PgResenas, NOMBRE_DE_UBICACION_GOOGLE, esNombreDeUbicacionGoogle } from "./resenas.js";

/**
 * Módulo de RESEÑAS de Google (Bloque F, fase 1) — la mitad "normal" (migración 0021): la tabla
 * `resenas_google` bajo RLS estándar (mismo patrón que `ideas`, 0013) y las tres columnas de
 * conexión en `clients`. Brief: `.superpowers/sdd/task-1-brief.md`.
 *
 * Nota sobre el helper de seed: el brief pedía un `seedDosClientesEnDosTenants` local, calcado de
 * un `test-helpers.js` que no existe en el repo. El `seed()` real de `testdb.js` (el que usan
 * `ideas.test.ts`, `clientes.test.ts`, `membresias.test.ts`, `sitios.test.ts`) YA devuelve
 * `tenantA`, `tenantB`, `clientA1`, `clientA2`, `clientB1` — exactamente lo que este archivo
 * necesita — más `equipoA`/`equipoB`/`duenoA1`/`intruso`, que hacen falta para tener un `userId`
 * real (una membresía) y no un placeholder. Se usa ese, sin duplicarlo.
 */

let db: TestDb;
let s: Seed;
let resenas: PgResenas;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  // PGlite y TestDb comparten instancia: el pool de PgResenas va contra la MISMA base ya sembrada
  // (mismo criterio que ideas.test.ts / clientes.test.ts / sitios.test.ts).
  resenas = new PgResenas(new PglitePool(db.pglite));
});

after(async () => {
  await db.close();
});

/** Crea una reseña con la autoridad de INFRAESTRUCTURA (superusuario: salta RLS y grants). */
async function crearResena(
  clientId: string,
  tenantId: string,
  over: Partial<{
    googleReviewId: string;
    puntuacion: number;
    autor: string;
    texto: string | null;
    publicadaEn: string;
  }> = {},
) {
  const [row] = await db.asService<{ id: string }>(
    `insert into resenas_google (tenant_id, client_id, google_review_id, puntuacion, autor, texto, publicada_en)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [
      tenantId,
      clientId,
      over.googleReviewId ?? crypto.randomUUID(),
      over.puntuacion ?? 5,
      over.autor ?? "Ana",
      over.texto ?? null,
      over.publicadaEn ?? new Date().toISOString(),
    ],
  );
  return row!.id;
}

// ============================================================ Etapa 1 — el esquema y RLS (SQL crudo)
//
// Con `db.asUser`/`db.asService`/`db.asRender`: lo que se prueba es LA BASE, no `PgResenas`. El
// modelo de amenaza realista es alguien que consigue ejecutar SQL con el rol `app_user` y un
// contexto de tenant válido — si RLS lo frena ahí, lo frena de verdad.

test("una reseña se guarda y se lee igual, con sus columnas", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, {
    googleReviewId: "g-1",
    puntuacion: 4,
    autor: "Marco",
    texto: "Muy buena la carta",
  });

  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select client_id, puntuacion, autor, texto, vista_en from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.["client_id"], s.clientA1);
  assert.equal(row?.["puntuacion"], 4);
  assert.equal(row?.["autor"], "Marco");
  assert.equal(row?.["texto"], "Muy buena la carta");
  assert.equal(row?.["vista_en"], null, "nace sin ver");
});

test("🔴 una reseña sin comentario (solo estrellas) es válida: texto nullable", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, { texto: null });
  const [row] = await db.asService("select texto from resenas_google where id = $1", [id]);
  assert.equal(row?.["texto"], null, "una reseña de Google Maps sin comentario es real");
});

test("🔴 puntuacion fuera de 1-5 se rechaza", async () => {
  for (const valor of [0, 6, -1]) {
    await assert.rejects(
      () =>
        db.asService(
          `insert into resenas_google (tenant_id, client_id, google_review_id, puntuacion, autor, publicada_en)
           values ($1, $2, $3, $4, 'Test', now())`,
          [s.tenantA, s.clientA1, crypto.randomUUID(), valor],
        ),
      /violat|check/i,
      `puntuacion=${valor} tiene que caer por el check 1..5`,
    );
  }
});

test("🔴 dos reseñas con el mismo google_review_id para el mismo cliente se rechazan (idempotencia del polling)", async () => {
  await crearResena(s.clientA1, s.tenantA, { googleReviewId: "duplicada" });
  await assert.rejects(
    () => crearResena(s.clientA1, s.tenantA, { googleReviewId: "duplicada" }),
    /unique|duplicate/i,
    "sin el unique, correr el polling dos veces insertaría la misma reseña dos veces",
  );
});

test("🔴 una reseña con client_id de OTRO tenant se rechaza (FK compuesta)", async () => {
  await assert.rejects(
    () =>
      db.asService(
        `insert into resenas_google (tenant_id, client_id, google_review_id, puntuacion, autor, publicada_en)
         values ($1, $2, $3, 5, 'Cruzada', now())`,
        // tenant A + cliente del tenant B: cada uno existe por separado, el PAR no.
        [s.tenantA, s.clientB1, crypto.randomUUID()],
      ),
    /foreign key|violat/i,
    "RLS controla qué filas ves; la integridad entre tablas la da la FK compuesta",
  );
});

test("`resenas_google` tiene RLS FORZADA, no solo habilitada", async () => {
  const [row] = await db.asService<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(
    "select relrowsecurity, relforcerowsecurity from pg_class where relname = 'resenas_google'",
  );
  assert.equal(row?.relrowsecurity, true);
  assert.equal(row?.relforcerowsecurity, true, "sin FORCE, el DUEÑO de la tabla salta las políticas");
});

// ---------------------------------------------------------------- RLS: aislamiento entre tenants
//
// 🔴 EL CASO CRÍTICO. `app.ve_cliente(cid)` para un rol staff (maestro/equipo/servicio) devuelve
// `true` para CUALQUIER `cid`, sin mirar de qué tenant es — lo que aísla por tenant es el rol
// (resuelto vía `current_tenant_id()`), no `ve_cliente()` sola. Una política de SELECT que se
// apoyara SOLO en `ve_cliente(client_id)`, sin `tenant_id = app.current_tenant_id()` explícito,
// dejaría a CUALQUIER staff de CUALQUIER tenant ver las reseñas de todos los demás. Es el mismo
// vector que describe la 0001 para `kr_keywords` ("el aislamiento no se hereda"), aplicado al
// revés: acá lo que falta no es el filtro de cliente, es el de tenant.

test("🔴 el tenant B NO ve las reseñas del tenant A (ni pidiéndolas por client_id explícito)", async () => {
  const idA = await crearResena(s.clientA1, s.tenantA, { autor: "Secreto de A" });

  const filasB = await db.asUser({ tenantId: s.tenantB, userId: s.equipoB }, "select id from resenas_google");
  assert.ok(!filasB.map((r) => (r as { id: string }).id).includes(idA), "el equipo de B no ve la reseña de A");

  // El vector real: pedir explícitamente el client_id de OTRO tenant. Si la política solo
  // comprobara `ve_cliente(client_id)` (sin `tenant_id = current_tenant_id()`), esto devolvería la
  // fila igual: para un staff, `ve_cliente()` es `true` para cualquier cliente, de cualquier tenant.
  const directo = await db.asUser(
    { tenantId: s.tenantB, userId: s.equipoB },
    "select id from resenas_google where client_id = $1",
    [s.clientA1],
  );
  assert.equal(directo.length, 0, "pedir el client_id ajeno explícitamente devuelve cero filas, no la fuga");
});

test("🔴 un usuario SIN membresía no ve ninguna reseña, aunque reclame un tenant válido", async () => {
  await crearResena(s.clientA1, s.tenantA, {});
  const filas = await db.asUser({ tenantId: s.tenantA, userId: s.intruso }, "select id from resenas_google");
  assert.equal(filas.length, 0, "sin membresía no hay rol, y la allowlist positiva no concede nada");
});

test("🔴 un rol 'cliente' ve SOLO las reseñas de su propio negocio, no las del vecino de tenant", async () => {
  const suya = await crearResena(s.clientA1, s.tenantA, { autor: "De A1" });
  const ajena = await crearResena(s.clientA2, s.tenantA, { autor: "De A2" });

  const filas = await db.asUser({ tenantId: s.tenantA, userId: s.duenoA1 }, "select id from resenas_google");
  const ids = filas.map((r) => (r as { id: string }).id);
  assert.ok(ids.includes(suya), "el dueño de A1 ve su propia reseña");
  assert.ok(!ids.includes(ajena), "y NO ve la del otro cliente del mismo tenant");

  const staff = await db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select id from resenas_google");
  const idsStaff = staff.map((r) => (r as { id: string }).id);
  assert.ok(idsStaff.includes(suya) && idsStaff.includes(ajena), "control positivo: el staff ve las dos");
});

// ---------------------------------------------------------------- permisos POR VERBO (ADR-20)

test("🔴 un rol 'cliente' NO puede marcar su propia reseña como vista (0 filas), y el equipo SÍ", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, {});

  const comoCliente = await db.asUser(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    "update resenas_google set vista_en = now() where id = $1 returning id",
    [id],
  );
  assert.equal(comoCliente.length, 0, "ADR-20: el cliente VE pero no puede marcar como vista");

  const comoEquipo = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update resenas_google set vista_en = now() where id = $1 returning id",
    [id],
  );
  assert.equal(comoEquipo.length, 1, "control positivo: la agencia sí puede");
});

test("🔴 nadie inserta ni borra reseñas desde app_user: eso es del polling (Task 2)", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        `insert into resenas_google (tenant_id, client_id, google_review_id, puntuacion, autor, publicada_en)
         values ($1, $2, $3, 5, 'A mano', now())`,
        [s.tenantA, s.clientA1, crypto.randomUUID()],
      ),
    /permission denied|no tiene permiso/i,
  );

  const id = await crearResena(s.clientA1, s.tenantA, {});
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "delete from resenas_google where id = $1", [id]),
    /permission denied|no tiene permiso/i,
  );
});

test("🔴 el update de app_user es POR COLUMNA: solo vista_en, ni siquiera el staff mueve una reseña de cliente", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, {});
  await assert.rejects(
    () =>
      db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "update resenas_google set client_id = $2 where id = $1", [
        id,
        s.clientA2,
      ]),
    /permission denied|no tiene permiso/i,
  );
  await assert.rejects(
    () =>
      db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "update resenas_google set puntuacion = 1 where id = $1", [
        id,
      ]),
    /permission denied|no tiene permiso/i,
    "puntuacion no está en el grant de update: la reseña la trae el polling, no se edita a mano",
  );
});

/**
 * Los verbos concedidos, preguntándoselo a Postgres en vez de leyendo la migración.
 */
test("🔴 los grants sobre `resenas_google` son exactamente los enumerados", async () => {
  const [t] = await db.asService<Record<string, boolean>>(`
    select
      has_table_privilege('app_user',    'resenas_google', 'select') as user_select,
      has_table_privilege('app_user',    'resenas_google', 'update') as user_update,
      has_table_privilege('app_user',    'resenas_google', 'insert') as user_insert,
      has_table_privilege('app_user',    'resenas_google', 'delete') as user_delete,
      has_table_privilege('app_service', 'resenas_google', 'select') as service_select,
      has_table_privilege('app_service', 'resenas_google', 'insert') as service_insert,
      has_table_privilege('app_render',  'resenas_google', 'select') as render_select
  `);
  assert.deepEqual(t, {
    user_select: true,
    // `false` a propósito: el update es POR COLUMNA (solo vista_en).
    user_update: false,
    user_insert: false,
    user_delete: false,
    // El orquestador no participa de esta mitad: lo cross-tenant es `app_resenas` en la 0022.
    service_select: false,
    service_insert: false,
    // ADR-19: el renderizador anónimo, jamás.
    render_select: false,
  });

  const [c] = await db.asService<Record<string, boolean>>(`
    select has_column_privilege('app_user', 'resenas_google', 'vista_en', 'update') as vista_en,
           has_column_privilege('app_user', 'resenas_google', 'puntuacion', 'update') as puntuacion
  `);
  assert.deepEqual(c, { vista_en: true, puntuacion: false });
});

// ---------------------------------------------------------------- ADR-19: el renderizador anónimo

test("🔴 app_render NO llega a `resenas_google`: ni a la tabla ni a ninguna columna (permission denied, no cero filas)", async () => {
  await assert.rejects(() => db.asRender("select * from resenas_google"), /permission denied|no tiene permiso/i);
  await assert.rejects(
    () => db.asRender("select autor, texto, puntuacion from resenas_google"),
    /permission denied|no tiene permiso/i,
  );
  await assert.rejects(() => db.asRender("select count(*) from resenas_google"), /permission denied|no tiene permiso/i);
});

// ---------------------------------------------------------------- la credencial: clients.google_refresh_token

/**
 * 🔴 EL GRANT ASIMÉTRICO. `app_user` YA tiene `grant select ... on clients` A NIVEL DE TABLA desde
 * la 0001 (`grant select, insert, update, delete on clients, kr_runs, kr_keywords, kr_pages to
 * app_user;`), y un grant de tabla cubre CUALQUIER columna, incluidas las que agregue una `alter
 * table` posterior. Sin un `revoke select (google_refresh_token) on clients from app_user`
 * explícito en esta misma migración, la columna sería legible a pesar del `grant select (id,
 * tenant_id, google_location_id, google_conectado_en)` más acotado que agrega la 0021 — ese grant
 * NUEVO solo puede sumar columnas, nunca puede quitar lo que el de la 0001 ya concedía.
 */
test("🔴 los grants sobre clients.google_refresh_token son ESCRITURA sin lectura para app_user", async () => {
  const [t] = await db.asService<Record<string, boolean>>(`
    select
      has_column_privilege('app_user', 'clients', 'google_refresh_token', 'select') as puede_leer,
      has_column_privilege('app_user', 'clients', 'google_refresh_token', 'update') as puede_escribir
  `);
  assert.equal(t?.["puede_leer"], false, "app_user NUNCA puede leer el refresh token de vuelta");
  assert.equal(t?.["puede_escribir"], true, "pero sí puede escribirlo -- lo hace el callback de OAuth");
});

test("app_user SÍ puede leer google_location_id y google_conectado_en (lo que pinta 'conectado desde...')", async () => {
  const [t] = await db.asService<Record<string, boolean>>(`
    select
      has_column_privilege('app_user', 'clients', 'google_location_id',  'select') as location_id,
      has_column_privilege('app_user', 'clients', 'google_conectado_en', 'select') as conectado_en
  `);
  assert.deepEqual(t, { location_id: true, conectado_en: true });
});

test("un select real bajo RLS confirma lo mismo que los catálogos: refresh_token no viaja, las otras dos sí", async () => {
  await db.asService("update clients set google_location_id = 'loc-1', google_refresh_token = 'secreto-oauth', google_conectado_en = now() where id = $1", [
    s.clientA1,
  ]);

  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "select google_refresh_token from clients where id = $1",
        [s.clientA1],
      ),
    /permission denied|no tiene permiso/i,
  );

  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select google_location_id, google_conectado_en from clients where id = $1",
    [s.clientA1],
  );
  assert.equal(row?.["google_location_id"], "loc-1");
  assert.ok(row?.["google_conectado_en"]);
});

// ============================================================ Etapa 2 — `PgResenas`
//
// Lo de arriba prueba EL ESQUEMA con SQL crudo. Lo de acá abajo prueba la clase de acceso, que
// escribe de verdad vía `PglitePool` — por eso cada test crea sus propias reseñas en vez de
// reutilizar las de arriba.

test("🔴 listarResenas devuelve SOLO las del cliente pedido, no las de otro cliente del mismo tenant", async () => {
  await crearResena(s.clientA1, s.tenantA, { autor: "De A1" });
  await crearResena(s.clientA2, s.tenantA, { autor: "De A2" });

  const vistas = await resenas.listarResenas({ tenantId: s.tenantA, userId: s.equipoA }, s.clientA1);
  assert.ok(vistas.length > 0, "sin filas, este test no comprobaría nada");
  assert.ok(
    vistas.every((r) => r.clientId === s.clientA1),
    "ninguna fila del resultado es del otro cliente",
  );
});

/**
 * 🔴 La versión, a través de `PgResenas`, del test crítico de aislamiento de arriba: pedir
 * explícitamente el `client_id` de otro tenant no puede devolver filas, aunque `listarResenas` no
 * filtre nada por tenant en TypeScript (RLS es quien lo hace).
 */
test("🔴 listarResenas con el client_id de OTRO tenant devuelve vacío, no lanza y no filtra nada", async () => {
  await crearResena(s.clientB1, s.tenantB, { autor: "Secreto de B" });

  const desdeA = await resenas.listarResenas({ tenantId: s.tenantA, userId: s.equipoA }, s.clientB1);
  assert.deepEqual(desdeA, [], "un staff de A pidiendo el client_id de B no debe ver nada");

  // Control positivo: el mismo client_id, con el tenant correcto, sí trae la fila.
  const desdeB = await resenas.listarResenas({ tenantId: s.tenantB, userId: s.equipoB }, s.clientB1);
  assert.ok(desdeB.length > 0, "y sí aparece cuando quien pregunta es del tenant correcto");
});

test("🔴 listarResenas pone las 1-3★ SIN VER antes que el resto, y dentro de eso más nueva primero", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };
  const cliente = s.clientB1;

  await crearResena(cliente, s.tenantB, {
    puntuacion: 5,
    autor: "Positiva vieja",
    publicadaEn: "2020-01-01T00:00:00Z",
  });
  await crearResena(cliente, s.tenantB, {
    puntuacion: 2,
    autor: "Negativa",
    publicadaEn: "2024-01-01T00:00:00Z",
  });

  const vistas = await resenas.listarResenas(ctx, cliente);
  assert.equal(vistas[0]?.autor, "Negativa", "la de 2★ sin ver va primero aunque sea más nueva la otra");
});

test("🔴 dentro del mismo bucket de vista/puntuación, la más nueva va primero", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const cliente = s.clientA1;

  await crearResena(cliente, s.tenantA, {
    puntuacion: 1,
    autor: "Negativa vieja",
    publicadaEn: "2020-01-01T00:00:00Z",
  });
  await crearResena(cliente, s.tenantA, {
    puntuacion: 1,
    autor: "Negativa nueva",
    publicadaEn: "2024-01-01T00:00:00Z",
  });

  const vistas = await resenas.listarResenas(ctx, cliente);
  const idxVieja = vistas.findIndex((r) => r.autor === "Negativa vieja");
  const idxNueva = vistas.findIndex((r) => r.autor === "Negativa nueva");
  assert.ok(idxNueva < idxVieja, "misma puntuación, ambas sin ver: la más nueva primero");
});

test("🔴 una reseña ya vista se ordena DESPUÉS de las sin ver, aunque tenga peor puntuación", async () => {
  const ctx = { tenantId: s.tenantB, userId: s.equipoB };
  const cliente = s.clientB1;

  const vieja = await crearResena(cliente, s.tenantB, { puntuacion: 1, autor: "Mala pero vista" });
  await crearResena(cliente, s.tenantB, { puntuacion: 5, autor: "Buena sin ver" });

  await resenas.marcarVista(ctx, cliente, vieja);
  const vistas = await resenas.listarResenas(ctx, cliente);

  const idxVista = vistas.findIndex((r) => r.autor === "Mala pero vista");
  const idxSinVer = vistas.findIndex((r) => r.autor === "Buena sin ver");
  assert.ok(idxSinVer < idxVista, "sin ver antes que vista, sin importar la puntuación");
});

test("🔴 listarResenas devuelve borradorRespuesta cuando existe, null cuando no (Fix 1)", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const clienteId = s.clientA1;

  // Caso 1: una reseña 5★ CON borrador_respuesta (escrito a mano en la base, como hace la Task 2)
  const conBorrador = await crearResena(clienteId, s.tenantA, { puntuacion: 5, googleReviewId: "fb-1" });
  await db.asService("update resenas_google set borrador_respuesta = $1 where id = $2", [
    "Gracias por tu reseña, nos alegra haber complacido tu paladar.",
    conBorrador,
  ]);

  // Caso 2: una reseña SIN borrador
  const sinBorrador = await crearResena(clienteId, s.tenantA, { puntuacion: 5, googleReviewId: "fb-2" });

  const vistas = await resenas.listarResenas(ctx, clienteId);
  const conBorrador_row = vistas.find((r) => r.id === conBorrador);
  const sinBorrador_row = vistas.find((r) => r.id === sinBorrador);

  assert.equal(
    conBorrador_row?.borradorRespuesta,
    "Gracias por tu reseña, nos alegra haber complacido tu paladar.",
    "listarResenas trae el borradorRespuesta cuando existe",
  );
  assert.equal(sinBorrador_row?.borradorRespuesta, null, "listarResenas devuelve null cuando no hay borrador");
});

test("🔴 listarResenas devuelve EXACTAMENTE el set de campos de ResenaGoogle (guardarraíl contra el bug de COLS/aResena desincronizados)", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, {});
  const [fila] = await resenas.listarResenas({ tenantId: s.tenantA, userId: s.equipoA }, s.clientA1);
  assert.deepEqual(
    Object.keys(fila!).sort(),
    [
      "autor",
      "borradorRespuesta",
      "clientId",
      "id",
      "publicadaEn",
      "puntuacion",
      "respuestaPublicadaEn",
      "respuestaSolicitadaEn",
      "texto",
      "vistaEn",
    ].sort(),
  );
  // El check de Object.keys por sí solo NO alcanza: `aResena()` arma el objeto de retorno con las 8
  // claves siempre presentes, así que si `COLS` deja de traer una columna, la clave sigue estando
  // en el objeto -- solo cambia a `undefined` (nunca `null`, que es el valor real de "sin dato" que
  // devuelve Postgres). Por eso el guardarraíl real es este: ningún campo puede ser `undefined`.
  for (const [campo, valor] of Object.entries(fila!)) {
    assert.notEqual(
      valor,
      undefined,
      `${campo} es undefined -- probablemente falta en COLS (Postgres devuelve null, no undefined, para 'sin dato')`,
    );
  }
});

test("marcarVista pone vista_en y no se puede repetir sobre una ya vista", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearResena(s.clientA1, s.tenantA, { googleReviewId: "r1" });

  const primera = await resenas.marcarVista(ctx, s.clientA1, id);
  assert.equal(primera, true);

  const segunda = await resenas.marcarVista(ctx, s.clientA1, id);
  assert.equal(segunda, false, "ya estaba vista: el update no afecta filas");

  const [row] = await db.asService<{ vista_en: Date }>("select vista_en from resenas_google where id = $1", [id]);
  assert.ok(row?.vista_en, "la marca quedó puesta");
});

test("🔴 marcarVista sobre una reseña de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearResena(s.clientB1, s.tenantB, { googleReviewId: "ajena" });

  const resultado = await resenas.marcarVista({ tenantId: s.tenantA, userId: s.equipoA }, s.clientA1, ajena);
  assert.equal(resultado, false);

  const [row] = await db.asService<{ vista_en: Date | null }>("select vista_en from resenas_google where id = $1", [
    ajena,
  ]);
  assert.equal(row?.vista_en, null, "la reseña de B sigue sin ver: el intento de A no la tocó");
});

test("🔴 marcarVista con rol 'cliente' devuelve false: la marca la pone la agencia (ADR-20)", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, {});
  const resultado = await resenas.marcarVista({ tenantId: s.tenantA, userId: s.duenoA1 }, s.clientA1, id);
  assert.equal(resultado, false);
});

// ============================================================ Etapa 3 — editarBorrador (0024)

test("editarBorrador guarda el texto y se puede repetir (a diferencia de marcarVista)", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "eb-1" });

  const primera = await resenas.editarBorrador(ctx, s.clientA1, id, "Primer borrador");
  assert.equal(primera, true);

  const segunda = await resenas.editarBorrador(ctx, s.clientA1, id, "Borrador corregido");
  assert.equal(segunda, true, "a diferencia de marcarVista, editar de nuevo SÍ tiene efecto");

  const [row] = await db.asService<{ borrador_respuesta: string }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.borrador_respuesta, "Borrador corregido");
});

test("🔴 editarBorrador sobre una reseña de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearResena(s.clientB1, s.tenantB, { googleReviewId: "eb-ajena", puntuacion: 5 });

  const resultado = await resenas.editarBorrador(
    { tenantId: s.tenantA, userId: s.equipoA },
    s.clientA1,
    ajena,
    "Intento cruzado",
  );
  assert.equal(resultado, false);

  const [row] = await db.asService<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [ajena],
  );
  assert.equal(row?.borrador_respuesta, null, "el intento de A no tocó la reseña de B");
});

test("🔴 editarBorrador con rol 'cliente' devuelve false (ADR-20: el cliente no escribe)", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "eb-cliente" });
  const resultado = await resenas.editarBorrador(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    s.clientA1,
    id,
    "Intento del rol cliente",
  );
  assert.equal(resultado, false);

  const [row] = await db.asService<{ borrador_respuesta: string | null }>(
    "select borrador_respuesta from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.borrador_respuesta, null, "el rol cliente no pudo escribir nada");
});

// ======================================================= Etapa 4 — solicitarPublicacion (0025)

test("solicitarPublicacion devuelve true con un borrador guardado y sin publicar, y listarResenas lo refleja", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "sp-1" });
  await resenas.editarBorrador(ctx, s.clientA1, id, "Gracias por tu reseña");

  const resultado = await resenas.solicitarPublicacion(ctx, s.clientA1, id);
  assert.equal(resultado, true);

  const propia = (await resenas.listarResenas(ctx, s.clientA1)).find((r) => r.id === id);
  assert.ok(propia?.respuestaSolicitadaEn, "listarResenas muestra respuestaSolicitadaEn no nulo");
});

test("🔴 solicitarPublicacion sin borrador devuelve false y no toca la fila", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "sp-sin-borrador" });

  const resultado = await resenas.solicitarPublicacion(ctx, s.clientA1, id);
  assert.equal(resultado, false, "🔴 el WHERE rechaza borrador_respuesta is null");

  const [row] = await db.asService<{ respuesta_solicitada_en: string | null }>(
    "select respuesta_solicitada_en from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.respuesta_solicitada_en, null, "no se tocó la fila sin borrador");
});

test("🔴 solicitarPublicacion sobre una reseña ya publicada devuelve false", async () => {
  const ctx = { tenantId: s.tenantA, userId: s.equipoA };
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "sp-ya-publicada" });
  await resenas.editarBorrador(ctx, s.clientA1, id, "Gracias");
  await db.asService(
    "update resenas_google set respuesta_solicitada_en = now(), respuesta_publicada_en = now() where id = $1",
    [id],
  );

  const resultado = await resenas.solicitarPublicacion(ctx, s.clientA1, id);
  assert.equal(resultado, false, "🔴 el WHERE rechaza respuesta_publicada_en is not null");
});

test("🔴 solicitarPublicacion sobre una reseña de OTRO tenant no toca nada (RLS, no un 404 de aplicación)", async () => {
  const ajena = await crearResena(s.clientB1, s.tenantB, { puntuacion: 5, googleReviewId: "sp-ajena" });
  await resenas.editarBorrador({ tenantId: s.tenantB, userId: s.equipoB }, s.clientB1, ajena, "Gracias");

  const resultado = await resenas.solicitarPublicacion(
    { tenantId: s.tenantA, userId: s.equipoA },
    s.clientA1,
    ajena,
  );
  assert.equal(resultado, false);

  const [row] = await db.asService<{ respuesta_solicitada_en: string | null }>(
    "select respuesta_solicitada_en from resenas_google where id = $1",
    [ajena],
  );
  assert.equal(row?.respuesta_solicitada_en, null, "el intento de A no tocó la reseña de B");
});

test("🔴 solicitarPublicacion con rol 'cliente' devuelve false (ADR-20: el cliente no escribe)", async () => {
  const id = await crearResena(s.clientA1, s.tenantA, { puntuacion: 5, googleReviewId: "sp-cliente" });
  await resenas.editarBorrador({ tenantId: s.tenantA, userId: s.equipoA }, s.clientA1, id, "Gracias");

  const resultado = await resenas.solicitarPublicacion(
    { tenantId: s.tenantA, userId: s.duenoA1 },
    s.clientA1,
    id,
  );
  assert.equal(resultado, false);

  const [row] = await db.asService<{ respuesta_solicitada_en: string | null }>(
    "select respuesta_solicitada_en from resenas_google where id = $1",
    [id],
  );
  assert.equal(row?.respuesta_solicitada_en, null, "el rol cliente no pudo escribir nada");
});

// ------------------------------------------------- el formato del nombre de recurso de Google

/*
 * Estos cuatro no tocan la base: fijan el FORMATO de `clients.google_location_id`, que es un
 * contrato entre los dos lados que manipulan esa columna — la API la ESCRIBE (un humano pega el
 * nombre al conectar) y el orquestador la LEE para armar la URL de la v4. Viven en `db/` porque la
 * columna es de `db/`: es la única forma de que no haya dos regex distintas divergiendo en silencio.
 */

test("esNombreDeUbicacionGoogle acepta el nombre de recurso completo de la v4", () => {
  assert.equal(esNombreDeUbicacionGoogle("accounts/123456789/locations/987654321"), true);
  assert.equal(esNombreDeUbicacionGoogle("accounts/abc-DEF_9/locations/xyz"), true);
});

test("🔴 esNombreDeUbicacionGoogle rechaza un id suelto: con eso la v4 devuelve un 404 genérico", () => {
  assert.equal(esNombreDeUbicacionGoogle("987654321"), false);
  assert.equal(esNombreDeUbicacionGoogle("locations/987654321"), false);
  assert.equal(esNombreDeUbicacionGoogle("accounts/123"), false);
});

test("🔴 esNombreDeUbicacionGoogle rechaza espacios, vacíos y segmentos de más", () => {
  assert.equal(esNombreDeUbicacionGoogle(""), false);
  assert.equal(esNombreDeUbicacionGoogle("   "), false);
  assert.equal(esNombreDeUbicacionGoogle("accounts/1 2/locations/3"), false);
  assert.equal(esNombreDeUbicacionGoogle("accounts//locations/3"), false);
  assert.equal(esNombreDeUbicacionGoogle("accounts/1/locations/3/reviews/4"), false);
  // Sin anclas la regex matchearía en medio de cualquier cosa; con ellas, no.
  assert.equal(esNombreDeUbicacionGoogle("basura accounts/1/locations/2"), false);
  assert.equal(esNombreDeUbicacionGoogle("accounts/1/locations/2 basura"), false);
});

test("NOMBRE_DE_UBICACION_GOOGLE no es global: un regex con /g arrastra lastIndex entre llamadas", () => {
  assert.equal(NOMBRE_DE_UBICACION_GOOGLE.global, false);
  // La consecuencia concreta, y por eso el predicado existe en vez de exponer solo la regex:
  // con /g, dos `test()` seguidos sobre el MISMO valor válido darían true y después false.
  assert.equal(esNombreDeUbicacionGoogle("accounts/1/locations/2"), true);
  assert.equal(esNombreDeUbicacionGoogle("accounts/1/locations/2"), true);
});

// ---------------------------------------------------------------- nonce de OAuth de un solo uso (0034)
//
// La deuda que cierran estos tests estuvo abierta desde el Bloque F fase 1: `EstadoOAuth.nonce`
// (`api/src/oauth-state.ts`) se firmaba y NUNCA se invalidaba, así que un `state` filtrado se podía
// reproducir cuantas veces se quisiera durante sus 10 minutos de ventana — y ese `state` es la única
// identidad con la que el callback anónimo escribe `google_refresh_token` en un cliente.
//
// El test de punta a punta (el mismo state dos veces, por HTTP) vive en `api/src/app.test.ts`: acá se
// fija el contrato del método y las garantías del ESQUEMA, que es donde están impuestas.

const ctxA = () => ({ tenantId: s.tenantA, userId: s.equipoA });
const ctxB = () => ({ tenantId: s.tenantB, userId: s.equipoB });

/**
 * Un `delete from oauth_nonces_usados` PELADO, con el rol `app_user` y COMMIT — el peor caso realista
 * del modelo de amenaza de este ámbito: alguien que consigue ejecutar SQL con el rol de la API y un
 * contexto de tenant válido, e intenta des-quemar un nonce para poder repetir un `state`.
 *
 * Sin `where` a propósito: es exactamente lo que ejecuta la purga de `consumirNonceOAuth`, y también
 * el borrado más agresivo que ese rol puede pedir. Quien decide qué filas caen es la política
 * `nonce_purga`, no la sentencia. `TestDb.asUser` no sirve acá porque hace `rollback`: un borrado que
 * se revierte solo no prueba si la base lo habría permitido.
 */
async function borrarNoncesComoAppUser(tenantId: string, userId: string): Promise<void> {
  const pg = db.pglite;
  await pg.exec("begin");
  try {
    await pg.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await pg.query("select set_config('app.user_id', $1, true)", [userId]);
    await pg.exec("set local role app_user");
    await pg.query("delete from oauth_nonces_usados");
    await pg.exec("commit");
  } catch (e) {
    await pg.exec("rollback");
    throw e;
  }
}

test("🔴 consumirNonceOAuth: true la primera vez, false la segunda (el state es de un solo uso)", async () => {
  const nonce = crypto.randomUUID();

  assert.equal(await resenas.consumirNonceOAuth(ctxA(), nonce), true, "primer uso: el camino normal");
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), nonce), false, "replay: ya estaba quemado");
  // Tercera vez: que no "se reabra" por haber devuelto false una vez (la purga corre en cada llamada
  // y no debe llevarse por delante la fila que acaba de rechazar).
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), nonce), false, "sigue quemado indefinidamente");
});

test("🔴 un nonce quemado no se puede DES-quemar: la política solo deja purgar lo ya vencido", async () => {
  /*
   * Ésta es la garantía de fondo, y no es "limpieza": si `app_user` pudiera borrar una fila reciente,
   * el replay volvería a estar abierto para cualquiera que llegue a ejecutar un DELETE — un bug de la
   * API, un endpoint nuevo mal escrito. La condición de edad vive en el `using` de `nonce_purga`
   * (migración 0034), no en el `where` de la sentencia, así que no depende de que nadie se olvide.
   *
   * Se mide por COMPORTAMIENTO (el nonce sigue rechazado) y no contando filas: es la propiedad que
   * importa, y un conteo pasaría igual si el método dejara de mirar la tabla.
   */
  const nonce = crypto.randomUUID();
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), nonce), true);

  await borrarNoncesComoAppUser(s.tenantA, s.equipoA);

  assert.equal(
    await resenas.consumirNonceOAuth(ctxA(), nonce),
    false,
    "el DELETE no pudo tocar la fila recién quemada: la política exige usado_en < now() - 1 hora",
  );
});

test("la purga corre DENTRO de cada consumo y se lleva lo vencido: la tabla no crece para siempre", async () => {
  /*
   * Lo que dispara la purga es OTRO `consumirNonceOAuth`, no un DELETE escrito por el test. Es la
   * diferencia entre probar la política y probar que el método la usa: la primera versión de este
   * test llamaba a `borrarNoncesComoAppUser` y quitar el CTE `with purga as (delete ...)` de
   * `consumirNonceOAuth` la dejaba en VERDE — o sea que nada cubría la limpieza de verdad, y la tabla
   * podía crecer para siempre sin que ningún test se enterara. Medido, no supuesto.
   */
  const viejo = crypto.randomUUID();
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), viejo), true);

  // Envejecer la fila es lo único que hace falta para que la purga la alcance. Se hace con la
  // autoridad de INFRAESTRUCTURA (superusuario) porque es un artificio del test, no un camino de la
  // app: `app_user` no tiene ningún grant de UPDATE sobre esta tabla, y eso también es deliberado.
  await db.asService("update oauth_nonces_usados set usado_en = now() - interval '2 hours' where nonce = $1", [
    viejo,
  ]);

  // Un consumo cualquiera, posterior: el que hace la limpieza de paso.
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), crypto.randomUUID()), true);

  const quedan = await db.asService<{ n: number }>(
    "select count(*)::int as n from oauth_nonces_usados where nonce = $1",
    [viejo],
  );
  assert.equal(quedan[0]!.n, 0, "una fila más vieja que la ventana del state no aporta nada y se va");
});

test("🔴 los nonces no se filtran entre tenants: app_user no puede LEER la tabla, ni siquiera la suya", async () => {
  const nonce = crypto.randomUUID();
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), nonce), true);

  // No es "cero filas": es `permission denied`. No hay ningún grant de SELECT sobre esta tabla, y esa
  // ausencia es la que hace que `consumirNonceOAuth` tenga que detectar el replay por el 23505 en vez
  // de por un `returning`. Si alguien concediera el select "para poder depurar", este test cae.
  await assert.rejects(
    () => db.asUser(ctxB(), "select nonce from oauth_nonces_usados"),
    /permission denied/i,
    "el tenant B no puede enumerar nonces",
  );
  await assert.rejects(
    () => db.asUser(ctxA(), "select nonce from oauth_nonces_usados"),
    /permission denied/i,
    "tampoco el tenant que los quemó: nadie lee esta tabla desde la API",
  );
});

test("🔴 no se puede quemar un nonce marcándolo con el tenant de otro", async () => {
  // El `with check` de `nonce_quemar`. Sin él, el tenant A podría sembrar filas en el registro de B
  // —basura ajena, y una vía para que B se quede sin poder usar un nonce que todavía no acuñó.
  await assert.rejects(
    () =>
      db.asUser(ctxA(), "insert into oauth_nonces_usados (nonce, tenant_id) values ($1, $2)", [
        crypto.randomUUID(),
        s.tenantB,
      ]),
    /row-level security/i,
    "42501: la fila resultante no es del tenant que la escribe",
  );
});

test("🔴 el nonce es único GLOBALMENTE, no por tenant: otro tenant tampoco puede repetirlo", async () => {
  /*
   * Deliberado, y conviene decirlo porque parece una fuga y no lo es. Un `primary key (nonce)` en vez
   * de `(tenant_id, nonce)` significa que el tenant B, presentando el MISMO nonce, se lleva un
   * `false`. Lo que eso le revela es que ese uuid ya se usó — nada más: no puede leer la tabla, no
   * sabe de quién era, y un nonce quemado no sirve para nada.
   *
   * A cambio, la unicidad no depende de que el `tenant_id` del `state` sea el correcto. Con una clave
   * compuesta, un `state` cuyo tenant se pudiera manipular se replayearía cambiando ese campo; hoy no
   * se puede (viaja firmado), pero la defensa no tiene por qué apoyarse en eso.
   */
  const nonce = crypto.randomUUID();
  assert.equal(await resenas.consumirNonceOAuth(ctxA(), nonce), true);
  assert.equal(await resenas.consumirNonceOAuth(ctxB(), nonce), false, "un nonce quemado lo está para todos");
});

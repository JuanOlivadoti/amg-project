import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PgClientes } from "./clientes.js";
import type { NuevoCliente } from "./clientes.js";
import { PglitePool } from "./pool.js";

/**
 * Etapa 1 del CRM de clientes (SOLO esquema, ver `docs/proyecto/11-plan-fase-2.md`): las columnas
 * nuevas de `clients` que portan la gestión de clientes del Angular viejo (Firestore).
 *
 * Dos preguntas gobiernan estos tests:
 *   1. ¿El esquema guarda y devuelve estos datos tal cual, con la forma e integridad prometidas?
 *   2. ¿Sigue siendo cierto que NINGUNO de estos campos es alcanzable por `app_render` (ADR-19)?
 *      Es la pregunta más cara del plan — el renderizador es la única pieza expuesta a internet
 *      anónimo, y estos datos son internos de la agencia.
 */

let db: TestDb;
let s: Seed;
let clientes: PgClientes;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  // PGlite y TestDb comparten instancia; el pool de PgClientes va contra la misma base sembrada
  // (mismo criterio que sitios.test.ts para PgSitios).
  clientes = new PgClientes(new PglitePool(db.pglite));
});

after(async () => {
  await db.close();
});

const CAMPOS_CRM = `tipo, industria, etiquetas, nivel_actividad, estado_contrato,
  contrato_vence_en::text as contrato_vence_en, score, asignado_a, contacto, origen`;

// ---------------------------------------------------------------- guardar y leer

test("un cliente con todos los campos de CRM se guarda y se lee igual", async () => {
  const contacto = {
    email: "hola@bellanapoli.es",
    telefono: "+34 600 000 000",
    persona_contacto: "Marco",
    redes: { instagram: "@bellanapoli" },
    notas: "cliente desde 2023, muy conforme",
  };

  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    `update clients set
       tipo = 'empresa',
       industria = 'restauracion',
       etiquetas = $2,
       nivel_actividad = 'alto',
       estado_contrato = 'vigente',
       contrato_vence_en = '2027-01-01',
       score = 87,
       asignado_a = $3,
       contacto = $4::jsonb,
       origen = 'referido'
     where id = $1
     returning ${CAMPOS_CRM}`,
    [s.clientA1, ["vip", "premium"], s.equipoA, JSON.stringify(contacto)],
  );

  assert.equal(row?.["tipo"], "empresa");
  assert.equal(row?.["industria"], "restauracion");
  assert.deepEqual(row?.["etiquetas"], ["vip", "premium"]);
  assert.equal(row?.["nivel_actividad"], "alto");
  assert.equal(row?.["estado_contrato"], "vigente");
  assert.equal(row?.["contrato_vence_en"], "2027-01-01");
  assert.equal(row?.["score"], 87);
  assert.equal(row?.["asignado_a"], s.equipoA);
  assert.deepEqual(row?.["contacto"], contacto);
  assert.equal(row?.["origen"], "referido");
});

test("un cliente recién creado tiene los defaults del CRM: sin_contrato, etiquetas y contacto vacíos", async () => {
  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    `insert into clients (tenant_id, nombre) values ($1, 'Nuevo Negocio')
     returning estado_contrato, etiquetas, contacto, score, asignado_a, tipo`,
    [s.tenantA],
  );

  assert.equal(row?.["estado_contrato"], "sin_contrato", "sin_contrato: el alta no implica contrato firmado");
  assert.deepEqual(row?.["etiquetas"], []);
  assert.deepEqual(row?.["contacto"], {});
  assert.equal(row?.["score"], null);
  assert.equal(row?.["asignado_a"], null);
  assert.equal(row?.["tipo"], null);
});

test("etiquetas acepta un array vacío", async () => {
  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update clients set etiquetas = array['vip'] where id = $1 returning etiquetas",
    [s.clientA1],
  );
  assert.deepEqual(row?.["etiquetas"], ["vip"]);

  const [vacio] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update clients set etiquetas = '{}' where id = $1 returning etiquetas",
    [s.clientA1],
  );
  assert.deepEqual(vacio?.["etiquetas"], []);
});

// ---------------------------------------------------------------- checks

test("🔴 score fuera de 0-100 se rechaza", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set score = 101 where id = $1",
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
    "101 está fuera de rango",
  );

  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set score = -1 where id = $1",
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
    "-1 está fuera de rango",
  );
});

test("score acepta los bordes 0 y 100", async () => {
  for (const valor of [0, 100]) {
    const [row] = await db.asUser(
      { tenantId: s.tenantA, userId: s.equipoA },
      "update clients set score = $2 where id = $1 returning score",
      [s.clientA1, valor],
    );
    assert.equal(row?.["score"], valor);
  }
});

test("🔴 tipo fuera de la lista (empresa|autonomo|particular) se rechaza", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set tipo = 'gobierno' where id = $1",
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
  );
});

test("🔴 estado_contrato fuera de la lista (sin_contrato|vigente|vencido) se rechaza", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set estado_contrato = 'pausado' where id = $1",
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
  );
});

test("🔴 nivel_actividad fuera de la lista (bajo|medio|alto) se rechaza", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set nivel_actividad = 'extremo' where id = $1",
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
  );
});

test("🔴 contacto tiene que ser un objeto: un array o un string se rechazan", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set contacto = '[1,2,3]'::jsonb where id = $1",
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
    "un array no es un objeto",
  );

  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        `update clients set contacto = '"un string suelto"'::jsonb where id = $1`,
        [s.clientA1],
      ),
    /violat.*check|check.*constraint/i,
    "un string no es un objeto",
  );
});

// ---------------------------------------------------------------- FK compuesta

test("🔴 asignado_a apuntando a un usuario de OTRO tenant se rechaza", async () => {
  // s.equipoB es miembro de tenantB. Asignarlo a un cliente de tenantA tiene que fallar: es
  // exactamente el mismo mecanismo que la FK compuesta de kr_runs → clients (0001).
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set asignado_a = $2 where id = $1",
        [s.clientA1, s.equipoB],
      ),
    /foreign key|violat/i,
  );
});

test("asignado_a apuntando a un usuario del MISMO tenant se acepta", async () => {
  const [row] = await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update clients set asignado_a = $2 where id = $1 returning asignado_a",
    [s.clientA1, s.equipoA],
  );
  assert.equal(row?.["asignado_a"], s.equipoA);
});

test("🔴 asignado_a apuntando a un uuid que no es miembro de NINGÚN tenant se rechaza", async () => {
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: s.equipoA },
        "update clients set asignado_a = $2 where id = $1",
        [s.clientA1, s.intruso],
      ),
    /foreign key|violat/i,
  );
});

// ---------------------------------------------------------------- ADR-19: el renderizador no ve nada de esto

const COLUMNAS_CRM = [
  "tipo",
  "industria",
  "etiquetas",
  "nivel_actividad",
  "estado_contrato",
  "contrato_vence_en",
  "score",
  "asignado_a",
  "contacto",
  "origen",
] as const;

test("🔴 app_render NO puede leer ninguna columna nueva del CRM directamente", async () => {
  for (const columna of COLUMNAS_CRM) {
    await assert.rejects(
      () => db.asRender(`select ${columna} from clients`),
      /permission denied|no tiene permiso/i,
      `${columna} no debería tener ningún grant a app_render`,
    );
  }
});

test("🔴 el CRM (contacto, contrato, score) NO aparece en business_profile_publico, aunque el perfil público lo mencione", async () => {
  // Carga un cliente con datos reales del CRM (columnas nuevas) Y, además, con una copia de esos
  // mismos datos DENTRO de business_profile — simulando el error que este test existe para atajar:
  // que alguien, por comodidad, escriba el contacto o el contrato adentro del perfil público. La
  // allowlist de nap_publico (0008/0009/0010) tiene que seguir descartándolo por nombre de clave.
  await db.asService(
    `update clients set
       domain = 'crm-seguridad.es',
       storyblok_space_id = 'SB-CRM-SEG',
       business_profile = $2::jsonb,
       estado_contrato = 'vigente',
       contrato_vence_en = '2026-12-31',
       score = 92,
       contacto = $3::jsonb,
       tipo = 'empresa'
     where id = $1`,
    [
      s.clientA2,
      JSON.stringify({
        name: "Bar Pepe",
        priceRange: "€€",
        // Mismos nombres que las columnas nuevas del CRM, puestos A PROPÓSITO dentro del perfil:
        // si nap_publico alguna vez se mutara para proyectarlos, este test tiene que caer.
        contacto: { email: "privado@barpepe.es", telefono: "+34 611 222 333" },
        estado_contrato: "vigente",
        score: 92,
        notas_agencia: "no paga hace tres meses",
      }),
      JSON.stringify({ email: "privado@barpepe.es", telefono: "+34 611 222 333" }),
    ],
  );

  const [fila] = await db.asRender<{ p: Record<string, unknown> }>(
    "select business_profile_publico as p from clients where domain = 'crm-seguridad.es'",
  );
  const perfil = fila?.p ?? {};

  assert.equal(perfil["name"], "Bar Pepe", "el NAP público sí pasa");
  assert.equal(perfil["priceRange"], "€€");
  assert.equal(perfil["contacto"], undefined, "el contacto NO pasa, ni escondido dentro del perfil");
  assert.equal(perfil["estado_contrato"], undefined, "el estado del contrato NO pasa");
  assert.equal(perfil["score"], undefined, "el score NO pasa");
  assert.equal(perfil["notas_agencia"], undefined, "las notas de la agencia NO pasan");

  // Y por supuesto, las columnas reales del CRM (fuera de business_profile) siguen sin grant.
  await assert.rejects(
    () => db.asRender("select contacto, score, estado_contrato from clients where domain = 'crm-seguridad.es'"),
    /permission denied|no tiene permiso/i,
  );
});

// ---------------------------------------------------------------- RLS existente: nada cambia

test("RLS de clients sigue aislando por tenant con las columnas nuevas puestas", async () => {
  await db.asUser(
    { tenantId: s.tenantA, userId: s.equipoA },
    "update clients set score = 50, estado_contrato = 'vigente' where id = $1",
    [s.clientA1],
  );

  const rows = await db.asUser({ tenantId: s.tenantB, userId: s.equipoB }, "select id from clients");
  const ids = rows.map((r) => (r as { id: string }).id);
  assert.ok(!ids.includes(s.clientA1), "el tenant B sigue sin ver el cliente del tenant A");
});

// ================================================================== Etapa 2: PgClientes (TypeScript)
//
// Lo de arriba prueba el ESQUEMA con SQL crudo bajo `db.asUser` (que hace rollback por llamada). Lo
// de acá abajo prueba la CAPA DE DATOS (`clientes.ts`), que escribe de verdad (commit real, vía
// `PglitePool`) — por eso cada test da de alta sus propios clientes con `crearCliente` en vez de
// mutar los clientes sembrados (`s.clientA1`/`clientA2`/`clientB1`), que las secciones de arriba
// siguen usando en su estado original.

test("listarClientes devuelve solo los clientes del tenant del contexto", async () => {
  const comoA = await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA });
  const comoB = await clientes.listarClientes({ tenantId: s.tenantB, userId: s.equipoB });

  const idsA = comoA.map((c) => c.id);
  const idsB = comoB.map((c) => c.id);

  assert.ok(idsA.includes(s.clientA1), "el tenant A ve su propio cliente A1");
  assert.ok(idsA.includes(s.clientA2), "el tenant A ve su propio cliente A2");
  assert.ok(!idsA.includes(s.clientB1), "el tenant A NO ve el cliente del tenant B");

  assert.ok(idsB.includes(s.clientB1), "el tenant B ve su propio cliente");
  assert.ok(!idsB.includes(s.clientA1) && !idsB.includes(s.clientA2), "el tenant B NO ve los clientes del tenant A");
});

test("crearCliente usa el tenant_id del CONTEXTO, aunque el payload traiga uno de otro tenant", async () => {
  // `NuevoCliente` no tiene una clave `tenantId` (ver clientes.ts) -- pero un handler HTTP real
  // (Etapa 3) parsea JSON sin tipos, así que un payload real SÍ podría traer una clave extra. El
  // cast simula justo eso: la garantía tiene que ser de RUNTIME (qué columnas lee el insert), no
  // solo del compilador negándose a compilar un objeto literal con una clave de más.
  const payloadConFuga = {
    nombre: "Intento de fuga de tenant",
    tenantId: s.tenantB,
  } as unknown as NuevoCliente;

  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, payloadConFuga);

  const comoA = await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA });
  const comoB = await clientes.listarClientes({ tenantId: s.tenantB, userId: s.equipoB });

  assert.ok(comoA.some((c) => c.id === id), "el cliente nace en el tenant del CONTEXTO");
  assert.ok(!comoB.some((c) => c.id === id), "no en el tenant que venía (de más) en el payload");
});

test("crearCliente sin campos opcionales respeta los defaults del esquema (0011)", async () => {
  const id = await clientes.crearCliente(
    { tenantId: s.tenantA, userId: s.equipoA },
    { nombre: "Nuevo Negocio TS" },
  );

  const fila = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.equal(fila?.estado_contrato, "sin_contrato", "sin_contrato: el alta no implica contrato firmado");
  assert.deepEqual(fila?.etiquetas, []);
  assert.deepEqual(fila?.contacto, {});
  assert.equal(fila?.score, null);
  assert.equal(fila?.tipo, null);
});

test("actualizarCliente de un cliente de OTRO tenant no afecta ninguna fila (0, no una excepción)", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Solo de A" });

  const resultado = await clientes.actualizarCliente(
    { tenantId: s.tenantB, userId: s.equipoB },
    id,
    { score: 99 },
  );
  assert.equal(resultado, false, "el tenant B no puede tocar un cliente del tenant A");

  const fila = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.equal(fila?.score, null, "el score NO cambió");
});

test("actualizarCliente del MISMO tenant sí aplica los cambios", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Editable" });

  const ok = await clientes.actualizarCliente({ tenantId: s.tenantA, userId: s.equipoA }, id, {
    score: 55,
    industria: "restauracion",
    contacto: { email: "editable@test.es" },
  });
  assert.equal(ok, true);

  const fila = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.equal(fila?.score, 55);
  assert.equal(fila?.industria, "restauracion");
  assert.deepEqual(fila?.contacto, { email: "editable@test.es" });
});

test("archivarCliente / desarchivarCliente cambian archived_at", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Para archivar" });

  const antes = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.equal(antes?.archived_at, null);

  const archivado = await clientes.archivarCliente({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.equal(archivado, true);
  const despues = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.ok(despues?.archived_at, "archived_at quedó seteado");

  const reabierto = await clientes.desarchivarCliente({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.equal(reabierto, true);
  const final = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.equal(final?.archived_at, null, "desarchivarCliente vuelve a dejarlo en null");
});

test("archivarCliente de un cliente de OTRO tenant no afecta ninguna fila", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Protegido" });

  const resultado = await clientes.archivarCliente({ tenantId: s.tenantB, userId: s.equipoB }, id);
  assert.equal(resultado, false);

  const fila = (await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })).find(
    (c) => c.id === id,
  );
  assert.equal(fila?.archived_at, null, "sigue sin archivar: el tenant B no pudo tocarlo");
});

// ================================================================== Etapa 3: obtenerCliente
//
// El "traer uno solo" que le faltaba a PgClientes para que GET /clients/:id (api) pueda existir.
// Mismo patrón que store.ts's getRun/getClient: `rows[0] ?? null`, nunca un throw.

test("obtenerCliente devuelve el cliente por id, con las mismas columnas que listarClientes", async () => {
  const id = await clientes.crearCliente(
    { tenantId: s.tenantA, userId: s.equipoA },
    { nombre: "Uno Solo", industria: "restauracion", score: 42 },
  );

  const cliente = await clientes.obtenerCliente({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.ok(cliente, "el cliente existe y es del tenant del contexto");
  assert.equal(cliente?.id, id);
  assert.equal(cliente?.nombre, "Uno Solo");
  assert.equal(cliente?.industria, "restauracion");
  assert.equal(cliente?.score, 42);
});

test("obtenerCliente de un id de OTRO tenant devuelve null (no lanza)", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Solo de A" });

  const comoB = await clientes.obtenerCliente({ tenantId: s.tenantB, userId: s.equipoB }, id);
  assert.equal(comoB, null, "bajo RLS, un id de otro tenant no matchea: null, no un error");
});

test("obtenerCliente de un id inexistente devuelve null", async () => {
  const cliente = await clientes.obtenerCliente(
    { tenantId: s.tenantA, userId: s.equipoA },
    "00000000-0000-4000-8000-000000000000",
  );
  assert.equal(cliente, null);
});

// ================================================================== Etapa 4: enmascarado del CRM
//
// Fix CRÍTICO de la revisión final de la rama: `client_select` (0001) es RLS POR FILA, no por
// columna — un usuario con rol `cliente` YA podía ver su propia fila completa de `clients`
// (`app.ve_cliente` se lo permite). Antes de la 0011 eso era inofensivo (nombre, perfil de negocio);
// ahora esa misma fila carga además notas INTERNAS de la agencia sobre ese cliente (contacto, score,
// estado del contrato, etc.). El fix envuelve esas 10 columnas en un `case when app.current_role() =
// 'cliente' then null else <col> end` dentro de la consulta (`CLIENTE_CRM_COLS`, clientes.ts) — la
// misma función `app.current_role()` que ya usan las políticas RLS decide, en Postgres, qué vuelve.
//
// `s.duenoA1` es la membresía rol `cliente` atada a `s.clientA1` (ver seed en testdb.ts). Antes de
// este bloque `clientA1` sigue en sus defaults (los únicos intentos previos de escribirle CRM fueron
// vía `db.asUser`, que hace rollback) — así que acá lo sembramos de verdad con `actualizarCliente`
// (que sí commitea, vía `PglitePool`), como `equipoA` (el único rol que puede escribir).

const CRM_SEMBRADO = {
  tipo: "empresa",
  industria: "restauracion",
  etiquetas: ["vip"],
  nivel_actividad: "alto",
  estado_contrato: "vigente",
  contrato_vence_en: "2027-01-01",
  score: 87,
  asignado_a: undefined as string | undefined, // se completa abajo con s.equipoA
  contacto: { email: "dueno@bellanapoli.es", notas: "cliente conflictivo, revisar antes de renovar" },
  origen: "referido",
};

test("🔴 duenoA1 (rol cliente) NO ve las columnas de CRM de su propio cliente: listarClientes", async () => {
  CRM_SEMBRADO.asignado_a = s.equipoA;
  const ok = await clientes.actualizarCliente(
    { tenantId: s.tenantA, userId: s.equipoA },
    s.clientA1,
    CRM_SEMBRADO,
  );
  assert.equal(ok, true, "el seed de este bloque se aplicó (equipoA sí puede escribir)");

  const comoDueno = (
    await clientes.listarClientes({ tenantId: s.tenantA, userId: s.duenoA1 })
  ).find((c) => c.id === s.clientA1);

  assert.ok(comoDueno, "duenoA1 sigue viendo su propia fila (RLS por fila no cambia)");
  assert.equal(comoDueno?.tipo, null, "tipo enmascarado para el rol cliente");
  assert.equal(comoDueno?.industria, null, "industria enmascarada para el rol cliente");
  assert.equal(comoDueno?.etiquetas, null, "etiquetas enmascaradas para el rol cliente");
  assert.equal(comoDueno?.nivel_actividad, null, "nivel_actividad enmascarado para el rol cliente");
  assert.equal(comoDueno?.estado_contrato, null, "estado_contrato enmascarado para el rol cliente");
  assert.equal(comoDueno?.contrato_vence_en, null, "contrato_vence_en enmascarado para el rol cliente");
  assert.equal(comoDueno?.score, null, "score enmascarado para el rol cliente");
  assert.equal(comoDueno?.asignado_a, null, "asignado_a enmascarado para el rol cliente");
  assert.equal(comoDueno?.contacto, null, "contacto (notas internas) enmascarado para el rol cliente");
  assert.equal(comoDueno?.origen, null, "origen enmascarado para el rol cliente");

  // Lo que NO es CRM sigue visible: la máscara es de columna, no de fila.
  assert.equal(comoDueno?.id, s.clientA1);
  assert.equal(comoDueno?.nombre, "Trattoria Bella Napoli");
  assert.equal(comoDueno?.archived_at, null);
  assert.ok(comoDueno?.created_at, "created_at sigue presente");
});

test("🔴 duenoA1 (rol cliente) NO ve las columnas de CRM de su propio cliente: obtenerCliente", async () => {
  const cliente = await clientes.obtenerCliente({ tenantId: s.tenantA, userId: s.duenoA1 }, s.clientA1);

  assert.ok(cliente, "duenoA1 sigue pudiendo traer su propia fila por id");
  assert.equal(cliente?.tipo, null);
  assert.equal(cliente?.industria, null);
  assert.equal(cliente?.etiquetas, null);
  assert.equal(cliente?.nivel_actividad, null);
  assert.equal(cliente?.estado_contrato, null);
  assert.equal(cliente?.contrato_vence_en, null);
  assert.equal(cliente?.score, null);
  assert.equal(cliente?.asignado_a, null);
  assert.equal(cliente?.contacto, null);
  assert.equal(cliente?.origen, null);

  assert.equal(cliente?.id, s.clientA1);
  assert.equal(cliente?.nombre, "Trattoria Bella Napoli", "lo que no es CRM sigue visible");
  assert.equal(cliente?.archived_at, null);
  assert.ok(cliente?.created_at);
});

test("equipoA (rol equipo, mismo tenant) SÍ ve todas las columnas de CRM sin cambios — el fix no rompe el uso legítimo del staff", async () => {
  const comoEquipo = (
    await clientes.listarClientes({ tenantId: s.tenantA, userId: s.equipoA })
  ).find((c) => c.id === s.clientA1);

  assert.ok(comoEquipo);
  assert.equal(comoEquipo?.tipo, "empresa");
  assert.equal(comoEquipo?.industria, "restauracion");
  assert.deepEqual(comoEquipo?.etiquetas, ["vip"]);
  assert.equal(comoEquipo?.nivel_actividad, "alto");
  assert.equal(comoEquipo?.estado_contrato, "vigente");
  assert.equal(comoEquipo?.contrato_vence_en, "2027-01-01");
  assert.equal(comoEquipo?.score, 87);
  assert.equal(comoEquipo?.asignado_a, s.equipoA);
  assert.deepEqual(comoEquipo?.contacto, {
    email: "dueno@bellanapoli.es",
    notas: "cliente conflictivo, revisar antes de renovar",
  });
  assert.equal(comoEquipo?.origen, "referido");

  const viaObtener = await clientes.obtenerCliente({ tenantId: s.tenantA, userId: s.equipoA }, s.clientA1);
  assert.equal(viaObtener?.score, 87, "obtenerCliente tampoco enmascara para equipo");
  assert.deepEqual(viaObtener?.contacto, {
    email: "dueno@bellanapoli.es",
    notas: "cliente conflictivo, revisar antes de renovar",
  });
});

// ---------------------------------------------------------------- menú (editor del portal)

test("obtenerMenu de un cliente sin business_profile devuelve arrays vacíos, no null ni excepción", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Sin carta" });

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);

  assert.deepEqual(menu, { menu: [], menu_categorias: [] });
});

test("obtenerMenu de un cliente inexistente (o de otro tenant) devuelve null", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Solo A" });

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantB, userId: s.equipoB }, id);

  assert.equal(menu, null);
});

test("actualizarMenu sobre un cliente con business_profile NULL lo guarda igual (no se pierde en silencio)", async () => {
  // `crearCliente` nunca escribe `business_profile`: la columna queda en su default, NULL. Éste es
  // exactamente el caso que `coalesce(business_profile, '{}'::jsonb)` tiene que cubrir — sin él, el
  // `||` de jsonb sobre NULL da NULL, el UPDATE devuelve éxito y el menú no queda guardado.
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Perfil vacío" });

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantA, userId: s.equipoA }, id, {
    menu: [{ name: "Margherita", price: "9,00 €" }],
    menu_categorias: [],
  });
  assert.equal(ok, true);

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.deepEqual(menu, {
    menu: [{ name: "Margherita", price: "9,00 €" }],
    menu_categorias: [],
  });
});

test("actualizarMenu toca SOLO menu/menu_categorias — el resto de business_profile sobrevive", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Con perfil" });
  // Perfil inicial con brand y fotos, escrito directo (no hay otro método de escritura de perfil
  // completo desde este store — mismo camino que usaría el CLI de seed).
  await db.asService(
    "update clients set business_profile = $1::jsonb where id = $2",
    [
      JSON.stringify({
        name: "Con perfil",
        brand: { colores: { primario: "#0a7d34" } },
        fotos: [{ src: "https://a.storyblok.com/f/1/x.jpg" }],
      }),
      id,
    ],
  );

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantA, userId: s.equipoA }, id, {
    menu: [{ name: "Margherita", price: "9,00 €" }],
    menu_categorias: [{ nombre: "Pizzas" }],
  });
  assert.equal(ok, true);

  const [fila] = await db.asService(
    "select business_profile from clients where id = $1",
    [id],
  );
  assert.deepEqual((fila as { business_profile: Record<string, unknown> }).business_profile.brand, {
    colores: { primario: "#0a7d34" },
  });
  assert.deepEqual((fila as { business_profile: Record<string, unknown> }).business_profile.fotos, [
    { src: "https://a.storyblok.com/f/1/x.jpg" },
  ]);
});

test("actualizarMenu de un cliente de OTRO tenant no afecta ninguna fila", async () => {
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Solo de A" });

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantB, userId: s.equipoB }, id, {
    menu: [{ name: "Intento de fuga" }],
    menu_categorias: [],
  });
  assert.equal(ok, false);

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.deepEqual(menu, { menu: [], menu_categorias: [] }, "el menú de A no cambió");
});

test("🔴 actualizarMenu con rol cliente (duenoA1) no escribe — client_write/app.puede_escribir() lo bloquea", async () => {
  // Restricción #2 del plan (Global Constraints: "Solo maestro/equipo editan"). No es una política
  // nueva —`client_write` (0001) ya lo impone y ningún cambio de esta etapa la tocó— pero hasta ahora
  // solo quedaba cubierta transitivamente por los tests de `client_write` sobre `PATCH /clients/:id`,
  // nunca por un test directo sobre `actualizarMenu`.
  const id = await clientes.crearCliente({ tenantId: s.tenantA, userId: s.equipoA }, { nombre: "Con carta" });
  await clientes.actualizarMenu({ tenantId: s.tenantA, userId: s.equipoA }, id, {
    menu: [{ name: "Margherita" }],
    menu_categorias: [],
  });

  const ok = await clientes.actualizarMenu({ tenantId: s.tenantA, userId: s.duenoA1 }, id, {
    menu: [{ name: "Intento de fuga" }],
    menu_categorias: [],
  });
  assert.equal(ok, false);

  const menu = await clientes.obtenerMenu({ tenantId: s.tenantA, userId: s.equipoA }, id);
  assert.deepEqual(menu, { menu: [{ name: "Margherita" }], menu_categorias: [] }, "el menú no cambió");
});

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

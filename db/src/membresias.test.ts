import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PgMembresias } from "./membresias.js";
import { PglitePool } from "./pool.js";

/**
 * Etapa 1 de la pieza 2 (Usuarios, ver `docs/superpowers/plans/2026-08-01-paginas-usuarios-portal.md`):
 * acceso de LECTURA a los miembros del tenant, con su email (de `auth.users`, vía la vista
 * `membresias_perfil` que agrega la 0012).
 *
 * Decisión ya cerrada (no se re-abre acá): un rol `cliente` que llama `listarMiembros` ve SOLO su
 * propia fila, nunca la lista completa de miembros del tenant. Un `equipo`/`maestro` sí ve todas las
 * filas del tenant. El filtro vive en la vista (SQL), no en un `if` de TypeScript después de traer
 * todas las filas -- eso NO sería defensa en profundidad.
 */

let db: TestDb;
let s: Seed;
let membresias: PgMembresias;
// `seed()` (testdb.ts, Etapa 1) no sembró ningún `maestro` -- no lo necesitaba. La Etapa 2 sí: solo
// un maestro puede cambiar roles (ver `membership_update`, 0012). Dos en tenantA, para poder
// degradar a uno sin que el OTRO test (el del último maestro) se pise con este.
let maestroA1: string;
let maestroA2: string;

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  // PGlite y TestDb comparten instancia; el pool de PgMembresias va contra la misma base sembrada
  // (mismo criterio que clientes.test.ts para PgClientes).
  membresias = new PgMembresias(new PglitePool(db.pglite));

  // `seed()` (testdb.ts) da de alta las membresías pero no toca `auth.users` -- ese stand-in es
  // nuestro, así que acá le damos email a cada usuario que `seed()` ya sembró en `memberships`.
  await db.asService(
    `insert into auth.users (id, email, raw_app_meta_data) values
       ($1, 'equipoA@agencia-a.test', '{"name":"Equipo A"}'::jsonb),
       ($2, 'equipoB@agencia-b.test', '{"name":"Equipo B"}'::jsonb),
       ($3, 'dueno.a1@bellanapoli.test', '{"name":"Dueno A1"}'::jsonb)`,
    [s.equipoA, s.equipoB, s.duenoA1],
  );

  const mkMaestro = async (): Promise<string> => {
    const [m] = await db.asService<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol, client_id)
       values ($1, gen_random_uuid(), 'maestro', null) returning user_id`,
      [s.tenantA],
    );
    return m!.user_id;
  };
  maestroA1 = await mkMaestro();
  maestroA2 = await mkMaestro();
});

after(async () => {
  await db.close();
});

// ---------------------------------------------------------------- visibilidad por rol

test("equipoA (staff) ve TODAS las membresías de su tenant, con email", async () => {
  const filas = await membresias.listarMiembros({ tenantId: s.tenantA, userId: s.equipoA });
  const userIds = filas.map((f) => f.user_id);

  assert.ok(userIds.includes(s.equipoA), "se ve a sí mismo");
  assert.ok(userIds.includes(s.duenoA1), "ve también al dueño (rol cliente) del mismo tenant");
  assert.ok(!userIds.includes(s.equipoB), "NO ve al equipo del tenant B");

  const propia = filas.find((f) => f.user_id === s.equipoA);
  assert.equal(propia?.email, "equipoA@agencia-a.test");
  assert.equal(propia?.rol, "equipo");
});

test("duenoA1 (rol cliente) ve SOLO su propia fila, no la lista completa del tenant", async () => {
  const filas = await membresias.listarMiembros({ tenantId: s.tenantA, userId: s.duenoA1 });

  assert.equal(filas.length, 1, "una sola fila: la suya -- NUNCA la cartera completa del tenant");
  assert.equal(filas[0]?.user_id, s.duenoA1);
  assert.equal(filas[0]?.email, "dueno.a1@bellanapoli.test");
  assert.equal(filas[0]?.rol, "cliente");
});

test("equipoB ve solo las membresías de SU tenant (aislamiento básico)", async () => {
  const filas = await membresias.listarMiembros({ tenantId: s.tenantB, userId: s.equipoB });
  const userIds = filas.map((f) => f.user_id);

  assert.ok(userIds.includes(s.equipoB));
  assert.ok(!userIds.includes(s.equipoA), "no ve al equipo del tenant A");
  assert.ok(!userIds.includes(s.duenoA1), "no ve al dueño del tenant A");
});

test("un usuario sin ninguna membresía (intruso) no ve absolutamente nada", async () => {
  const filas = await membresias.listarMiembros({ tenantId: s.tenantA, userId: s.intruso });
  assert.deepEqual(filas, []);
});

// ---------------------------------------------------------------- grant por columna

test("🔴 el grant sobre auth.users es POR COLUMNA: created_at (no concedida) se rechaza para app_user", async () => {
  // 0012 concede select(id, email, raw_app_meta_data) -- nunca la tabla entera. `created_at` existe
  // en el stand-in (para poder ordenar internamente) pero NO tiene grant: si esto pasara a resolver,
  // sería la señal de que alguien cambió el grant a `select on auth.users` a secas, exactamente lo
  // que el brief prohíbe (auth.users real tiene encrypted_password/confirmation_token/recovery_token).
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select created_at from auth.users"),
    /permission denied|no tiene permiso/i,
  );
});

// ---------------------------------------------------------------- test de fuga

test("🔴 FUGA: un miembro del tenant A no ve, por NINGÚN camino, el email de alguien que NO es miembro de A", async () => {
  // 1) Vía la capa de datos (PgMembresias) -- el camino que va a usar el portal.
  const filas = await membresias.listarMiembros({ tenantId: s.tenantA, userId: s.equipoA });
  assert.ok(
    !filas.some((f) => f.email === "equipoB@agencia-b.test"),
    "equipoA (tenant A) no ve el email de equipoB (tenant B) vía listarMiembros",
  );

  // 2) Vía SQL crudo contra la MISMA vista, bajo RLS real (rol de conexión app_user, sin pasar por
  //    la clase TypeScript): la garantía tiene que vivir en la vista, no en membresias.ts.
  const crudo = await db.asUser<{ email: string }>(
    { tenantId: s.tenantA, userId: s.equipoA },
    "select email from membresias_perfil where user_id = $1",
    [s.equipoB],
  );
  assert.equal(crudo.length, 0, "la vista tampoco deja pasar la fila de equipoB para el tenant A");
});

// ------------------------------------------------ defensa en profundidad: rol 'servicio' en memberships

test("🔴 una fila 'servicio' colada en memberships NO obtiene visibilidad de staff (rol_propio_sin_recursion la excluye)", async () => {
  // La constraint membresia_no_es_servicio (0003) ya bloquea el INSERT normal -- este test simula que
  // esa CAPA falla (se la saca a mano) para probar que rol_propio_sin_recursion() es una segunda capa
  // independiente, no una que confía en la constraint. Todo dentro de UNA transacción que se
  // rollbackea al final: ni el DROP CONSTRAINT ni el INSERT sobreviven este test.
  await db.exec("begin");
  try {
    await db.queryEnTx("alter table memberships drop constraint membresia_no_es_servicio");
    const [fila] = await db.queryEnTx<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol, client_id)
       values ($1, gen_random_uuid(), 'servicio'::user_role, null) returning user_id`,
      [s.tenantA],
    );
    const servicioUserId = fila!.user_id;

    await db.queryEnTx("select set_config('app.tenant_id', $1, true)", [s.tenantA]);
    await db.queryEnTx("select set_config('app.user_id', $1, true)", [servicioUserId]);
    await db.queryEnTx("set local role app_user");

    // Si rol_propio_sin_recursion() no filtrara 'servicio' (el bug), membership_select_staff lo
    // trataría como staff y vería TODAS las membresías del tenant (equipoA, duenoA1, maestroA1/2...).
    // Con el filtro puesto, solo membership_select (own-row) aplica: una sola fila, la propia.
    const filas = await db.queryEnTx<{ user_id: string }>("select user_id from memberships");
    assert.equal(filas.length, 1, "NO debe ver el resto del tenant como si fuera staff");
    assert.equal(filas[0]?.user_id, servicioUserId, "la única fila visible es la propia");
  } finally {
    await db.exec("rollback");
  }
});

// ---------------------------------------------------------------- cambiarRol (Etapa 2)
//
// Este archivo comparte UNA sola base entre todos los `test()` (un solo before/after, sin reset
// entre casos) -- por eso cada test que MUTA de verdad usa una membresía "de usar y tirar", creada
// adentro del propio test, en vez de tocar `s.equipoA`/`s.duenoA1` (de los que los tests de arriba ya
// dependen) o `maestroA1`/`maestroA2` (que varios tests de acá abajo siguen necesitando intactos).

const rolDe = async (userId: string): Promise<{ rol: string; client_id: string | null }> => {
  const [row] = await db.asService<{ rol: string; client_id: string | null }>(
    "select rol, client_id from memberships where user_id = $1",
    [userId],
  );
  return { rol: row!.rol, client_id: row!.client_id };
};

const mkMiembro = async (tenantId: string, rol: string, clientId: string | null = null): Promise<string> => {
  const [m] = await db.asService<{ user_id: string }>(
    `insert into memberships (tenant_id, user_id, rol, client_id)
     values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
    [tenantId, rol, clientId],
  );
  return m!.user_id;
};

test("🔴 el GRANT UPDATE de memberships es POR COLUMNA: user_id se rechaza aunque el que pregunta sea maestro", async () => {
  // 0012 concede update(rol, client_id) -- nunca la tabla entera. Si esto pasara a resolver, sería
  // la señal de que alguien volvió al grant amplio (`grant update on memberships`), que permitiría
  // reescribir user_id/id (la PK) para transferir un rol de maestro a una cuenta arbitraria, sin
  // pasar por el INSERT que sí está bloqueado. Se prueba con maestroA1 (pasa membership_update.using
  // Y with check) para que el rechazo sea del GRANT, no de la política -- si solo probáramos con un
  // 'equipo', el 42501 podría venir de with check y este caso no distinguiría las dos causas.
  const blanco = await mkMiembro(s.tenantA, "equipo");
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: maestroA1 },
        "update memberships set user_id = gen_random_uuid() where user_id = $1",
        [blanco],
      ),
    /permission denied|no tiene permiso/i,
  );
});

test("🔴 cambiarRol de un usuario de OTRO tenant no afecta ninguna fila", async () => {
  // maestroA1 (tenant A) intenta cambiar a equipoB, que es de tenant B -- membership_update.using
  // exige tenant_id = current_tenant_id(), así que la fila de equipoB ni siquiera se "ve".
  const ok = await membresias.cambiarRol(
    { tenantId: s.tenantA, userId: maestroA1 },
    s.equipoB,
    { rol: "equipo" },
  );
  assert.equal(ok, false);
  const fila = await rolDe(s.equipoB);
  assert.equal(fila.rol, "equipo", "equipoB no cambió: sigue siendo equipo en SU tenant");
});

test("🔴 poner rol 'cliente' sin client_id falla por la constraint cliente_exige_client_id (0001)", async () => {
  const blanco = await mkMiembro(s.tenantA, "equipo");
  await assert.rejects(
    () => membresias.cambiarRol({ tenantId: s.tenantA, userId: maestroA1 }, blanco, { rol: "cliente" }),
    /cliente_exige_client_id|check constraint/i,
  );
});

test("🔴 poner rol 'cliente' con client_id de OTRO tenant falla por la FK compuesta (0001)", async () => {
  const blanco = await mkMiembro(s.tenantA, "equipo");
  await assert.rejects(
    () =>
      membresias.cambiarRol({ tenantId: s.tenantA, userId: maestroA1 }, blanco, {
        rol: "cliente",
        clientId: s.clientB1, // clientB1 es de tenantB, no de tenantA
      }),
    /foreign key|violat/i,
  );
});

test("maestro cambia el rol de un miembro a 'cliente', atado a un client_id del MISMO tenant", async () => {
  const blanco = await mkMiembro(s.tenantA, "equipo");
  const ok = await membresias.cambiarRol({ tenantId: s.tenantA, userId: maestroA1 }, blanco, {
    rol: "cliente",
    clientId: s.clientA2,
  });
  assert.equal(ok, true);
  const fila = await rolDe(blanco);
  assert.equal(fila.rol, "cliente");
  assert.equal(fila.client_id, s.clientA2);
});

test("cambiar de 'cliente' a 'equipo' limpia client_id a null (si no, violaría cliente_exige_client_id)", async () => {
  const blanco = await mkMiembro(s.tenantA, "cliente", s.clientA1);
  const ok = await membresias.cambiarRol({ tenantId: s.tenantA, userId: maestroA1 }, blanco, { rol: "equipo" });
  assert.equal(ok, true);
  const fila = await rolDe(blanco);
  assert.equal(fila.rol, "equipo");
  assert.equal(fila.client_id, null, "un rol no-cliente no puede quedar con client_id seteado");
});

test("🔴 un 'equipo' (no maestro) intentando cambiar el rol de otro → RLS lo frena (42501)", async () => {
  const blanco = await mkMiembro(s.tenantA, "equipo");
  await assert.rejects(
    () => membresias.cambiarRol({ tenantId: s.tenantA, userId: s.equipoA }, blanco, { rol: "maestro" }),
    /permission denied|row-level security|insufficient_privilege/i,
  );
  const fila = await rolDe(blanco);
  assert.equal(fila.rol, "equipo", "el intento de equipoA no tuvo ningún efecto");
});

test("🔴 auto-degradación: un maestro cambiando SU PROPIO rol → RLS lo frena (42501), en la base", async () => {
  // Ver membership_update (0012): with check exige user_id <> current_user_id(), además de ser
  // maestro. No es solo un `if` en la API (api/src/app.ts también lo comprueba comparando el userId
  // de la ruta contra ctx.userId) -- acá se confirma que la base lo impone incluso si algo llamara a
  // cambiarRol sin pasar por ese `if`.
  await assert.rejects(
    () => membresias.cambiarRol({ tenantId: s.tenantA, userId: maestroA1 }, maestroA1, { rol: "equipo" }),
    /permission denied|row-level security|insufficient_privilege/i,
  );
  const fila = await rolDe(maestroA1);
  assert.equal(fila.rol, "maestro", "maestroA1 sigue siendo maestro: no se pudo auto-degradar");
});

test("maestro cambia el rol de OTRO maestro (quedan 2 -> queda 1): no dispara la garantía del último", async () => {
  const ok = await membresias.cambiarRol({ tenantId: s.tenantA, userId: maestroA1 }, maestroA2, { rol: "equipo" });
  assert.equal(ok, true);
  const fila = await rolDe(maestroA2);
  assert.equal(fila.rol, "equipo");
  // maestroA1 sigue siendo el único maestro de tenantA -- lo confirma el próximo test de este mismo
  // archivo, que necesita exactamente ese estado.
});

// ---------------------------------------------------------------- último maestro (trigger, 0012)
//
// El `with check` de membership_update YA exige ser maestro Y no ser la propia fila -- así que,
// vía `cambiarRol` (el camino de la API), un tenant JAMÁS puede llegar a "0 maestros": quien hace el
// cambio siempre tiene que seguir siendo maestro después (es su propia garantía, no la del trigger).
// El trigger protege el camino que SÍ puede saltarse esa combinación: acceso directo/administrativo
// (migraciones, soporte, un futuro DELETE) que corre como `asService` (superusuario: bypassa RLS,
// pero un trigger NO es RLS -- corre igual). Por eso este test usa `db.asService`, no `cambiarRol`.
test("🔴 degradar (o borrar) al ÚLTIMO maestro de un tenant falla, incluso por acceso directo", async () => {
  const [t] = await db.asService<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Tenant Único Maestro', 'unico-maestro') returning id",
  );
  const tenantSolo = t!.id;
  const unicoMaestro = await mkMiembro(tenantSolo, "maestro");

  await assert.rejects(
    () => db.asService("update memberships set rol = 'equipo' where user_id = $1", [unicoMaestro]),
    /quedaría sin ningún maestro|last.*maestro/i,
    "degradar al único maestro tiene que fallar",
  );
  await assert.rejects(
    () => db.asService("delete from memberships where user_id = $1", [unicoMaestro]),
    /quedaría sin ningún maestro|last.*maestro/i,
    "borrar al único maestro tiene que fallar igual (mismo trigger, AFTER DELETE)",
  );

  const fila = await rolDe(unicoMaestro);
  assert.equal(fila.rol, "maestro", "el intento no tuvo ningún efecto: sigue siendo maestro");
});

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

test("listarMiembros expone telegram_vinculado (contrato que consume Task 3 del portal)", async () => {
  await db.asService(
    "update memberships set telegram_chat_id = '12345' where user_id = $1",
    [s.equipoA],
  );

  const filas = await membresias.listarMiembros({ tenantId: s.tenantA, userId: s.equipoA });
  const equipoA = filas.find((f) => f.user_id === s.equipoA);
  const duenoA1 = filas.find((f) => f.user_id === s.duenoA1);

  assert.equal(equipoA?.telegram_vinculado, true, "vinculó Telegram -> true");
  assert.equal(duenoA1?.telegram_vinculado, false, "nunca vinculó -> false, no undefined");
});

// ---------------------------------------------------------------- acceso directo a auth.users

test("🔴 app_user NO puede leer auth.users directamente: la vista es el ÚNICO camino", async () => {
  // La 0012 nació concediendo `select (id, email, raw_app_meta_data) on auth.users to app_user`,
  // razonando que un grant POR COLUMNA protege lo sensible (encrypted_password, recovery_token...).
  // Protege las COLUMNAS, sí -- pero el filtrado de FILAS (tenant + rol) lo hace la vista
  // `membresias_perfil`, no la tabla. Con ese grant, saltearse la vista era una fuga CROSS-TENANT:
  // medido sobre esta misma rama con PGlite, equipoA (tenant A) que hacía
  // `select email from auth.users` obtenía 2 filas -- incluida `equipoB@agencia-b.test`, de OTRO
  // tenant -- mientras la vista le devolvía 1.
  //
  // El grant nunca hizo falta: una vista sin `security_invoker = true` corre con los permisos de su
  // OWNER, así que el invocador no necesita permiso sobre la tabla base para leer a través de ella.
  // `grant usage on schema auth` sí se queda: deja nombrar el esquema (sin él falla hasta el camino
  // legítimo), no leer nada.
  //
  // Este test se rompe si alguien repone el grant -- que es exactamente su trabajo. Se prueba `email`
  // (la columna que ANTES estaba concedida y por la que se filtraba el dato) y no una columna
  // cualquiera: si probáramos solo una nunca concedida, pasaría igual con la fuga puesta.
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select email from auth.users"),
    /permission denied|no tiene permiso/i,
    "leer emails salteándose la vista tiene que estar prohibido, no devolver filas de otros tenants",
  );
  await assert.rejects(
    () => db.asUser({ tenantId: s.tenantA, userId: s.equipoA }, "select created_at from auth.users"),
    /permission denied|no tiene permiso/i,
  );

  // El camino legítimo sigue funcionando: sin esto, el test de arriba se satisfaría rompiendo todo.
  const filas = await membresias.listarMiembros({ tenantId: s.tenantA, userId: s.equipoA });
  assert.ok(
    filas.some((f) => f.email === "equipoA@agencia-a.test"),
    "la vista sigue devolviendo el email por el camino permitido",
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
    // Desde la 0026, el trigger `membresias_guardia_telegram` (BEFORE UPDATE) corre ANTES de que
    // RLS evalúe el WITH CHECK de `membership_update`, y repite la misma condición de
    // autorización con su PROPIO mensaje ("No autorizado…") -- mismo errcode 42501
    // (insufficient_privilege), texto distinto al genérico de Postgres. La garantía (rechazo) es
    // la misma; lo que cambia es CUÁL de las dos capas la reporta primero.
    /permission denied|row-level security|insufficient_privilege|No autorizado/i,
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
    // Ver el comentario del test de arriba: desde la 0026 el trigger reporta esto primero, mismo 42501.
    /permission denied|row-level security|insufficient_privilege|No autorizado/i,
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

test("🔴 el chequeo del último maestro se serializa POR TENANT antes de contar", async () => {
  // Contar no alcanza si dos transacciones cuentan a la vez: con dos maestros, cada una degrada al
  // suyo, cada una ve al OTRO todavía maestro (el cambio ajeno no está commiteado) y las dos aprueban
  // -- el tenant termina con cero. ADR-24 pide explícitamente que el trigger sobreviva a eso.
  //
  // ESTE TEST NO REPRODUCE LA CARRERA, y conviene que se sepa: PGlite es un solo backend, no hay dos
  // transacciones simultáneas que interleavear. Lo que fija es que el punto de serialización EXISTE y
  // es por tenant -- que es lo que se puede comprobar acá, y cae si alguien saca el
  // `pg_advisory_xact_lock` del trigger.
  const claveDe = async (tenantId: string): Promise<number> => {
    const [k] = await db.asService<{ objid: number }>(
      // pg_locks expone classid/objid como oid (sin signo); hashtext devuelve int4 con signo. La
      // conversión se hace en SQL para comparar exactamente lo mismo que reporta el motor.
      "select (hashtext($1::text)::bigint & 4294967295)::bigint as objid",
      [tenantId],
    );
    return Number(k!.objid);
  };

  const locksDeLaTx = async (): Promise<number[]> => {
    const filas = await db.queryEnTx<{ objid: number }>(
      `select objid::bigint as objid from pg_locks
        where locktype = 'advisory'
          and classid = (hashtext('memberships_ultimo_maestro')::bigint & 4294967295)`,
    );
    return filas.map((f) => Number(f.objid));
  };

  // Un tenant nuevo con dos maestros: degradar a uno dispara el trigger y lo deja pasar (queda el
  // otro), que es el camino donde el lock tiene que estar puesto -- no solo en el que falla.
  const [t] = await db.asService<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Tenant Concurrencia', 'concurrencia') returning id",
  );
  const tenantC = t!.id;
  const m1 = await mkMiembro(tenantC, "maestro");
  await mkMiembro(tenantC, "maestro");

  await db.exec("begin");
  try {
    assert.deepEqual(await locksDeLaTx(), [], "antes del update no hay ningún lock de este espacio");

    await db.queryEnTx("update memberships set rol = 'equipo' where user_id = $1", [m1]);

    assert.deepEqual(
      await locksDeLaTx(),
      [await claveDe(tenantC)],
      "el trigger tiene que haber tomado el lock de ESTE tenant antes de contar",
    );

    // Y que sea POR TENANT, no uno global: si la clave no dependiera del tenant, dos agencias
    // distintas se harían cola entre sí sin ninguna razón.
    const otro = await claveDe(s.tenantA);
    assert.notEqual(otro, await claveDe(tenantC), "tenants distintos, claves distintas");
  } finally {
    await db.exec("rollback");
  }

  // `_xact_`: se suelta solo al terminar la transacción, sin `unlock` que alguien pueda olvidar en un
  // camino de error -- acá el camino de salida fue un rollback, y aun así no quedó nada tomado.
  const [n] = await db.asService<{ n: number }>(
    "select count(*)::int as n from pg_locks where locktype = 'advisory'",
  );
  assert.equal(Number(n!.n), 0, "al cerrar la transacción el lock se suelta solo");
});

// =============================================================================
// Telegram (migración 0026, Bloque F fase 2) — auto-servicio de vinculación.
//
// El caso de más riesgo de esta migración es el trigger `membresias_guardia_telegram`: una
// segunda política UPDATE permisiva sobre `memberships` (para vincular Telegram) se combina por OR
// con `membership_update` (0012), así que sin un backstop, un UPDATE que tocara `rol` Y
// `telegram_link_code` en la MISMA sentencia podría colarse por el `with check` más laxo de la
// política nueva. Los dos tests marcados VERIFICACIÓN POR MUTACIÓN abajo son los que lo prueban de
// verdad: sin ellos, "el trigger existe" y "el trigger hace algo" no son la misma afirmación.
// =============================================================================

test("generarCodigoTelegram: el segundo código reemplaza al primero (el viejo deja de servir)", async () => {
  const miembro = await mkMiembro(s.tenantA, "equipo");
  const primero = await membresias.generarCodigoTelegram({ tenantId: s.tenantA, userId: miembro });
  const segundo = await membresias.generarCodigoTelegram({ tenantId: s.tenantA, userId: miembro });
  assert.notEqual(primero.codigo, segundo.codigo, "cada pedido genera un código nuevo (gen_random_uuid)");

  // app.vincular_telegram es security definer de app_telegram: db.asService (superusuario) puede
  // llamarla igual que app_service, sin necesitar el rol -- el superusuario salta los chequeos de
  // EXECUTE, así que esto simula exactamente lo que hace el orquestador tras leer un /start.
  const [conElViejo] = await db.asService<{ vincular_telegram: boolean }>(
    "select app.vincular_telegram($1, $2) as vincular_telegram",
    [primero.codigo, "chat-viejo"],
  );
  assert.equal(conElViejo!.vincular_telegram, false, "el código viejo ya no sirve: el segundo pedido lo pisó");

  const [conElNuevo] = await db.asService<{ vincular_telegram: boolean }>(
    "select app.vincular_telegram($1, $2) as vincular_telegram",
    [segundo.codigo, "chat-nuevo"],
  );
  assert.equal(conElNuevo!.vincular_telegram, true, "el código actual sí sirve");
});

test("telegramVinculado: false antes de vincular, true después", async () => {
  const miembro = await mkMiembro(s.tenantA, "equipo");
  // membresias_perfil hace un INNER JOIN con auth.users (0012) -- sin una fila ahí, la vista no
  // devuelve NADA para este usuario, y las dos comparaciones de abajo "pasarían" por el motivo
  // equivocado (ambas leerían `false` del default de `telegramVinculado`, no del dato real).
  await db.asService(
    "insert into auth.users (id, email, raw_app_meta_data) values ($1, 'telegram-test@agencia-a.test', '{}'::jsonb)",
    [miembro],
  );
  assert.equal(await membresias.telegramVinculado({ tenantId: s.tenantA, userId: miembro }), false);

  // Simula lo que haría app.vincular_telegram (confirmado en un test aparte de store.test.ts) sin
  // pasar por él: acá el foco es telegramVinculado/membresias_perfil, no la función de vinculación.
  await db.asService("update memberships set telegram_chat_id = $1 where user_id = $2", ["chat-1", miembro]);

  assert.equal(await membresias.telegramVinculado({ tenantId: s.tenantA, userId: miembro }), true);
});

test("desvincularTelegram: true la primera vez, false la segunda (no había nada que desvincular)", async () => {
  const miembro = await mkMiembro(s.tenantA, "equipo");
  await db.asService("update memberships set telegram_chat_id = $1 where user_id = $2", ["chat-1", miembro]);

  assert.equal(await membresias.desvincularTelegram({ tenantId: s.tenantA, userId: miembro }), true);
  assert.equal(await membresias.desvincularTelegram({ tenantId: s.tenantA, userId: miembro }), false);
});

test("🔴 el trigger membresias_guardia_telegram bloquea un UPDATE que combina rol Y telegram_link_code en la misma fila", async () => {
  // Sin este trigger, membership_vincular_telegram (0026, con check solo "¿es mi fila?") se OR-earía
  // con membership_update (0012, con check "ser maestro Y no la propia fila") y un 'equipo' podría
  // colarse a 'maestro' con tal de tocar también telegram_link_code en la MISMA sentencia.
  const equipoX = await mkMiembro(s.tenantA, "equipo");
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: equipoX },
        "update memberships set rol = 'maestro', telegram_link_code = 'x' where user_id = $1",
        [equipoX],
      ),
    /No autorizado/i,
    "un 'equipo' no puede autopromoverse combinando la columna de Telegram",
  );
  const fila = await rolDe(equipoX);
  assert.equal(fila.rol, "equipo", "el intento no tuvo ningún efecto");
});

test("🔴 VERIFICACIÓN POR MUTACIÓN: sin el trigger, ese mismo UPDATE combinado SÍ se cuela", async () => {
  const equipoY = await mkMiembro(s.tenantA, "equipo");
  await db.exec("drop trigger membresias_guardia_telegram on memberships");
  let filas: Array<{ rol: string }> = [];
  try {
    // db.asUser SIEMPRE hace rollback (éxito o no) -- lo que importa acá es si la SENTENCIA lanza o
    // no, no si el cambio persiste. `returning` deja ver, dentro de la misma transacción, si el
    // UPDATE afectó la fila antes del rollback.
    filas = await db.asUser<{ rol: string }>(
      { tenantId: s.tenantA, userId: equipoY },
      "update memberships set rol = 'maestro', telegram_link_code = 'x' where user_id = $1 returning rol",
      [equipoY],
    );
  } finally {
    await db.exec(`
      create trigger membresias_guardia_telegram
        before update on memberships
        for each row
        execute function app.membresias_guardia_telegram();
    `);
  }
  assert.equal(filas.length, 1, "sin el trigger, el UPDATE combinado SÍ afecta la fila -- exactamente el bug que el trigger cierra");
  assert.equal(filas[0]?.rol, "maestro", "el 'equipo' se autopromovió a maestro combinando la columna de Telegram");
});

test("🔴 el código de vinculación lo genera Postgres, no el caller: un valor elegido a mano no se conserva", async () => {
  const miembro = await mkMiembro(s.tenantA, "equipo");
  const filas = await db.asUser<{ telegram_link_code: string; telegram_link_code_expira: string }>(
    { tenantId: s.tenantA, userId: miembro },
    `update memberships
     set telegram_link_code = 'codigo-elegido-a-mano', telegram_link_code_expira = now() + interval '10 years'
     where user_id = $1
     returning telegram_link_code, telegram_link_code_expira`,
    [miembro],
  );
  assert.equal(filas.length, 1);
  const fila = filas[0]!;
  assert.notEqual(fila.telegram_link_code, "codigo-elegido-a-mano", "el trigger reemplaza el valor elegido a mano");
  const expiraEn = new Date(fila.telegram_link_code_expira).getTime() - Date.now();
  assert.ok(expiraEn > 0 && expiraEn < 11 * 60 * 1000, "el vencimiento es ~10 minutos, NO 10 años");
});

test("🔴 VERIFICACIÓN POR MUTACIÓN: sin el guardia del código, el valor elegido a mano SÍ queda guardado", async () => {
  const miembro = await mkMiembro(s.tenantA, "equipo");
  // Reemplaza la función por una que SOLO tiene el guardia (a) de rol/client_id -- sin el bloque
  // (b) que fuerza código y vencimiento. Mismo trigger, mismo nombre: no hace falta tocar el CREATE
  // TRIGGER, solo el cuerpo de la función que ejecuta.
  await db.exec(`
    create or replace function app.membresias_guardia_telegram() returns trigger
    language plpgsql as $$
    begin
      if (new.rol is distinct from old.rol or new.client_id is distinct from old.client_id)
         and (app.rol_propio_sin_recursion() <> 'maestro' or new.user_id = app.current_user_id()) then
        raise exception 'No autorizado para cambiar rol/cliente de esta membresía.'
          using errcode = '42501';
      end if;
      return new;
    end;
    $$;
  `);
  let filas: Array<{ telegram_link_code: string }> = [];
  try {
    filas = await db.asUser<{ telegram_link_code: string }>(
      { tenantId: s.tenantA, userId: miembro },
      `update memberships set telegram_link_code = 'codigo-elegido-a-mano' where user_id = $1
       returning telegram_link_code`,
      [miembro],
    );
  } finally {
    // Se repone la función COMPLETA (los dos guardias), tal como quedó la migración 0026 -- para
    // que ningún test posterior de este archivo corra contra la versión mutilada.
    await db.exec(`
      create or replace function app.membresias_guardia_telegram() returns trigger
      language plpgsql as $$
      begin
        if (new.rol is distinct from old.rol or new.client_id is distinct from old.client_id)
           and (app.rol_propio_sin_recursion() <> 'maestro' or new.user_id = app.current_user_id()) then
          raise exception 'No autorizado para cambiar rol/cliente de esta membresía.'
            using errcode = '42501';
        end if;

        if new.telegram_link_code is distinct from old.telegram_link_code
           and new.telegram_link_code is not null then
          new.telegram_link_code := gen_random_uuid()::text;
          new.telegram_link_code_expira := now() + interval '10 minutes';
        end if;

        return new;
      end;
      $$;
    `);
  }
  assert.equal(
    filas[0]?.telegram_link_code,
    "codigo-elegido-a-mano",
    "sin el guardia (b), el valor elegido a mano SÍ se guarda tal cual -- el bug que el trigger cierra",
  );
});

test("🔴 el GRANT UPDATE de memberships para app_user NO incluye telegram_chat_id: solo app_telegram puede escribirlo", async () => {
  // `membership_vincular_telegram` (0026) le da a app_user UPDATE sobre `telegram_link_code`/
  // `telegram_link_code_expira`, nunca sobre `telegram_chat_id` -- si un usuario pudiera escribirlo
  // a mano, cualquiera podría poner el chat_id de OTRA persona y robarle sus alertas sin que
  // Telegram mediara en nada (ver el comentario de la columna en la 0026). Esto tiene que rechazarse
  // por GRANT (42501 "permission denied for table"), no por RLS -- ni siquiera llega a evaluar una
  // política porque el privilegio de columna no está.
  const miembro = await mkMiembro(s.tenantA, "equipo");
  await assert.rejects(
    () =>
      db.asUser(
        { tenantId: s.tenantA, userId: miembro },
        "update memberships set telegram_chat_id = 'chat-robado' where user_id = $1",
        [miembro],
      ),
    /permission denied|no tiene permiso/i,
  );
});

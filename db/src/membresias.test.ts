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

import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * Crea un tenant, cliente y run de prueba en la base de datos pasada.
 * Usado en tests que no necesitan el seed completo pero sí datos válidos para inserciones.
 */
async function crearRunDePrueba(
  sql: <T = Record<string, unknown>>(sqlStr: string, params?: unknown[]) => Promise<T[]>,
): Promise<{ tenantId: string; clientId: string; runId: string }> {
  const [tenantRow] = await sql<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Test', 'test') returning id",
  );
  const tenantId = tenantRow!.id;

  const [clientRow] = await sql<{ id: string }>(
    "insert into clients (tenant_id, nombre) values ($1, 'Test Client') returning id",
    [tenantId],
  );
  const clientId = clientRow!.id;

  const [run] = await sql<{ id: string }>(
    `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt, market_country,
      market_language, market_location_code)
     values ($1, $2, 'kr.v0.5', 'pending_approval', 'x', 'ES', 'es', 1) returning id`,
    [tenantId, clientId],
  );
  const runId = run!.id;

  return { tenantId, clientId, runId };
}

test("kr_run_decisiones: existe con las columnas del spec", async () => {
  const { sql, close } = await newDb();
  try {
    const rows = await sql<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'kr_run_decisiones' order by column_name",
    );
    const columnas = rows.map((r) => r.column_name).sort();
    assert.deepEqual(columnas, [
      "client_id", "completado_en", "decidido_en", "decidido_por", "destino",
      "detalle_error", "id", "resultado", "run_id", "tenant_id",
    ]);
  } finally {
    await close();
  }
});

test("🔴 el check de coherencia rechaza 'completado' sin completado_en", async () => {
  const { sql, close } = await newDb();
  try {
    const { tenantId, clientId, runId } = await crearRunDePrueba(sql);
    await assert.rejects(
      () => sql(
        `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado)
         values ($1, $2, $3, 'solo_informe', 'completado')`,
        [runId, tenantId, clientId],
      ),
      /check/i,
    );
  } finally {
    await close();
  }
});

test("🔴 el índice único parcial rechaza una segunda decisión 'pendiente' para el mismo run", async () => {
  const { sql, close } = await newDb();
  try {
    const { tenantId, clientId, runId } = await crearRunDePrueba(sql);
    await sql(
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino) values ($1, $2, $3, 'solo_informe')`,
      [runId, tenantId, clientId],
    );
    await assert.rejects(
      () => sql(
        `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino) values ($1, $2, $3, 'crear_web')`,
        [runId, tenantId, clientId],
      ),
      /duplicate key|unique/i,
    );
  } finally {
    await close();
  }
});

test("RLS: un tenant NO ve las decisiones de otro tenant", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    await db.asUser(
      { tenantId: s.tenantA, userId: s.equipoA },
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
       values ($1, $2, $3, 'solo_informe')`,
      [s.runA1, s.tenantA, s.clientA1],
    );
    const rows = await db.asUser(
      { tenantId: s.tenantB, userId: s.equipoB },
      "select id from kr_run_decisiones",
    );
    assert.equal(rows.length, 0, "el tenant B no ve la decisión del tenant A");
  } finally {
    await db.close();
  }
});

test("RLS: dentro del mismo tenant, un rol 'cliente' no ve las decisiones de OTRO negocio", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    // Insertar decisión bajo clientA1 como equipoA (team role que puede escribir para cualquier cliente del tenant)
    await db.asUser(
      { tenantId: s.tenantA, userId: s.equipoA },
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino)
       values ($1, $2, $3, 'solo_informe')`,
      [s.runA1, s.tenantA, s.clientA1],
    );

    // Crear un segundo cliente y su owner en el mismo tenant
    const [clientA2Row] = await db.asService<{ id: string }>(
      "insert into clients (tenant_id, nombre) values ($1, 'Cliente A2 Test') returning id",
      [s.tenantA],
    );
    const clientA2Id = clientA2Row!.id;

    const [duenoA2Row] = await db.asService<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol, client_id)
       values ($1, gen_random_uuid(), 'cliente', $2) returning user_id`,
      [s.tenantA, clientA2Id],
    );
    const duenoA2Id = duenoA2Row!.user_id;

    // duenoA2 debe ser un 'cliente' atado a clientA2, así que no debe ver la decisión de clientA1
    const rows = await db.asUser(
      { tenantId: s.tenantA, userId: duenoA2Id },
      "select id from kr_run_decisiones where client_id = $1",
      [s.clientA1],
    );
    assert.equal(rows.length, 0, "un 'cliente' de OTRO negocio del mismo tenant no ve la fila");
  } finally {
    await db.close();
  }
});

test("grants: app_user y app_service pueden select/insert/update sobre kr_run_decisiones", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    for (const rol of ["app_user", "app_service"] as const) {
      const puede = await db.asService<{ sel: boolean; ins: boolean; upd: boolean }>(
        `select has_table_privilege('${rol}', 'kr_run_decisiones', 'select') as sel,
                has_table_privilege('${rol}', 'kr_run_decisiones', 'insert') as ins,
                has_table_privilege('${rol}', 'kr_run_decisiones', 'update') as upd`,
      );
      // has_table_privilege confirma el GRANT; no reemplaza el test de RLS de arriba (evalúa
      // privilegio, no la política) — los dos hacen falta, uno no cubre al otro.
      assert.deepEqual(puede, [{ sel: true, ins: true, upd: true }]);
    }
    const app_render = await db.asService<{ sel: boolean }>(
      `select has_table_privilege('app_render', 'kr_run_decisiones', 'select') as sel`,
    );
    assert.deepEqual(app_render, [{ sel: false }], "app_render sin grant, igual que sobre kr_runs");
  } finally {
    await db.close();
  }
});

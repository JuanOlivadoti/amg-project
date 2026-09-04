import { test } from "node:test";
import assert from "node:assert/strict";
import { newDb, TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";

/**
 * Crea un tenant, cliente, run y decisión de prueba — lo mínimo que `kr_publicacion_intentos`
 * necesita como padre (`decision_id`), sin pasar por el store.
 */
async function crearDecisionDePrueba(
  sql: <T = Record<string, unknown>>(sqlStr: string, params?: unknown[]) => Promise<T[]>,
): Promise<{ tenantId: string; clientId: string; runId: string; decisionId: string }> {
  const [tenantRow] = await sql<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Test', 'test') returning id",
  );
  const tenantId = tenantRow!.id;

  const [clientRow] = await sql<{ id: string }>(
    "insert into clients (tenant_id, nombre, vertical) values ($1, 'Test Client', 'restauracion') returning id",
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

  const [decision] = await sql<{ id: string }>(
    `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado, completado_en)
     values ($1, $2, $3, 'solo_informe', 'completado', now())
     returning id`,
    [runId, tenantId, clientId],
  );
  const decisionId = decision!.id;

  return { tenantId, clientId, runId, decisionId };
}

test("kr_publicacion_intentos: existe con las columnas del spec", async () => {
  const { sql, close } = await newDb();
  try {
    const rows = await sql<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name = 'kr_publicacion_intentos' order by column_name",
    );
    const columnas = rows.map((r) => r.column_name).sort();
    assert.deepEqual(columnas, [
      "client_id",
      "decision_id",
      "id",
      "intentado_at",
      "modo",
      "paginas_confirmadas",
      "paginas_enviadas",
      "tenant_id",
    ]);
  } finally {
    await close();
  }
});

test("🔴 el check rechaza paginas_confirmadas > paginas_enviadas", async () => {
  const { sql, close } = await newDb();
  try {
    const { tenantId, clientId, decisionId } = await crearDecisionDePrueba(sql);
    await assert.rejects(
      () =>
        sql(
          `insert into kr_publicacion_intentos
             (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
           values ($1, $2, $3, 'live', 1, 2)`,
          [decisionId, tenantId, clientId],
        ),
      /check/i,
    );
  } finally {
    await close();
  }
});

test("el check ACEPTA paginas_confirmadas == paginas_enviadas (límite, no solo el interior)", async () => {
  const { sql, close } = await newDb();
  try {
    const { tenantId, clientId, decisionId } = await crearDecisionDePrueba(sql);
    const rows = await sql<{ id: string }>(
      `insert into kr_publicacion_intentos
         (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
       values ($1, $2, $3, 'live', 3, 3) returning id`,
      [decisionId, tenantId, clientId],
    );
    assert.equal(rows.length, 1);
  } finally {
    await close();
  }
});

test("🔴 el check de 'modo' rechaza un valor fuera de mock/dry-run/live", async () => {
  const { sql, close } = await newDb();
  try {
    const { tenantId, clientId, decisionId } = await crearDecisionDePrueba(sql);
    await assert.rejects(
      () =>
        sql(
          `insert into kr_publicacion_intentos
             (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
           values ($1, $2, $3, 'staging', 0, 0)`,
          [decisionId, tenantId, clientId],
        ),
      /check/i,
    );
  } finally {
    await close();
  }
});

test("RLS: app_service inserta un intento y lo lee de vuelta bajo el mismo tenant", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    const [decision] = await db.asService<{ id: string }>(
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado, completado_en)
       values ($1, $2, $3, 'solo_informe', 'completado', now()) returning id`,
      [s.runA1, s.tenantA, s.clientA1],
    );
    const decisionId = decision!.id;

    await db.asOrquestador(
      { tenantId: s.tenantA },
      `insert into kr_publicacion_intentos
         (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
       values ($1, $2, $3, 'dry-run', 4, 0)`,
      [decisionId, s.tenantA, s.clientA1],
    );

    const rows = await db.asOrquestador(
      { tenantId: s.tenantA },
      "select modo, paginas_enviadas, paginas_confirmadas from kr_publicacion_intentos where decision_id = $1",
      [decisionId],
    );
    assert.deepEqual(rows, [{ modo: "dry-run", paginas_enviadas: 4, paginas_confirmadas: 0 }]);
  } finally {
    await db.close();
  }
});

test("🔴 RLS: un tenant NO ve los intentos de publicación de otro", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    const [decisionA] = await db.asService<{ id: string }>(
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado, completado_en)
       values ($1, $2, $3, 'solo_informe', 'completado', now()) returning id`,
      [s.runA1, s.tenantA, s.clientA1],
    );

    await db.asOrquestador(
      { tenantId: s.tenantA },
      `insert into kr_publicacion_intentos
         (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
       values ($1, $2, $3, 'live', 2, 2)`,
      [decisionA!.id, s.tenantA, s.clientA1],
    );

    const rows = await db.asOrquestador({ tenantId: s.tenantB }, "select id from kr_publicacion_intentos");
    assert.equal(rows.length, 0, "el tenant B no ve el intento del tenant A");
  } finally {
    await db.close();
  }
});

test("🔴 RLS: app_service NO puede insertar un intento declarando el tenant_id de OTRO tenant", async () => {
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    const [decisionA] = await db.asService<{ id: string }>(
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado, completado_en)
       values ($1, $2, $3, 'solo_informe', 'completado', now()) returning id`,
      [s.runA1, s.tenantA, s.clientA1],
    );

    // GUC dice tenant A, pero la fila declara tenant_id = B: el `with check` de
    // intento_publicacion_insert lo tiene que rechazar (42501), no dejarlo pasar.
    await assert.rejects(
      () =>
        db.asOrquestador(
          { tenantId: s.tenantA },
          `insert into kr_publicacion_intentos
             (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
           values ($1, $2, $3, 'live', 1, 1)`,
          [decisionA!.id, s.tenantB, s.clientB1],
        ),
      /permission denied|row-level security/i,
    );
  } finally {
    await db.close();
  }
});

test("grants: SOLO app_service puede select/insert sobre kr_publicacion_intentos", async () => {
  const db = await TestDb.create();
  try {
    const servicio = await db.asService<{ sel: boolean; ins: boolean }>(
      `select has_table_privilege('app_service', 'kr_publicacion_intentos', 'select') as sel,
              has_table_privilege('app_service', 'kr_publicacion_intentos', 'insert') as ins`,
    );
    assert.deepEqual(servicio, [{ sel: true, ins: true }]);

    for (const rol of ["app_user", "app_render"] as const) {
      const puede = await db.asService<{ sel: boolean; ins: boolean }>(
        `select has_table_privilege('${rol}', 'kr_publicacion_intentos', 'select') as sel,
                has_table_privilege('${rol}', 'kr_publicacion_intentos', 'insert') as ins`,
      );
      assert.deepEqual(puede, [{ sel: false, ins: false }], `${rol} no tiene grant`);
    }
  } finally {
    await db.close();
  }
});

test("🔴 sin el GRANT a app_service, un intento válido no se puede insertar (grant, no RLS, es la frontera)", async () => {
  // Este test documenta por qué el mecanismo real que bloquea a app_user es el GRANT y no la
  // política: la política (`tenant_id = current_tenant_id() and ve_cliente(client_id)`) daría TRUE
  // para cualquier rol staff (incluido 'equipo' vía app_user) sobre su propio tenant — es el GRANT
  // el que corta antes de llegar a evaluarla. Se prueba revocando el grant de app_service (el único
  // que lo tiene) y confirmando que el insert que antes pasaba ahora falla con 42501.
  const db = await TestDb.create();
  const s: Seed = await seed(db);
  try {
    const [decisionA] = await db.asService<{ id: string }>(
      `insert into kr_run_decisiones (run_id, tenant_id, client_id, destino, resultado, completado_en)
       values ($1, $2, $3, 'solo_informe', 'completado', now()) returning id`,
      [s.runA1, s.tenantA, s.clientA1],
    );

    await db.asService("revoke insert on kr_publicacion_intentos from app_service");
    try {
      await assert.rejects(
        () =>
          db.asOrquestador(
            { tenantId: s.tenantA },
            `insert into kr_publicacion_intentos
               (decision_id, tenant_id, client_id, modo, paginas_enviadas, paginas_confirmadas)
             values ($1, $2, $3, 'live', 1, 1)`,
            [decisionA!.id, s.tenantA, s.clientA1],
          ),
        /permission denied/i,
      );
    } finally {
      await db.asService("grant insert on kr_publicacion_intentos to app_service");
    }
  } finally {
    await db.close();
  }
});

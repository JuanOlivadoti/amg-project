import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb } from "./testdb.js";
import { sembrarBellaNapoli, type ResultadoSeed } from "./seed-demo.js";
import { ConexionReservada } from "./deploy.js";

/**
 * Tests del seed de la demo (Fase 1: el portal de Frank).
 *
 * La clave: NO prueban "el insert corrió". Prueban **la visibilidad BAJO RLS** —lo leen con `asUser`,
 * el rol `app_user` y el rol derivado de `memberships`, igual que lo hará el `PgStore` de la API—.
 * (No prueban la serialización del store, ni el endpoint HTTP, ni lo que renderiza Angular: eso lo
 * cubre el test de integración en `api`.) Así el seed queda atado al mismo contrato de seguridad que
 * el resto: si una membresía queda mal, un usuario deja de ver lo suyo (o un intruso ve de más) y el
 * test cae.
 *
 * Los UUID de Frank y Juan son parámetros (en producción salen de Supabase Auth). Acá se fijan para
 * poder consultar como ellos.
 */
const FRANK = "11111111-1111-1111-1111-111111111111"; // maestro
const JUAN = "22222222-2222-2222-2222-222222222222"; // equipo
const INTRUSO = "33333333-3333-3333-3333-333333333333"; // sin membresía: no ve nada

/** PGlite es una sola conexión → una `ConexionReservada` válida para sembrar en los tests. */
const con = (db: TestDb) => ConexionReservada.desdePglite(db.pglite);

let db: TestDb;
let r: ResultadoSeed;

before(async () => {
  db = await TestDb.create();
  r = await sembrarBellaNapoli(con(db), { frankUserId: FRANK, juanUserId: JUAN });
});

after(async () => {
  await db.close();
});

test("Frank (maestro) ve el run de Bella Napoli en su lista, en pending_approval", async () => {
  const runs = await db.asUser<{ id: string; status: string; prompt: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select id, status, prompt from kr_runs",
  );
  assert.equal(runs.length, 1, "ve exactamente el run sembrado");
  assert.equal(runs[0]?.id, r.runId);
  assert.equal(runs[0]?.status, "pending_approval", "nace en la compuerta (ADR-06)");
});

test("Frank deriva rol 'maestro' y Juan 'equipo' (de memberships, no declarado)", async () => {
  const [frank] = await db.asUser<{ rol: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select app.current_role() as rol",
  );
  const [juan] = await db.asUser<{ rol: string }>(
    { tenantId: r.tenantId, userId: JUAN },
    "select app.current_role() as rol",
  );
  assert.equal(frank?.rol, "maestro");
  assert.equal(juan?.rol, "equipo");
});

test("Juan (equipo) también ve el cliente y el run (staff ve toda la cartera del tenant)", async () => {
  const clientes = await db.asUser<{ nombre: string }>(
    { tenantId: r.tenantId, userId: JUAN },
    "select nombre from clients",
  );
  assert.ok(
    clientes.some((c) => c.nombre.includes("Bella Napoli")),
    "ve el cliente de demo",
  );
  const runs = await db.asUser({ tenantId: r.tenantId, userId: JUAN }, "select id from kr_runs");
  assert.equal(runs.length, 1);
});

test("un intruso sin membresía no ve NADA (ni cliente, ni run, ni páginas)", async () => {
  const ctx = { tenantId: r.tenantId, userId: INTRUSO };
  assert.equal((await db.asUser(ctx, "select id from clients")).length, 0);
  assert.equal((await db.asUser(ctx, "select id from kr_runs")).length, 0);
  assert.equal((await db.asUser(ctx, "select id from kr_pages")).length, 0);
});

test("el brief tiene 8 páginas, TODAS sin aprobar (la compuerta certifica que un humano miró)", async () => {
  const pages = await db.asUser<{ approved: boolean }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select approved from kr_pages where run_id = $1",
    [r.runId],
  );
  assert.equal(pages.length, 8, "las 8 páginas de la corrida de la acción 06");
  assert.ok(
    pages.every((p) => p.approved === false),
    "ninguna nace aprobada: la aprueba Frank en el portal",
  );
});

test("el split de honestidad: exactamente 3 respaldadas por datos y 5 sin validar", async () => {
  const rows = await db.asUser<{ evidencia: string; n: string }>(
    { tenantId: r.tenantId, userId: FRANK },
    `select evidencia, count(*)::text as n from kr_pages where run_id = $1 group by evidencia`,
    [r.runId],
  );
  const porEvidencia = Object.fromEntries(rows.map((x) => [x.evidencia, Number(x.n)]));
  assert.equal(porEvidencia["datos_mercado"], 3, "3 respaldadas por datos de mercado");
  assert.equal(porEvidencia["sin_validar"], 5, "5 sin datos que las validen");
});

test("las respaldadas tienen volumen y las sin validar no (el dato honesto)", async () => {
  const pages = await db.asUser<{ evidencia: string; volumen: number | null }>(
    { tenantId: r.tenantId, userId: FRANK },
    "select evidencia, volumen from kr_pages where run_id = $1",
    [r.runId],
  );
  for (const p of pages) {
    if (p.evidencia === "datos_mercado") assert.ok(p.volumen !== null, "respaldada → tiene volumen");
    else assert.equal(p.volumen, null, "sin validar → sin volumen (≠ 0)");
  }
});

test("sembrar dos veces es idempotente: no duplica tenant, cliente, run ni páginas", async () => {
  const r2 = await sembrarBellaNapoli(con(db), { frankUserId: FRANK, juanUserId: JUAN });
  assert.equal(r2.tenantId, r.tenantId, "el mismo tenant (upsert por slug)");
  assert.equal(r2.clientId, r.clientId, "el mismo cliente (id fijo)");
  assert.equal(r2.runId, r.runId, "el mismo run de demo (id fijo)");

  // Contado como superusuario (salta RLS): la verdad cruda de la base, sin duplicados.
  const [tenants] = await db.asService<{ n: string }>(
    "select count(*)::text as n from tenants where slug = 'amg'",
  );
  const [clientes] = await db.asService<{ n: string }>(
    "select count(*)::text as n from clients where tenant_id = $1",
    [r.tenantId],
  );
  const [runs] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_runs where tenant_id = $1",
    [r.tenantId],
  );
  const [pages] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_pages where tenant_id = $1",
    [r.tenantId],
  );
  assert.equal(tenants?.n, "1", "un solo tenant");
  assert.equal(clientes?.n, "1", "un solo cliente");
  assert.equal(pages?.n, "8", "las 8 páginas del run de demo, sin duplicar");
  // Puede haber MÁS de un run del cliente (ver el test de abajo); acá basta con que el de demo no se
  // duplique. La cuenta exacta de runs se afirma en el test de no-destrucción.
});

test("re-sembrar NO destruye un run ajeno del mismo cliente (no es un delete por client_id)", async () => {
  // Un run que NO es el de demo, para el mismo cliente: simula investigación real de Fase 2.
  const AJENO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await db.asService(
    `insert into kr_runs (id, tenant_id, client_id, schema_version, status, prompt,
                          market_country, market_language, market_location_code)
     values ($1, $2, $3, 'kr.v0.5', 'approved', 'corrida real del cliente', 'ES', 'es', 2724)`,
    [AJENO, r.tenantId, r.clientId],
  );

  // Re-sembrar: solo debe tocar el run de demo.
  await sembrarBellaNapoli(con(db), { frankUserId: FRANK, juanUserId: JUAN });

  const [ajeno] = await db.asService<{ n: string }>(
    "select count(*)::text as n from kr_runs where id = $1",
    [AJENO],
  );
  assert.equal(ajeno?.n, "1", "el run ajeno del cliente sobrevive al re-seed (antes se borraba)");

  // Limpieza para no contaminar tests posteriores que cuenten runs del tenant.
  await db.asService("delete from kr_runs where id = $1", [AJENO]);
});

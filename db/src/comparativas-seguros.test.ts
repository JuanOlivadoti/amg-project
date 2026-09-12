import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { TestDb, seed } from "./testdb.js";
import type { Seed } from "./testdb.js";
import { PglitePool } from "./pool.js";
import { PgComparativasSeguros } from "./comparativas-seguros.js";
import type { TenantContext } from "./store.js";
import type { DatosComparativa, OpcionSeguro } from "./comparativas-seguros.js";

/**
 * Módulo de comparativas de seguros (correduría) -- migración 0033: la tabla `comparativas_seguros`
 * bajo RLS y el gate de revisión (`revisado_en`/`revisado_por`). Brief:
 * `.superpowers/sdd/2026-09-12-comparativas-seguros/task-1-brief.md`.
 */

let db: TestDb;
let s: Seed;
let comparativas: PgComparativasSeguros;
let ctxA: TenantContext;
let ctxB: TenantContext;
let ctxClienteA: TenantContext;

const OPCIONES: OpcionSeguro[] = [
  {
    aseguradora: "Mapfre",
    producto: "Hogar Plus",
    prima: 350.5,
    cobertura: "Incendio, robo, responsabilidad civil",
    condiciones: "Franquicia de 150€",
    notas: null,
  },
  {
    aseguradora: "Allianz",
    producto: "Hogar Total",
    prima: 410,
    cobertura: "Incendio, robo, responsabilidad civil, daños eléctricos",
    condiciones: null,
    notas: "Incluye asistencia 24h",
  },
];

const DATOS: DatosComparativa = {
  clienteFinalNombre: "Ana García",
  clienteFinalEmail: "ana@example.com",
  opciones: OPCIONES,
  recomendacion: "Allianz Hogar Total por la cobertura de daños eléctricos",
  informeMd: "# Comparativa\n\nDos opciones evaluadas.",
  mailAsunto: "Tu comparativa de seguros",
  mailCuerpoMd: "Hola Ana, adjunto la comparativa.",
  costoUsd: 0.02,
};

before(async () => {
  db = await TestDb.create();
  s = await seed(db);
  comparativas = new PgComparativasSeguros(new PglitePool(db.pglite));
  ctxA = { tenantId: s.tenantA, userId: s.equipoA };
  ctxB = { tenantId: s.tenantB, userId: s.equipoB };
  ctxClienteA = { tenantId: s.tenantA, userId: s.duenoA1 };
});

after(async () => {
  await db.close();
});

/**
 * SQL crudo como `app_user`, en el contexto del tenant A -- existe para UN caso: probar un `grant`
 * o un `check` de la tabla directamente, sin pasar por `PgComparativasSeguros` (que nunca ofrece un
 * método para tocar esas columnas, así que el ataque hay que montarlo a mano).
 */
function sqlComoAppUser(sql: string, params: unknown[] = []) {
  return db.asUser(ctxA, sql, params);
}

// ============================================================ Camino feliz

test("crear + obtener devuelve la fila, sin revisar", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);
  const c = await comparativas.obtener(ctxA, s.clientA1, id);

  assert.ok(c);
  assert.equal(c!.clientId, s.clientA1);
  assert.equal(c!.creadoPor, s.equipoA);
  assert.equal(c!.clienteFinalNombre, "Ana García");
  assert.equal(c!.clienteFinalEmail, "ana@example.com");
  assert.deepEqual(c!.opciones, OPCIONES);
  assert.equal(c!.recomendacion, DATOS.recomendacion);
  assert.equal(c!.informeMd, DATOS.informeMd);
  assert.equal(c!.mailAsunto, DATOS.mailAsunto);
  assert.equal(c!.mailCuerpoMd, DATOS.mailCuerpoMd);
  assert.equal(c!.costoUsd, 0.02);
  assert.equal(c!.revisadoEn, null);
  assert.equal(c!.revisadoPor, null);
});

test("listarPorCliente devuelve las comparativas del cliente, más nueva primero", async () => {
  const id1 = await comparativas.crear(ctxA, s.clientA2, DATOS);
  const id2 = await comparativas.crear(ctxA, s.clientA2, DATOS);
  const lista = await comparativas.listarPorCliente(ctxA, s.clientA2);
  assert.deepEqual(
    lista.map((c) => c.id),
    [id2, id1],
  );
});

test("marcarRevisada pone los dos campos del gate", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);
  const ok = await comparativas.marcarRevisada(ctxA, s.clientA1, id);
  assert.equal(ok, true);

  const c = await comparativas.obtener(ctxA, s.clientA1, id);
  assert.ok(c!.revisadoEn);
  assert.equal(c!.revisadoPor, s.equipoA);
});

// ============================================================ 🔴 Seguridad

test("🔴 el tenant B no ve la comparativa del tenant A", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);
  assert.equal(await comparativas.obtener(ctxB, s.clientA1, id), null);
  assert.deepEqual(await comparativas.listarPorCliente(ctxB, s.clientA1), []);
});

test("🔴 nace SIN revisar -- el gate empieza cerrado, no abierto", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);
  const c = await comparativas.obtener(ctxA, s.clientA1, id);
  assert.equal(c!.revisadoEn, null);
  assert.equal(c!.revisadoPor, null);
});

test("🔴 el rol `cliente` NO puede crear", async () => {
  await assert.rejects(() => comparativas.crear(ctxClienteA, s.clientA1, DATOS));
});

test("🔴 revisar NO puede corregir: app_user no tiene grant sobre informe_md", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);
  await assert.rejects(
    () => sqlComoAppUser("update comparativas_seguros set informe_md = 'otro' where id = $1", [id]),
    /permission denied|42501/,
  );
});

test("🔴 el check del gate: no se puede poner revisado_en sin revisado_por", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);
  await assert.rejects(
    () => sqlComoAppUser("update comparativas_seguros set revisado_en = now() where id = $1", [id]),
    // El mensaje de PGlite no siempre trae el código en el texto -- el `code` sí, siempre
    // (mismo criterio que `informes.test.ts`, que revisa `e.code === "23514"`).
    (e: { code?: string }) => e.code === "23514",
  );
});

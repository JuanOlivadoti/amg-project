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

test("🔴 marcarRevisada NO es re-entrante: la segunda llamada no pisa la primera (carrera)", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);

  const primera = await comparativas.marcarRevisada(ctxA, s.clientA1, id);
  assert.equal(primera, true);
  const c1 = await comparativas.obtener(ctxA, s.clientA1, id);
  const revisadoEn1 = c1!.revisadoEn;
  const revisadoPor1 = c1!.revisadoPor;
  assert.ok(revisadoEn1);
  assert.equal(revisadoPor1, s.equipoA);

  // Simula la segunda petición concurrente (mismo caller, como sería el segundo request de la carrera).
  const segunda = await comparativas.marcarRevisada(ctxA, s.clientA1, id);
  assert.equal(segunda, false, "ya estaba revisada: no vuelve a 'revisar'");

  const c2 = await comparativas.obtener(ctxA, s.clientA1, id);
  // El tipo declara `revisadoEn: string | null`, pero en runtime el driver de pg devuelve un `Date`
  // para las columnas `timestamptz` (el cast `as Parameters<typeof aComparativa>[0]` de la línea 72
  // no lo fuerza a string) -- discrepancia preexistente, fuera del alcance de este fix. Dos `Date`
  // con el mismo instante NO son el mismo objeto, así que se compara por valor (getTime()): lo que
  // importa es que Postgres NO reescribió la fila con la segunda llamada, no la identidad del objeto.
  assert.equal(
    (c2!.revisadoEn as unknown as Date)?.getTime(),
    (revisadoEn1 as unknown as Date)?.getTime(),
    "revisado_en NO cambió con la segunda llamada",
  );
  assert.equal(c2!.revisadoPor, revisadoPor1, "revisado_por sigue siendo el de la PRIMERA llamada");
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

test("🔴 el rol `cliente` NO puede marcarRevisada (el gate de revisión es solo de staff)", async () => {
  const id = await comparativas.crear(ctxA, s.clientA1, DATOS);

  const ok = await comparativas.marcarRevisada(ctxClienteA, s.clientA1, id);
  assert.equal(ok, false, "app.puede_escribir() lo niega: 0 filas afectadas, no una excepción");

  // No basta con el booleano: si la política estuviera en el `with check` en vez de en el `using`,
  // el update podría lanzar 42501 en vez de afectar 0 filas -- pero lo que de verdad importa acá es
  // que la fila NO haya cambiado, releída con un ctx que SÍ puede verla.
  const c = await comparativas.obtener(ctxA, s.clientA1, id);
  assert.equal(c!.revisadoEn, null, "revisado_en sigue en null: el cliente no cerró el gate");
  assert.equal(c!.revisadoPor, null);
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

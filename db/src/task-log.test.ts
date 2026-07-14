import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PglitePool } from "./pool.js";
import { PgTaskLog, MAX_INTENTOS } from "./task-log.js";

/**
 * Tests del registro de idempotencia (ADR-10). Contra Postgres real: la corrección depende del
 * `on conflict do nothing` + `for update`, o sea de la semántica exacta de Postgres.
 *
 * Lo que se prueba acá es DINERO: que no se pague dos veces por la misma petición, y que un timeout
 * (que pudo cobrar) no se confunda con un fallo declarado por el proveedor (que no cobró).
 */

const aqui = dirname(fileURLToPath(import.meta.url));

let pg: PGlite;
let log: PgTaskLog;

const EP = "/v3/keywords_data/google_ads/search_volume/live";
const HASH = "a".repeat(64);

before(async () => {
  pg = new PGlite();
  await pg.exec(await readFile(join(aqui, "..", "migrations", "0001_init.sql"), "utf8"));
  log = new PgTaskLog(new PglitePool(pg));
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("delete from kr_provider_tasks;");
});

// ---------------------------------------------------------------- el ciclo normal

test("una petición nueva es 'nueva' (adelante, se puede gastar)", async () => {
  assert.deepEqual(await log.reservar(EP, HASH), { estado: "nueva" });
});

test("una petición ya completada devuelve el resultado SIN volver a pagar", async () => {
  await log.reservar(EP, HASH);
  await log.completar(EP, HASH, { result: [{ keyword: "pizza", search_volume: 390 }], costMicros: 102_000 });

  const r = await log.reservar<{ keyword: string }>(EP, HASH);

  assert.equal(r.estado, "listo");
  assert.deepEqual(r.estado === "listo" ? r.result : null, [{ keyword: "pizza", search_volume: 390 }]);
});

test("un resultado VACÍO también se recuerda (no se vuelve a pagar por preguntar la nada)", async () => {
  // `[]` es un resultado legítimo: el proveedor no tiene datos para esas keywords. Sin el envoltorio
  // {v}, un array vacío en jsonb no se distinguiría de "no hay fila" y se re-pagaría cada corrida.
  await log.reservar(EP, HASH);
  await log.completar(EP, HASH, { result: [], costMicros: 50_000 });

  const r = await log.reservar(EP, HASH);

  assert.equal(r.estado, "listo");
  assert.deepEqual(r.estado === "listo" ? r.result : null, []);
});

// ================================================================
// La distinción que vale dinero: ¿hubo respuesta o no?
// ================================================================

/**
 * El proveedor RESPONDIÓ que la task falló → no cobró, y lo sabemos porque nos lo dijo.
 * Reintentar es seguro y no se cuenta como repago.
 */
test("🔴 una task fallida CON respuesta se puede reintentar (el proveedor no cobró)", async () => {
  await log.reservar(EP, HASH);
  await log.fallar(EP, HASH, "40501 internal error");

  const r = await log.reservar(EP, HASH);

  assert.deepEqual(r, { estado: "nueva" }, "no es un repago: sabemos que no cobró");
});

/**
 * EL CASO QUE IMPORTA. La petición se envió y nunca volvió (timeout, 5xx, el proceso murió).
 * Pudo ejecutarse y cobrarse. La reserva quedó en `pending`, y el siguiente intento TIENE que
 * enterarse — antes volvía a pagar en silencio.
 */
test("🔴 una petición sin respuesta queda 'huerfana': pudo haberse cobrado", async () => {
  await log.reservar(EP, HASH); // se reserva…
  // …y el proceso muere acá. Nunca se llama a completar() ni a fallar().

  const r = await log.reservar(EP, HASH);

  assert.equal(r.estado, "huerfana", "hay que saber que esa petición pudo cobrarse");
  assert.equal(r.estado === "huerfana" ? r.intento : 0, 2);
});

test("🔴 no se reenvía para siempre: al 3er intento sin respuesta, se planta", async () => {
  // Cada reenvío puede estar cobrando. Insistir infinitamente es vaciar el saldo por nada.
  await log.reservar(EP, HASH);
  for (let i = 2; i <= MAX_INTENTOS; i++) await log.reservar(EP, HASH);

  await assert.rejects(() => log.reservar(EP, HASH), /puede estar cobrando/i);
});

test("las huérfanas quedan listadas: es la lista a mirar si el saldo no cuadra", async () => {
  await log.reservar(EP, HASH);
  await log.reservar("/v3/serp/google/organic/live/advanced", "b".repeat(64));
  await log.completar("/v3/serp/google/organic/live/advanced", "b".repeat(64), {
    result: [],
    costMicros: 3_000,
  });

  const h = await log.huerfanas();

  assert.equal(h.length, 1, "solo la que nunca volvió");
  assert.equal(h[0]!.endpoint, EP);
});

// ================================================================
// Concurrencia: dos procesos, la misma petición
// ================================================================

/**
 * Dos runs concurrentes que forman la MISMA petición. Con un `select` y después un `insert`, los
 * dos se creerían los primeros y la pagarían los dos. El `on conflict do nothing` decide quién la
 * creó; el segundo ve la verdad.
 */
test("🔴 concurrencia: dos reservas simultáneas — solo UNA es 'nueva'", async () => {
  const [a, b] = await Promise.all([log.reservar(EP, HASH), log.reservar(EP, HASH)]);

  const nuevas = [a, b].filter((r) => r.estado === "nueva");
  assert.equal(nuevas.length, 1, "solo un proceso puede creerse el primero (si no, se paga dos veces)");
});

test("el entorno separa los registros: sandbox y producción no se pisan", async () => {
  const prod = new PgTaskLog(new PglitePool(pg), "dfs:prod");
  const sandbox = new PgTaskLog(new PglitePool(pg), "dfs:sandbox");

  await prod.reservar(EP, HASH);
  await prod.completar(EP, HASH, { result: [{ v: 1 }], costMicros: 100 });

  assert.deepEqual(await sandbox.reservar(EP, HASH), { estado: "nueva" }, "el sandbox no ve lo de prod");
});

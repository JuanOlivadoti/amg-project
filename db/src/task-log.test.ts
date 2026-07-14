import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones } from "./migrate.js";
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
  await aplicarMigraciones(pg);
  log = new PgTaskLog(new PglitePool(pg));
});

after(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("delete from kr_provider_tasks;");
});

/** El token del intento. completar()/fallar() hacen CAS contra el. */
function tokenDe(r: { estado: string; attemptId?: string }): string {
  if (!r.attemptId) throw new Error(`la reserva ${r.estado} no trae token`);
  return r.attemptId;
}

/** Simula que el proceso MURIO: el lease vence sin que nadie complete la peticion. */
async function vencerLease() {
  await pg.exec("update kr_provider_tasks set lease_until = now() - interval '1 minute'");
}

// ---------------------------------------------------------------- el ciclo normal

test("una petición nueva es 'nueva' (adelante, se puede gastar)", async () => {
  assert.equal((await log.reservar(EP, HASH)).estado, "nueva");
});

test("una petición ya completada devuelve el resultado SIN volver a pagar", async () => {
  const r0 = await log.reservar(EP, HASH);
  await log.completar(EP, HASH, {
    result: [{ keyword: "pizza", search_volume: 390 }],
    costMicros: 102_000,
    attemptId: tokenDe(r0),
  });

  const r = await log.reservar<{ keyword: string }>(EP, HASH);

  assert.equal(r.estado, "listo");
  assert.deepEqual(r.estado === "listo" ? r.result : null, [{ keyword: "pizza", search_volume: 390 }]);
});

test("un resultado VACÍO también se recuerda (no se vuelve a pagar por preguntar la nada)", async () => {
  // `[]` es un resultado legítimo: el proveedor no tiene datos para esas keywords. Sin el envoltorio
  // {v}, un array vacío en jsonb no se distinguiría de "no hay fila" y se re-pagaría cada corrida.
  const r0 = await log.reservar(EP, HASH);
  await log.completar(EP, HASH, { result: [], costMicros: 50_000, attemptId: tokenDe(r0) });

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
  const r0 = await log.reservar(EP, HASH);
  await log.fallar(EP, HASH, "40501 internal error", tokenDe(r0));

  const r = await log.reservar(EP, HASH);

  assert.equal(r.estado, "nueva", "no es un repago: sabemos que no cobró");
});

/**
 * EL CASO QUE IMPORTA. La petición se envió y nunca volvió (timeout, 5xx, el proceso murió).
 * Pudo ejecutarse y cobrarse. La reserva quedó en `pending`, y el siguiente intento TIENE que
 * enterarse — antes volvía a pagar en silencio.
 */
test("🔴 el proceso murió (lease vencido) → huérfana: pudo haberse cobrado", async () => {
  await log.reservar(EP, HASH); // se reserva…
  await vencerLease();          // …y el proceso muere. Nunca completa ni falla.

  const r = await log.reservar(EP, HASH);

  assert.equal(r.estado, "huerfana", "hay que saber que esa petición pudo cobrarse");
  assert.equal(r.estado === "huerfana" ? r.intento : 0, 2);
});

test("🔴 no se reenvía para siempre: al 3er intento sin respuesta, se planta", async () => {
  // Cada reenvío puede estar cobrando. Insistir infinitamente es vaciar el saldo por nada.
  await log.reservar(EP, HASH);
  for (let i = 2; i <= MAX_INTENTOS; i++) {
    await vencerLease();
    await log.reservar(EP, HASH);
  }

  await vencerLease();
  await assert.rejects(() => log.reservar(EP, HASH), /puede estar cobrando/i);
});

test("las huérfanas quedan listadas: es la lista a mirar si el saldo no cuadra", async () => {
  await log.reservar(EP, HASH);
  const r2 = await log.reservar("/v3/serp/google/organic/live/advanced", "b".repeat(64));
  await log.completar("/v3/serp/google/organic/live/advanced", "b".repeat(64), {
    result: [],
    costMicros: 3_000,
    attemptId: tokenDe(r2),
  });

  await vencerLease();
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
/**
 * 🔴 EL TEST QUE ESTABA MAL, Y POR ESO EL BUG SEGUÍA VIVO.
 *
 * El anterior comprobaba "solo UNA reserva es 'nueva'". Era cierto… y era irrelevante: la otra
 * salía 'huerfana', **y 'huerfana' también autoriza el POST**. Medido: de 2 reservas
 * simultáneas, 2 autorizaban gastar. El test pasaba con el doble cobro dentro.
 *
 * Lo que hay que medir no es el ESTADO, es cuántas AUTORIZAN GASTAR. Tiene que ser exactamente una.
 *
 * ## ⚠️ LO QUE ESTE TEST *NO* PRUEBA — y hay que decirlo, porque yo lo presentaba como si sí
 *
 * **PGlite tiene UNA sola conexión y serializa las transacciones.** `Promise.all` acá no crea dos
 * procesos concurrentes: crea dos llamadas que Postgres ejecuta **una detrás de la otra**. O sea que
 * esto verifica la LÓGICA del `on conflict do nothing` (que ya es algo: es lo que decide quién crea
 * la fila), pero **no reproduce la carrera** entre dos conexiones reales.
 *
 * La consecuencia concreta: quitar el `for update` de `PgTaskLog.reservar()` probablemente **no
 * haría caer este test**, porque sin dos conexiones no hay dos transacciones compitiendo por la
 * fila. En un Postgres de verdad, dos procesos rescatando el mismo lease vencido podrían leerlo a la
 * vez y **ambos** salir a pagar.
 *
 * Cerrar eso exige un Postgres con dos conexiones (Docker, o un Postgres de CI). No está hecho.
 * Queda anotado en ADR-14 como lo que es: **una garantía que el código intenta dar y los tests no
 * verifican.** Preferible tenerlo escrito que creerme cubierto.
 */
test("concurrencia (lógica, NO carrera real — ver el comentario): solo UNA reserva autoriza gastar", async () => {
  const [a, b] = await Promise.all([log.reservar(EP, HASH), log.reservar(EP, HASH)]);

  const autorizaGasto = (r: { estado: string }) => r.estado === "nueva" || r.estado === "huerfana";
  const gastan = [a, b].filter(autorizaGasto);

  assert.equal(gastan.length, 1, "si autorizan las dos, se le paga DOS VECES a DataForSEO");
  const otra = [a, b].find((r) => !autorizaGasto(r));
  assert.equal(otra?.estado, "en_progreso", "la segunda ESPERA el resultado de la primera");
});

/**
 * CAS por `attemptId`: una respuesta TARDÍA del intento 1 (que dimos por muerto) no puede pisar el
 * resultado del intento 2.
 */
test("🔴 una respuesta tardía NO pisa el resultado del intento siguiente", async () => {
  const r1 = await log.reservar(EP, HASH);
  const token1 = tokenDe(r1);

  await vencerLease();                          // el intento 1 se da por muerto
  const r2 = await log.reservar(EP, HASH);      // el intento 2 toma el relevo
  await log.completar(EP, HASH, { result: [{ bueno: true }], costMicros: 1, attemptId: tokenDe(r2) });

  // …y AHORA llega, tardísimo, la respuesta del intento 1.
  const guardo = await log.completar(EP, HASH, {
    result: [{ viejo: true }],
    costMicros: 1,
    attemptId: token1,
  });

  assert.equal(guardo, false, "el intento 1 ya no tiene el lease: su escritura se rechaza");
  const r = await log.reservar<{ bueno: boolean }>(EP, HASH);
  assert.deepEqual(r.estado === "listo" ? r.result : null, [{ bueno: true }], "gana el intento 2");
});

test("el entorno separa los registros: sandbox y producción no se pisan", async () => {
  const prod = new PgTaskLog(new PglitePool(pg), "dfs:prod");
  const sandbox = new PgTaskLog(new PglitePool(pg), "dfs:sandbox");

  const r0 = await prod.reservar(EP, HASH);
  await prod.completar(EP, HASH, { result: [{ v: 1 }], costMicros: 100, attemptId: tokenDe(r0) });

  assert.equal((await sandbox.reservar(EP, HASH)).estado, "nueva", "el sandbox no ve lo de prod");
});

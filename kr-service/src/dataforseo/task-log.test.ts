import { test } from "node:test";
import assert from "node:assert/strict";
import { MemTaskLog, payloadHash, MAX_INTENTOS } from "./task-log.js";

/**
 * El contrato del registro de idempotencia, del lado de `kr-service`.
 *
 * Lo que se prueba es DINERO: que la misma petición no se pague dos veces, y —lo más importante—
 * que un **timeout** (que pudo cobrar) no se confunda con un **fallo declarado por el proveedor**
 * (que no cobró). Son dos situaciones que se parecen en el código y son opuestas en la factura.
 */

const EP = "/v3/dataforseo_labs/google/bulk_keyword_difficulty/live";

// ---------------------------------------------------------------- el hash

test("el hash NO depende del orden de las claves (es la misma petición)", () => {
  const a = payloadHash("dfs:prod", EP, { keywords: ["pizza"], location_code: 2724 });
  const b = payloadHash("dfs:prod", EP, { location_code: 2724, keywords: ["pizza"] });

  assert.equal(a, b);
});

/**
 * El entorno va en el hash. Es la MISMA lección que envenenó la cache: sandbox y producción
 * devuelven cosas distintas para el mismo cuerpo. Si compartieran hash, una reserva de sandbox
 * (gratis, con datos ficticios) haría que producción se creyera ya pagada y servida.
 */
test("🔴 el hash incluye el ENTORNO: sandbox y producción no son la misma petición", () => {
  const cuerpo = { keywords: ["pizza"], location_code: 2724 };

  assert.notEqual(payloadHash("dfs:prod", EP, cuerpo), payloadHash("dfs:sandbox", EP, cuerpo));
});

test("el hash cambia si cambian las keywords (es otra petición, se paga aparte)", () => {
  assert.notEqual(
    payloadHash("dfs:prod", EP, { keywords: ["pizza"] }),
    payloadHash("dfs:prod", EP, { keywords: ["pasta"] }),
  );
});

// ---------------------------------------------------------------- los estados

test("la misma petición no se paga dos veces", async () => {
  const log = new MemTaskLog();
  const h = payloadHash("dfs:prod", EP, { keywords: ["pizza"] });

  const r0 = await log.reservar(EP, h);
  assert.equal(r0.estado, "nueva");
  await log.completar(EP, h, {
    result: [{ kd: 15 }],
    costMicros: 56_000,
    attemptId: r0.estado === "nueva" ? r0.attemptId : "",
  });

  const r = await log.reservar<{ kd: number }>(EP, h);
  assert.equal(r.estado, "listo", "la segunda vez sale del registro, no de la API");
  assert.deepEqual(r.estado === "listo" ? r.result : null, [{ kd: 15 }]);
});

/**
 * El proveedor RESPONDIÓ que la task falló → no cobró, y lo sabemos porque nos lo dijo.
 * Reintentar es seguro.
 */
test("🔴 un fallo CON respuesta se reintenta limpio (el proveedor no cobró)", async () => {
  const log = new MemTaskLog();
  const h = payloadHash("dfs:prod", EP, { keywords: ["pizza"] });

  const r0 = await log.reservar(EP, h);
  await log.fallar(EP, h, "40501 internal error", r0.estado === "nueva" ? r0.attemptId : "");

  assert.equal((await log.reservar(EP, h)).estado, "nueva", "no es repago: no cobró");
});

/**
 * EL CASO QUE VALE DINERO. Se envió y nunca volvió (timeout, 5xx, el proceso murió). Pudo
 * ejecutarse y cobrarse, y no hay forma de saberlo desde acá. La reserva queda en `pending` y el
 * siguiente intento TIENE que enterarse — antes volvía a pagar en silencio.
 */
test("🔴 el proceso murió (lease vencido) → huérfana: el reintento sabe que puede estar repagando", async () => {
  const log = new MemTaskLog();
  const h = payloadHash("dfs:prod", EP, { keywords: ["pizza"] });

  await log.reservar(EP, h); // …y el proceso muere. Ni completar() ni fallar().
  log.vencerLeases();

  const r = await log.reservar(EP, h);
  assert.equal(r.estado, "huerfana");
  assert.equal(r.estado === "huerfana" ? r.intento : 0, 2);
});

/**
 * 🔴 Mientras el otro proceso SIGUE VIVO, no se paga otra vez: se espera. Este estado no existía, y
 * su ausencia era el doble cobro — la segunda reserva salía "huerfana", que autoriza gastar.
 */
test("🔴 si otro proceso la está pidiendo AHORA, no se paga otra vez: se espera", async () => {
  const log = new MemTaskLog();
  const h = payloadHash("dfs:prod", EP, { keywords: ["pizza"] });

  await log.reservar(EP, h);          // proceso A: lease VIVO
  const b = await log.reservar(EP, h); // proceso B, concurrente

  assert.equal(b.estado, "en_progreso", "B espera a A; si saliera huerfana, pagaría de nuevo");
});

test("🔴 no se reenvía para siempre: cada intento sin respuesta puede estar cobrando", async () => {
  const log = new MemTaskLog();
  const h = payloadHash("dfs:prod", EP, { keywords: ["pizza"] });

  await log.reservar(EP, h);
  for (let i = 2; i <= MAX_INTENTOS; i++) {
    log.vencerLeases();
    await log.reservar(EP, h);
  }

  log.vencerLeases();
  await assert.rejects(() => log.reservar(EP, h), /puede estar cobrando/i);
});

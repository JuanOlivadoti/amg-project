import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * EL AGUJERO QUE NINGÚN TEST TOCABA: el CLI de producción pagaba dos veces.
 *
 * `runResearch()` sin `deps.taskLog` —que es EXACTAMENTE como lo llama el CLI (`spike.ts`)— hacía
 * `getProvider(undefined)`, y el cliente caía en `NoopTaskLog`: todo es "nuevo", ningún `payload_hash`
 * se compara, y un crash + re-run vuelve a cobrar los ~$0.25. Toda la idempotencia de ADR-14
 * existía… y el camino de producción documentado (`npm run spike`) la salteaba entera.
 *
 * El registro de idempotencia SOLO sirve si sobrevive al proceso (`durable`). En live+prod eso es
 * obligatorio: `getProvider` falla cerrado si no lo tiene, **antes de tocar la red**. Acá se prueba
 * el contrato, no la implementación: se cuenta que NO salió una sola petición a DataForSEO.
 *
 * El entorno se fija ANTES del import: `config` se congela al importarse, y `isSandbox` (que decide
 * si el registro es obligatorio) se deriva de la URL base.
 */

process.env["DATAFORSEO_MODE"] = "live";
process.env["DATAFORSEO_BASE_URL"] = "https://api.dataforseo.com"; // producción: el registro es obligatorio
process.env["DFS_CACHE"] = "off"; // el guard corre antes que la cache; la sacamos del medio

const { getProvider } = await import("./index.js");
const { NoopTaskLog, MemTaskLog } = await import("./task-log.js");
import type { ProviderTaskLog } from "./task-log.js";

/** Un registro durable de mentira: alcanza con que `durable` sea true para pasar el guard. */
const durableStub = { durable: true } as unknown as ProviderTaskLog;

let fetchLlamado = false;
let fetchOriginal: typeof globalThis.fetch;

beforeEach(() => {
  fetchLlamado = false;
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchLlamado = true;
    throw new Error("no debería tocar la red");
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

test("live+prod SIN registro (como el CLI) falla antes de tocar la red", () => {
  assert.throws(() => getProvider(), /durable|idempotencia|producci/i);
  assert.equal(fetchLlamado, false, "no debe salir ninguna petición facturable");
});

test("live+prod con NoopTaskLog explícito también falla: Noop no es durable", () => {
  assert.throws(() => getProvider(new NoopTaskLog()), /durable|idempotencia|producci/i);
});

test("live+prod con MemTaskLog falla: en memoria no sobrevive un re-run", () => {
  // MemTaskLog dedupe DENTRO del proceso, pero un crash + re-run vuelve a pagar. En prod no basta.
  assert.throws(() => getProvider(new MemTaskLog()), /durable|idempotencia|producci/i);
});

test("live+prod con un registro durable (PgTaskLog) NO falla", () => {
  assert.doesNotThrow(() => getProvider(durableStub));
});

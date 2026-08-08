import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * `PROSE_MODE=openai` **declarado, y sin key**: el estado donde leer el entorno y preguntarle al
 * código dan respuestas distintas — el mismo par que en `publish/modo-publicacion-degradado.test.ts`,
 * en el eje que **gasta dinero**.
 *
 * Si `/_health` derivara el modo de `process.env` —`PROSE_MODE === "openai" → "openai"`, que es lo
 * que cualquiera escribiría— este entorno reportaría `openai` mientras el proceso rellena con texto
 * de mock. Y al revés, que es el caso caro: con la key puesta y `PROSE_MODE` ausente, el default de
 * `config.ts` es **`openai`**, así que publicar factura sin que nadie lo haya declarado.
 *
 * `config` se congela al importarse, así que el entorno se fija ANTES del import dinámico.
 */

process.env["PROSE_MODE"] = "openai";
process.env["OPENAI_API_KEY"] = ""; // no hay key: no hay llamadas, no hay gasto

const { modoProsa, getProseGen } = await import("./content.js");

test("🔴 declarar `openai` sin key NO es generar con OpenAI: el modo es mock", () => {
  assert.equal(
    modoProsa(),
    "mock",
    "sin key no se llama al proveedor, aunque la variable diga que sí — leer el panel no alcanza",
  );
});

/**
 * 🔴 Lo reportado y lo construido salen de la misma decisión. Acá se comprueba por la clase del
 * generador, que es lo único observable sin llamar al proveedor.
 */
test("🔴 el modo reportado y el generador construido no pueden divergir", () => {
  assert.equal(
    getProseGen().constructor.name,
    "MockProseGen",
    "el generador tiene que ser el que corresponde al modo que se reporta",
  );
});

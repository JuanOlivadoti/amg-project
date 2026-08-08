import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * **El default que factura**, que es el que hay que fijar con un test y no con un comentario.
 *
 * `config.prose.mode` es `PROSE_MODE || (hay key ? "openai" : "mock")`. O sea: **con la key puesta y
 * `PROSE_MODE` sin declarar, se genera con OpenAI de verdad** — y eso pasa dentro del paso de
 * publicación, que es el que el bloque C ejercita. Nadie tuvo que declarar el gasto: alcanzó con que
 * la key estuviera.
 *
 * `PROSE_MODE=""` en vez de `delete`: la cadena vacía es falsy, así que toma **el mismo brazo del
 * `||` que la ausencia**, y además sobrevive a `dotenv/config` (que solo rellena claves que no
 * existen — un `.env` del paquete con `PROSE_MODE=mock` volvería verde este test por el motivo
 * equivocado).
 */

process.env["PROSE_MODE"] = "";
process.env["OPENAI_API_KEY"] = "sk-de-mentira-para-el-test";

const { modoProsa, getProseGen } = await import("./content.js");

test("🔴 con key y sin PROSE_MODE declarado, el default es `openai` — o sea, gasta", () => {
  assert.equal(
    modoProsa(),
    "openai",
    "el default no es `mock`: basta con que la key esté para que publicar llame al proveedor",
  );
});

test("🔴 el modo reportado y el generador construido no pueden divergir", () => {
  assert.equal(
    getProseGen().constructor.name,
    "OpenAIProseGen",
    "el generador tiene que ser el que corresponde al modo que se reporta",
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * `WEB_PUBLISH_MODE=storyblok` **declarado, y sin token**: el estado donde leer el entorno y
 * preguntarle al código dan respuestas DISTINTAS.
 *
 * ## Por qué existe este archivo aparte
 *
 * Es la mutación que el paso C-0 del plan pide que caiga: si `/_health` derivara el modo de
 * `process.env` —`WEB_PUBLISH_MODE === "storyblok" && STORYBLOK_DRY_RUN !== "1" → "live"`, que es lo
 * que cualquiera escribiría— **este entorno reportaría `live` mientras el proceso publica en
 * dry-run**. Un operador leería "live", daría por hecho que el circuito escribe en Storyblok, y
 * estaría mirando payloads en `out/storyblok/`.
 *
 * `config` se congela al importarse, así que el entorno se fija ANTES del import dinámico, y por eso
 * cada estado necesita su propio archivo: `node --test` corre un proceso por archivo.
 */

process.env["WEB_PUBLISH_MODE"] = "storyblok";
process.env["STORYBLOK_MANAGEMENT_TOKEN"] = ""; // el que falta en Railway hoy, a propósito
process.env["STORYBLOK_SPACE_ID"] = "space-GLOBAL";
// "0" explícito y no `delete`: `config` importa `dotenv/config`, y un `.env` del paquete con
// `STORYBLOK_DRY_RUN=1` llenaría el hueco y el test pasaría por el motivo equivocado.
process.env["STORYBLOK_DRY_RUN"] = "0"; // NADIE pidió dry-run: se llega igual

const { getPublisher, modoPublicacion } = await import("./publisher.js");
const { StoryblokDryRunPublisher } = await import("./storyblok-publisher.js");

test("🔴 declarar `storyblok` sin token NO es publicar: el modo es dry-run", () => {
  assert.equal(
    modoPublicacion(),
    "dry-run",
    "sin token no se publica, aunque las dos variables digan que sí — leer el panel no alcanza",
  );
});

/**
 * 🔴 El invariante que hace que el valor sirva: **lo que se reporta y lo que se construye salen de
 * la misma decisión**. Si divergieran, `/_health` sería una segunda fuente de verdad sobre el mismo
 * hecho, que es peor que no tener ninguna.
 */
test("🔴 el modo reportado y el publisher construido no pueden divergir", () => {
  assert.ok(
    getPublisher("space-A") instanceof StoryblokDryRunPublisher,
    "el publisher tiene que ser el que corresponde al modo que se reporta",
  );
});

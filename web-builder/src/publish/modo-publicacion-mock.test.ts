import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * El estado **mock**, que es el default y el peligroso.
 *
 * Se llega con `WEB_PUBLISH_MODE` ausente o con cualquier valor que no sea exactamente `storyblok`
 * — acá, un typo—. Y entonces, **con token y con space puestos**, no se toca Storyblok pero
 * `MockPublisher` reporta `published: true`: la base anotaría como publicadas páginas que nunca
 * salieron del contenedor, en un `out/` que se evapora en el próximo deploy.
 *
 * Un typo en el valor de una variable no da error en ningún lado: da mock en silencio. Por eso el
 * caso que se fija acá es el typo y no la ausencia — recorren el mismo `!== "storyblok"`, y el typo
 * es el que nadie sospecha.
 */

process.env["WEB_PUBLISH_MODE"] = "storybloc"; // el typo
process.env["STORYBLOK_MANAGEMENT_TOKEN"] = "tok";
process.env["STORYBLOK_SPACE_ID"] = "space-GLOBAL";
process.env["STORYBLOK_DRY_RUN"] = "0";

const { getPublisher, modoPublicacion } = await import("./publisher.js");
const { MockPublisher } = await import("./mock-publisher.js");

test("🔴 un typo en WEB_PUBLISH_MODE es mock, con token y space puestos", () => {
  assert.equal(
    modoPublicacion(),
    "mock",
    "cualquier valor que no sea exactamente `storyblok` es mock, y el token puesto no cambia nada",
  );
});

test("🔴 el modo reportado y el publisher construido no pueden divergir", () => {
  assert.ok(
    getPublisher("space-A") instanceof MockPublisher,
    "el publisher tiene que ser el que corresponde al modo que se reporta",
  );
});

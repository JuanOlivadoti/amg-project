import { test } from "node:test";
import assert from "node:assert/strict";
import { MockBlogPublisher } from "./mock-publisher.js";

test("MockBlogPublisher confirma publicado y arma la URL a partir del slug", async () => {
  const publisher = new MockBlogPublisher();
  const resultado = await publisher.publicar(
    { titulo: "T", cuerpo: "<p>C</p>", slug: "mejores-tacos" },
    "page-id-1",
    { tipo: "wordpress", url: "https://blog.cliente.com/", credencial: "sek" },
  );
  assert.equal(resultado.publicado, true);
  assert.equal(resultado.url, "https://blog.cliente.com/mejores-tacos");
});

// Codex, ronda 1 sobre el plan, hallazgo Minor: los slugs REALES de kr_pages empiezan con "/"
// (`url_slug`, ver db/src/store.test.ts y api/src/dev-server.ts) — el test de arriba usaba
// "mejores-tacos" sin la barra inicial, que ocultaba el doble "/" que se produce con un slug real.
test("MockBlogPublisher no duplica la barra con un slug real (que empieza con /)", async () => {
  const publisher = new MockBlogPublisher();
  const resultado = await publisher.publicar(
    { titulo: "T", cuerpo: "<p>C</p>", slug: "/mejores-tacos" },
    "page-id-1",
    { tipo: "wordpress", url: "https://blog.cliente.com/", credencial: "sek" },
  );
  assert.equal(resultado.url, "https://blog.cliente.com/mejores-tacos", "🔴 sin el fix daría //mejores-tacos");
});

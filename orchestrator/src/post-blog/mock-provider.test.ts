import { test } from "node:test";
import assert from "node:assert/strict";
import { MockPostProvider, PREFIJO_MOCK_POST } from "./mock-provider.js";

test("MockPostProvider devuelve título y cuerpo con el prefijo inconfundible", async () => {
  const provider = new MockPostProvider();
  const post = await provider.generar({
    contentBrief: { tema: "tacos" },
    keywordPrincipal: "mejores tacos zona norte",
    perfilCliente: null,
  });
  assert.ok(post.titulo.includes(PREFIJO_MOCK_POST));
  assert.ok(post.cuerpo.includes(PREFIJO_MOCK_POST));
  assert.ok(post.titulo.includes("mejores tacos zona norte"));
});

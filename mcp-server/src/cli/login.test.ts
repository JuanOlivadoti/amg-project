import assert from "node:assert/strict";
import { test } from "node:test";
import { mensajeExito } from "./login.js";

test("mensajeExito: incluye la ruta de la sesión y el tenant, no el token", () => {
  const msg = mensajeExito("/home/juan/.amg-mcp/session.json", "22222222-2222-2222-2222-222222222222");
  assert.match(msg, /session\.json/);
  assert.match(msg, /22222222-2222-2222-2222-222222222222/);
  assert.doesNotMatch(msg, /access|token/i);
});

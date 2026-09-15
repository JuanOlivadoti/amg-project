import assert from "node:assert/strict";
import { test } from "node:test";
import { respuestaTexto } from "./formato.js";

test("resultado ok: el texto es el JSON legible de los datos, sin isError", () => {
  const r = respuestaTexto({ ok: true, datos: { clientes: [{ id: "c1" }] } });
  assert.equal(r.isError, undefined);
  assert.equal(r.content.length, 1);
  assert.equal(r.content[0]!.type, "text");
  assert.deepEqual(JSON.parse(r.content[0]!.text), { clientes: [{ id: "c1" }] });
});

test("resultado NO ok: el texto es el mensaje, con isError true", () => {
  const r = respuestaTexto({ ok: false, mensaje: "No existe o no tenés acceso." });
  assert.equal(r.isError, true);
  assert.equal(r.content[0]!.text, "No existe o no tenés acceso.");
});

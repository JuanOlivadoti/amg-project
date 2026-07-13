import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalKey } from "./text.js";

test("canonicalKey: baja a minúsculas y recorta", () => {
  assert.equal(canonicalKey("  Pizza Napolitana  "), "pizza napolitana");
});

test("canonicalKey: colapsa espacios múltiples", () => {
  assert.equal(canonicalKey("pizza    napolitana"), "pizza napolitana");
});

test("canonicalKey: normaliza Unicode (NFD → NFC) para que casen las formas", () => {
  const nfc = "menú"; // ú precompuesta
  const nfd = "menú"; // u + combining acute
  assert.notEqual(nfc, nfd); // distintas como strings crudos
  assert.equal(canonicalKey(nfc), canonicalKey(nfd)); // iguales como clave
});

test("canonicalKey: mismo resultado para variantes de casing/espaciado", () => {
  assert.equal(canonicalKey("Restaurante Italiano MADRID"), canonicalKey("restaurante  italiano madrid"));
});

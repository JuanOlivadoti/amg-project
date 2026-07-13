import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalKey, dedupeByCanonical } from "./text.js";

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

/**
 * Regresión: los duplicados de casing se pagaban dos veces a DataForSEO (se cobra por keyword).
 * Detectado en la primera corrida real: 4 de 60 keywords eran el mismo término con otra grafía.
 */
test("dedupeByCanonical: colapsa duplicados de casing y conserva la primera grafía", () => {
  const out = dedupeByCanonical([
    "pasta fresca Madrid",
    "pasta fresca madrid",
    "pizza napolitana Madrid",
    "pizza napolitana madrid",
  ]);

  assert.deepEqual(out, ["pasta fresca Madrid", "pizza napolitana Madrid"]);
});

test("dedupeByCanonical: NO colapsa keywords realmente distintas", () => {
  const out = dedupeByCanonical(["pasta fresca madrid", "pasta fresca en madrid"]);

  assert.equal(out.length, 2);
});

test("dedupeByCanonical: colapsa por espacios y forma Unicode, no solo por casing", () => {
  const out = dedupeByCanonical(["menú  del día", " menú del día ", "menu del dia"]);

  assert.deepEqual(out, ["menú  del día", "menu del dia"]);
});

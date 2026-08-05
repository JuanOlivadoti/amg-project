import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, usdFromMicros } from "./index.js";

test("SCHEMA_VERSION es la versión del contrato vigente", () => {
  assert.equal(SCHEMA_VERSION, "kr.v0.5");
});

test("usdFromMicros formatea micros a USD con 4 decimales", () => {
  // 309700 micros = $0.3097, el coste real de la corrida de la demo.
  assert.equal(usdFromMicros(309_700), "0.3097");
  assert.equal(usdFromMicros(0), "0.0000");
});

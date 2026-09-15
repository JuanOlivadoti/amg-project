import assert from "node:assert/strict";
import { test } from "node:test";
import { esUuid } from "./validacion.js";

test("esUuid: acepta un UUID v4 válido", () => {
  assert.equal(esUuid("11111111-1111-1111-1111-111111111111"), true);
});

test("esUuid: acepta mayúsculas", () => {
  assert.equal(esUuid("AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE"), true);
});

test("esUuid: rechaza un nombre de cliente", () => {
  assert.equal(esUuid("Bella Napoli"), false);
});

test("esUuid: rechaza un UUID con un carácter de más", () => {
  assert.equal(esUuid("11111111-1111-1111-1111-1111111111111"), false);
});

test("esUuid: rechaza vacío", () => {
  assert.equal(esUuid(""), false);
});

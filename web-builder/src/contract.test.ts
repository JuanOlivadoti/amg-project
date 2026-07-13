import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBrief, parseProfile } from "./contract.js";
import { validBrief, validPage, validProfile } from "./fixtures.js";

test("#3 parseBrief: acepta un brief válido kr.v0.2", () => {
  const b = parseBrief(validBrief());
  assert.equal(b.paginas_propuestas.length, 1);
});

test("#3 parseBrief: rechaza schema_version no soportada", () => {
  assert.throws(() => parseBrief(validBrief({ schema_version: "kr.v9" })), /no soportada/);
});

test("#3 parseBrief: rechaza página malformada (content_brief null)", () => {
  const bad = validBrief({ paginas_propuestas: [{ content_brief: null } as never] });
  assert.throws(() => parseBrief(bad), /Brief inválido/);
});

test("#3 parseBrief: rechaza intención fuera del enum", () => {
  const bad = validBrief({ paginas_propuestas: [validPage({ intencion: "xxx" as never })] });
  assert.throws(() => parseBrief(bad), /Brief inválido/);
});

test("#14 parseProfile: acepta un perfil válido", () => {
  assert.equal(parseProfile(validProfile()).name, "Trattoria Bella Napoli");
});

test("#14 parseProfile: rechaza url inválida (no disfraza corrupción)", () => {
  assert.throws(() => parseProfile(validProfile({ url: "no-es-una-url" })), /inválido/);
});

test("#14 parseProfile: rechaza name faltante", () => {
  assert.throws(() => parseProfile({ telephone: "+34 900" } as never), /inválido/);
});

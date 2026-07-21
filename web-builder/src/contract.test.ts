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

test("parseProfile: acepta una marca válida (hex + fuente allowlist + logo)", () => {
  const p = parseProfile(validProfile({ brand: { color: "#0a7d34", font: "serif", logo: "https://cdn.ej/l.png" } }));
  assert.equal(p.brand?.color, "#0a7d34");
  assert.equal(p.brand?.font, "serif");
});

test("🔴 parseProfile: rechaza un color que no es hex (superficie de inyección CSS)", () => {
  assert.throws(() => parseProfile(validProfile({ brand: { color: "red;}body{}" } as never })), /inválido/);
});

test("🔴 parseProfile: rechaza una fuente fuera de la allowlist", () => {
  assert.throws(() => parseProfile(validProfile({ brand: { font: "Comic Sans" } as never })), /inválido/);
});

test("🔴 parseProfile: rechaza un logo que no es URL", () => {
  assert.throws(() => parseProfile(validProfile({ brand: { logo: "javascript:alert(1)" } as never })), /inválido/);
});

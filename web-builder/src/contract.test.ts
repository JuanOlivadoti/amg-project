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

test("perfil: acepta varios locales y una carta", () => {
  const p = parseProfile({
    name: "La Birra Bar",
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
        opening_hours: "Lun-Dom 11:00-01:00",
      },
    ],
    menu: [{ category: "Hamburguesas", name: "Golden Burger", price: "12,50 €" }],
  });
  assert.equal(p.locations?.length, 1);
  assert.equal(p.locations?.[0]?.name, "Centro");
  assert.equal(p.menu?.[0]?.name, "Golden Burger");
});

test("perfil: una dirección sin código postal es válida (no se inventa el dato)", () => {
  const p = parseProfile({
    name: "La Birra Bar",
    address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
  });
  assert.equal(p.address?.postalCode, undefined);
  assert.equal(p.address?.streetAddress, "Carrera de San Jerónimo 3");
});

test("🔴 perfil: un ítem de la carta sin nombre no pasa la puerta", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ price: "10 €" }] }),
    /business-profile\.json inválido/,
  );
});

test("🔴 revisión externa #3 — más de 20 locations se rechaza EN LA PUERTA (no llega nunca a Postgres)", () => {
  const locations = Array.from({ length: 21 }, (_, i) => ({ name: `Local ${i}` }));
  assert.throws(
    () => parseProfile({ name: "X", locations }),
    /business-profile\.json inválido/,
  );
});

test("🔴 revisión externa #3 — más de 200 items de menu se rechaza EN LA PUERTA", () => {
  const menu = Array.from({ length: 201 }, (_, i) => ({ name: `Item ${i}` }));
  assert.throws(
    () => parseProfile({ name: "X", menu }),
    /business-profile\.json inválido/,
  );
});

test("perfil: exactamente 20 locations / 200 items de menu SÍ pasa (el límite es el tope, no menos)", () => {
  const locations = Array.from({ length: 20 }, (_, i) => ({ name: `Local ${i}` }));
  const menu = Array.from({ length: 200 }, (_, i) => ({ name: `Item ${i}` }));
  const p = parseProfile({ name: "X", locations, menu });
  assert.equal(p.locations?.length, 20);
  assert.equal(p.menu?.length, 200);
});

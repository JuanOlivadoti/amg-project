import { test } from "node:test";
import assert from "node:assert/strict";
import { stableUid } from "./uid.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("#12 stableUid: es determinista (misma clave → mismo uid)", () => {
  assert.equal(stableUid("pagina", "section", "Sobre Nosotros"), stableUid("pagina", "section", "Sobre Nosotros"));
});

test("#12 stableUid: claves distintas → uids distintos", () => {
  assert.notEqual(stableUid("a", "section", "X"), stableUid("a", "section", "Y"));
  assert.notEqual(stableUid("a", "section", "X"), stableUid("b", "section", "X"));
  assert.notEqual(stableUid("a", "hero"), stableUid("a", "faq"));
});

test("#12 stableUid: tiene forma de UUID v5 válida (lo que espera Storyblok)", () => {
  assert.match(stableUid("pagina", "page"), UUID_RE);
  assert.match(stableUid("otra", "faq_item", "¿Cómo reservo?"), UUID_RE);
});

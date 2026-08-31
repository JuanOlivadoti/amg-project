import { test } from "node:test";
import assert from "node:assert/strict";
import { armarPromptSistema } from "./openai-provider.js";

test("armarPromptSistema: sin vertical, queda en la base genérica (sin mencionar rubro)", () => {
  const prompt = armarPromptSistema(undefined);
  assert.ok(!prompt.includes("gastronómico"));
  assert.ok(!prompt.includes("correduría"));
});

test("armarPromptSistema: con vertical 'restauracion', agrega el contexto gastronómico", () => {
  assert.ok(armarPromptSistema("restauracion").includes("gastronómico"));
});

test("armarPromptSistema: con vertical 'correduria_seguros', agrega el contexto de seguros", () => {
  assert.ok(armarPromptSistema("correduria_seguros").includes("correduría"));
});

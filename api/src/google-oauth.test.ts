import { test } from "node:test";
import assert from "node:assert/strict";
import { MockGoogleOAuthProvider, getGoogleOAuthProvider } from "./google-oauth.js";

test("intercambiarCode devuelve un refreshToken y locationId derivados del code", async () => {
  const p = new MockGoogleOAuthProvider();
  const r = await p.intercambiarCode("abc123");
  assert.equal(r.refreshToken, "mock-refresh-abc123");
  assert.equal(r.locationId, "mock-location-abc123");
});

test("🔴 intercambiarCode rechaza un code vacío", async () => {
  const p = new MockGoogleOAuthProvider();
  await assert.rejects(() => p.intercambiarCode(""));
});

test("urlDeConsentimiento apunta al propio callback de la API, con state y code de mentira", () => {
  const p = new MockGoogleOAuthProvider();
  const url = p.urlDeConsentimiento("cliente-1", "el-state", "http://localhost:3000");
  assert.equal(url, "http://localhost:3000/clients/cliente-1/google/callback?code=mock-code&state=el-state");
});

test("getGoogleOAuthProvider('mock') devuelve el mock", () => {
  assert.ok(getGoogleOAuthProvider("mock") instanceof MockGoogleOAuthProvider);
});

test("🔴 getGoogleOAuthProvider('live') todavía no está implementado: lanza explícito, no un mock silencioso", () => {
  assert.throws(() => getGoogleOAuthProvider("live"), /live sin implementación/);
});

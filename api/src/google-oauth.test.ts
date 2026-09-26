import { test } from "node:test";
import assert from "node:assert/strict";
import { MockGoogleOAuthProvider, getGoogleOAuthProvider } from "./google-oauth.js";
import { LiveGoogleOAuthProvider } from "./google-oauth-live.js";

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

test("urlDeConsentimiento apunta al callback FIJO de la API, con state y code de mentira", () => {
  // La ruta no lleva el cliente adentro porque Google exige un `redirect_uri` exacto y sin comodines
  // de path: una URL por cliente haría imposible el modo `live`. El cliente va dentro del `state`.
  const p = new MockGoogleOAuthProvider();
  const url = p.urlDeConsentimiento("el-state", "http://localhost:3000");
  assert.equal(url, "http://localhost:3000/google/callback?code=mock-code&state=el-state");
});

test("getGoogleOAuthProvider('mock') devuelve el mock", () => {
  assert.ok(getGoogleOAuthProvider("mock") instanceof MockGoogleOAuthProvider);
});

test("getGoogleOAuthProvider('live') con las tres credenciales devuelve el provider real", () => {
  const p = getGoogleOAuthProvider("live", "id", "secreto", "https://api.bigballs.es/google/callback");
  assert.ok(p instanceof LiveGoogleOAuthProvider);
});

test("🔴 getGoogleOAuthProvider('live') lanza nombrando la credencial que falta", () => {
  // Incluye el caso `""`, que es lo que escribe env:sync cuando la clave falta en credenciales.env.
  assert.throws(() => getGoogleOAuthProvider("live", "", "s", "u"), /GOOGLE_CLIENT_ID/);
  assert.throws(() => getGoogleOAuthProvider("live", "i", "  ", "u"), /GOOGLE_CLIENT_SECRET/);
  assert.throws(() => getGoogleOAuthProvider("live", "i", "s", undefined), /GOOGLE_REDIRECT_URI/);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGoogleOAuthProvider, SCOPE_BUSINESS } from "./google-oauth-live.js";

/** Cola de respuestas: el intercambio del code encadena hasta tres llamadas. */
function stubFetch(respuestas: Array<{ status: number; body: unknown }>) {
  const llamadas: Array<{ url: string; init: RequestInit | undefined }> = [];
  const original = globalThis.fetch;
  const cola = [...respuestas];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    const r = cola.shift();
    if (!r) throw new Error("stubFetch: una llamada de más, sin respuesta preparada");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return {
    llamadas,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const REDIRECT = "https://api.bigballs.es/google/callback";
const crear = () => new LiveGoogleOAuthProvider("un-client-id", "un-secreto", REDIRECT);

const TOKEN_OK = { status: 200, body: { refresh_token: "el-refresh", access_token: "el-access" } };

// ---------------------------------------------------------------- urlDeConsentimiento

test("urlDeConsentimiento: access_type=offline y prompt=consent -- sin las dos no hay refresh token", () => {
  const url = new URL(crear().urlDeConsentimiento("el-state", "http://ignorado:3000"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline", "sin esto Google no emite refresh token");
  assert.equal(
    url.searchParams.get("prompt"),
    "consent",
    "sin esto, un SEGUNDO consentimiento no trae refresh token y el cliente queda sin credencial",
  );
  assert.equal(url.searchParams.get("scope"), SCOPE_BUSINESS);
  assert.equal(url.searchParams.get("state"), "el-state");
  assert.equal(url.searchParams.get("response_type"), "code");
});

test("urlDeConsentimiento: el redirect_uri es el CONFIGURADO, nunca el origen de la request", () => {
  // Google exige coincidencia exacta con el registrado, y detrás de un proxy el origen que ve el
  // proceso puede no ser el público. El `callbackBaseUrl` se ignora en live, por contrato.
  const url = new URL(crear().urlDeConsentimiento("s", "http://localhost:3000"));
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
});

// ---------------------------------------------------------------- intercambiarCode

test("intercambiarCode: POST con grant_type=authorization_code y el redirect_uri configurado", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }] } },
    { status: 200, body: { locations: [{ name: "locations/222" }] } },
  ]);
  try {
    const r = await crear().intercambiarCode("el-code");
    assert.equal(r.refreshToken, "el-refresh");
    assert.equal(r.locationId, "accounts/111/locations/222", "la v4 direcciona por nombre de recurso completo");

    assert.equal(s.llamadas[0]!.url, "https://oauth2.googleapis.com/token");
    const cuerpo = new URLSearchParams(s.llamadas[0]!.init!.body as string);
    assert.equal(cuerpo.get("grant_type"), "authorization_code");
    assert.equal(cuerpo.get("code"), "el-code");
    assert.equal(cuerpo.get("redirect_uri"), REDIRECT);
  } finally {
    s.restore();
  }
});

test("🔴 intercambiarCode: un code vacío no llega a la red", async () => {
  const s = stubFetch([]);
  try {
    await assert.rejects(() => crear().intercambiarCode("  "));
    assert.equal(s.llamadas.length, 0);
  } finally {
    s.restore();
  }
});

test("🔴 intercambiarCode: un 200 SIN refresh_token lanza -- el fallo más traicionero del flujo", async () => {
  /*
   * Google devuelve `refresh_token` sólo en el primer consentimiento salvo que se pida
   * `prompt=consent`. Sin esta comprobación el cliente quedaría "conectado" con un access token de
   * una hora, y el polling dejaría de traer reseñas al rato sin que nada avisara.
   */
  const s = stubFetch([{ status: 200, body: { access_token: "solo-access" } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /refresh_token/);
  } finally {
    s.restore();
  }
});

test("🔴 intercambiarCode: HTTP 400 conserva el `error` de Google en el mensaje", async () => {
  const s = stubFetch([{ status: 400, body: { error: "redirect_uri_mismatch" } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /redirect_uri_mismatch/);
  } finally {
    s.restore();
  }
});

// ---------------------------------------------------------------- descubrir la ficha

test("🔴 429 al listar cuentas se traduce a un mensaje que nombra el trámite de cuota", async () => {
  // Es el estado REAL hoy: la Account Management API está en cuota 0 en amg-automation. Propagar un
  // "HTTP 429" pelado dejaría a quien conecte sin saber que el problema no es suyo.
  const s = stubFetch([TOKEN_OK, { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /cuota 0/);
  } finally {
    s.restore();
  }
});

test("🔴 varias fichas: falla nombrando la decisión pendiente en vez de elegir la primera", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }] } },
    { status: 200, body: { locations: [{ name: "locations/222" }, { name: "locations/333" }] } },
  ]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /2 fichas|selección/);
  } finally {
    s.restore();
  }
});

test("🔴 varias cuentas de negocio: tampoco se adivina cuál corresponde a este cliente", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }, { name: "accounts/999" }] } },
  ]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /2 cuentas/);
  } finally {
    s.restore();
  }
});

test("🔴 una cuenta sin ninguna ficha falla explícito, no devuelve un locationId a medias", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }] } },
    { status: 200, body: { locations: [] } },
  ]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /no tiene ninguna ficha/);
  } finally {
    s.restore();
  }
});

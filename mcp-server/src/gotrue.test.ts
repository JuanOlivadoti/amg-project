import assert from "node:assert/strict";
import { test } from "node:test";
import { iniciarSesion, refrescarSesion, TIMEOUT_TOKEN_MS, type OpcionesGoTrue } from "./gotrue.js";

const OPTS: OpcionesGoTrue = { supabaseUrl: "https://proyecto.supabase.co", anonKey: "anon-key-123" };

function respuestaGoTrue(over: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      access_token: "access-abc",
      refresh_token: "refresh-def",
      expires_in: 3600,
      user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: { tenant_id: "tenant-xyz" } },
      ...over,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("iniciarSesion: arma el request de login con la forma exacta de GoTrue", async () => {
  let capturado: { url: string; init: RequestInit } | null = null;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    capturado = { url: String(url), init: init ?? {} };
    return respuestaGoTrue();
  }) as typeof fetch;

  await iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "hunter2");

  // Sin `assert.ok(capturado)` a propósito: su firma `asserts` hace que tsc, que no sabe que el
  // closure de arriba corrió, angoste el tipo a `never` de acá en adelante (falso positivo del
  // checker, no un bug real). El `!` de abajo alcanza: si el closure no corrió, revienta en
  // runtime igual, con un mensaje más claro todavía ("Cannot read properties of null").
  assert.equal(capturado!.url, "https://proyecto.supabase.co/auth/v1/token?grant_type=password");
  assert.equal(capturado!.init.method, "POST");
  const headers = capturado!.init.headers as Record<string, string>;
  assert.equal(headers["apikey"], "anon-key-123");
  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(capturado!.init.body as string), { email: "juan@amg.es", password: "hunter2" });
});

test("iniciarSesion: mapea la respuesta a Sesion", async () => {
  const fetchFn = (async () => respuestaGoTrue()) as typeof fetch;
  const sesion = await iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "hunter2");
  assert.equal(sesion.accessToken, "access-abc");
  assert.equal(sesion.refreshToken, "refresh-def");
  assert.equal(sesion.userId, "11111111-1111-1111-1111-111111111111");
  assert.equal(sesion.tenantId, "tenant-xyz");
  assert.ok(sesion.expiraEn > Date.now(), "expiraEn tiene que ser un instante futuro");
});

test("iniciarSesion: LANZA si falta app_metadata.tenant_id (spec §3.3)", async () => {
  const fetchFn = (async () =>
    respuestaGoTrue({ user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: {} } })) as typeof fetch;
  await assert.rejects(
    () => iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "hunter2"),
    /tenant/i,
  );
});

test("iniciarSesion: LANZA con el mensaje de Supabase si el login falla", async () => {
  const fetchFn = (async () =>
    new Response(JSON.stringify({ error_description: "Invalid login credentials" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  await assert.rejects(
    () => iniciarSesion({ ...OPTS, fetchFn }, "juan@amg.es", "mal"),
    /Invalid login credentials/,
  );
});

test("refrescarSesion: arma el request con grant_type=refresh_token", async () => {
  let capturado: { url: string; body: string } | null = null;
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    capturado = { url: String(url), body: init?.body as string };
    return respuestaGoTrue();
  }) as typeof fetch;

  await refrescarSesion({ ...OPTS, fetchFn }, "refresh-viejo");

  assert.equal(capturado!.url, "https://proyecto.supabase.co/auth/v1/token?grant_type=refresh_token");
  assert.deepEqual(JSON.parse(capturado!.body), { refresh_token: "refresh-viejo" });
});

test("refrescarSesion: también lanza si falta el tenant", async () => {
  const fetchFn = (async () =>
    respuestaGoTrue({ user: { id: "11111111-1111-1111-1111-111111111111", app_metadata: {} } })) as typeof fetch;
  await assert.rejects(() => refrescarSesion({ ...OPTS, fetchFn }, "refresh-viejo"), /tenant/i);
});

test("TIMEOUT_TOKEN_MS es razonable y se usa en el request", async () => {
  assert.equal(TIMEOUT_TOKEN_MS, 8_000);
  let vioSignal = false;
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    vioSignal = init?.signal instanceof AbortSignal;
    return respuestaGoTrue();
  }) as typeof fetch;
  await iniciarSesion({ ...OPTS, fetchFn }, "a@b.es", "x");
  assert.ok(vioSignal, "el request tiene que llevar un AbortSignal (timeout)");
});

import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { llamarApi, type OpcionesApi } from "./api-client.js";
import { escribirSesion, type Sesion } from "./session.js";

const SESION_VIVA: Sesion = {
  accessToken: "access-vivo",
  refreshToken: "refresh-vivo",
  expiraEn: Date.now() + 3_600_000, // vence en 1h — no está por vencer
  userId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
};

async function conSesion(sesion: Sesion | null): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-api-test-"));
  const ruta = join(dir, "session.json");
  if (sesion) await escribirSesion(sesion, ruta);
  return ruta;
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });
}

const BASE: Omit<OpcionesApi, "rutaSesion" | "fetchFn"> = {
  apiUrl: "http://localhost:3000",
  supabaseUrl: "https://proyecto.supabase.co",
  anonKey: "anon-key",
};

test("sin sesión: no llama a fetch, devuelve el mensaje de 'sin sesión'", async () => {
  const rutaSesion = await conSesion(null);
  let llamoFetch = false;
  const fetchFn = (async () => {
    llamoFetch = true;
    return json({});
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /mcp:login -w mcp-server/);
  assert.equal(llamoFetch, false);
});

test("sesión viva: manda authorization y x-amg-tenant correctos", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  let headers: Record<string, string> = {};
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    headers = init?.headers as Record<string, string>;
    return json({ clientes: [] });
  }) as typeof fetch;

  const r = await llamarApi<{ clientes: unknown[] }>({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, true);
  assert.equal(headers["authorization"], "Bearer access-vivo");
  assert.equal(headers["x-amg-tenant"], "22222222-2222-2222-2222-222222222222");
});

test("con body: manda content-type y el JSON del body", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  let headers: Record<string, string> = {};
  let cuerpo = "";
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    headers = init?.headers as Record<string, string>;
    cuerpo = init?.body as string;
    return json({ ok: true, decisionId: "d1" });
  }) as typeof fetch;

  await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/runs/r1/approve", {
    method: "POST",
    body: { destino: "solo_informe" },
  });

  assert.equal(headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(cuerpo), { destino: "solo_informe" });
});

test("sesión por vencer: refresca ANTES de llamar, y usa el token nuevo", async () => {
  const rutaSesion = await conSesion({ ...SESION_VIVA, expiraEn: Date.now() + 1_000 }); // por vencer
  let tokenUsado = "";
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes("/auth/v1/token")) {
      return json({
        access_token: "access-refrescado",
        refresh_token: "refresh-refrescado",
        expires_in: 3600,
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    tokenUsado = ((init?.headers as Record<string, string>)["authorization"] ?? "").replace("Bearer ", "");
    return json({ clientes: [] });
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, true);
  assert.equal(tokenUsado, "access-refrescado");
});

test("401 en el primer intento: refresca UNA vez y reintenta con éxito", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  let llamadasApi = 0;
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) {
      return json({
        access_token: "access-refrescado",
        refresh_token: "refresh-refrescado",
        expires_in: 3600,
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    llamadasApi += 1;
    return llamadasApi === 1 ? json({ error: "Token inválido o expirado." }, 401) : json({ clientes: [] });
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, true);
  assert.equal(llamadasApi, 2, "primer intento (401) + reintento tras refrescar");
});

test("401 persiste tras refrescar: mensaje de 'sin sesión', no un loop", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) {
      return json({
        access_token: "access-refrescado",
        refresh_token: "refresh-refrescado",
        expires_in: 3600,
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    return json({ error: "Token inválido o expirado." }, 401);
  }) as typeof fetch;

  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /mcp:login -w mcp-server/);
});

test("503: mensaje específico de Supabase caído, no el de sesión muerta", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async () => json({ error: "No se puede verificar el token en este momento." }, 503)) as typeof fetch;
  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/runs");
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /Supabase/);
});

test("403 y 404: mismo mensaje genérico, sin distinguir (igual que la API)", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  for (const status of [403, 404]) {
    const fetchFn = (async () => json({ error: "no importa" }, status)) as typeof fetch;
    const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients/x");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.mensaje, /No existe o no tenés acceso/);
  }
});

test("409: reenvía el mensaje real de la API, tal cual", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async () =>
    json({ error: "Esta transición no está permitida para el estado actual del run.", codigo: "TRANSICION_INVALIDA" }, 409)) as typeof fetch;
  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/runs/r1/approve", { method: "POST", body: { destino: "solo_informe" } });
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.mensaje, "Esta transición no está permitida para el estado actual del run.");
});

test("la API no responde (fetch lanza): mensaje con la URL configurada", async () => {
  const rutaSesion = await conSesion(SESION_VIVA);
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) return json({});
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  const r = await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.mensaje, /No hay API en/);
    assert.match(r.mensaje, /http:\/\/localhost:3000/);
    assert.match(r.mensaje, /dev:server -w api/);
  }
});

test("refresh persiste en disco: la próxima llamada ya usa el token nuevo sin refrescar de nuevo", async () => {
  const rutaSesion = await conSesion({ ...SESION_VIVA, expiraEn: Date.now() + 1_000 });
  let refrescos = 0;
  const fetchFn = (async (url: string | URL) => {
    if (String(url).includes("/auth/v1/token")) {
      refrescos += 1;
      return json({
        access_token: `access-${refrescos}`,
        refresh_token: `refresh-${refrescos}`,
        expires_in: 3600, // la sesión nueva NO está por vencer
        user: { id: SESION_VIVA.userId, app_metadata: { tenant_id: SESION_VIVA.tenantId } },
      });
    }
    return json({ clientes: [] });
  }) as typeof fetch;

  await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");
  await llamarApi({ ...BASE, fetchFn, rutaSesion }, "/clients");

  assert.equal(refrescos, 1, "la segunda llamada tiene que leer la sesión YA refrescada del disco");
});

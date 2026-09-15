import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { OpcionesApi } from "../api-client.js";
import { escribirSesion, type Sesion } from "../session.js";
import { aprobarRun, esDestinoValido, listarRuns, verInforme, verRun } from "./runs.js";

const RUN_ID = "11111111-1111-1111-1111-111111111111";
const CLIENT_ID = "22222222-2222-2222-2222-222222222222";

const SESION_VIVA: Sesion = {
  accessToken: "access-vivo",
  refreshToken: "refresh-vivo",
  expiraEn: Date.now() + 3_600_000,
  userId: RUN_ID,
  tenantId: CLIENT_ID,
};

async function opts(fetchFn: typeof fetch): Promise<OpcionesApi> {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-tools-test-"));
  const rutaSesion = join(dir, "session.json");
  await escribirSesion(SESION_VIVA, rutaSesion);
  return { apiUrl: "http://localhost:3000", supabaseUrl: "https://x.supabase.co", anonKey: "k", fetchFn, rutaSesion };
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });
}

test("listarRuns sin clientId: GET /runs", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ runs: [] });
  }) as typeof fetch;
  await listarRuns(await opts(fetchFn));
  assert.equal(pedido, "http://localhost:3000/runs");
});

test("listarRuns con clientId: GET /runs?clientId=<uuid>", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ runs: [] });
  }) as typeof fetch;
  await listarRuns(await opts(fetchFn), CLIENT_ID);
  assert.equal(pedido, `http://localhost:3000/runs?clientId=${CLIENT_ID}`);
});

test("🔴 listarRuns: clientId inválido no llega a la red", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;
  const r = await listarRuns(await opts(fetchFn), "no-es-un-uuid");
  assert.equal(r.ok, false);
  assert.equal(llamo, false);
});

test("verRun: GET /runs/:id", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ run: {}, pages: [] });
  }) as typeof fetch;
  await verRun(await opts(fetchFn), RUN_ID);
  assert.equal(pedido, `http://localhost:3000/runs/${RUN_ID}`);
});

test("🔴 verRun: rechaza un id no-UUID sin llamar a la red", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;
  const r = await verRun(await opts(fetchFn), "el run de bella napoli");
  assert.equal(r.ok, false);
  assert.equal(llamo, false);
});

test("verInforme: GET /runs/:id/informe", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ informe_md: null, generado_at: null });
  }) as typeof fetch;
  await verInforme(await opts(fetchFn), RUN_ID);
  assert.equal(pedido, `http://localhost:3000/runs/${RUN_ID}/informe`);
});

test("esDestinoValido: los tres valores del enum, y nada más", () => {
  assert.equal(esDestinoValido("crear_web"), true);
  assert.equal(esDestinoValido("solo_informe"), true);
  assert.equal(esDestinoValido("crear_posts"), true);
  assert.equal(esDestinoValido("publicar_ya"), false);
  assert.equal(esDestinoValido(""), false);
});

test("aprobarRun: POST /runs/:id/approve con {destino} en el body", async () => {
  let url = "";
  let method = "";
  let body = "";
  const fetchFn = (async (u: string | URL, init?: RequestInit) => {
    url = String(u);
    method = init?.method ?? "";
    body = (init?.body as string) ?? "";
    return json({ ok: true, decisionId: "d1" });
  }) as typeof fetch;

  const r = await aprobarRun(await opts(fetchFn), RUN_ID, "solo_informe");

  assert.equal(url, `http://localhost:3000/runs/${RUN_ID}/approve`);
  assert.equal(method, "POST");
  assert.deepEqual(JSON.parse(body), { destino: "solo_informe" });
  assert.equal(r.ok, true);
});

test("🔴 aprobarRun: destino fuera del enum se rechaza ANTES de llamar a la API", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;

  const r = await aprobarRun(await opts(fetchFn), RUN_ID, "publicar_ya");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /crear_web/);
  assert.equal(llamo, false, "un destino inválido no debe llegar a la red — defensa en profundidad, spec §5");
});

test("🔴 aprobarRun: runId no-UUID se rechaza ANTES de llamar a la API", async () => {
  let llamo = false;
  const fetchFn = (async () => {
    llamo = true;
    return json({});
  }) as typeof fetch;

  const r = await aprobarRun(await opts(fetchFn), "el run de ayer", "solo_informe");

  assert.equal(r.ok, false);
  assert.equal(llamo, false);
});

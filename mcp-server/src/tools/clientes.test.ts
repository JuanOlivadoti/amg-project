import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { OpcionesApi } from "../api-client.js";
import { escribirSesion, type Sesion } from "../session.js";
import { listarClientes, verCliente } from "./clientes.js";

const SESION_VIVA: Sesion = {
  accessToken: "access-vivo",
  refreshToken: "refresh-vivo",
  expiraEn: Date.now() + 3_600_000,
  userId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
};

/**
 * `llamarApi` (Task 4) exige una sesión en disco antes de tocar la red — sin esto, cada test de acá
 * fallaría con "sin sesión" sin haber ejercitado nada de `clientes.ts`. Mismo patrón que
 * `api-client.test.ts:conSesion`.
 */
async function opts(fetchFn: typeof fetch): Promise<OpcionesApi> {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-tools-test-"));
  const rutaSesion = join(dir, "session.json");
  await escribirSesion(SESION_VIVA, rutaSesion);
  return { apiUrl: "http://localhost:3000", supabaseUrl: "https://x.supabase.co", anonKey: "k", fetchFn, rutaSesion };
}

function json(datos: unknown, status = 200): Response {
  return new Response(JSON.stringify(datos), { status, headers: { "content-type": "application/json" } });
}

test("listarClientes: pega a GET /clients", async () => {
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ clientes: [{ id: "c1", nombre: "Bella Napoli" }] });
  }) as typeof fetch;

  const r = await listarClientes(await opts(fetchFn));

  assert.match(pedido, /\/clients$/);
  assert.equal(r.ok, true);
});

test("verCliente: pega a GET /clients/:id con un UUID válido", async () => {
  const id = "11111111-1111-1111-1111-111111111111";
  let pedido = "";
  const fetchFn = (async (url: string | URL) => {
    pedido = String(url);
    return json({ cliente: { id, nombre: "Bella Napoli" } });
  }) as typeof fetch;

  const r = await verCliente(await opts(fetchFn), id);

  assert.equal(pedido, `http://localhost:3000/clients/${id}`);
  assert.equal(r.ok, true);
});

test("🔴 verCliente: rechaza un nombre en vez de un UUID, SIN llamar a la API", async () => {
  let llamoFetch = false;
  const fetchFn = (async () => {
    llamoFetch = true;
    return json({});
  }) as typeof fetch;

  const r = await verCliente(await opts(fetchFn), "Bella Napoli");

  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.mensaje, /UUID/);
  assert.equal(llamoFetch, false, "un id inválido no debe llegar a la red");
});

import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { PglitePool, PgStore, ConexionReservada, sembrarBellaNapoli, migrarConRegistro } from "db";
import type { ResultadoSeed } from "db";
import { createApp } from "./app.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";

/**
 * Integración de PUNTA A PUNTA del seed de la demo (Fase 1) A TRAVÉS de la API real.
 *
 * Los tests de `db/src/seed-demo.test.ts` leen lo sembrado con SQL directo bajo RLS: prueban la
 * visibilidad, no el camino completo. Esto lo cierra: siembra con la MISMA función que corre en el
 * deploy, arma el `PgStore` real (rol `app_user`) y la app de Hono, y pega `GET /runs` / `GET
 * /runs/:id` como lo hará el portal —con el JWT (verificador de mentira) y el header de tenant—. Si
 * el seed dejara la membresía mal, o el tenant no cuadrara, acá Frank no vería su research.
 */
const FRANK = "11111111-1111-1111-1111-111111111111"; // maestro
const JUAN = "22222222-2222-2222-2222-222222222222"; // equipo
const INTRUSO = "44444444-4444-4444-4444-444444444444"; // sin membresía

const verificar: VerificadorToken = async (token) =>
  token.startsWith("valid:") ? { userId: token.slice(6) } : null;

let pg: PGlite;
let app: ReturnType<typeof createApp>;
let r: ResultadoSeed;

beforeEach(async () => {
  pg = new PGlite();
  const con = ConexionReservada.desdePglite(pg);
  // Migraciones con el runner REAL del deploy (no `aplicarMigraciones`): el mismo camino que producción.
  await migrarConRegistro(con);
  r = await sembrarBellaNapoli(con, { frankUserId: FRANK, juanUserId: JUAN });

  const store = new PgStore(new PglitePool(pg)); // amg_api → app_user
  const emisor: EmisorEventos = { send: async () => ({}) };
  app = createApp({ store, emisor, verificar });
});

afterEach(async () => {
  await pg.close();
});

async function get(path: string, user: string, tenant: string): Promise<Response> {
  return app.request(path, {
    headers: { authorization: `Bearer valid:${user}`, "x-amg-tenant": tenant },
  });
}

test("GET /runs como Frank devuelve el run de Bella Napoli en pending_approval", async () => {
  const res = await get("/runs", FRANK, r.tenantId);
  assert.equal(res.status, 200);
  const { runs } = (await res.json()) as { runs: Array<{ id: string; status: string }> };
  assert.equal(runs.length, 1);
  assert.equal(runs[0]?.id, r.runId);
  assert.equal(runs[0]?.status, "pending_approval");
});

test("GET /runs/:id como Frank devuelve las 8 páginas con el split 3/5", async () => {
  const res = await get(`/runs/${r.runId}`, FRANK, r.tenantId);
  assert.equal(res.status, 200);
  const { pages } = (await res.json()) as { pages: Array<{ evidencia: string; approved: boolean }> };
  assert.equal(pages.length, 8);
  assert.equal(pages.filter((p) => p.evidencia === "datos_mercado").length, 3);
  assert.equal(pages.filter((p) => p.evidencia === "sin_validar").length, 5);
  assert.ok(pages.every((p) => p.approved === false), "ninguna nace aprobada");
});

test("GET /runs como Juan (equipo) también ve el run", async () => {
  const res = await get("/runs", JUAN, r.tenantId);
  const { runs } = (await res.json()) as { runs: unknown[] };
  assert.equal(runs.length, 1);
});

test("un intruso con el tenant correcto pero sin membresía no ve runs", async () => {
  const res = await get("/runs", INTRUSO, r.tenantId);
  assert.equal(res.status, 200);
  const { runs } = (await res.json()) as { runs: unknown[] };
  assert.equal(runs.length, 0, "RLS no le deriva rol: no ve nada, aunque reclame el tenant");
});

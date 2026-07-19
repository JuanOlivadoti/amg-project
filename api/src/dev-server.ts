/**
 * ARRANQUE DE DESARROLLO — la API real, sobre PGlite, sin credenciales.
 *
 * ⚠️ **Nunca en producción.** Usa un verificador de token FALSO (`valid:<uuid>`) y una base en
 * memoria que se pierde al salir. Existe para dos cosas legítimas:
 *   · levantar el portal contra una API de verdad sin tener Supabase ni Postgres;
 *   · verificar en un navegador lo que los tests no alcanzan (render, navegación entre runs).
 *
 * Es posible porque `createApp` recibe TODO inyectado (store, emisor, verificador). El mismo diseño
 * que hace testeable a la API sin red es el que permite este harness.
 *
 * Correr:  npm run dev:server -w api
 */
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { aplicarMigraciones, PglitePool, PgStore } from "db";
import { createApp } from "./app.js";
import type { EmisorEventos } from "./solicitar.js";
import type { VerificadorToken } from "./auth.js";

if (process.env["NODE_ENV"] === "production") {
  throw new Error("dev-server.ts NO se corre en producción: su verificador de token es falso.");
}

const pg = new PGlite();
await aplicarMigraciones(pg);
const store = new PgStore(new PglitePool(pg));

const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> =>
  (await pg.query<T>(q, p)).rows;

// ---------------------------------------------------------------- seed
const [tenant] = (
  await sql<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Agencia AMG','amg') returning id",
  )
).map((r) => r.id) as [string];

const [client] = (
  await sql<{ id: string }>(
    "insert into clients (tenant_id, nombre) values ($1,'Trattoria Bella Napoli') returning id",
    [tenant],
  )
).map((r) => r.id) as [string];

const equipo = (
  await sql<{ user_id: string }>(
    `insert into memberships (tenant_id, user_id, rol, client_id)
     values ($1, gen_random_uuid(), 'equipo'::user_role, null) returning user_id`,
    [tenant],
  )
)[0]!.user_id;

const crearRun = async (prompt: string, status = "pending_approval"): Promise<string> =>
  (
    await sql<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code, coste_micros_usd)
       values ($1,$2,'kr.v0.5',$4,$3,'ES','es',2724, 310800) returning id`,
      [tenant, client, prompt, status],
    )
  )[0]!.id;

const crearPagina = async (
  runId: string,
  slug: string,
  kw: string,
  evidencia: string,
  volumen: number | null,
  kd: number | null,
  score: number,
): Promise<void> => {
  await sql(
    `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, url_slug,
                           keyword_principal, keywords_secundarias, intencion, local, volumen,
                           dificultad, evidencia, opportunity_score, score_confidence, seo,
                           content_brief, preguntas_frecuentes, approved, retirada)
     values ($1,$2,$3, gen_random_uuid(), 'landing_local', $4, $5, array[]::text[], 'local', true,
             $6, $7, $8, $9, 1, '{}'::jsonb, '{}'::jsonb, array['¿Reservan?'], false, false)`,
    [tenant, runId, client, slug, kw, volumen, kd, evidencia, score],
  );
};

const runA = await crearRun("Restaurante italiano en Madrid centro");
await crearPagina(runA, "/restaurante-italiano-madrid-centro", "restaurante italiano madrid centro", "datos_mercado", 480, 0, 91);
await crearPagina(runA, "/pizza-napolitana-madrid", "pizza napolitana madrid", "datos_mercado", 390, 15, 84);
await crearPagina(runA, "/cenas-para-grupos", "cenas para grupos madrid", "sin_validar", null, null, 52);

const runB = await crearRun("Bar de tapas en Malasaña");
await crearPagina(runB, "/bar-tapas-malasana", "bar de tapas malasaña", "datos_mercado", 210, 8, 70);
await crearPagina(runB, "/brunch-fin-de-semana", "brunch fin de semana madrid", "sin_validar", null, null, 44);

// ---------------------------------------------------------------- app
const eventos: Array<{ name: string; data: Record<string, unknown> }> = [];
const emisor: EmisorEventos = {
  send: async (e) => {
    eventos.push(e);
    console.log(`  [evento] ${e.name}`, e.data);
    return {};
  },
};

/** FALSO a propósito: `valid:<uuid>` identifica a ese usuario. Ver el aviso de arriba. */
const verificar: VerificadorToken = async (t) => (t.startsWith("valid:") ? { userId: t.slice(6) } : null);

const app = createApp({ store, emisor, verificar, corsOrigins: ["http://localhost:4200"] });

// Un run EN CURSO: es el que dispara el polling del brief (y con el que se comprueba que no quede
// un intervalo huérfano al salir de la pantalla).
const runCorriendo = await crearRun("Pizzería en Chamberí (corriendo)", "running");

serve({ fetch: app.fetch, port: 3000 }, () => {
  const sesion = {
    accessToken: `valid:${equipo}`,
    refreshToken: "dev-refresh",
    expiraEn: Date.now() + 86_400_000,
    userId: equipo,
    email: "equipo@amg.dev",
    tenantId: tenant,
    rol: "equipo",
  };
  console.log("\n▶ API de desarrollo en http://localhost:3000  (PGlite en memoria, token falso)\n");
  console.log(`  runA (italiano):  ${runA}`);
  console.log(`  runB (tapas):     ${runB}`);
  console.log(`  runC (corriendo): ${runCorriendo}\n`);
  console.log("  Sesión para el portal (pegar en la consola del navegador):");
  console.log(`  localStorage.setItem('amg.sesion', ${JSON.stringify(JSON.stringify(sesion))})\n`);
});

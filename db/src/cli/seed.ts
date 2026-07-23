/**
 * CLI del seed de la demo (Fase 1). Carga el caso de Bella Napoli para el portal de Frank.
 *
 *   DATABASE_URL_ADMIN="postgres://…" \
 *   SEED_FRANK_USER_ID="<uuid de Frank en Supabase Auth>" \
 *   SEED_JUAN_USER_ID="<uuid de Juan en Supabase Auth>" \
 *   npm run seed:demo -w db
 *
 * ## El orden importa (por qué los IDs son env vars)
 *
 * Las membresías atan un usuario a un tenant y un rol, y necesitan el `sub` real del usuario de
 * Supabase Auth. Así que **primero** se crean los usuarios de Frank y Juan en Supabase (paso de
 * Juan), se copian sus UUID a estas variables, y **después** se corre este seed. Es idempotente: si
 * más adelante hay que reasignar un rol, se re-corre sin duplicar nada.
 *
 * Usa la conexión de ADMIN igual que las migraciones: sembrar crea datos de varios "dueños" y no es
 * una petición de usuario (no pasa por RLS). Lo sembrado se lee después bajo RLS.
 */
import { sembrarBellaNapoli, type OpcionesSeed } from "../seed-demo.js";
import type { Ejecutor } from "../deploy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const databaseUrl = process.env["DATABASE_URL_ADMIN"];
const frankUserId = process.env["SEED_FRANK_USER_ID"]?.trim();
const juanUserId = process.env["SEED_JUAN_USER_ID"]?.trim();

// Falla cerrado, y decí EXACTAMENTE qué falta: un seed a medio configurar que crea membresías con
// IDs vacíos deja usuarios que existen pero no ven nada, y el fallo aparece recién en el portal.
const faltan = [
  !databaseUrl && "DATABASE_URL_ADMIN (conexión de admin de Supabase)",
  !frankUserId && "SEED_FRANK_USER_ID (sub del usuario de Frank en Supabase Auth)",
  !juanUserId && "SEED_JUAN_USER_ID (sub del usuario de Juan en Supabase Auth)",
].filter((x): x is string => Boolean(x));

if (faltan.length > 0) {
  console.error(`Faltan variables para sembrar:\n  - ${faltan.join("\n  - ")}`);
  console.error(
    "\nPrimero creá los usuarios de Frank y Juan en Supabase Auth, copiá sus UUID a\n" +
      "SEED_FRANK_USER_ID / SEED_JUAN_USER_ID, y volvé a correr.",
  );
  process.exit(1);
}

for (const [nombre, id] of [
  ["SEED_FRANK_USER_ID", frankUserId],
  ["SEED_JUAN_USER_ID", juanUserId],
] as const) {
  if (!UUID.test(id!)) {
    console.error(`${nombre} no parece un UUID de Supabase: "${id}"`);
    process.exit(1);
  }
}

const opts: OpcionesSeed = { frankUserId: frankUserId!, juanUserId: juanUserId! };

const { Client } = await import("pg");
const client = new Client({ connectionString: databaseUrl });
await client.connect();

const ej: Ejecutor = {
  exec: (sql) => client.query(sql),
  query: <T>(sql: string, params?: unknown[]) =>
    client.query(sql, params) as unknown as Promise<{ rows: T[] }>,
};

try {
  const r = await sembrarBellaNapoli(ej, opts);
  console.log("\n✔ Sembrado el caso de Bella Napoli.\n");
  console.log("  tenant_id:", r.tenantId);
  console.log("  client_id:", r.clientId);
  console.log("  run_id:   ", r.runId);
  console.log(
    "\nPróximo paso (en Supabase Auth): poné en el `app_metadata` de CADA usuario:\n" +
      `  Frank → { "tenant_id": "${r.tenantId}", "rol": "maestro" }\n` +
      `  Juan  → { "tenant_id": "${r.tenantId}", "rol": "equipo" }\n` +
      "\nEl portal lee el tenant de ahí (lo manda en el header x-amg-tenant); `rol` es solo para la\n" +
      "UI —mostrar/ocultar botones—, la autorización real la deriva RLS de memberships (ADR-15/20).",
  );
} catch (e) {
  console.error(`\n✖ El seed falló y se revirtió: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

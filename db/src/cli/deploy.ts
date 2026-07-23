/**
 * CLI de migraciones contra una base REMOTA (Fase 1: Supabase).
 *
 * Corre las migraciones pendientes, en orden, de forma idempotente (ver `deploy.ts`). Es lo que se
 * ejecuta una vez al desplegar, y de nuevo cada vez que se agrega una migración.
 *
 *   DATABASE_URL_ADMIN="postgres://…" npm run migrate:deploy -w db
 *
 * ## Qué credencial usa (y por qué NO es `amg_api`)
 *
 * Las migraciones **crean roles** (`create role amg_api …`) y son dueñas del esquema: eso exige el
 * superusuario del proyecto (en Supabase, el login `postgres` / la "connection string" de admin), no
 * el login `amg_api`, que solo puede asumir `app_user` y no puede crear roles. Esta es la ÚNICA pieza
 * que toca esa credencial de admin; la API y el renderizador usan sus logins mínimos.
 *
 * El `import("pg")` es dinámico a propósito: así el paquete `db` sigue compilando y testeando sin
 * `pg` ni conexión real (todo el proyecto corre sin credenciales; solo este CLI necesita una).
 */
import { migrarConRegistro, type Ejecutor } from "../deploy.js";

const databaseUrl = process.env["DATABASE_URL_ADMIN"];
if (!databaseUrl) {
  // Falla cerrado: un runner de migraciones a medio configurar no debe "por las dudas" tocar otra
  // base. Mejor no arrancar y decir exactamente qué falta.
  console.error(
    "Falta DATABASE_URL_ADMIN: la conexión de ADMIN (superusuario `postgres` de Supabase),\n" +
      "no la de `amg_api`. Las migraciones crean roles y son dueñas del esquema.",
  );
  process.exit(1);
}

const { Client } = await import("pg");
const client = new Client({ connectionString: databaseUrl });
await client.connect();

// `pg` cumple `Ejecutor` con un envoltorio mínimo: `exec` por el protocolo simple (multi-sentencia,
// una migración entera) y `query` por el extendido (una sentencia con parámetros, para el registro).
const ej: Ejecutor = {
  exec: (sql) => client.query(sql),
  query: <T>(sql: string, params?: unknown[]) =>
    client.query(sql, params) as unknown as Promise<{ rows: T[] }>,
};

try {
  const aplicadas = await migrarConRegistro(ej, (msg) => console.log(msg));
  if (aplicadas.length === 0) {
    console.log("\n✔ La base ya estaba al día: no había migraciones pendientes.");
  } else {
    console.log(`\n✔ Aplicadas ${aplicadas.length} migración(es): ${aplicadas.join(", ")}`);
  }
} catch (e) {
  console.error(`\n✖ ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}

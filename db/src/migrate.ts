import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const aqui = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(aqui, "..", "migrations");

/** Lo que ejecuta SQL crudo. Lo cumple PGlite y cualquier cliente de Postgres. */
interface Ejecutor {
  exec(sql: string): Promise<unknown>;
}

/**
 * Stand-in MÍNIMO de `auth.users`, el esquema que Supabase Auth ya crea en producción.
 *
 * La `0012_membresias_perfil.sql` asume que `auth.users` YA EXISTE — no es nuestro esquema, y por
 * eso nunca se migra dentro de `db/migrations/` (ver esa migración). En PRODUCCIÓN (Supabase real)
 * llamar esto es un NO-OP: el `if not exists` no toca nada, porque el esquema y la tabla YA existen
 * con su forma real (columnas que este stand-in ni siquiera declara, como `encrypted_password`,
 * que este sistema nunca debe leer). En PGlite (tests), que arranca completamente vacío, esto es lo
 * ÚNICO que crea el stand-in — sin él, la 0012 fallaría con "relation auth.users does not exist".
 *
 * Se llama desde LOS DOS runners que aplican migraciones (`aplicarMigraciones` acá abajo, y
 * `migrarConRegistro` en `deploy.ts`): cualquiera de los dos puede ser el primero en tocar la 0012,
 * y varios tests de este paquete corren `aplicarMigraciones` directo sobre un PGlite propio, sin
 * pasar por `TestDb.create()` (`store.test.ts`, `cache.test.ts`, `task-log.test.ts`).
 */
export async function asegurarAuthStandIn(db: Ejecutor): Promise<void> {
  await db.exec(`
    create schema if not exists auth;
    create table if not exists auth.users (
      id                 uuid primary key default gen_random_uuid(),
      email              text,
      raw_app_meta_data  jsonb not null default '{}'::jsonb,
      created_at         timestamptz not null default now()
    );
  `);
}

/**
 * Aplica las migraciones en orden alfabético (`0001_`, `0002_`, …).
 *
 * No hay tabla de migraciones aplicadas todavía: el esquema se crea de cero en cada test y no hay
 * base desplegada. Cuando la haya, acá va el registro — pero inventarlo ahora sería infraestructura
 * para un problema que no existe.
 */
export async function aplicarMigraciones(db: Ejecutor): Promise<string[]> {
  await asegurarAuthStandIn(db);
  const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of archivos) {
    await db.exec(await readFile(join(MIGRATIONS_DIR, f), "utf8"));
  }
  return archivos;
}

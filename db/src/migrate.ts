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
 * Aplica las migraciones en orden alfabético (`0001_`, `0002_`, …).
 *
 * No hay tabla de migraciones aplicadas todavía: el esquema se crea de cero en cada test y no hay
 * base desplegada. Cuando la haya, acá va el registro — pero inventarlo ahora sería infraestructura
 * para un problema que no existe.
 */
export async function aplicarMigraciones(db: Ejecutor): Promise<string[]> {
  const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of archivos) {
    await db.exec(await readFile(join(MIGRATIONS_DIR, f), "utf8"));
  }
  return archivos;
}

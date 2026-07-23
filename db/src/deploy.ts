import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { MIGRATIONS_DIR } from "./migrate.js";

/**
 * Runner de migraciones para una base REMOTA que persiste (Fase 1: Supabase).
 *
 * ## Por qué no alcanza `aplicarMigraciones`
 *
 * `aplicarMigraciones` corre las 9 migraciones sobre una base NUEVA cada vez (PGlite en tests): no
 * necesita registro porque nunca re-aplica. Una base desplegada es al revés —persiste—, y correr las
 * migraciones dos veces revienta: `create table`, `create type`, `create policy` y `add constraint`
 * NO son idempotentes. El propio `migrate.ts` lo anticipaba: "cuando haya base desplegada, acá va el
 * registro". Esto es ese registro.
 *
 * No crea nada distinto de lo que crean las migraciones (el esquema, los roles `amg_*`/`app_*` y la
 * RLS ya nacen en 0001/0003/0007). Su único trabajo es aplicarlas **en orden, una sola vez, de forma
 * segura y repetible** contra una conexión remota.
 */

/** Lo mínimo que el runner le pide al cliente de base: lo cumplen PGlite y un `Client` de `pg`. */
export interface Ejecutor {
  /** SQL crudo, posiblemente multi-sentencia (una migración entera, o `begin`/`commit`). */
  exec(sql: string): Promise<unknown>;
  /** Una sentencia con parámetros. Se usa solo para leer/escribir el registro. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * El registro vive en el schema `app`, no en `public`: los roles de aplicación tienen `usage` sobre
 * `app` pero ningún grant de select sobre tablas ahí, así que no lo ven. Con RLS forzada y sin
 * política queda deny-all incluso para ellos: defensa en profundidad, coherente con el resto.
 */
const REGISTRO = "app.migraciones_aplicadas";

/**
 * Aplica las migraciones pendientes contra `ej`, en orden, cada una en su propia transacción, y las
 * anota en el registro. Devuelve los nombres de las que aplicó en ESTA corrida (`[]` si no había
 * pendientes). Es idempotente: correrlo de nuevo no re-aplica nada.
 */
export async function migrarConRegistro(
  ej: Ejecutor,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  await ej.exec(`
    create schema if not exists app;
    create table if not exists ${REGISTRO} (
      nombre       text primary key,
      aplicada_en  timestamptz not null default now()
    );
    alter table ${REGISTRO} enable row level security;
    alter table ${REGISTRO} force  row level security;
  `);

  const { rows } = await ej.query<{ nombre: string }>(`select nombre from ${REGISTRO}`);
  const yaAplicadas = new Set(rows.map((r) => r.nombre));

  const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const nuevas: string[] = [];

  for (const archivo of archivos) {
    if (yaAplicadas.has(archivo)) {
      log(`= ${archivo} (ya aplicada)`);
      continue;
    }

    const sql = await readFile(join(MIGRATIONS_DIR, archivo), "utf8");

    // Cada migración en SU transacción: si una falla no deja el esquema a medias, y la fila del
    // registro se escribe en el mismo commit que sus cambios (o no se escribe si algo lanza). El
    // insert del registro va DENTRO de la transacción a propósito: si estuviera fuera, un commit del
    // esquema seguido de una caída antes del insert dejaría la migración aplicada y sin registrar —
    // y la próxima corrida la re-aplicaría y reventaría.
    await ej.exec("begin");
    try {
      await ej.exec(sql);
      await ej.query(`insert into ${REGISTRO} (nombre) values ($1)`, [archivo]);
      await ej.exec("commit");
    } catch (e) {
      await ej.exec("rollback");
      throw new Error(`La migración ${archivo} falló y se revirtió: ${(e as Error).message}`, {
        cause: e,
      });
    }

    log(`+ ${archivo}`);
    nuevas.push(archivo);
  }

  return nuevas;
}

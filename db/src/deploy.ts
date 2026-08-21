import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { MIGRATIONS_DIR, asegurarAuthStandIn } from "./migrate.js";

/**
 * Runner de migraciones para una base REMOTA que persiste (Fase 1: Supabase).
 *
 * ## Por qué no alcanza `aplicarMigraciones`
 *
 * `aplicarMigraciones` corre las 10 migraciones sobre una base NUEVA cada vez (PGlite en tests): no
 * necesita registro porque nunca re-aplica. Una base desplegada es al revés —persiste—, y correr las
 * migraciones dos veces revienta: `create table`, `create type`, `create policy` y `add constraint`
 * NO son idempotentes. El propio `migrate.ts` lo anticipaba: "cuando haya base desplegada, acá va el
 * registro". Esto es ese registro.
 *
 * No crea nada distinto de lo que crean las migraciones (el esquema, los roles `amg_*`/`app_*` y la
 * RLS ya nacen en 0001/0003/0007). Su único trabajo es aplicarlas **en orden, una sola vez, de forma
 * segura y repetible** contra una conexión remota.
 */

/**
 * Una conexión RESERVADA: una sola conexión de Postgres para toda la secuencia. Es lo que impone
 * ADR-13 en el tipo: el runner hace `begin` / `<migración>` / `insert` / `commit` como llamadas
 * separadas, y las cuatro TIENEN que ir por la misma conexión. Si se aceptara un `Pool` suelto, cada
 * llamada tomaría una conexión distinta y el `begin` se iría a una, el `insert` a otra —el bug que
 * `pool.ts` documenta—. Por eso no hay constructor público: solo se obtiene de una conexión única
 * (un `pg.Client` conectado, o PGlite, que es de una sola conexión por naturaleza).
 */
export class ConexionReservada {
  private constructor(
    private readonly _exec: (sql: string) => Promise<unknown>,
    private readonly _query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>,
  ) {}

  /** SQL crudo, posiblemente multi-sentencia (una migración entera, o `begin`/`commit`). */
  exec(sql: string): Promise<unknown> {
    return this._exec(sql);
  }

  /** Una sentencia con parámetros (leer/escribir el registro, sembrar filas). */
  query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
    return this._query(sql, params) as Promise<{ rows: T[] }>;
  }

  /**
   * Desde PGlite (tests): `exec` es multi-sentencia (protocolo simple), `query` lleva parámetros.
   * PGlite es una sola conexión, así que la garantía de "misma conexión" se cumple sola.
   */
  static desdePglite(pg: {
    exec(sql: string): Promise<unknown>;
    query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  }): ConexionReservada {
    return new ConexionReservada(
      (sql) => pg.exec(sql),
      (sql, params) => pg.query(sql, params),
    );
  }

  /**
   * Desde un `Client` de `pg` YA CONECTADO (producción). Un `Client` es una única conexión; un `Pool`
   * NO se acepta a propósito —no hay factory que lo tome—, porque repartiría la transacción.
   */
  static desdeClientePg(client: {
    query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
  }): ConexionReservada {
    return new ConexionReservada(
      (sql) => client.query(sql),
      (sql, params) => client.query(sql, params),
    );
  }
}

/**
 * El registro vive en el schema `app`, no en `public`: los roles de aplicación tienen `usage` sobre
 * `app` pero **ningún grant de select sobre tablas** ahí, así que no lo ven. Eso —ownership + falta
 * de grants— es lo que lo protege.
 *
 * NO lleva `force row level security`. La versión anterior sí, "por las dudas", y era un tiro en el
 * pie: si el rol que corre las migraciones no tiene `BYPASSRLS` (el `postgres` de Supabase alojado,
 * oficialmente, no es superusuario), `force` + cero políticas = deny-all para él mismo, y el propio
 * runner no podría leer su registro. La protección correcta acá es no conceder grants, no una RLS que
 * se auto-bloquea. (10ª review externa, #9.)
 */
const REGISTRO = "app.migraciones_aplicadas";

/**
 * SHA-256 del contenido de la migración: detecta que una migración YA aplicada cambió después.
 *
 * Normaliza `\r\n` a `\n` antes de hashear. Sin esto, el mismo archivo da checksums distintos según
 * quién lo escribió a disco: git en Windows con `core.autocrlf=true` (el default de `git clone` ahí)
 * convierte los finales de línea a CRLF al hacer checkout, mientras que el blob en git y un checkout
 * en Mac/Linux quedan en LF. El contenido lógico de la migración es idéntico — el guard de más abajo
 * existe para detectar una EDICIÓN real, no una diferencia de finales de línea entre sistemas
 * operativos. Comprobado contra producción: el checksum registrado en Supabase coincide EXACTO con
 * el commit `bf3d1f7` de `0001_init.sql` normalizado a LF; el "cambio" que reportaba este runner en
 * Windows era enteramente CRLF.
 */
export function checksumDe(sql: string): string {
  return createHash("sha256").update(sql.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

/**
 * Aplica las migraciones pendientes contra `con`, en orden, cada una en su propia transacción, y las
 * anota en el registro con su checksum. Devuelve los nombres de las que aplicó en ESTA corrida (`[]`
 * si no había pendientes). Es idempotente: correrlo de nuevo no re-aplica nada.
 *
 * Si una migración YA aplicada tiene un checksum distinto del archivo actual (alguien la editó
 * después de aplicarla), **aborta**: re-aplicarla en silencio dejaría bases divergentes. Editar una
 * migración aplicada es un error de proceso, no algo que el runner deba "arreglar" corriéndola otra vez.
 */
export async function migrarConRegistro(
  con: ConexionReservada,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  // Esta fase (stand-in de `auth.users`, crear el schema/registro, leer lo ya aplicado) corre ANTES
  // del bucle de abajo, así que ninguna migración se tocó todavía. Sin envolverla, un fallo acá sale
  // del `catch` del CLI (`db/src/cli/deploy.ts`) como el error crudo del driver de `pg` — algo como
  // "permission denied for schema app"— sin decir en qué ETAPA del despliegue pasó, a diferencia de
  // un fallo dentro del bucle, que ya viene envuelto con el nombre del archivo. Quien lo lee no puede
  // distinguir "no llegó a aplicar nada" de "aplicó 3 migraciones y la 4ª rompió el esquema a medias":
  // son dos situaciones con remedios distintos, y el mensaje crudo no las separa.
  let yaAplicadas: Map<string, string>;
  try {
    // La 0012 asume que `auth.users` existe (ver migrate.ts, `asegurarAuthStandIn`). En Supabase real
    // esto es un no-op (`if not exists`); en PGlite (deploy.test.ts) es lo único que lo crea — este
    // runner NO pasa por `aplicarMigraciones`, así que necesita la misma garantía por su cuenta.
    await asegurarAuthStandIn(con);

    await con.exec(`
      create schema if not exists app;
      create table if not exists ${REGISTRO} (
        nombre       text primary key,
        checksum     text not null,
        aplicada_en  timestamptz not null default now()
      );
    `);

    const { rows } = await con.query<{ nombre: string; checksum: string }>(
      `select nombre, checksum from ${REGISTRO}`,
    );
    yaAplicadas = new Map(rows.map((r) => [r.nombre, r.checksum]));
  } catch (e) {
    throw new Error(
      `Falló preparando el registro de migraciones, antes de aplicar ninguna: ${(e as Error).message}`,
      { cause: e },
    );
  }

  const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
  const nuevas: string[] = [];

  for (const archivo of archivos) {
    const sql = await readFile(join(MIGRATIONS_DIR, archivo), "utf8");
    const checksum = checksumDe(sql);

    const aplicado = yaAplicadas.get(archivo);
    if (aplicado !== undefined) {
      if (aplicado !== checksum) {
        throw new Error(
          `La migración ${archivo} ya se aplicó pero su contenido CAMBIÓ (checksum distinto). ` +
            `Editar una migración aplicada deja bases divergentes: revertí el cambio o escribí una ` +
            `migración nueva.`,
        );
      }
      log(`= ${archivo} (ya aplicada)`);
      continue;
    }

    // Cada migración en SU transacción: si una falla no deja el esquema a medias, y la fila del
    // registro se escribe en el mismo commit que sus cambios (o no se escribe si algo lanza). El
    // insert va DENTRO de la transacción a propósito: si estuviera fuera, un commit del esquema
    // seguido de una caída antes del insert dejaría la migración aplicada y sin registrar — y la
    // próxima corrida la re-aplicaría y reventaría.
    await con.exec("begin");
    try {
      await con.exec(sql);
      await con.query(`insert into ${REGISTRO} (nombre, checksum) values ($1, $2)`, [archivo, checksum]);
      await con.exec("commit");
    } catch (e) {
      await con.exec("rollback");
      throw new Error(`La migración ${archivo} falló y se revirtió: ${(e as Error).message}`, {
        cause: e,
      });
    }

    log(`+ ${archivo}`);
    nuevas.push(archivo);
  }

  return nuevas;
}

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
 * eso nunca se migra dentro de `db/migrations/`. En PGlite (tests), que arranca completamente
 * vacío, esto es lo ÚNICO que lo crea: sin él, la 0012 falla con "relation auth.users does not
 * exist".
 *
 * ## Por qué hay un `if` y no un `create ... if not exists` pelado
 *
 * Porque el `if not exists` NO es un no-op en Supabase, y este comentario afirmaba que sí lo era
 * **sin haberlo medido nunca contra Supabase**. Medido el 2026-08-07, en el primer despliegue real
 * que pasó por acá: el schema `auth` existe y pertenece a `supabase_auth_admin`, y nuestro rol de
 * admin (el `postgres` del proyecto) no tiene `usage` sobre él. **Para evaluar el `if not exists` de
 * la tabla, Postgres igual tiene que mirar DENTRO del schema**, así que la sentencia aborta con
 * `permission denied for schema auth` — y como esto corre ANTES del bucle de migraciones, el
 * despliegue entero moría sin aplicar ni una, y sin decir en qué punto.
 *
 * El `if` consulta `pg_class`/`pg_namespace`, que son catálogos del sistema y **se leen sin `usage`
 * sobre el schema**: por eso la comprobación funciona donde el `create` no. En Supabase la tabla ya
 * está, el `if` da falso y no se toca nada — ahora sí, de verdad, un no-op.
 *
 * Se llama desde LOS DOS runners que aplican migraciones (`aplicarMigraciones` acá abajo, y
 * `migrarConRegistro` en `deploy.ts`): cualquiera de los dos puede ser el primero en tocar la 0012,
 * y varios tests de este paquete corren `aplicarMigraciones` directo sobre un PGlite propio, sin
 * pasar por `TestDb.create()` (`store.test.ts`, `cache.test.ts`, `task-log.test.ts`).
 */
export async function asegurarAuthStandIn(db: Ejecutor): Promise<void> {
  await db.exec(`
    do $$
    begin
      if not exists (
        select 1
          from pg_class c
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'auth' and c.relname = 'users'
      ) then
        create schema if not exists auth;
        create table auth.users (
          id                 uuid primary key default gen_random_uuid(),
          email              text,
          raw_app_meta_data  jsonb not null default '{}'::jsonb,
          created_at         timestamptz not null default now()
        );
      end if;
    end $$;
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

/** El prefijo numérico `NNNN` de `NNNN_nombre.sql`, como número. Lanza si el archivo no lo tiene —
 *  mejor un error temprano que comparar strings y fallar en silencio con un orden torcido. */
function numeroDeMigracion(nombreArchivo: string): number {
  const m = /^(\d{4})_/.exec(nombreArchivo);
  if (!m) throw new Error(`Migración sin prefijo numérico de 4 dígitos: ${nombreArchivo}`);
  return Number(m[1]);
}

/**
 * Aplica solo las migraciones con número `<= n` (mismo orden alfabético que `aplicarMigraciones`),
 * incluido el stand-in de `auth.users`.
 *
 * Existe para un caso puntual: un test de backfill necesita una base "detenida" ANTES de que la
 * migración que agrega una columna exista, para poder insertar una fila que la migración de al lado
 * tiene que rellenar — el mismo patrón que ya vivía copiado, inline, en `store.test.ts` y
 * `seed-contrato.test.ts` (filtrar `readdirSync(MIGRATIONS_DIR)` por prefijo y aplicar uno por uno).
 * Acá se consolida una vez para no repetirlo una tercera vez en `clientes.test.ts`
 * (`0029_clientes_vertical.sql`) — no reemplaza esos dos usos existentes, que se dejan como están.
 */
export async function aplicarMigracionesHasta(db: Ejecutor, n: number): Promise<string[]> {
  await asegurarAuthStandIn(db);
  const archivos = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => numeroDeMigracion(f) <= n);
  for (const f of archivos) {
    await db.exec(await readFile(join(MIGRATIONS_DIR, f), "utf8"));
  }
  return archivos;
}

/**
 * Aplica UNA sola migración, la de número `n` exacto. Complementa a `aplicarMigracionesHasta`: primero
 * se detiene la base en `n - 1`, se siembra el caso que hace falta probar, y recién ahí se aplica esta
 * migración sola para observar su efecto (el backfill, en el caso que la motivó).
 */
export async function aplicarMigracion(db: Ejecutor, n: number): Promise<void> {
  const archivos = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql"));
  const objetivo = archivos.find((f) => numeroDeMigracion(f) === n);
  if (!objetivo) throw new Error(`No existe ninguna migración con número ${n}`);
  await db.exec(await readFile(join(MIGRATIONS_DIR, objetivo), "utf8"));
}

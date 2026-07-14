import type { DbPool, Tx } from "./pool.js";
import type { RolConexion, TenantContext } from "./store.js";

/**
 * Utilidades de TEST. **No se exporta desde `index.ts`: no viaja al artefacto de producción.**
 *
 * `sqlCrudo()` vivía en `PgStore`. Un método que ejecuta SQL arbitrario bajo el contexto RLS del
 * usuario es precisamente la palanca que convierte un bug de la API (una ruta que llame a esto con
 * input del usuario) en ejecución de SQL. No tiene por qué estar en el binario que se despliega.
 *
 * Pero hace falta para los tests, y por una razón de fondo: probar el aislamiento **solo** a través
 * de los métodos del Store probaría que el Store es correcto, no que la BASE lo es. El modelo de
 * amenaza realista es alguien que consigue ejecutar SQL con el rol `app_user` y un contexto de
 * tenant válido. Si RLS lo frena ahí, lo frena de verdad.
 */
export async function sqlCrudo<T = Record<string, unknown>>(
  pool: DbPool,
  ctx: TenantContext,
  sql: string,
  params: unknown[] = [],
  rol: RolConexion = "app_user",
): Promise<T[]> {
  return pool.transaction(async (tx: Tx) => {
    await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
    await tx.exec(`set local role ${rol}`);
    const { rows } = await tx.query<T>(sql, params);
    return rows;
  });
}

/** Lo que un atacante vería con `select * from kr_keywords`. */
export const leerKeywordsCrudo = (pool: DbPool, ctx: TenantContext) =>
  sqlCrudo<{ id: string }>(pool, ctx, "select id from kr_keywords");

/** Lo que un atacante vería con `select * from kr_pages`. */
export const leerPaginasCrudo = (pool: DbPool, ctx: TenantContext) =>
  sqlCrudo<{ id: string }>(pool, ctx, "select id from kr_pages");

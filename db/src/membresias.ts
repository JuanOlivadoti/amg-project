import type { DbPool, Tx } from "./pool.js";
import type { RolConexion, TenantContext } from "./store.js";

/**
 * Capa de acceso de LECTURA a los miembros del tenant (pieza 2 -- Usuarios --, Etapa 1): quién
 * tiene acceso, con qué rol, y su email (de `auth.users`, vía la vista `membresias_perfil` que
 * agrega la 0012).
 *
 * Solo lectura a propósito: crear membresías y cambiar roles es la Etapa 2 de la pieza (necesita su
 * propia garantía -- "el tenant nunca se queda sin un `maestro`" -- que todavía no existe). Esta
 * clase resuelve primero la pregunta más barata, ver quién hay, sin la complejidad de escribir.
 *
 * Mismo patrón que `PgStore`/`PgClientes`: `withTenant`, `Tx`, nunca un `query()` suelto (ADR-13).
 * El `withTenant` de acá es una copia IDÉNTICA del de `clientes.ts` -- ver esa cabecera para por qué
 * la duplicación es a propósito (un dominio nuevo, su propio archivo).
 */

/**
 * Una fila de `memberships` con el email/metadata de `auth.users` ya resueltos.
 *
 * NO hay un método que devuelva "todos los miembros sin filtrar por rol": la vista
 * `membresias_perfil` (0012) YA decide, dentro de Postgres, qué filas ve quién pregunta -- staff ve
 * el tenant entero, un rol `cliente` ve solo su propia fila. `listarMiembros` nunca sabe cuál de los
 * dos casos está pasando; simplemente refleja lo que la vista dejó pasar.
 */
export interface Miembro {
  id: string;
  tenant_id: string;
  user_id: string;
  /** `user_role` (0001): `maestro` | `equipo` | `cliente` | `servicio`. */
  rol: string;
  client_id: string | null;
  created_at: string;
  /** `| null`: `auth.users.email` real puede ser null (invitación pendiente, login por teléfono). */
  email: string | null;
  raw_app_meta_data: Record<string, unknown> | null;
}

/** Las columnas de `Miembro`. Una sola definición: el select no puede quedar desalineado. */
const MIEMBRO_COLS = "id, tenant_id, user_id, rol, client_id, created_at, email, raw_app_meta_data";

export class PgMembresias {
  constructor(
    private readonly pool: DbPool,
    private readonly rol: RolConexion = "app_user",
  ) {}

  /**
   * Copiado en forma IDÉNTICA al `withTenant` de `PgStore`/`PgClientes` (ver la cabecera de
   * `clientes.ts` para por qué esta duplicación es a propósito).
   */
  private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await tx.exec(`set local role ${this.rol}`);
      return fn(tx);
    });
  }

  /**
   * Los miembros visibles para QUIEN pregunta -- no necesariamente todos los del tenant.
   *
   * La visibilidad por rol (staff ve todo el tenant; un `cliente` ve SOLO su propia fila) vive
   * ENTERA dentro de la vista `membresias_perfil` (0012), evaluada por Postgres. No hay -- ni podría
   * haber -- un `if (ctx.rol === ...)` acá: `TenantContext` no tiene un campo `rol` que leer
   * (ADR-15, el rol se DERIVA de `memberships`, nunca se declara). Un `select *` liso y llano contra
   * la vista, bajo RLS, es la implementación completa.
   */
  async listarMiembros(ctx: TenantContext): Promise<Miembro[]> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<Miembro>(
        `select ${MIEMBRO_COLS} from membresias_perfil order by created_at asc`,
      );
      return rows;
    });
  }
}

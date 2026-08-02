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

/**
 * Lo que hace falta para cambiar el rol de un miembro (Etapa 2 de la pieza).
 *
 * A propósito NO valida `rol` contra una allowlist -- esa allowlist (`maestro | equipo | cliente`,
 * rechazando `servicio`) vive en el borde HTTP (`api/src/app.ts`, mismo criterio que
 * `filtrarCamposCliente`). Acá abajo, el `::user_role` del `update` es la última red: un valor que no
 * sea un `user_role` válido revienta con 22P02, y `servicio` puntual choca con la constraint
 * `membresia_no_es_servicio` (0003) -- 23514. Las dos, el `onError` de la API ya las mapea a 400.
 */
export interface CambioRol {
  rol: string;
  /** Solo tiene efecto si `rol === 'cliente'` -- ver el comentario de `cambiarRol`. */
  clientId?: string | null;
}

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

  /**
   * Cambia el rol de un miembro. Devuelve `false` si el `update` no tocó ninguna fila -- nunca
   * lanza un error genérico (mismo patrón que `actualizarCliente`/`approvePage`). Bajo RLS, un
   * `userId` de OTRO tenant no matchea ninguna fila (`membership_update.using` lo filtra): 0 filas
   * es la respuesta correcta, no una excepción.
   *
   * Quién puede llegar a que esto devuelva `true` lo decide LA MIGRACIÓN (0012, política
   * `membership_update`), no esta clase: `using` deja "ver" la fila a cualquiera del mismo tenant,
   * pero `with check` exige `app.rol_propio_sin_recursion() = 'maestro'` -- un `equipo` que llame
   * esto para otro usuario dispara un 42501 real (Postgres lo lanza, no lo silencia), que el
   * `onError` de la API mapea a 403. Ver el comentario de esa política para el porqué exacto de
   * `using` vs `with check`.
   *
   * `client_id` se fuerza a `null` en TypeScript cuando `datos.rol !== 'cliente'` -- si no, cambiar
   * de `cliente` a `equipo` sin tocar `client_id` dejaría la fila violando
   * `cliente_exige_client_id` (0001: `rol <> 'cliente' and client_id is not null`). Es la misma
   * columna, un único `update`: no hay una segunda escritura que alguien pueda olvidar.
   */
  async cambiarRol(ctx: TenantContext, userId: string, datos: CambioRol): Promise<boolean> {
    const clientId = datos.rol === "cliente" ? (datos.clientId ?? null) : null;
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update memberships set rol = $1::user_role, client_id = $2 where user_id = $3 returning id`,
        [datos.rol, clientId, userId],
      );
      return rows.length > 0;
    });
  }
}

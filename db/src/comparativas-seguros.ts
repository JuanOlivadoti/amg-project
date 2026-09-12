import type { DbPool, Tx } from "./pool.js";
import type { TenantContext } from "./store.js";

/**
 * Una opción de seguro dentro de una comparativa: una cotización de una aseguradora. El mismo shape
 * que produce el provider de LLM (`api/src/comparativas/provider.ts`, Task 4) -- se declara ACÁ y no
 * ahí porque `db/` no puede importar de `api/`, y así hay una sola definición en vez de dos que
 * derivan sin que nada avise. Task 4 importa este tipo desde `db`.
 */
export interface OpcionSeguro {
  aseguradora: string;
  producto: string;
  prima: number;
  cobertura: string;
  condiciones: string | null;
  notas: string | null;
}

/**
 * Una fila de `comparativas_seguros`, tal como la ve el portal.
 *
 * ⚠️ NO confundir con `Comparativa` (Task 4, `api/src/comparativas/provider.ts`): esa es lo que
 * devuelve el LLM -- sin `id`, sin timestamps, sin el gate de revisión. Esta es la fila persistida,
 * con dueño en Postgres. El endpoint de Task 6 convierte la primera en la segunda al crear.
 */
export interface ComparativaSeguros {
  id: string;
  clientId: string;
  creadoPor: string;
  clienteFinalNombre: string;
  clienteFinalEmail: string | null;
  opciones: OpcionSeguro[];
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
  costoUsd: number;
  /** `null` = pendiente de revisión. Los dos viajan juntos: lo impone un `check` de la tabla. */
  revisadoEn: string | null;
  revisadoPor: string | null;
  createdAt: string;
}

/** Lo que el endpoint le pasa a `crear`. NO lleva `creadoPor`: sale de `ctx.userId`, nunca del body. */
export interface DatosComparativa {
  clienteFinalNombre: string;
  clienteFinalEmail: string | null;
  opciones: OpcionSeguro[];
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
  costoUsd: number;
}

const COLS =
  "id, client_id, creado_por, cliente_final_nombre, cliente_final_email, opciones, recomendacion, " +
  "informe_md, mail_asunto, mail_cuerpo_md, costo_usd::float8, revisado_en, revisado_por, created_at";

function aComparativa(r: {
  id: string;
  client_id: string;
  creado_por: string;
  cliente_final_nombre: string;
  cliente_final_email: string | null;
  opciones: OpcionSeguro[];
  recomendacion: string;
  informe_md: string;
  mail_asunto: string;
  mail_cuerpo_md: string;
  costo_usd: number;
  revisado_en: string | null;
  revisado_por: string | null;
  created_at: string;
}): ComparativaSeguros {
  return {
    id: r.id,
    clientId: r.client_id,
    creadoPor: r.creado_por,
    clienteFinalNombre: r.cliente_final_nombre,
    clienteFinalEmail: r.cliente_final_email,
    opciones: r.opciones,
    recomendacion: r.recomendacion,
    informeMd: r.informe_md,
    mailAsunto: r.mail_asunto,
    mailCuerpoMd: r.mail_cuerpo_md,
    costoUsd: r.costo_usd,
    revisadoEn: r.revisado_en,
    revisadoPor: r.revisado_por,
    createdAt: r.created_at,
  };
}

/**
 * Acceso a `comparativas_seguros` bajo RLS (rol `app_user`). Mismo molde que `PgResenas`: sin `role`
 * en el constructor porque no hay ningún rol de servicio cross-tenant sobre esta tabla (a diferencia
 * de `resenas_google`/`app_resenas`) -- todo el módulo vive dentro de una petición autenticada.
 */
export class PgComparativasSeguros {
  constructor(private readonly pool: DbPool) {}

  private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await tx.exec("set local role app_user");
      return fn(tx);
    });
  }

  /**
   * Crea la comparativa. `creadoPor` sale de `ctx.userId`, NUNCA de un parámetro que venga del
   * llamador HTTP -- si `ctx.userId` faltara (no debería, para una petición autenticada de agencia),
   * la columna `not null` de la migración lo rechaza antes de que la fila exista.
   */
  async crear(ctx: TenantContext, clientId: string, datos: DatosComparativa): Promise<string> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `insert into comparativas_seguros (
           tenant_id, client_id, creado_por, cliente_final_nombre, cliente_final_email,
           opciones, recomendacion, informe_md, mail_asunto, mail_cuerpo_md, costo_usd
         ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)
         returning id`,
        [
          ctx.tenantId,
          clientId,
          ctx.userId ?? "",
          datos.clienteFinalNombre,
          datos.clienteFinalEmail,
          JSON.stringify(datos.opciones),
          datos.recomendacion,
          datos.informeMd,
          datos.mailAsunto,
          datos.mailCuerpoMd,
          datos.costoUsd,
        ],
      );
      return rows[0]!.id;
    });
  }

  /** Una comparativa por id. Bajo RLS, de otro tenant/cliente o inexistente → `null`, nunca lanza. */
  async obtener(ctx: TenantContext, clientId: string, id: string): Promise<ComparativaSeguros | null> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(
        `select ${COLS} from comparativas_seguros where id = $1 and client_id = $2`,
        [id, clientId],
      );
      const r = rows[0];
      return r ? aComparativa(r as Parameters<typeof aComparativa>[0]) : null;
    });
  }

  /** Todas las comparativas de un cliente, más nueva primero. */
  async listarPorCliente(ctx: TenantContext, clientId: string): Promise<ComparativaSeguros[]> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(
        `select ${COLS} from comparativas_seguros where client_id = $1 order by created_at desc`,
        [clientId],
      );
      return rows.map((r) => aComparativa(r as Parameters<typeof aComparativa>[0]));
    });
  }

  /**
   * Cierra el gate: pone `revisado_en`/`revisado_por` juntos. `false` si la comparativa no existe,
   * es de otro tenant/cliente, o `puede_escribir()` da falso (rol `cliente`) -- nunca lanza por eso.
   * `returning id` + `rows.length`, no `rowCount` -- mismo criterio que `PgResenas.marcarVista`.
   *
   * No hay forma de "corregir" acá: el grant de la migración solo cubre estas dos columnas, así que
   * revisar es confirmar, no editar (v1 es de solo lectura tras crear -- ver la spec).
   */
  async marcarRevisada(ctx: TenantContext, clientId: string, id: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update comparativas_seguros set revisado_en = now(), revisado_por = $1
         where id = $2 and client_id = $3
         returning id`,
        [ctx.userId ?? "", id, clientId],
      );
      return rows.length > 0;
    });
  }
}

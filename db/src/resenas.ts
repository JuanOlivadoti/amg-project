import type { DbPool, Tx } from "./pool.js";

/** Una fila de `resenas_google`, tal como la ve el portal. */
export interface ResenaGoogle {
  id: string;
  clientId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
  vistaEn: string | null;
}

export interface TenantContext {
  tenantId: string;
  userId: string;
}

const COLS = "id, client_id, puntuacion, autor, texto, publicada_en, vista_en";

function aResena(r: {
  id: string;
  client_id: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicada_en: string;
  vista_en: string | null;
}): ResenaGoogle {
  return {
    id: r.id,
    clientId: r.client_id,
    puntuacion: r.puntuacion,
    autor: r.autor,
    texto: r.texto,
    publicadaEn: r.publicada_en,
    vistaEn: r.vista_en,
  };
}

/**
 * Acceso a `resenas_google` bajo RLS (rol `app_user`). Mismo molde que `PgIdeas`: sin `role` en el
 * constructor porque `app_service` (el orquestador) no tiene ningún grant sobre esta tabla -- lo
 * cross-tenant vive en `PgStore.clientesConectadosGoogle`/`registrarResenaGoogle` (Task 2), no acá.
 *
 * Orden explícito: `puntuacion asc` (1-3★ primero) y dentro de cada bucket, sin ver antes que
 * vistas, y más nueva primero. Es el orden que la spec pide para la pantalla ("1-3★ sin ver
 * primero"), impuesto en SQL y no en el portal -- así ningún consumidor nuevo lo puede pintar en
 * otro orden por accidente.
 */
export class PgResenas {
  constructor(private readonly pool: DbPool) {}

  private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await tx.exec("set local role app_user");
      return fn(tx);
    });
  }

  async listarResenas(ctx: TenantContext, clientId: string): Promise<ResenaGoogle[]> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<Record<string, unknown>>(
        `select ${COLS} from resenas_google
         where client_id = $1
         order by (vista_en is not null) asc, puntuacion asc, publicada_en desc`,
        [clientId],
      );
      return rows.map((r) => aResena(r as Parameters<typeof aResena>[0]));
    });
  }

  /**
   * `false` si la reseña no existe o no es de este cliente/tenant -- nunca lanza por eso.
   *
   * `returning id` + `rows.length`, no `rowCount`: `Tx.query` (`pool.ts`) devuelve `{ rows: T[] }`
   * únicamente -- ningún adaptador (`PglitePool`, `NodePgPool`) expone un `rowCount` en el tipo, y
   * es el mismo criterio que ya usan `cambiarEstado`/`editarIdea` en `ideas.ts`.
   */
  async marcarVista(ctx: TenantContext, clientId: string, resenaId: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update resenas_google set vista_en = now()
         where id = $1 and client_id = $2 and vista_en is null
         returning id`,
        [resenaId, clientId],
      );
      return rows.length > 0;
    });
  }
}

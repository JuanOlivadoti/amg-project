import type { DbPool, Tx } from "./pool.js";
import type { TenantContext } from "./store.js";

/**
 * El formato de `clients.google_location_id`: la v4 de reseñas direcciona por **nombre de recurso
 * completo** (`accounts/<id>/locations/<id>`), no por un id suelto.
 *
 * Vive acá, y no en quien la usa, porque la dueña del formato es la COLUMNA. Hay dos lados que lo
 * manipulan —`api/` lo ESCRIBE (un humano puede pegarlo a mano al conectar, porque las APIs de
 * descubrimiento de Google están en cuota 0) y `orchestrator/` lo LEE para armar la URL—, y dos
 * copias de la misma regex en dos paquetes divergen sin que nada avise.
 *
 * Con un id suelto la petición a Google saldría igual y volvería un 404 genérico, mucho más difícil
 * de diagnosticar que un rechazo en el momento en que alguien pega el valor.
 */
export const NOMBRE_DE_UBICACION_GOOGLE = /^accounts\/[^/\s]+\/locations\/[^/\s]+$/;

/**
 * El predicado es la superficie que se usa; la regex se exporta solo para poder aseverar sobre ella.
 * Sin `/g` a propósito: un regex global arrastra `lastIndex` entre llamadas, y con él dos
 * validaciones seguidas del MISMO valor válido darían resultados distintos.
 */
export function esNombreDeUbicacionGoogle(valor: string): boolean {
  return NOMBRE_DE_UBICACION_GOOGLE.test(valor);
}

/** Una fila de `resenas_google`, tal como la ve el portal. */
export interface ResenaGoogle {
  id: string;
  clientId: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicadaEn: string;
  vistaEn: string | null;
  /** `null` = sin borrador todavía. Generado por IA (4-5★) o editado a mano por el staff. */
  borradorRespuesta: string | null;
  /** `null` = nadie pidió publicar todavía. */
  respuestaSolicitadaEn: string | null;
  /** `null` = no publicado (nunca pedido, en curso, o el último intento falló). */
  respuestaPublicadaEn: string | null;
}

/*
 * `TenantContext` se importa de `store.ts` (mismo patrón que `ideas.ts`), NO se redeclara acá. La
 * versión anterior la duplicaba con `userId: string` (no opcional) -- una interfaz local que
 * contradecía su propio `withTenant`, que ya hacía `ctx.userId ?? ""` de manera defensiva (línea de
 * abajo). Se notó al conectar `app.ts`: el `ctx` real que deja `autenticar()` es el `TenantContext`
 * de `store.ts` (`userId?: string | null`, opcional porque el orquestador no tiene), y ese tipo más
 * ancho no encajaba en el más angosto de acá. La base de RLS no cambia -- lo único que se corrige es
 * el tipo de TypeScript para que dos módulos no describan la misma forma de dos maneras distintas.
 */

const COLS =
  "id, client_id, puntuacion, autor, texto, publicada_en, vista_en, borrador_respuesta, " +
  "respuesta_solicitada_en, respuesta_publicada_en";

function aResena(r: {
  id: string;
  client_id: string;
  puntuacion: number;
  autor: string;
  texto: string | null;
  publicada_en: string;
  vista_en: string | null;
  borrador_respuesta: string | null;
  respuesta_solicitada_en: string | null;
  respuesta_publicada_en: string | null;
}): ResenaGoogle {
  return {
    id: r.id,
    clientId: r.client_id,
    puntuacion: r.puntuacion,
    autor: r.autor,
    texto: r.texto,
    publicadaEn: r.publicada_en,
    vistaEn: r.vista_en,
    borradorRespuesta: r.borrador_respuesta,
    respuestaSolicitadaEn: r.respuesta_solicitada_en,
    respuestaPublicadaEn: r.respuesta_publicada_en,
  };
}

/**
 * Acceso a `resenas_google` bajo RLS (rol `app_user`). Mismo molde que `PgIdeas`: sin `role` en el
 * constructor porque `app_service` (el orquestador) no tiene ningún grant sobre esta tabla -- lo
 * cross-tenant vive en `PgStore.clientesConectadosGoogle`/`registrarResenaGoogle` (Task 2), no acá.
 *
 * Orden explícito, y la clave EXTERNA es `vista_en`, no `puntuacion`: primero TODAS las sin ver
 * (sin importar la puntuación, incluida una 5★), después TODAS las vistas; dentro de cada uno de
 * esos dos grupos, `puntuacion asc` (1-3★ primero) y más nueva primero. Es el orden que la spec
 * pide para la pantalla ("1-3★ sin ver primero"), impuesto en SQL y no en el portal -- así ningún
 * consumidor nuevo lo puede pintar en otro orden por accidente.
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

  /**
   * Edita el borrador de respuesta de una reseña. Mismo molde exacto que `marcarVista`: `false` sin
   * lanzar si no matchea ninguna fila (otro tenant, no existe, o `puede_escribir()` da falso para el
   * rol `cliente` — ADR-20). A diferencia de `marcarVista`, no hay `where borrador_respuesta is
   * null`: el staff puede editar un borrador ya generado por IA, o escribir uno desde cero si la
   * generación había fallado — ese es justamente el camino de recuperación manual (ver la spec).
   */
  async editarBorrador(
    ctx: TenantContext,
    clientId: string,
    resenaId: string,
    texto: string,
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update resenas_google set borrador_respuesta = $1
         where id = $2 and client_id = $3
         returning id`,
        [texto, resenaId, clientId],
      );
      return rows.length > 0;
    });
  }

  /**
   * Pide publicar el borrador de vuelta en Google (Bloque F, fase 2, segunda pieza). `false` sin
   * lanzar si la reseña no existe, es de otro cliente, no tiene borrador, ya está publicada, o
   * `puede_escribir()` da falso (ADR-20) -- el WHERE decide, no este método. Un segundo llamado
   * sobre una fila ya solicitada pero no publicada REINTENTA (pisa el timestamp de nuevo).
   */
  async solicitarPublicacion(ctx: TenantContext, clientId: string, resenaId: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update resenas_google set respuesta_solicitada_en = now()
         where id = $1 and client_id = $2
           and borrador_respuesta is not null
           and respuesta_publicada_en is null
         returning id`,
        [resenaId, clientId],
      );
      return rows.length > 0;
    });
  }

  /**
   * Conecta la cuenta de Google del cliente: escribe las tres columnas de `clients` bajo RLS
   * (`app_user`). `false` si el cliente no existe, es de otro tenant, o quien pide no puede escribir
   * -- nunca lanza por eso. ADR-20 se cumple SOLO por la política: `client_write` (0001) exige
   * `app.puede_escribir()` en su `using`, así que para el rol `cliente` el `update` no matchea
   * ninguna fila y esto devuelve `false` sin que este método sepa qué rol es quien llama.
   *
   * `returning id` + `rows.length`, no `rowCount` -- mismo motivo que `marcarVista`, arriba.
   */
  async conectarGoogle(
    ctx: TenantContext,
    clientId: string,
    datos: { refreshToken: string; locationId: string },
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update clients set google_refresh_token = $1, google_location_id = $2, google_conectado_en = now()
         where id = $3
         returning id`,
        [datos.refreshToken, datos.locationId, clientId],
      );
      return rows.length > 0;
    });
  }

  /**
   * Quema el `nonce` de un `state` de OAuth: `true` la PRIMERA vez que se ve, `false` si ya estaba
   * usado. Es lo que convierte el `state` en algo de un solo uso -- sin esto, un `state` filtrado
   * (la barra del navegador, el historial, el log de un proxy, un `Referer`) se podía reproducir
   * cuantas veces se quisiera durante su ventana de 10 minutos, y ese `state` es la ÚNICA identidad
   * con la que el callback anónimo escribe `google_refresh_token`.
   *
   * ## Por qué el replay se detecta por el ERROR 23505 y no por un `returning`
   *
   * La defensa es la PRIMARY KEY de `oauth_nonces_usados` (migración 0034), no una comprobación
   * previa: dos callbacks simultáneos con el mismo state -- la forma exacta que tiene un replay
   * automatizado -- se resuelven dentro de Postgres, no en una carrera de TypeScript. Un
   * `on conflict do nothing returning nonce` habría sido más idiomático en este repo, pero
   * `returning` exige privilegio de SELECT sobre la columna, y lo que se quería es justamente que
   * `app_user` NO pueda leer esta tabla nunca. Así que el insert va pelado y el conflicto llega como
   * excepción; cualquier otro código se re-lanza (un 23503 de tenant inexistente, por ejemplo, tiene
   * que seguir siendo un error, no un "replay" silencioso).
   *
   * El `catch` va FUERA de `withTenant` a propósito: la excepción aborta la transacción, y
   * `pool.transaction` ya se encarga del rollback antes de re-lanzar (`db/src/pool.ts`). Atraparla
   * adentro dejaría la transacción abortada y cualquier query posterior del mismo `tx` reventaría
   * con 25P02.
   *
   * La purga es el CTE `delete` SIN `where`: el where es la política `nonce_purga`, que solo deja
   * borrar filas del propio tenant y más viejas que una hora. Va en la MISMA sentencia porque es lo
   * más barato que existe (cero viajes extra, cero tarea programada, cero rol nuevo) y porque no
   * necesita ser fiable: si el insert choca, el statement entero revierte y la purga simplemente
   * ocurrirá en el próximo callback. Es limpieza, no contabilidad.
   */
  async consumirNonceOAuth(ctx: TenantContext, nonce: string): Promise<boolean> {
    try {
      await this.withTenant(ctx, async (tx: Tx) => {
        await tx.query(
          `with purga as (delete from oauth_nonces_usados)
           insert into oauth_nonces_usados (nonce, tenant_id) values ($1, $2)`,
          [nonce, ctx.tenantId],
        );
      });
      return true;
    } catch (e) {
      // 23505 = unique_violation. Es el ÚNICO código que no es un fallo: es el replay.
      if ((e as { code?: string }).code === "23505") return false;
      throw e;
    }
  }

  /** Limpia las tres columnas de conexión. Mismo criterio de `false`/RLS que `conectarGoogle`. */
  async desconectarGoogle(ctx: TenantContext, clientId: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx: Tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update clients set google_refresh_token = null, google_location_id = null, google_conectado_en = null
         where id = $1
         returning id`,
        [clientId],
      );
      return rows.length > 0;
    });
  }
}

import type { DbPool, Tx } from "./pool.js";
import type { TenantContext } from "./store.js";

/**
 * Capa de acceso a las IDEAS: los audios que el cliente le manda a la agencia, ya transcritos y
 * analizados, que la agencia revisa y aprueba o rechaza (pieza 3 del portal, Etapa 2).
 *
 * Esquema: `db/migrations/0013_ideas.sql`. Plan:
 * `docs/superpowers/plans/2026-08-01-modulo-ideas-portal.md`.
 *
 * ## Lo que esta clase NO hace
 *
 * **No autoriza.** No hay —ni puede haber— un `if (ctx.rol === "cliente")` acá: `TenantContext` no
 * tiene un campo `rol` que leer (ADR-15, el rol se DERIVA de `memberships` dentro de Postgres). Quién
 * ve qué idea y quién puede tocarla lo deciden `idea_select` e `idea_update` (0013), evaluadas por el
 * motor. Un `select` liso y llano bajo RLS es la implementación completa de "el cliente ve solo las
 * suyas".
 *
 * **No crea ideas.** `app_user` no tiene grant de `insert` sobre `ideas`, a propósito: el ingreso real
 * es el flujo de audio (n8n) y todavía no existe. Hasta que exista —un endpoint autenticado con
 * secreto propio, separado del token de usuario— las ideas las crea el seed de ejemplo con la
 * autoridad de la infraestructura. Que esta clase no tenga un `crearIdea` no es un olvido: es que no
 * hay a quién dárselo.
 *
 * **No borra.** Mismo motivo: sin grant de `delete`. Si algún día hace falta, se decide entonces.
 *
 * Mismo patrón que `PgStore`/`PgClientes`/`PgMembresias`: `withTenant`, `Tx`, nunca un `query()`
 * suelto (ADR-13). El `withTenant` de acá es una copia IDÉNTICA del de `clientes.ts` — ver esa
 * cabecera para por qué la duplicación es a propósito.
 */

// ---------------------------------------------------------------- la máquina de estados

/**
 * `idea_estado` (0013). Una idea nace `nueva`, la agencia la pone `en_revision` y termina `aprobada`
 * o `rechazada`.
 */
export type EstadoIdea = "nueva" | "en_revision" | "aprobada" | "rechazada";

/** En el orden del ciclo de vida, igual que el enum de Postgres. */
export const ESTADOS_IDEA = ["nueva", "en_revision", "aprobada", "rechazada"] as const satisfies readonly EstadoIdea[];

/**
 * Las transiciones válidas: `nueva → en_revision → aprobada | rechazada`.
 *
 * `aprobada` y `rechazada` son TERMINALES (lista vacía). En particular **`aprobada → nueva` no es una
 * transición** y `nueva → aprobada` tampoco: aprobar sin pasar por revisión se saltearía el producto
 * entero, que es que la agencia revisa (ADR-20).
 *
 * ## Esta es la SEGUNDA copia de la máquina, y es deliberado
 *
 * La primera vive en Postgres (`app.idea_transicion_valida`, trigger `ideas_transicion_estado`) y es
 * **la garantía**: cualquier `update` que no pase por acá —un script, un endpoint futuro, una
 * consulta a mano— la respeta igual. Esta copia existe para poder rechazar ANTES de escribir y
 * devolver un motivo que la API pueda traducir a un 400 (un 23514 del trigger sería un 500 si nadie
 * lo mapea).
 *
 * Que sean dos es un riesgo real de desincronización, así que está atado por un test que recorre los
 * 12 pares de estados distintos, los prueba contra el motor y exige que los dos veredictos coincidan
 * (`db/src/ideas.test.ts`). Mismo mecanismo con el que `cartera-portal.test.ts` ata el brief al
 * portal. Si tocás una de las dos copias sin la otra, ese test cae.
 */
export const TRANSICIONES_IDEA: Readonly<Record<EstadoIdea, readonly EstadoIdea[]>> = {
  nueva: ["en_revision"],
  en_revision: ["aprobada", "rechazada"],
  aprobada: [],
  rechazada: [],
};

/** ¿`valor` es uno de los cuatro estados? Allowlist positiva: cualquier otra cosa es `false`. */
export function esEstadoIdea(valor: unknown): valor is EstadoIdea {
  return typeof valor === "string" && (ESTADOS_IDEA as readonly string[]).includes(valor);
}

/**
 * ¿Se puede pasar de `desde` a `hacia`?
 *
 * Un estado consigo mismo da `false`: no es una transición, es un no-op. La política de la base lo
 * trata igual — el trigger lleva `when (old.estado is distinct from new.estado)`, así que un update
 * que no mueve el estado ni siquiera lo evalúa (por eso editar una idea ya aprobada sigue siendo
 * posible).
 */
export function esTransicionValida(desde: EstadoIdea, hacia: EstadoIdea): boolean {
  return TRANSICIONES_IDEA[desde].includes(hacia);
}

// ---------------------------------------------------------------- los dos recortes de lectura

/**
 * Lo que devuelve un LISTADO. Cinco campos, y ninguno es la transcripción ni el análisis.
 *
 * No es una preferencia estética: es el contrato de exposición que fija el plan (enmienda del
 * 2026-08-02). Un listado de ideas alimenta la tabla y los contadores del dashboard; mandar la
 * transcripción de cada idea al navegador para pintar un contador es filtrar el dato más sensible del
 * sistema por comodidad. Y el recorte empieza en el `select`, no en un DTO de la API: **lo que no sale
 * de Postgres no se puede olvidar de filtrar después.**
 *
 * Si una pantalla necesita un campo más, se agrega acá **a propósito** — nunca `transcripcion` ni
 * `analisis`, que tienen su propio camino (`obtenerIdea`, una idea a la vez).
 */
export interface IdeaResumen {
  id: string;
  client_id: string;
  titulo: string;
  estado: EstadoIdea;
  /** `timestamptz`: tanto PGlite como `pg` lo entregan ya parseado como `Date`. */
  creada_en: Date;
}

/** El DETALLE: una idea a la vez, abierta a propósito por alguien que la está revisando. */
export interface IdeaDetalle extends IdeaResumen {
  resumen: string | null;
  /** La voz del cliente. Superficie de inyección: se muestra como TEXTO, nunca como HTML. */
  transcripcion: string | null;
  /** URL a donde el audio ya vive. AMG OS no tiene storage: no se sube nada. */
  audio_url: string | null;
  carpeta_url: string | null;
  mensaje_de: string | null;
  /** El bloque del LLM. Siempre un objeto (lo impone un `check` en la 0013), nunca `null`. */
  analisis: Record<string, unknown>;
  actualizada_en: Date;
}

/** Las columnas del resumen. Una sola definición: el select no puede quedar desalineado. */
const COLS_RESUMEN = "id, client_id, titulo, estado, creada_en";

/** Las del detalle: el resumen más lo que solo se mira de a una. */
const COLS_DETALLE = `${COLS_RESUMEN}, resumen, transcripcion, audio_url, carpeta_url, mensaje_de,
  analisis, actualizada_en`;

// ---------------------------------------------------------------- filtros y resultados

export interface FiltrosIdeas {
  estado?: EstadoIdea;
  clientId?: string;
  /** Se acota a `[1, LIMITE_IDEAS.maximo]`. Ver `LIMITE_IDEAS`. */
  limite?: number;
}

/**
 * El techo del listado.
 *
 * **El plan no fijaba estos números**; los elige esta capa y por eso están acá, con nombre y con
 * test, en vez de escondidos en un `limit 200` dentro de una plantilla SQL. El motivo de que exista
 * un techo: sin él, un tenant con miles de ideas devuelve miles de filas en la pantalla de listado, y
 * el primero que lo note va a ser el navegador de la agencia. Si la Etapa 3 necesita otro número,
 * cambiarlo acá lo cambia en un solo sitio.
 */
export const LIMITE_IDEAS = { porDefecto: 200, maximo: 500 } as const;

/**
 * El resultado de `cambiarEstado`, explícito en vez de un `boolean`.
 *
 * Los dos fallos son distintos y la API los traduce a códigos distintos (Etapa 3): `no_encontrada` es
 * un 404 y `transicion_invalida` es un **400, no un 500** — que es justamente lo que se gana teniendo
 * la máquina también en TypeScript. Un `boolean` obligaría al llamador a adivinar cuál de los dos
 * pasó, y adivinaría mal.
 */
export type ResultadoCambioEstado =
  | { ok: true; estado: EstadoIdea }
  | { ok: false; motivo: "no_encontrada" }
  | { ok: false; motivo: "transicion_invalida"; desde: EstadoIdea };

/**
 * Lo que se puede editar de una idea.
 *
 * A propósito NO tiene `estado` (eso es `cambiarEstado`, que valida la transición), ni `tenant_id`,
 * ni `client_id`, ni `id`. Que el tipo no tenga dónde ponerlos es la primera red; la segunda es la
 * allowlist `COLUMNAS_EDITABLES` de abajo, que ignora cualquier clave que le cuelen en runtime; y la
 * tercera —la que de verdad manda— es que el `grant update` de la 0013 es **por columna** y no incluye
 * ninguna de esas cuatro: mover una idea de tenant o de cliente da 42501 desde Postgres.
 */
export interface CambiosIdea {
  titulo?: string;
  resumen?: string | null;
  transcripcion?: string | null;
  audio_url?: string | null;
  carpeta_url?: string | null;
  mensaje_de?: string | null;
  analisis?: Record<string, unknown>;
}

/** Columnas editables, en el orden en que se evalúan. `analisis` es la única jsonb: lleva cast. */
const COLUMNAS_EDITABLES = [
  "titulo",
  "resumen",
  "transcripcion",
  "audio_url",
  "carpeta_url",
  "mensaje_de",
  "analisis",
] as const;

export class PgIdeas {
  /**
   * Sin parámetro de rol, al revés que `PgStore`/`PgClientes`/`PgMembresias`.
   *
   * No es una omisión: `app_service` **no tiene ningún grant** sobre `ideas` (0013, "sin privilegios
   * especulativos"), así que un `new PgIdeas(pool, "app_service")` compilaría y reventaría con 42501
   * en la primera consulta. Que el constructor no acepte el rol es la garantía en el tipo de que solo
   * se construye como se puede usar. Si el ingreso futuro (n8n) necesita el rol del servicio, el plan
   * que lo construya agregará el grant Y este parámetro, juntos.
   */
  constructor(private readonly pool: DbPool) {}

  /**
   * Copiado en forma IDÉNTICA al `withTenant` de `PgStore`/`PgClientes` (ver la cabecera de
   * `clientes.ts` para por qué esta duplicación es a propósito).
   */
  private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await tx.exec("set local role app_user");
      return fn(tx);
    });
  }

  /**
   * Las ideas visibles para quien pregunta — no necesariamente todas las del tenant: un rol `cliente`
   * ve solo las de su negocio, y eso lo resuelve `idea_select` dentro de Postgres. No hay ningún
   * filtro por rol acá que alguien pueda olvidarse de escribir.
   *
   * RLS ya aísla por tenant, así que tampoco hay un `where tenant_id = ...` explícito (mismo criterio
   * que `listRuns` en store.ts y `listarClientes` en clientes.ts).
   *
   * El orden lleva `id desc` como desempate: sin él, dos ideas creadas en la misma transacción (el
   * seed) salen en orden arbitrario y un listado paginado podría repetir o saltearse filas.
   */
  async listarIdeas(ctx: TenantContext, filtros: FiltrosIdeas = {}): Promise<IdeaResumen[]> {
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (filtros.estado !== undefined) {
      params.push(filtros.estado);
      condiciones.push(`estado = $${params.length}::idea_estado`);
    }
    if (filtros.clientId !== undefined) {
      params.push(filtros.clientId);
      condiciones.push(`client_id = $${params.length}`);
    }

    const limite = acotarLimite(filtros.limite);
    params.push(limite);
    const where = condiciones.length > 0 ? `where ${condiciones.join(" and ")}` : "";

    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<IdeaResumen>(
        `select ${COLS_RESUMEN} from ideas ${where}
         order by creada_en desc, id desc
         limit $${params.length}`,
        params,
      );
      return rows;
    });
  }

  /**
   * Una idea con todo su contenido. `null` si no existe o no es visible — nunca lanza (mismo patrón
   * que `getRun`/`obtenerCliente`). Bajo RLS, un id de otro tenant no matchea ninguna fila: `null` es
   * la respuesta correcta y además no revela que exista en otro sitio.
   */
  async obtenerIdea(ctx: TenantContext, id: string): Promise<IdeaDetalle | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<IdeaDetalle>(`select ${COLS_DETALLE} from ideas where id = $1`, [id]);
      return rows[0] ?? null;
    });
  }

  /**
   * Mueve una idea por la máquina de estados.
   *
   * Lee el estado actual y valida ANTES de escribir, todo dentro de la MISMA transacción (`Tx`), para
   * poder distinguir "no existe" de "esa transición no se puede" y que la API conteste 404 o 400 en
   * vez de un 500 con un 23514 crudo.
   *
   * **Esa validación no es la garantía**: la garantía es el trigger `ideas_transicion_estado` de la
   * 0013, que sostiene la máquina de estados venga el `update` de donde venga. Lo de acá es para dar
   * un motivo limpio.
   *
   * ## Por qué el `select` lleva `for update` — dos cosas, las dos MEDIDAS
   *
   * 1. **Cierra la ventana de carrera.** Sin el bloqueo, entre leer el estado y escribirlo otra
   *    transacción podría moverlo, y la validación se haría sobre un estado viejo. (Con el bloqueo, la
   *    segunda espera; el trigger seguiría siendo la red final si algo se escapara.)
   * 2. **Unifica el contrato para el rol `cliente`, y esto es lo que más importa.** Postgres aplica a
   *    las filas bloqueadas **también el `using` de las políticas de UPDATE**, no solo las de SELECT.
   *    Medido contra PGlite 16.4 sobre la MISMA idea: un `equipo` obtiene 1 fila y el dueño del
   *    negocio, 0. Sin `for update`, un `cliente` pasaba el `select` (la ve por `idea_select`) y
   *    recibía `transicion_invalida` (→400) o `no_encontrada` (→404) **según qué transición pidiera**
   *    sobre una idea que en ningún caso puede tocar. Ahora recibe siempre `no_encontrada`.
   *
   * Y una corrección para quien venga leyendo: aquí decía que `for update` exige el privilegio UPDATE
   * **de tabla** y que por eso no se podía usar con un grant por columna. **Es falso, y está medido**:
   * con el grant tal como lo concede la 0013, `for update`, `for no key update` y `for share`
   * funcionan — cuando la cláusula de bloqueo no nombra columnas, Postgres comprueba si hay privilegio
   * de UPDATE sobre *alguna* columna. Lo único que queda fuera es `lock table`, que este código no usa.
   *
   * `no_encontrada` cubre entonces tres casos que al llamador le dan igual: la idea no existe, es de
   * otro tenant, o quien pregunta no puede escribirla (ADR-20: la revisa la agencia).
   */
  async cambiarEstado(ctx: TenantContext, id: string, hacia: EstadoIdea): Promise<ResultadoCambioEstado> {
    return this.withTenant(ctx, async (tx) => {
      const { rows: actuales } = await tx.query<{ estado: string }>(
        "select estado from ideas where id = $1 for update",
        [id],
      );
      const actual = actuales[0]?.estado;
      if (actual === undefined) return { ok: false, motivo: "no_encontrada" };
      if (!esEstadoIdea(actual)) {
        // Inalcanzable mientras la columna sea el enum `idea_estado`. Si alguna vez pasa, es que la
        // columna dejó de ser un enum — y eso hay que verlo, no tragárselo.
        throw new Error(`Estado desconocido en la idea ${id}: ${actual}`);
      }
      if (!esTransicionValida(actual, hacia)) {
        return { ok: false, motivo: "transicion_invalida", desde: actual };
      }

      const { rows } = await tx.query<{ estado: EstadoIdea }>(
        "update ideas set estado = $2::idea_estado where id = $1 returning estado",
        [id, hacia],
      );
      const escrito = rows[0]?.estado;
      if (escrito === undefined) return { ok: false, motivo: "no_encontrada" };
      return { ok: true, estado: escrito };
    });
  }

  /**
   * Edita el CONTENIDO de una idea (nunca su estado, nunca a quién pertenece).
   *
   * Allowlist de columnas, mismo criterio que `editPage`/`actualizarCliente`: construir el `update` a
   * partir de las claves que mande el llamador, sin pasar por una lista fija, es cómo un endpoint de
   * edición se convierte en una escalada de privilegios.
   *
   * `false` si no tocó ninguna fila — nunca un error genérico. Bajo RLS eso cubre tres casos que al
   * llamador le dan igual: la idea no existe, es de otro tenant, o quien pregunta es un rol `cliente`
   * (que ve la idea pero no la alcanza para escribir: la revisa la agencia, ADR-20).
   */
  async editarIdea(ctx: TenantContext, id: string, cambios: CambiosIdea): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of COLUMNAS_EDITABLES) {
      const v = cambios[col];
      if (v === undefined) continue;
      params.push(col === "analisis" ? JSON.stringify(v) : v);
      sets.push(col === "analisis" ? `${col} = $${params.length}::jsonb` : `${col} = $${params.length}`);
    }
    if (sets.length === 0) return false;

    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update ideas set ${sets.join(", ")} where id = $1 returning id`,
        params,
      );
      return rows.length > 0;
    });
  }
}

/**
 * Acota el límite del listado. Un `0` (o un negativo, o un `NaN` que llegue de un query param mal
 * parseado) devolvería cero filas y parecería "no hay ideas" — un bug mudo. Se acota a 1.
 */
function acotarLimite(limite: number | undefined): number {
  if (limite === undefined || !Number.isFinite(limite)) return LIMITE_IDEAS.porDefecto;
  return Math.min(Math.max(1, Math.floor(limite)), LIMITE_IDEAS.maximo);
}

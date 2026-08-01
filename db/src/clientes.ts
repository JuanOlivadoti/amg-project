import type { DbPool, Tx } from "./pool.js";
import type { RolConexion, TenantContext } from "./store.js";

/**
 * Capa de acceso a datos del CRM de clientes: las columnas de `clients` que agregó la 0011
 * (`db/migrations/0011_clientes_crm.sql`) — tipo, industria, etiquetas, nivel de actividad, estado
 * del contrato, score, a quién de la agencia está asignado, datos de contacto y origen.
 *
 * ## Por qué es una clase propia, no un agregado a `PgStore`
 *
 * `store.ts` ya tiene ~750 líneas para el dominio de `kr_runs`/`kr_pages`/`clients` (destino de
 * publicación). El patrón ya establecido para un dominio nuevo en este paquete es una clase en su
 * propio archivo — así lo hacen `PgSitios` (sitios.ts), `PgTaskLog` (task-log.ts) y `PgKeywordCache`
 * (cache.ts). Esta clase copia el `withTenant` de `PgStore` en forma IDÉNTICA (las mismas tres
 * líneas de `set_config`/`set local role`): es una pequeña duplicación a cambio de mantener el CRM
 * desacoplado del dominio de research — la misma disyuntiva que ya se resolvió así para esos otros
 * tres dominios.
 *
 * ## Por qué NO reutiliza `ClientRow` (store.ts)
 *
 * `ClientRow` es el recorte angosto que usa el pipeline de publicación (`getClient`): id, nombre,
 * destino de Storyblok, perfil de negocio. Es justo lo que un tenant necesita para publicar, y nada
 * más. Hacerlo crecer con campos de CRM (contacto, contrato, score) mezclaría dos preguntas
 * distintas — "¿a dónde publico?" vs. "¿cómo gestiono la cuenta?" — en un solo tipo, y arriesgaría
 * que un día alguien lo use donde no debería (por ejemplo, cerca del renderizador). Por eso `clients`
 * tiene DOS lecturas con DOS tipos: `ClientRow` y `ClienteCRM`, cada una con su propio alcance.
 */

/**
 * La fila completa del CRM: lo que ve la agencia de UN cliente en el portal. Todo esto es interno —
 * ninguna de estas columnas tiene grant a `app_render` (ADR-19, ver 0011).
 */
export interface ClienteCRM {
  id: string;
  nombre: string;
  tipo: string | null;
  industria: string | null;
  etiquetas: string[];
  nivel_actividad: string | null;
  estado_contrato: string;
  contrato_vence_en: string | null;
  score: number | null;
  asignado_a: string | null;
  contacto: Record<string, unknown>;
  origen: string | null;
  archived_at: string | null;
  created_at: string;
}

/**
 * Lo que hace falta para dar de alta un cliente.
 *
 * A PROPÓSITO no tiene un campo `tenantId` (ni `tenant_id`): el tenant sale SIEMPRE de
 * `ctx.tenantId` (ADR-15), nunca de lo que mande el llamador. Que el tipo no tenga dónde ponerlo es
 * la garantía del compilador — no un `if` que lo descarte en runtime. `crearCliente` además nunca
 * LEE una clave `tenantId` del objeto que recibe, así que aunque un caller real (un handler HTTP
 * parseando JSON sin tipos, en la Etapa 3) le cuele una, no tiene ningún efecto: ver el test que lo
 * verifica en `clientes.test.ts`.
 */
export interface NuevoCliente {
  nombre: string;
  tipo?: string | null;
  industria?: string | null;
  etiquetas?: string[];
  nivel_actividad?: string | null;
  estado_contrato?: string;
  contrato_vence_en?: string | null;
  score?: number | null;
  asignado_a?: string | null;
  contacto?: Record<string, unknown>;
  origen?: string | null;
}

/**
 * Lo que se puede editar de un cliente ya existente. Mismo motivo que `NuevoCliente`: sin
 * `tenantId`. Tampoco tiene `id` — el id es un parámetro APARTE de `actualizarCliente`, no una clave
 * del objeto de cambios, siguiendo el mismo criterio de allowlist que ya usa `editPage` en
 * `store.ts`.
 */
export interface CambiosCliente {
  nombre?: string;
  tipo?: string | null;
  industria?: string | null;
  etiquetas?: string[];
  nivel_actividad?: string | null;
  estado_contrato?: string;
  contrato_vence_en?: string | null;
  score?: number | null;
  asignado_a?: string | null;
  contacto?: Record<string, unknown>;
  origen?: string | null;
}

/** Las columnas de `ClienteCRM`. Una sola definición: el select no puede quedar desalineado. */
const CLIENTE_CRM_COLS = `id, nombre, tipo, industria, etiquetas, nivel_actividad, estado_contrato,
  contrato_vence_en::text as contrato_vence_en, score, asignado_a, contacto, origen,
  archived_at, created_at`;

/** Columnas editables por `actualizarCliente`, en el orden en que se evalúan. `contacto` es la
 *  única jsonb: necesita el cast explícito al armar el `set`. */
const COLUMNAS_EDITABLES = [
  "nombre",
  "tipo",
  "industria",
  "etiquetas",
  "nivel_actividad",
  "estado_contrato",
  "contrato_vence_en",
  "score",
  "asignado_a",
  "contacto",
  "origen",
] as const;

export class PgClientes {
  constructor(
    private readonly pool: DbPool,
    private readonly rol: RolConexion = "app_user",
  ) {}

  /**
   * Copiado en forma IDÉNTICA al `withTenant` de `PgStore` (store.ts, línea 207-218). Ver la
   * cabecera del archivo para por qué esta duplicación es a propósito.
   */
  private withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.pool.transaction(async (tx) => {
      await tx.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
      await tx.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await tx.exec(`set local role ${this.rol}`);
      return fn(tx);
    });
  }

  /** Todos los clientes del tenant del contexto. RLS ya aísla — no hace falta un `where
   *  tenant_id = ...` explícito (mismo criterio que `listRuns`/`listAllRuns` en store.ts). */
  async listarClientes(ctx: TenantContext): Promise<ClienteCRM[]> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<ClienteCRM>(
        `select ${CLIENTE_CRM_COLS} from clients order by created_at desc`,
      );
      return rows;
    });
  }

  /**
   * Da de alta un cliente. El `tenant_id` sale de `ctx`, nunca de `datos` (ver `NuevoCliente`).
   *
   * Inserta SOLO las columnas que `datos` trae explícitamente: las que faltan quedan en su default
   * de Postgres (`etiquetas: '{}'`, `estado_contrato: 'sin_contrato'`, `contacto: '{}'`, definidos en
   * la 0011). Si en cambio siempre insertara las once columnas mandando `null` para las que faltan,
   * pisaría esos defaults con `null` — que es justo lo que la 0011 (y su test en
   * `clientes.test.ts`) dice que NO tiene que pasar al dar de alta un cliente nuevo.
   */
  async crearCliente(ctx: TenantContext, datos: NuevoCliente): Promise<string> {
    return this.withTenant(ctx, async (tx) => {
      const columnas: string[] = ["tenant_id", "nombre"];
      const valores: unknown[] = [ctx.tenantId, datos.nombre];

      const opcionales: Array<[string, unknown]> = [
        ["tipo", datos.tipo],
        ["industria", datos.industria],
        ["etiquetas", datos.etiquetas],
        ["nivel_actividad", datos.nivel_actividad],
        ["estado_contrato", datos.estado_contrato],
        ["contrato_vence_en", datos.contrato_vence_en],
        ["score", datos.score],
        ["asignado_a", datos.asignado_a],
        ["contacto", datos.contacto ? JSON.stringify(datos.contacto) : undefined],
        ["origen", datos.origen],
      ];
      for (const [col, val] of opcionales) {
        if (val === undefined) continue;
        columnas.push(col);
        valores.push(val);
      }

      const marcadores = columnas
        .map((col, i) => (col === "contacto" ? `$${i + 1}::jsonb` : `$${i + 1}`))
        .join(", ");

      const { rows } = await tx.query<{ id: string }>(
        `insert into clients (${columnas.join(", ")}) values (${marcadores}) returning id`,
        valores,
      );
      return rows[0]!.id;
    });
  }

  /**
   * Edita un cliente existente. Allowlist de columnas (mismo criterio que `editPage` en
   * store.ts): construir el `update` a partir de las claves que mande el llamador, sin pasar por
   * una lista fija, es cómo un endpoint de edición se convierte en una escalada de privilegios.
   *
   * Devuelve `false` si el `update` no tocó ninguna fila — nunca lanza un error genérico. Bajo RLS,
   * un `id` de OTRO tenant no matchea ninguna fila: 0 filas es la respuesta correcta (mismo patrón
   * que `approvePage`/`editPage`).
   */
  async actualizarCliente(ctx: TenantContext, id: string, cambios: CambiosCliente): Promise<boolean> {
    const sets: string[] = [];
    const params: unknown[] = [id];
    for (const col of COLUMNAS_EDITABLES) {
      const v = cambios[col];
      if (v === undefined) continue;
      params.push(col === "contacto" ? JSON.stringify(v) : v);
      sets.push(col === "contacto" ? `${col} = $${params.length}::jsonb` : `${col} = $${params.length}`);
    }
    if (sets.length === 0) return false;

    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update clients set ${sets.join(", ")} where id = $1 returning id`,
        params,
      );
      return rows.length > 0;
    });
  }

  /** Archiva el cliente (`archived_at = now()`). `false` si el id no matchea (otro tenant o no
   *  existe) — mismo patrón de retorno que `actualizarCliente`. */
  async archivarCliente(ctx: TenantContext, id: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "update clients set archived_at = now() where id = $1 returning id",
        [id],
      );
      return rows.length > 0;
    });
  }

  /** Reabre un cliente archivado (`archived_at = null`). Mismo patrón de retorno. */
  async desarchivarCliente(ctx: TenantContext, id: string): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        "update clients set archived_at = null where id = $1 returning id",
        [id],
      );
      return rows.length > 0;
    });
  }
}

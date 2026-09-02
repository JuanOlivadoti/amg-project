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

/** El rubro del cliente (0029). Dos valores hoy; agregar un tercero es un ADR, no un `if`. */
export type Vertical = "restauracion" | "correduria_seguros";

/**
 * La fila completa del CRM: lo que ve la agencia de UN cliente en el portal. Todo esto es interno —
 * ninguna de estas columnas tiene grant a `app_render` (ADR-19, ver 0011).
 */
export interface ClienteCRM {
  id: string;
  nombre: string;
  /** NO enmascarada, a diferencia de `tipo`/`industria` (clasificación interna de la agencia):
   *  `vertical` es un atributo de PRODUCTO — el propio portal del cliente lo necesita para saber qué
   *  formulario y qué secciones mostrarle — no una nota del CRM. Nunca `| null`: la columna es `not
   *  null` (0029) y esta lectura no la enmascara para ningún rol. */
  vertical: Vertical;
  tipo: string | null;
  industria: string | null;
  /** `| null`: además del array vacío del default, un rol `cliente` la ve enmascarada (ver
   *  `CLIENTE_CRM_MASKED_COLS`) — no solo el equipo puede recibir `null` acá. */
  etiquetas: string[] | null;
  nivel_actividad: string | null;
  /** `| null` por el mismo motivo que `etiquetas`: enmascarada para el rol `cliente`, aunque el
   *  esquema (0011) le dé un default `not null` (`sin_contrato`). */
  estado_contrato: string | null;
  contrato_vence_en: string | null;
  score: number | null;
  asignado_a: string | null;
  /** `| null` por el mismo motivo: enmascarada para el rol `cliente`, aunque el default de columna
   *  sea `{}`, no `null`. */
  contacto: Record<string, unknown> | null;
  origen: string | null;
  /** NO enmascarada: a diferencia de las columnas de CRM interno, el rol `cliente` necesita saber si
   *  su propio Google Business Profile está conectado (Bloque F) para pintar el tab de reseñas. */
  google_conectado_en: string | null;
  /**
   * NO enmascaradas, a diferencia de las columnas de `CLIENTE_CRM_MASKED_COLS`: `tipo`/`url` no son
   * una nota interna de la agencia sobre el cliente, son DATO del propio blog del cliente (su propia
   * URL) — ocultárselo al rol `cliente` no protegería nada que no sepa ya (sub-proyecto 3, 0031).
   * `blog_externo_credencial` NUNCA aparece acá: no está en `ClienteCRM` porque `app_user` no tiene
   * `select` sobre esa columna (0031) — nombrarla en el `select` de abajo reventaría con
   * `permission denied` en vez de omitirla en silencio. Ver el comentario de la columna en la
   * migración.
   */
  blog_externo_tipo: string | null;
  blog_externo_url: string | null;
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
  /**
   * El rubro del cliente (`0029_clientes_vertical.sql`). REQUERIDO y no `?`: la columna es `not null`
   * SIN default (mismo criterio que `PIPELINE_MODO`), así que el compilador tiene que obligar a
   * elegirlo en cada alta — ningún caller puede "olvidarse" y dejar que un default lo decida por él,
   * porque no hay ningún default que lo decida.
   *
   * INMUTABLE tras el alta: a propósito NO está en `CambiosCliente` ni en `COLUMNAS_EDITABLES` más
   * abajo. La API todavía no expone una forma de elegirlo al crear un cliente real —eso es trabajo de
   * otra etapa de este plan—; hasta entonces, `api/src/app.ts` fija `'restauracion'` explícitamente en
   * el POST /clients de producción, la misma decisión que ya tomaban los tres caminos de datos de
   * DEMO/DEV.
   */
  vertical: Vertical;
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
  /**
   * Las tres columnas de `blog_externo_*` (0031, sub-proyecto 3). `credencial` SÍ se puede escribir
   * acá (a diferencia de `ClienteCRM`, que nunca la lee de vuelta) — mismo criterio de
   * escribir-pero-no-leer que `google_refresh_token` (0021). La validación de FORMA de `tipo` (string
   * no vacío, largo razonable) vive en el handler de `PATCH /clients/:id` (`api/src/app.ts`), no acá:
   * este tipo solo declara qué forma puede tener el valor, no lo restringe a un enum cerrado — es una
   * etiqueta libre, no un selector de lógica (ver el comentario de la columna en la migración).
   */
  blog_externo_tipo?: string | null;
  blog_externo_url?: string | null;
  blog_externo_credencial?: string | null;
}

/**
 * Las 10 columnas de `clients` que agregó la 0011 y que son notas INTERNAS de la agencia sobre el
 * cliente — nunca deben llegar sin enmascarar a un usuario con rol `cliente` leyendo su PROPIA fila.
 *
 * `client_select` (0001) es RLS **por fila**: `app.ve_cliente(id)` deja pasar la fila entera a su
 * dueño, no columna por columna. Antes de la 0011 eso era inofensivo (nombre, perfil de negocio);
 * ahora la misma fila carga además `score`, `estado_contrato`, `contacto` (que en la práctica guarda
 * notas de la agencia), etc. — fuga CRÍTICA si no se enmascara acá.
 *
 * `expr` es la expresión de columna tal cual se lee (con el cast que ya tenía `contrato_vence_en`);
 * la clave es el alias con el que sale en `ClienteCRM`.
 */
const CLIENTE_CRM_MASKED_COLS: Record<string, string> = {
  tipo: "tipo",
  industria: "industria",
  etiquetas: "etiquetas",
  nivel_actividad: "nivel_actividad",
  estado_contrato: "estado_contrato",
  contrato_vence_en: "contrato_vence_en::text",
  score: "score",
  asignado_a: "asignado_a",
  contacto: "contacto",
  origen: "origen",
};

/**
 * Las columnas de `ClienteCRM`. Una sola definición: el select no puede quedar desalineado, y no se
 * duplica entre `listarClientes` y `obtenerCliente`.
 *
 * Cada columna de `CLIENTE_CRM_MASKED_COLS` se envuelve en `case when app.es_staff() then <col> else
 * null end`: la MISMA función que ya usan las políticas RLS (`app.puede_escribir()`/`client_write`)
 * decide, dentro de Postgres, qué valor vuelve — no un `if` de TypeScript sobre `ctx`. Es a propósito
 * que la garantía viva en la consulta SQL, evaluada por una función `stable` de sesión (por eso no
 * puede ser una columna generada: esas exigen una expresión INMUTABLE) y no en un rol de conexión
 * distinto (violaría ADR-17: un solo login `app_user` para `equipo`/`maestro`/`cliente`).
 *
 * ALLOWLIST POSITIVA (`app.es_staff()`), no denylist (`current_role() = 'cliente'`): un rol NULL o
 * desconocido tiene que dar `null` acá, igual que ya hace `app.ve_cliente` (0001_init.sql) para no
 * repetir el error que esa función ya documenta ("`current_role() is distinct from 'cliente'` es
 * FALLA ABIERTO — un rol ausente concede en vez de negar"). Con `= 'cliente'`, un rol NULL caía en el
 * `else` y mostraba el CRM entero sin enmascarar — inofensivo hoy porque `client_select` ya bloquea
 * la fila para un rol NULL, pero es la mitad de una garantía que debería sostenerse sola.
 */
const CLIENTE_CRM_COLS = [
  "id",
  "nombre",
  // Sin enmascarar (ver el docblock de ClienteCRM.vertical): atributo de producto, no nota de CRM.
  "vertical",
  ...Object.entries(CLIENTE_CRM_MASKED_COLS).map(
    ([alias, expr]) => `case when app.es_staff() then ${expr} else null end as ${alias}`,
  ),
  // Sin enmascarar (ver el docblock de ClienteCRM.google_conectado_en): el rol `cliente` la necesita.
  "google_conectado_en",
  // Sin enmascarar (ver el docblock de ClienteCRM.blog_externo_tipo). `blog_externo_credencial` NO
  // aparece acá a propósito: `app_user` no tiene `select` sobre esa columna (0031).
  "blog_externo_tipo",
  "blog_externo_url",
  "archived_at",
  "created_at",
].join(", ");

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
  "blog_externo_tipo",
  "blog_externo_url",
  "blog_externo_credencial",
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

  /** Un solo cliente por id. Mismo patrón que `getRun`/`getClient` en store.ts: `rows[0] ?? null`,
   *  nunca lanza. Bajo RLS, un id de OTRO tenant no matchea ninguna fila → `null`, no un error. */
  async obtenerCliente(ctx: TenantContext, id: string): Promise<ClienteCRM | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<ClienteCRM>(
        `select ${CLIENTE_CRM_COLS} from clients where id = $1`,
        [id],
      );
      return rows[0] ?? null;
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
      // `vertical` va junto a `tenant_id`/`nombre` como columna SIEMPRE insertada, no en la lista de
      // `opcionales` de abajo: es `not null` sin default (0029), así que omitirla no es "dejarla en su
      // default" (no hay ninguno) — es un insert que Postgres va a rechazar.
      const columnas: string[] = ["tenant_id", "nombre", "vertical"];
      const valores: unknown[] = [ctx.tenantId, datos.nombre, datos.vertical];

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

  /**
   * La carta del cliente: `menu` + `menu_categorias`, tal como viven dentro de `business_profile`.
   * `[]` para cada uno si el perfil no los tiene (o no tiene perfil en absoluto) — nunca `null`: el
   * portal siempre puede pintar una lista vacía, no un hueco que hay que distinguir de un error.
   *
   * `null` (todo el retorno, no las claves de adentro) es "cliente no encontrado o no visible" —
   * mismo criterio que `obtenerCliente`.
   */
  async obtenerMenu(
    ctx: TenantContext,
    id: string,
  ): Promise<{ menu: unknown[]; menu_categorias: unknown[] } | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ menu: unknown[]; menu_categorias: unknown[] }>(
        `select coalesce(business_profile->'menu', '[]'::jsonb) as menu,
                coalesce(business_profile->'menu_categorias', '[]'::jsonb) as menu_categorias
         from clients where id = $1`,
        [id],
      );
      return rows[0] ?? null;
    });
  }

  /**
   * Reemplaza `menu` y `menu_categorias` COMPLETOS dentro de `business_profile`, sin tocar ninguna
   * otra clave del perfil (`brand`, `fotos`, etc.) ni pasar el perfil entero por `parseProfile()` —
   * ver la sección "Por qué el PATCH reemplaza el array entero" del spec.
   *
   * `coalesce(business_profile, '{}'::jsonb)` cubre el cliente recién creado, cuya columna es NULL
   * (la 0006 la agrega sin default): sin este `coalesce`, el operador `||` de jsonb sobre un operando
   * NULL da NULL — el UPDATE "funcionaría" (afecta la fila, devuelve éxito) pero el menú no quedaría
   * guardado, sin que nada lo avise. Hay un test que reproduce exactamente este caso.
   *
   * `datos.menu`/`datos.menu_categorias` llegan como `unknown[]`: ya pasaron el Zod de
   * `menuPatchSchema` en la API antes de esta llamada (frontera 2), así que acá no se vuelve a
   * validar — solo se serializa y se escribe. Igual que `contacto` en `actualizarCliente`.
   */
  async actualizarMenu(
    ctx: TenantContext,
    id: string,
    datos: { menu: unknown[]; menu_categorias: unknown[] },
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update clients
         set business_profile = coalesce(business_profile, '{}'::jsonb)
           || jsonb_build_object('menu', $1::jsonb, 'menu_categorias', $2::jsonb)
         where id = $3
         returning id`,
        [JSON.stringify(datos.menu), JSON.stringify(datos.menu_categorias), id],
      );
      return rows.length > 0;
    });
  }

  /**
   * La extensión de perfil de seguros (`numeroLicencia`/`anosExperiencia`/`redAfiliacion`), tal como
   * vive dentro de `business_profile.seguros` (validada por `perfilSegurosSchema` en
   * `web-builder/contract` ANTES de llegar acá — mismo criterio que `actualizarMenu` con
   * `menuPatchSchema`: acá no se vuelve a validar, solo se lee/escribe).
   *
   * El retorno tiene DOS niveles de `null`, y hay que distinguirlos: el de AFUERA es "cliente no
   * encontrado o no visible" (0 filas — así es como el handler HTTP decide 404, mismo criterio que
   * `obtenerCliente`); el de ADENTRO (`seguros: null`) es "el cliente existe pero no tiene la clave
   * cargada". `obtenerMenu` no tiene este problema porque coalescea sus arrays a `[]` en el propio
   * SQL, así que `rows[0]` nunca es ambiguo — `seguros` no tiene un "vacío" natural equivalente (un
   * `{}` sería indistinguible de "cargado pero sin ningún campo"), así que acá el objeto envolvente
   * es lo que separa ambos casos en vez del valor en sí.
   */
  async obtenerPerfilSeguros(
    ctx: TenantContext,
    id: string,
  ): Promise<{ seguros: Record<string, unknown> | null } | null> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ seguros: Record<string, unknown> | null }>(
        `select business_profile -> 'seguros' as seguros from clients where id = $1`,
        [id],
      );
      if (rows.length === 0) return null; // fila inexistente/ajena — la API responde 404
      return { seguros: rows[0]!.seguros ?? null }; // fila existe, el dato puede ser null igual
    });
  }

  /**
   * Reemplaza SOLO la clave `seguros` dentro de `business_profile`, sin tocar ninguna otra clave del
   * perfil (`menu`, `brand`, `fotos`, etc.) — mismo mecanismo que `actualizarMenu`, incluido el
   * `coalesce` para el cliente recién creado cuya columna `business_profile` es NULL (sin él, el `||`
   * de jsonb sobre NULL da NULL y el UPDATE "funcionaría" sin guardar nada).
   */
  async actualizarPerfilSeguros(
    ctx: TenantContext,
    id: string,
    datos: Record<string, unknown>,
  ): Promise<boolean> {
    return this.withTenant(ctx, async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update clients
         set business_profile = coalesce(business_profile, '{}'::jsonb)
           || jsonb_build_object('seguros', $1::jsonb)
         where id = $2
         returning id`,
        [JSON.stringify(datos), id],
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

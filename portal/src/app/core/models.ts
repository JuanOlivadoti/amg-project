/**
 * DTOs que espejan el JSON de la API. **No se importan de `db` ni de `api`**: el portal habla con la
 * API por HTTP y nada más (ADR-21). Duplicar estos tipos es el precio —barato— de esa frontera: el
 * front no se acopla al build del backend.
 */

export type RunStatus = 'running' | 'pending_approval' | 'approved' | 'rejected' | 'failed';

export interface RunSummary {
  id: string;
  client_id: string;
  status: RunStatus;
  prompt: string;
  schema_version: string;
  market_country: string;
  market_language: string;
  market_location_code: number;
  /**
   * Lo que la agencia pagó por el research — **el margen**, y por eso es `| null`.
   *
   * `RUN_SUMMARY_COLS` lo envuelve en `case when app.es_staff() then coste_micros_usd::int end`
   * (`db/src/store.ts`), así que la decisión de mostrarlo la toma **Postgres** derivando el rol de
   * `memberships` (ADR-15), no un `if` de la API ni una compuerta de esta pantalla. Quien no es staff
   * recibe `null` y el número nunca viaja al navegador.
   *
   * **`null` NO es cero.** Pintar `$0.00` acá afirmaría que el research salió gratis. Quien lo
   * muestre pasa por `usdDeMicros` (`core/dinero.ts`) y no pinta la línea cuando devuelve `null`.
   */
  coste_micros_usd: number | null;
  calidad_datos: Record<string, unknown>;
  config: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
}

/**
 * El informe del research ya renderizado, tal como lo devuelve `GET /runs/:id/informe` (KR-2b).
 *
 * Los dos campos son `| null` **juntos**: `null` significa «no hay informe para vos», y son DOS causas
 * indistinguibles a propósito — el run todavía no lo generó, o quien pregunta es un rol `cliente` y la
 * política `informe_staff` (0016) no le devuelve la fila. La API no revela cuál de las dos es (el informe
 * lleva el desglose de lo que la agencia le paga a DataForSEO), así que **el portal tampoco puede
 * distinguirlas, y no debe intentarlo**: las dos se cuentan con el mismo mensaje.
 *
 * Lo que sí es distinto es el **404**: ahí no hay RUN. `informe_md: null` llega con 200 y NO es un error.
 *
 * `generado_at` es un `string` ISO 8601 en UTC de verdad, no un `Date` disfrazado: `PgStore.getInforme`
 * convierte en el borde y tiene un test que lo fija. Se puede operar como cadena. (Ojo: `RunSummary`
 * created_at/finished_at NO tienen esa garantía — deuda vieja, anotada en `db/src/store.ts`.)
 */
export interface Informe {
  informe_md: string | null;
  generado_at: string | null;
}

/** Una página propuesta, tal como la ve el revisor: con su `id` y su estado de aprobación. */
export interface PaginaPropuesta {
  id: string;
  approved: boolean;
  cluster_id: string;
  tipo: string;
  page_strategy: string | null;
  url_slug: string;
  keyword_principal: string;
  keywords_secundarias: string[];
  intencion: string;
  local: boolean;
  volumen: number | null;
  dificultad: number | null;
  /** `datos_mercado` = respaldada por datos reales; cualquier otra cosa = sin validar. Ver `evidence.ts`. */
  evidencia: string;
  opportunity_score: number;
  score_confidence: number;
  seo: Record<string, unknown>;
  content_brief: Record<string, unknown>;
  preguntas_frecuentes: string[];
}

export interface Brief {
  run: RunSummary;
  pages: PaginaPropuesta[];
}

/** Lo que un humano puede corregir de una página antes de aprobarla (ADR-06). */
export interface CambiosPagina {
  url_slug?: string;
  keyword_principal?: string;
  seo?: Record<string, unknown>;
  content_brief?: Record<string, unknown>;
  preguntas_frecuentes?: string[];
}

export interface NuevoRun {
  clientId: string;
  prompt: string;
  market?: { country: string; language_code: string; location_code: number };
  maxCostMicros?: number;
  maxPages?: number;
}

/** Los tres valores que acepta `clients.tipo` (0011_clientes_crm.sql). `null` = sin clasificar. */
export type TipoCliente = 'empresa' | 'autonomo' | 'particular';

/** Los tres valores que acepta `clients.nivel_actividad`. `null` = sin medir todavía. */
export type NivelActividad = 'bajo' | 'medio' | 'alto';

/** Los tres valores que acepta `clients.estado_contrato`. La columna tiene default (nunca `null` a
 *  nivel de esquema), pero `null` SÍ es un valor real de esta API: `db/src/clientes.ts` enmascara
 *  las columnas de CRM a `null` cuando quien lee es el rol `cliente` (fix de seguridad, Etapa 7) —
 *  ver el comentario de `ClienteAgencia` más abajo. */
export type EstadoContrato = 'sin_contrato' | 'vigente' | 'vencido';

/**
 * Un cliente de la agencia (el CRM), tal como lo devuelve `GET /clients` y `GET /clients/:id`.
 * Espeja `ClienteCRM` de `db/src/clientes.ts` campo por campo — el portal NO importa ese tipo
 * (ADR-21), así que lo duplica a propósito. Nombrado `ClienteAgencia` y no `Cliente` a secas para no
 * confundirse con `ClienteApi` (el cliente HTTP en `api-core.ts`): son dos cosas completamente
 * distintas que un nombre corto haría indistinguibles a simple vista.
 *
 * Sin ningún campo del módulo de ideas (`ideasByStatus`, `totalIdeas`, etc.) — AMG OS no tiene ese
 * módulo, no hay ceros que inventar.
 *
 * `etiquetas`, `estado_contrato` y `contacto` son `| null` porque son justamente las columnas de CRM
 * interno que la base ENMASCARA a `null` cuando el que pide los datos tiene rol `cliente` — el dueño
 * de un negocio no tiene que ver las notas internas de la agencia sobre su propia cuenta. Cualquier
 * pantalla que los muestre tiene que tratarlos como opcionales, no asumir que siempre traen algo.
 */
export interface ClienteAgencia {
  id: string;
  nombre: string;
  tipo: TipoCliente | null;
  industria: string | null;
  etiquetas: string[] | null;
  nivel_actividad: NivelActividad | null;
  estado_contrato: EstadoContrato | null;
  contrato_vence_en: string | null;
  score: number | null;
  asignado_a: string | null;
  contacto: Record<string, unknown> | null;
  origen: string | null;
  archived_at: string | null;
  created_at: string;
}

/**
 * Lo que hace falta para dar de alta un cliente. Sin `id`, sin `tenant_id` — mismo criterio que en
 * la API: el tenant nunca lo manda el llamador, sale de la sesión (ADR-15).
 */
export interface NuevoClienteAgencia {
  nombre: string;
  tipo?: TipoCliente | null;
  industria?: string | null;
  etiquetas?: string[];
  nivel_actividad?: NivelActividad | null;
  estado_contrato?: EstadoContrato;
  contrato_vence_en?: string | null;
  score?: number | null;
  asignado_a?: string | null;
  contacto?: Record<string, unknown>;
  origen?: string | null;
}

/** Lo editable de un cliente existente. Mismos campos que `NuevoClienteAgencia`, todos opcionales. */
export type CambiosClienteAgencia = Partial<NuevoClienteAgencia>;

/**
 * Un miembro del tenant: una fila de `memberships` con el email de `auth.users` ya resuelto, tal
 * como la devuelve `GET /members`.
 *
 * Qué filas llegan acá **no lo decide el portal**: lo decide la vista `membresias_perfil` (0012)
 * dentro de Postgres — staff ve el tenant entero, un rol `cliente` ve solo su propia fila. Este tipo
 * describe lo que llega, no lo que se pidió.
 */
export interface Miembro {
  id: string;
  tenant_id: string;
  user_id: string;
  /** `user_role` (0001): `maestro` | `equipo` | `cliente` | `servicio`. */
  rol: string;
  client_id: string | null;
  created_at: string;
  /** Puede ser null de verdad: invitación pendiente o login por teléfono. No inventar un texto. */
  email: string | null;
  raw_app_meta_data: Record<string, unknown> | null;
}

/** Lo que `PATCH /members/:userId` acepta. `client_id` solo cuenta si el rol es `cliente`. */
export interface CambioRolMiembro {
  rol: string;
  client_id?: string | null;
}

/** La sesión que sostiene el portal: el token que la API verifica + el tenant (coordenada). */
export interface Sesion {
  accessToken: string;
  refreshToken: string;
  /** Epoch en ms en que expira el access token. */
  expiraEn: number;
  userId: string;
  email: string;
  tenantId: string;
  /**
   * Rol declarado en `app_metadata.rol`, si está. **Solo para la UI** (mostrar/ocultar lanzar y
   * aprobar). La autorización REAL la deriva RLS de `memberships` (ADR-20): si el portal se equivoca
   * y muestra un botón de más, la API lo rechaza igual. Vacío = se asume equipo (la base filtra).
   */
  rol: string;
}

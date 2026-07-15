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
  coste_micros_usd: number;
  calidad_datos: Record<string, unknown>;
  config: Record<string, unknown>;
  created_at: string;
  finished_at: string | null;
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

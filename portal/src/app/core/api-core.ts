import type { Brief, CambiosPagina, NuevoRun, RunSummary } from './models';

/** Error de la API con el status HTTP, para que la UI distinga 401 (relogin) de 403/409/500. */
export interface ApiError extends Error {
  status: number;
}

export interface ApiOpts {
  /** URL base de la API, sin barra final (p. ej. `http://localhost:3000`). */
  baseUrl: string;
  /** El access token vigente, o null. Se lee en cada request: si se refresca, la próxima ya lo usa. */
  getToken: () => string | null;
  /** El tenant activo (coordenada, no autoridad — RLS decide). */
  getTenant: () => string | null;
  /**
   * Renueva la sesión cuando la API responde 401. Devuelve `true` si consiguió un token nuevo (y
   * entonces el request se reintenta UNA vez) o `false` si no (y el 401 se propaga). El mecanismo se
   * inyecta —el core no sabe de Supabase—, pero la POLÍTICA (refrescar y reintentar una sola vez)
   * vive acá, probada. Sin este hook, un 401 se propaga tal cual.
   */
  refrescar?: () => Promise<boolean>;
  /** Inyectable para testear sin red. Por defecto, el `fetch` global. */
  fetchFn?: typeof fetch;
}

/**
 * El cliente de la API, framework-agnóstico. **Toda la lógica HTTP vive acá** (headers, parseo,
 * errores), en TypeScript puro y testeable con un `fetch` de mentira — igual que la API se testea sin
 * red. El `ApiService` de Angular es una cáscara fina encima de esto.
 */
export interface ClienteApi {
  listarRuns(clientId?: string): Promise<RunSummary[]>;
  crearRun(nuevo: NuevoRun): Promise<string>;
  verBrief(runId: string): Promise<Brief>;
  aprobarPagina(pageId: string): Promise<void>;
  editarPagina(pageId: string, cambios: CambiosPagina): Promise<void>;
  aprobarRun(runId: string): Promise<void>;
}

export function crearApi(opts: ApiOpts): ClienteApi {
  const fetchFn = opts.fetchFn ?? fetch;

  async function pedir<T>(method: string, path: string, body?: unknown, yaReintento = false): Promise<T> {
    const headers: Record<string, string> = {};
    const token = opts.getToken();
    const tenant = opts.getTenant();
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (tenant) headers['x-amg-tenant'] = tenant;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetchFn(`${opts.baseUrl}${path}`, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    // Token vencido: refrescar UNA vez y reintentar. `getToken` se relee, así que el retry ya lleva
    // el token nuevo. Una sola vez: si el refresh no alcanza, el 401 se propaga (no un bucle).
    if (res.status === 401 && opts.refrescar && !yaReintento) {
      if (await opts.refrescar()) return pedir<T>(method, path, body, true);
    }

    if (!res.ok) {
      let mensaje = `${res.status} ${res.statusText}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j?.error) mensaje = j.error;
      } catch {
        /* el cuerpo no era JSON; nos quedamos con el status */
      }
      const err = new Error(mensaje) as ApiError;
      err.status = res.status;
      throw err;
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  return {
    async listarRuns(clientId) {
      const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : '';
      const { runs } = await pedir<{ runs: RunSummary[] }>('GET', `/runs${qs}`);
      return runs;
    },
    async crearRun(nuevo) {
      const { runId } = await pedir<{ runId: string }>('POST', '/runs', nuevo);
      return runId;
    },
    verBrief(runId) {
      return pedir<Brief>('GET', `/runs/${encodeURIComponent(runId)}`);
    },
    async aprobarPagina(pageId) {
      await pedir('POST', `/pages/${encodeURIComponent(pageId)}/approve`);
    },
    async editarPagina(pageId, cambios) {
      await pedir('PATCH', `/pages/${encodeURIComponent(pageId)}`, cambios);
    },
    async aprobarRun(runId) {
      await pedir('POST', `/runs/${encodeURIComponent(runId)}/approve`);
    },
  };
}

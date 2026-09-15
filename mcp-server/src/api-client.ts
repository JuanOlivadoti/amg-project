import { refrescarSesion } from "./gotrue.js";
import { escribirSesion, estaPorVencer, leerSesion, type Sesion } from "./session.js";

export interface OpcionesApi {
  apiUrl: string;
  supabaseUrl: string;
  anonKey: string;
  fetchFn?: typeof fetch;
  ahora?: () => number;
  /** Override de la ruta de sesión, solo para tests. */
  rutaSesion?: string;
}

export type ResultadoLlamada<T> = { ok: true; datos: T } | { ok: false; mensaje: string };

/** Si falta esto de margen o menos para que venza el access token, se refresca antes de llamar. */
export const MARGEN_REFRESH_MS = 60_000;

const MSG_SIN_SESION = "Sesión no disponible. Corré `npm run mcp:login -w mcp-server`.";

/** Sesión válida y no por vencer, refrescando y persistiendo si hace falta. `null` si no se puede. */
async function sesionUtilizable(opts: OpcionesApi): Promise<Sesion | null> {
  const sesion = await leerSesion(opts.rutaSesion);
  if (!sesion) return null;

  const ahora = opts.ahora ?? Date.now;
  if (!estaPorVencer(sesion, MARGEN_REFRESH_MS, ahora)) return sesion;

  try {
    const nueva = await refrescarSesion({ supabaseUrl: opts.supabaseUrl, anonKey: opts.anonKey, fetchFn: opts.fetchFn }, sesion.refreshToken);
    await escribirSesion(nueva, opts.rutaSesion);
    return nueva;
  } catch {
    return null;
  }
}

/**
 * Llama a `api/` con la sesión guardada, refrescando el token cuando hace falta (por vencer, o ante
 * un 401) y traduciendo cada fallo al mensaje de la tabla del spec §7 — ver el comentario de cabecera
 * del archivo de test. Nunca lanza: siempre devuelve `ResultadoLlamada`, que es lo único que una tool
 * MCP le puede mostrar al usuario.
 */
export async function llamarApi<T>(
  opts: OpcionesApi,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ResultadoLlamada<T>> {
  let sesion = await sesionUtilizable(opts);
  if (!sesion) return { ok: false, mensaje: MSG_SIN_SESION };

  const fetchFn = opts.fetchFn ?? fetch;
  const pedir = (accessToken: string): Promise<Response> =>
    fetchFn(`${opts.apiUrl}${path}`, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "x-amg-tenant": (sesion as Sesion).tenantId,
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });

  let res: Response;
  try {
    res = await pedir(sesion.accessToken);
  } catch {
    return { ok: false, mensaje: `No hay API en ${opts.apiUrl}. ¿Está corriendo \`npm run dev:server -w api\`?` };
  }

  if (res.status === 401) {
    try {
      const nueva = await refrescarSesion({ supabaseUrl: opts.supabaseUrl, anonKey: opts.anonKey, fetchFn: opts.fetchFn }, sesion.refreshToken);
      await escribirSesion(nueva, opts.rutaSesion);
      sesion = nueva;
      res = await pedir(sesion.accessToken);
    } catch {
      return { ok: false, mensaje: MSG_SIN_SESION };
    }
    if (res.status === 401) return { ok: false, mensaje: MSG_SIN_SESION };
  }

  if (res.status === 503) {
    return { ok: false, mensaje: "No se puede verificar el token ahora (Supabase). Reintentá en un momento." };
  }
  if (res.status === 403 || res.status === 404) {
    return { ok: false, mensaje: "No existe o no tenés acceso." };
  }
  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, mensaje: cuerpo?.error ?? `La API respondió ${res.status}.` };
  }

  return { ok: true, datos: (await res.json()) as T };
}

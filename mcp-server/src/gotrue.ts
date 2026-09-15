import type { Sesion } from "./session.js";

/**
 * Login/refresh contra Supabase Auth (GoTrue) por su endpoint REST, sin el SDK — mismo criterio que
 * `portal/src/app/core/auth-core.ts` y la misma razón: el token es lo único que hace falta, y
 * `fetch` directo mantiene esto testeable sin red.
 */
export interface OpcionesGoTrue {
  supabaseUrl: string;
  anonKey: string;
  fetchFn?: typeof fetch;
}

interface RespuestaGoTrue {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string; app_metadata?: { tenant_id?: string } };
}

/** Mismo valor que el portal (`TIMEOUT_TOKEN_MS`): mismo endpoint, mismo modo de fallo (red muda). */
export const TIMEOUT_TOKEN_MS = 8_000;

async function postToken(opts: OpcionesGoTrue, params: string, body: unknown): Promise<RespuestaGoTrue> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(`${opts.supabaseUrl}/auth/v1/token?${params}`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: opts.anonKey },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_TOKEN_MS),
  });
  if (!res.ok) {
    let mensaje = "No se pudo iniciar sesión.";
    try {
      const j = (await res.json()) as { error_description?: string; msg?: string; error?: string };
      mensaje = j.error_description ?? j.msg ?? j.error ?? mensaje;
    } catch {
      /* cuerpo no-JSON */
    }
    throw new Error(mensaje);
  }
  return (await res.json()) as RespuestaGoTrue;
}

/**
 * `tenantId` sale de `app_metadata.tenant_id`, nunca se elige (spec §3.3). Si falta, se LANZA: no
 * hay pantalla acá que le muestre al usuario el caso "sin tenant" como hace el portal, así que una
 * sesión sin tenant escrita en disco solo produciría un 400 confuso en cada tool futura. Mejor
 * fallar una vez, fuerte, en el login.
 */
function aSesion(j: RespuestaGoTrue): Sesion {
  const tenantId = j.user.app_metadata?.tenant_id;
  if (!tenantId) {
    throw new Error(
      "Tu usuario no tiene un tenant asignado (app_metadata.tenant_id). Pedile a un administrador " +
        "que te lo asigne antes de usar el MCP de AMG OS.",
    );
  }
  const expiraEn = j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in ?? 3600) * 1000;
  return { accessToken: j.access_token, refreshToken: j.refresh_token, expiraEn, userId: j.user.id, tenantId };
}

/** Login con email + password. Lanza si Supabase rechaza la credencial o si falta el tenant. */
export async function iniciarSesion(opts: OpcionesGoTrue, email: string, password: string): Promise<Sesion> {
  const j = await postToken(opts, "grant_type=password", { email, password });
  return aSesion(j);
}

/** Renueva con el refresh token. Mismas reglas de fallo que `iniciarSesion`. */
export async function refrescarSesion(opts: OpcionesGoTrue, refreshToken: string): Promise<Sesion> {
  const j = await postToken(opts, "grant_type=refresh_token", { refresh_token: refreshToken });
  return aSesion(j);
}

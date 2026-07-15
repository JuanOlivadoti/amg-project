import type { Sesion } from './models';

/**
 * Login contra Supabase Auth (GoTrue) **por su endpoint REST**, sin el SDK.
 *
 * Por qué sin SDK: el portal solo necesita el access token (que la API verifica con el secreto del
 * proyecto) y el refresh token. El endpoint `/auth/v1/token` es estable y documentado, y hacerlo por
 * `fetch` mantiene la lógica en TypeScript puro, **testeable sin red** — la misma disciplina que el
 * resto del proyecto. Si algún día hace falta lo que el SDK trae (OAuth, magic links), se reevalúa.
 *
 * El `tenantId` NO viene de la contraseña: sale de `app_metadata.tenant_id` del usuario (un claim que
 * Supabase firma). Es la coordenada que la API pasa a RLS; si el usuario no lo tiene, el portal no
 * puede adivinarlo y lo dice.
 */

export interface AuthOpts {
  supabaseUrl: string;
  anonKey: string;
  fetchFn?: typeof fetch;
}

interface RespuestaGoTrue {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  user: { id: string; email?: string; app_metadata?: { tenant_id?: string; rol?: string } };
}

function aSesion(j: RespuestaGoTrue, emailFallback: string): Sesion {
  const expiraEn = j.expires_at ? j.expires_at * 1000 : Date.now() + (j.expires_in ?? 3600) * 1000;
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token,
    expiraEn,
    userId: j.user.id,
    email: j.user.email ?? emailFallback,
    tenantId: j.user.app_metadata?.tenant_id ?? '',
    rol: j.user.app_metadata?.rol ?? '',
  };
}

async function postToken(opts: AuthOpts, params: string, body: unknown): Promise<RespuestaGoTrue> {
  const fetchFn = opts.fetchFn ?? fetch;
  const res = await fetchFn(`${opts.supabaseUrl}/auth/v1/token?${params}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: opts.anonKey },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let mensaje = 'No se pudo iniciar sesión.';
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

/** Inicia sesión con email + contraseña. Devuelve la sesión lista para el portal. */
export async function loginConPassword(opts: AuthOpts, email: string, password: string): Promise<Sesion> {
  const j = await postToken(opts, 'grant_type=password', { email, password });
  return aSesion(j, email);
}

/** Renueva el access token con el refresh token. La UI la llama cuando el token está por vencer. */
export async function refrescarSesion(opts: AuthOpts, refreshToken: string): Promise<Sesion> {
  const j = await postToken(opts, 'grant_type=refresh_token', { refresh_token: refreshToken });
  return aSesion(j, '');
}

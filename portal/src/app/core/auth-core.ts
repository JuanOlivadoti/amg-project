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

/**
 * Lee una sesión guardada, **validando la forma**.
 *
 * Que el JSON parsee no significa que sirva: un `localStorage` manipulado, de una versión vieja o
 * simplemente `{}` producía una **sesión fantasma** —`autenticado()` en true, sin token— que dejaba
 * al portal navegando a pantallas que fallaban todas. No es un agujero de autoridad (la API/RLS
 * mandan), pero rompe el arranque. Si falta lo esencial, no hay sesión: al login.
 *
 * `tenantId` puede venir vacío a propósito: es el caso real del usuario sin `app_metadata.tenant_id`,
 * y el portal tiene que poder decirlo en vez de deslogearlo en silencio.
 */
export function parseSesion(raw: string | null): Sesion | null {
  if (!raw) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null) return null;
  const s = v as Record<string, unknown>;

  const texto = (k: string): boolean => typeof s[k] === 'string' && (s[k] as string).length > 0;
  if (!texto('accessToken') || !texto('refreshToken') || !texto('userId')) return null;
  if (typeof s['tenantId'] !== 'string') return null;
  // `expiraEn` tiene que ser un instante posible. Un negativo o un 0 no es "vencido": es basura.
  // Vencido SÍ se acepta: el refresh token suele vivir más que el access token, así que deslogear
  // por eso obligaría a re-entrar cuando el 401 lo habría resuelto solo.
  const expiraEn = s['expiraEn'];
  if (typeof expiraEn !== 'number' || !Number.isFinite(expiraEn) || expiraEn <= 0) return null;

  return {
    accessToken: s['accessToken'] as string,
    refreshToken: s['refreshToken'] as string,
    expiraEn,
    userId: s['userId'] as string,
    email: typeof s['email'] === 'string' ? s['email'] : '',
    tenantId: s['tenantId'] as string,
    rol: normalizarRol(s['rol']),
  };
}

/** Los roles que el sistema conoce (`memberships.rol`). Cualquier otra cosa: desconocido. */
const ROLES = ['maestro', 'equipo', 'cliente'] as const;

/**
 * Un rol inventado en `localStorage` no debe colarse como si fuera del dominio. No es escalada —la
 * API/RLS deciden igual— pero `esEquipo` mostraría controles de equipo por un valor arbitrario.
 * Lo desconocido se normaliza a `''`, que ya significa "no sé, asumo equipo y que filtre la base".
 */
function normalizarRol(v: unknown): string {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v) ? v : '';
}

/**
 * Cuánto se espera a que Supabase confirme una revocación antes de rendirse.
 *
 * `fetch` no tiene timeout propio: sin esto, una revocación puede quedar colgada indefinidamente.
 * No es solo prolijidad — mientras cuelga, `login` la está esperando (ver `AuthService.login`).
 */
export const TIMEOUT_REVOCACION_MS = 8_000;

/**
 * Revoca la sesión **en Supabase**, no solo en el navegador.
 *
 * Por qué existe: borrar el `localStorage` no invalida nada. El refresh token sigue siendo válido
 * del lado del servidor y **no caduca solo**, así que un "cerrar sesión" que solo limpia local deja
 * viva una credencial que puede acuñar access tokens indefinidamente. Si a alguien le roban el
 * equipo y cierra sesión desde otro lado, sin esto no pasa absolutamente nada.
 *
 * **Alcance: global.** Es el default de `POST /auth/v1/logout` sin `scope`, y es el que corresponde
 * al caso que motiva la función — el equipo robado —: revoca los refresh tokens de TODAS las
 * sesiones del usuario, no solo la de este navegador.
 *
 * **Lo que NO hace:** los access tokens ya emitidos siguen siendo válidos hasta su `exp` (una hora).
 * La API los verifica localmente contra el JWKS y no consulta a Supabase en cada request, así que la
 * revocación corta la renovación, no el acceso en curso. Cortarlo de inmediato exigiría comprobar la
 * sesión contra el servidor en cada llamada, y ese costo no se justifica acá.
 *
 * **Nunca lanza.** Revocar es best-effort: si la red está caída, el usuario tiene que quedar
 * deslogueado en su navegador igual. Devuelve si Supabase confirmó, para que quien llame pueda
 * registrarlo en vez de descubrirlo por casualidad.
 *
 * **El timeout acota la ESPERA, no el trabajo del servidor.** Abortar la conexión de este lado no
 * significa que Supabase deje de procesar una request que ya recibió: el POST puede confirmarse
 * igual del otro lado aunque acá se haya dejado de esperar. Por eso `AuthService` no solo reintenta
 * esta llamada — también hace que `login` espere a que la revocación en vuelo termine antes de pedir
 * un token nuevo (ver `revocacionEnVuelo`).
 */
export async function cerrarSesion(opts: AuthOpts, accessToken: string): Promise<boolean> {
  const fetchFn = opts.fetchFn ?? fetch;
  try {
    const res = await fetchFn(`${opts.supabaseUrl}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: opts.anonKey, authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_REVOCACION_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

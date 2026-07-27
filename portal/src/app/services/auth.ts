import { Injectable, computed, signal } from '@angular/core';
import { loginConPassword, refrescarSesion, parseSesion, cerrarSesion } from '../core/auth-core';
import type { AuthOpts } from '../core/auth-core';
import type { Sesion } from '../core/models';
import { environment } from '../../environments/environment';

const CLAVE = 'amg.sesion';

/**
 * La sesión del portal. Guarda el token y el tenant, y los expone como señales.
 *
 * `esEquipo` es **cosmético**: decide si se muestran los botones de lanzar/aprobar. La autorización
 * real la impone la API/RLS (ADR-20): si el portal se equivoca, la API responde 403. Por eso, ante la
 * duda (rol vacío), se asume equipo y se deja que la base filtre — nunca al revés, que rompería el
 * flujo principal del equipo.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _sesion = signal<Sesion | null>(this.leerGuardada());

  readonly sesion = this._sesion.asReadonly();
  readonly autenticado = computed(() => this._sesion() !== null);
  readonly email = computed(() => this._sesion()?.email ?? '');
  readonly esEquipo = computed(() => {
    const s = this._sesion();
    return s ? s.rol !== 'cliente' : false;
  });

  private readonly authOpts: AuthOpts = {
    supabaseUrl: environment.supabaseUrl,
    anonKey: environment.supabaseAnonKey,
  };

  /**
   * Generación de la sesión: cambia en cada login y en cada logout.
   *
   * Sirve **solo para el login**, que es la única operación que no tiene una sesión previa contra la
   * cual compararse — crea una nueva. Todo lo demás usa la identidad de la sesión capturada, que es
   * una guarda más fuerte (ver `hacerRefresh`).
   */
  private epoca = 0;

  async login(email: string, password: string): Promise<void> {
    const epoca = ++this.epoca;
    const sesion = await loginConPassword(this.authOpts, email, password);
    // Si mientras viajaba el login hubo un logout (u otro login), este resultado ya no es el que
    // manda: escribirlo dejaría al portal autenticado después de que el usuario cerró sesión.
    if (epoca !== this.epoca) return;
    this._sesion.set(sesion);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(sesion));
    } catch {
      /* sin localStorage (modo privado): la sesión vive en memoria y ya */
    }
  }

  /**
   * Cierra sesión de verdad: limpia el estado local **y** revoca en Supabase.
   *
   * El orden importa y es al revés de lo que parece natural: se limpia PRIMERO, de forma síncrona.
   * Si la limpieza esperara a la red, la UI quedaría autenticada mientras el `fetch` cuelga — y
   * `fetch` no tiene timeout propio, así que puede colgar indefinidamente. La revocación viaja
   * después con el token que ya se capturó; que falle no cambia nada de lo que ve el usuario.
   */
  async logout(): Promise<void> {
    const s = this._sesion();
    this.epoca++;
    this.limpiarLocal();
    if (s) await cerrarSesion(this.authOpts, s.accessToken);
  }

  /**
   * Solo el estado del navegador: nunca revoca nada en Supabase, eso es cosa de quien la llama.
   * La usan dos casos distintos: `logout`, donde la sesión sigue viva y la revocación va aparte
   * (después, sin bloquear la UI); y `hacerRefresh`, donde la sesión YA está muerta y revocar sería
   * pedirle a Supabase que invalide un refresh token que ya no sirve.
   */
  private limpiarLocal(): void {
    this._sesion.set(null);
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* sin localStorage (modo privado) */
    }
  }

  /**
   * Renueva el access token con el refresh token. La llama el cliente HTTP cuando la API responde
   * 401. Si el refresh falla (token revocado o vencido del todo), limpia el estado local —sin
   * revocar en Supabase: el refresh token ya está muerto, revocarlo no tiene sentido (ver
   * `hacerRefresh`)— y devuelve `false`: el guard mandará al login en la próxima navegación.
   *
   * En vuelo puede haber varias llamadas a la vez; se comparte una sola promesa para no disparar N
   * refrescos. Pero se comparte **solo entre llamadas de la MISMA sesión**: tras un logout y un login
   * nuevo, engancharse al refresco viejo devolvería su resultado —normalmente `false`— para una
   * sesión que sí se podía refrescar, y el cliente propagaría un 401 que no correspondía.
   */
  private refrescoEnVuelo: { sesion: Sesion; promesa: Promise<boolean> } | null = null;

  refrescar(): Promise<boolean> {
    const actual = this._sesion();
    if (!actual) return Promise.resolve(false);
    const enVuelo = this.refrescoEnVuelo;
    if (enVuelo && enVuelo.sesion === actual) return enVuelo.promesa;

    const promesa = this.hacerRefresh(actual);
    const entrada = { sesion: actual, promesa };
    this.refrescoEnVuelo = entrada;
    void promesa.finally(() => {
      // Solo limpia si sigue siendo el suyo: una promesa vieja no puede borrar una más nueva.
      if (this.refrescoEnVuelo === entrada) this.refrescoEnVuelo = null;
    });
    return promesa;
  }

  /**
   * La sesión a refrescar se recibe por parámetro y se usa como **identidad**: antes de escribir se
   * comprueba que siga siendo la sesión viva.
   *
   * Por qué identidad y no la época: la época solo cambia al *iniciar* un login o un logout, así que
   * un refresh disparado DESPUÉS de arrancar un login comparte su época y pasaría la guarda —
   * escribiendo la sesión vieja encima de la nueva. Comparar contra `actual` cubre los tres casos de
   * una vez: tras un logout `_sesion()` es `null`, tras otro login es otro objeto, y en el caso
   * normal es el mismo.
   */
  private async hacerRefresh(actual: Sesion): Promise<boolean> {
    try {
      const sesion = await refrescarSesion(this.authOpts, actual.refreshToken);
      // Si mientras refrescábamos hubo un logout o un login, este resultado está viejo: escribirlo
      // resucitaría una sesión cerrada o pisaría una nueva.
      if (this._sesion() !== actual) return false;
      // El refresh de Supabase no repite app_metadata: conservamos tenant/rol/email de la sesión viva.
      const fusion: Sesion = {
        ...sesion,
        tenantId: sesion.tenantId || actual.tenantId,
        rol: sesion.rol || actual.rol,
        email: sesion.email || actual.email,
      };
      this._sesion.set(fusion);
      try {
        localStorage.setItem(CLAVE, JSON.stringify(fusion));
      } catch {
        /* modo privado */
      }
      return true;
    } catch {
      if (this._sesion() !== actual) return false;
      // El refresh token ya no sirve —por eso estamos acá—, así que pedirle a Supabase que lo
      // revoque es una llamada que va a fallar. Solo se limpia lo local.
      this.limpiarLocal();
      return false;
    }
  }

  // Arrow functions: se pasan por referencia a `crearApi` sin perder el `this`.
  readonly getToken = (): string | null => this._sesion()?.accessToken ?? null;
  readonly getTenant = (): string | null => this._sesion()?.tenantId || null;

  private leerGuardada(): Sesion | null {
    try {
      // `parseSesion` VALIDA la forma: un localStorage viejo o manipulado no puede fabricar una
      // sesión fantasma (autenticado sin token). Ver `auth-core.ts`.
      return parseSesion(localStorage.getItem(CLAVE));
    } catch {
      return null;
    }
  }
}

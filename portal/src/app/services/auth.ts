import { Injectable, computed, signal } from '@angular/core';
import { loginConPassword, refrescarSesion, parseSesion } from '../core/auth-core';
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

  private readonly authOpts = {
    supabaseUrl: environment.supabaseUrl,
    anonKey: environment.supabaseAnonKey,
  };

  async login(email: string, password: string): Promise<void> {
    const sesion = await loginConPassword(this.authOpts, email, password);
    this._sesion.set(sesion);
    try {
      localStorage.setItem(CLAVE, JSON.stringify(sesion));
    } catch {
      /* sin localStorage (modo privado): la sesión vive en memoria y ya */
    }
  }

  logout(): void {
    this._sesion.set(null);
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      /* idem */
    }
  }

  /**
   * Renueva el access token con el refresh token. La llama el cliente HTTP cuando la API responde
   * 401. Si el refresh falla (token revocado o vencido del todo), **cierra la sesión** y devuelve
   * `false`: el guard mandará al login en la próxima navegación. En vuelo puede haber varias
   * llamadas a la vez; se comparte una sola promesa para no disparar N refrescos.
   */
  private refrescoEnVuelo: Promise<boolean> | null = null;

  refrescar(): Promise<boolean> {
    if (this.refrescoEnVuelo) return this.refrescoEnVuelo;
    this.refrescoEnVuelo = this.hacerRefresh().finally(() => {
      this.refrescoEnVuelo = null;
    });
    return this.refrescoEnVuelo;
  }

  private async hacerRefresh(): Promise<boolean> {
    const actual = this._sesion();
    if (!actual) return false;
    try {
      const sesion = await refrescarSesion(this.authOpts, actual.refreshToken);
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
      this.logout();
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

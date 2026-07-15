import { Injectable, computed, signal } from '@angular/core';
import { loginConPassword } from '../core/auth-core';
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

  // Arrow functions: se pasan por referencia a `crearApi` sin perder el `this`.
  readonly getToken = (): string | null => this._sesion()?.accessToken ?? null;
  readonly getTenant = (): string | null => this._sesion()?.tenantId || null;

  private leerGuardada(): Sesion | null {
    try {
      const raw = localStorage.getItem(CLAVE);
      return raw ? (JSON.parse(raw) as Sesion) : null;
    } catch {
      return null;
    }
  }
}

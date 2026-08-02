import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api';
import { AuthService } from './auth';
import { capacidadesDe, esStaff, rolEfectivo, type RolHumano } from '../core/capacidades';
import type { Miembro } from '../core/models';

/**
 * De dónde sale el rol que la UI usa.
 *
 * Hasta la pieza 2, el portal leía `app_metadata.rol` del token (`Sesion.rol`). Eso funcionaba solo
 * porque nada podía cambiar una membresía: el rol nacía en Supabase y ahí se quedaba. En cuanto esta
 * pieza permite cambiarlo, el token deja de ser una fuente válida — **la API no tiene credenciales de
 * Supabase** (recibe cuatro claves y ninguna es una service key), así que no puede reescribir ese
 * metadata. Un `maestro` degradado a `equipo` seguiría viendo la pantalla de un maestro hasta que
 * alguien tocara el usuario en Supabase a mano.
 *
 * No es una escalada —RLS sigue mandando y la API devuelve 403—, pero es una pantalla que miente, y
 * eso también se arregla. **El JWT aporta identidad; `memberships`, el rol.** Es ADR-15 aplicado
 * también al front.
 *
 * Mientras la resolución viaja, `rol()` devuelve lo que diga el token: cambiar la UI dos veces
 * (token → membresía) haría parpadear los botones en cada carga. Al llegar la respuesta, manda la
 * membresía, siempre — incluso si dice menos que el token.
 */
@Injectable({ providedIn: 'root' })
export class MembresiaService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  private readonly _miembros = signal<readonly Miembro[]>([]);
  /** `null` = todavía no se resolvió. Distinto de `''`, que es "resuelto: sin acceso al tenant". */
  private readonly _rol = signal<RolHumano | '' | null>(null);
  /**
   * De QUIÉN es el rol resuelto.
   *
   * El servicio es `providedIn: 'root'`: sobrevive a un logout. Sin este campo, tras salir un
   * `maestro` y entrar otra persona, el rol viejo seguiría en memoria hasta que llegara la respuesta
   * nueva — y en esa ventana la UI le mostraría a alguien los controles de otro. Atarlo a la
   * identidad hace que el estado de una sesión ajena no pueda leerse nunca, ni por un instante.
   */
  private readonly _resueltoPara = signal<string>('');
  private readonly _error = signal<string>('');

  /** La identidad viva. Todo lo derivado se compara contra esto antes de creerse el estado guardado. */
  private readonly userId = computed(() => this.auth.sesion()?.userId ?? '');

  /** `null` si lo guardado es de otra sesión: para quien lee, es indistinguible de "sin resolver". */
  private readonly rolPropio = computed<RolHumano | '' | null>(() =>
    this._resueltoPara() && this._resueltoPara() === this.userId() ? this._rol() : null,
  );

  readonly miembros = computed<readonly Miembro[]>(() =>
    this._resueltoPara() === this.userId() ? this._miembros() : [],
  );
  readonly error = this._error.asReadonly();
  readonly resuelto = computed(() => this.rolPropio() !== null);

  /** El rol efectivo, con el del token como puente mientras la membresía viaja (ver la cabecera). */
  readonly rol = computed<string>(() => this.rolPropio() ?? this.auth.sesion()?.rol ?? '');

  /** Resuelto y sin fila propia: existe en Auth pero no tiene acceso a este tenant (el `new` del origen). */
  readonly sinAcceso = computed(() => this.rolPropio() === '');

  readonly esEquipo = computed(() => esStaff(this.rol()));
  readonly capacidades = computed(() => capacidadesDe(this.rol()));

  private enVuelo: Promise<void> | null = null;

  /**
   * Trae la lista y deriva de ella el rol propio. Se comparte una sola promesa: el shell y la
   * pantalla de usuarios la piden casi a la vez y no hay razón para pedir dos veces lo mismo.
   */
  resolver(): Promise<void> {
    if (this.enVuelo) return this.enVuelo;
    const promesa = this.hacerResolver();
    this.enVuelo = promesa;
    void promesa.finally(() => {
      if (this.enVuelo === promesa) this.enVuelo = null;
    });
    return promesa;
  }

  /** Tras cambiar un rol, la lista y el rol propio quedaron viejos: se vuelven a pedir. */
  refrescar(): Promise<void> {
    this.enVuelo = null;
    return this.resolver();
  }

  private async hacerResolver(): Promise<void> {
    const userId = this.userId();
    if (!userId) return;
    try {
      const miembros = await this.api.listarMiembros();
      // Si mientras viajaba hubo un logout (o entró otra persona), este resultado ya no es de la
      // sesión viva: escribirlo le daría a alguien el rol de otro. Misma guarda de identidad que
      // usa `AuthService.hacerRefresh`, y por la misma razón.
      if (this.userId() !== userId) return;
      this._miembros.set(miembros);
      this._rol.set(rolEfectivo(miembros, userId));
      this._resueltoPara.set(userId);
      this._error.set('');
    } catch (e) {
      // Si la lista no llega, NO se inventa un rol: `_rol` sigue en `null` y `rol()` sigue dando el
      // del token. Degradar a "sin acceso" por un 500 dejaría al equipo sin sus botones por un fallo
      // de red, y promover a `maestro` sería peor todavía.
      this._error.set(e instanceof Error ? e.message : 'No se pudieron cargar los miembros.');
    }
  }

  async cambiarRol(userId: string, rol: string, clientId: string | null = null): Promise<void> {
    await this.api.cambiarRolMiembro(userId, { rol, client_id: clientId });
    await this.refrescar();
  }
}

import { Injectable, computed, signal } from '@angular/core';
import { CLASE_OSCURO, CLAVE_TEMA, parseTema, siguienteTema, temaEfectivo } from '../core/tema';
import type { Tema, TemaEfectivo } from '../core/tema';

const CONSULTA_OSCURO = '(prefers-color-scheme: dark)';

/**
 * El tema del portal: qué eligió el usuario, qué se pinta, y la clase en `<html>`.
 *
 * No usa `effect()` a propósito: `effect` exige un contexto de inyección de Angular, y estos tests
 * instancian el servicio con `new TemaService()` bajo `node:test` —el mismo patrón que `AuthService`,
 * que es lo que permite tener tests sin navegador—. La clase se aplica desde los tres únicos lugares
 * donde el tema efectivo puede cambiar: el arranque, el botón, y el cambio del sistema.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly _tema = signal<Tema>('auto');
  private readonly _sistemaPrefiereOscuro = signal(false);

  readonly tema = this._tema.asReadonly();
  readonly efectivo = computed<TemaEfectivo>(() =>
    temaEfectivo(this._tema(), this._sistemaPrefiereOscuro()),
  );

  constructor() {
    this._tema.set(parseTema(this.leerGuardado()));

    const consulta = matchMedia(CONSULTA_OSCURO);
    this._sistemaPrefiereOscuro.set(consulta.matches);
    // El listener actualiza la preferencia del SISTEMA, no el tema elegido. Si el usuario eligió
    // claro u oscuro, `temaEfectivo` ignora este valor y la pantalla no se mueve: la garantía vive
    // en esa función pura, no en un `if` acá.
    consulta.addEventListener('change', (e) => {
      this._sistemaPrefiereOscuro.set(e.matches);
      this.aplicar();
    });

    this.aplicar();
  }

  /** El ciclo del botón: auto → claro → oscuro → auto. Persiste y repinta. */
  alternar(): void {
    this._tema.set(siguienteTema(this._tema()));
    try {
      localStorage.setItem(CLAVE_TEMA, this._tema());
    } catch {
      /* sin localStorage (modo privado): el tema vive en memoria y ya */
    }
    this.aplicar();
  }

  private leerGuardado(): string | null {
    try {
      return localStorage.getItem(CLAVE_TEMA);
    } catch {
      return null;
    }
  }

  private aplicar(): void {
    document.documentElement.classList.toggle(CLASE_OSCURO, this.efectivo() === 'oscuro');
  }
}

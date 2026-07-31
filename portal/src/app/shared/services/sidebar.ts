import { Injectable, signal } from '@angular/core';

/**
 * Solo el estado del drawer mobile: el sidebar de escritorio queda siempre visible (2 ítems de
 * navegación no justifican el modo colapsado-a-íconos del template original — YAGNI).
 */
@Injectable({ providedIn: 'root' })
export class SidebarService {
  private readonly _mobileAbierto = signal(false);
  readonly mobileAbierto = this._mobileAbierto.asReadonly();

  alternarMobile(): void {
    this._mobileAbierto.update((v) => !v);
  }

  cerrarMobile(): void {
    this._mobileAbierto.set(false);
  }
}

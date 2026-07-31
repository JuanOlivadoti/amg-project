import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { TemaService } from '../../services/tema';
import { ICONO, ETIQUETA } from '../../core/tema';
import { SidebarService } from '../services/sidebar';

@Component({
  selector: 'app-header',
  template: `
    <header class="h-11 bg-superficie border-b border-borde flex items-center justify-between px-4">
      <button
        type="button"
        class="lg:hidden h-8 w-8 flex items-center justify-center text-texto-tenue hover:text-texto"
        [attr.aria-label]="sidebar.mobileAbierto() ? 'Cerrar menú' : 'Abrir menú'"
        [attr.aria-expanded]="sidebar.mobileAbierto()"
        (click)="sidebar.alternarMobile()"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <div class="ml-auto flex items-center gap-3 text-sm text-texto-tenue">
        @if (auth.autenticado()) {
          <span>{{ auth.email() }}</span>
          <button type="button" (click)="salir()" class="text-texto-tenue hover:text-texto">Salir</button>
        }
        <button
          type="button"
          (click)="tema.alternar()"
          [attr.aria-label]="ETIQUETA[tema.tema()]"
          [title]="ETIQUETA[tema.tema()]"
          class="h-11 w-11 -mr-2 flex items-center justify-center text-base leading-none text-texto-tenue hover:text-texto"
        >
          {{ ICONO[tema.tema()] }}
        </button>
      </div>
    </header>
  `,
})
export class AppHeaderComponent {
  readonly auth = inject(AuthService);
  readonly tema = inject(TemaService);
  readonly sidebar = inject(SidebarService);
  private readonly router = inject(Router);

  readonly ICONO = ICONO;
  readonly ETIQUETA = ETIQUETA;

  async salir(): Promise<void> {
    void this.auth.logout();
    await this.router.navigate(['/login']);
  }
}

import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SidebarService } from '../services/sidebar';

interface ItemNav {
  readonly etiqueta: string;
  readonly ruta: string;
  readonly icono: 'research' | 'cartera' | 'clientes';
}

const ITEMS_NAV: readonly ItemNav[] = [
  { etiqueta: 'Research', ruta: '/runs', icono: 'research' },
  { etiqueta: 'Cartera', ruta: '/cartera', icono: 'cartera' },
  { etiqueta: 'Clientes', ruta: '/clientes', icono: 'clientes' },
];

@Component({
  selector: 'app-sidebar',
  imports: [RouterLink, RouterLinkActive],
  template: `
    <aside
      class="fixed inset-y-0 left-0 z-50 w-64 bg-superficie border-r border-borde flex flex-col transition-transform lg:translate-x-0"
      [class.-translate-x-full]="!sidebar.mobileAbierto()"
    >
      <div class="h-11 flex items-center px-4 border-b border-borde">
        <span class="text-sm font-semibold text-texto">AMG OS</span>
      </div>
      <nav class="flex-1 px-2 py-3 space-y-1">
        @for (item of items; track item.ruta) {
          <a
            [routerLink]="item.ruta"
            routerLinkActive="bg-superficie-2 text-texto"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-texto-tenue hover:text-texto hover:bg-superficie-2"
            (click)="sidebar.cerrarMobile()"
          >
            @switch (item.icono) {
              @case ('research') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm9 16-4.35-4.35" />
                </svg>
              }
              @case ('cartera') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 13h4v7H3zM10 8h4v12h-4zM17 3h4v17h-4z" />
                </svg>
              }
              @case ('clientes') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M17 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M10 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 10v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
            }
            <span>{{ item.etiqueta }}</span>
          </a>
        }
      </nav>
    </aside>
  `,
})
export class AppSidebarComponent {
  readonly sidebar = inject(SidebarService);
  readonly items = ITEMS_NAV;
}

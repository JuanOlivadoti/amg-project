import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { SidebarService } from '../services/sidebar';

interface ItemNav {
  readonly etiqueta: string;
  readonly ruta: string;
  readonly icono: 'inicio' | 'cartera' | 'clientes' | 'usuarios';
}

const ITEMS_NAV: readonly ItemNav[] = [
  // Va PRIMERO en el orden del menú a propósito (Pieza 4, Dashboard): es la home del recorrido de
  // la agencia, aunque todavía no sea el destino por defecto de `/` (esa es una decisión de
  // producto aparte, ver app.routes.ts).
  { etiqueta: 'Inicio', ruta: '/inicio', icono: 'inicio' },
  // Research NO está: el research es de un cliente, y se alcanza desde su ficha
  // (`/clientes/:id/research`). Una entrada de menú global obligaba a elegir el cliente después,
  // pegando su uuid en un input.
  { etiqueta: 'Cartera', ruta: '/cartera', icono: 'cartera' },
  { etiqueta: 'Clientes', ruta: '/clientes', icono: 'clientes' },
  // Aditivo, y visible para todos: la pantalla se defiende sola. Un rol `cliente` que entre ve una
  // sola fila (la suya) porque eso es lo que la vista `membresias_perfil` le deja ver — ocultar el
  // link no autorizaría nada, y mostrarlo tampoco filtra nada.
  { etiqueta: 'Usuarios', ruta: '/usuarios', icono: 'usuarios' },
];

/**
 * El menú de la plataforma. Solo lo que es de la AGENCIA: lo que pertenece a un cliente vive en su
 * ficha (`/clientes/:id`), no acá.
 *
 * **Por qué el `!` va en `text-texto!` y no en `bg-superficie-2`, y la asimetría es el punto.**
 * Tailwind emite las utilidades por orden alfabético y, a igual especificidad, gana la última de la
 * hoja: `text-texto-tenue` (de la clase base) va después de `text-texto` (del estado activo) y lo
 * pisa. El fondo, en cambio, no compite con nada en estado normal —la base solo tiene
 * `hover:bg-superficie-2`—, así que gana solo, y pedirle un `!` enseñaría a poner `!important` por
 * reflejo.
 *
 * El defecto era real y estaba escondido: el activo se distinguía por el fondo, así que quien le
 * quitara el fondo se quedaba sin marca de activo y sin nada rojo. Lo caza `core/marca-activa.test.ts`.
 */
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
        <!-- El porqué del ! asimétrico está en el docblock del componente: acá los backticks de un
             comentario cerrarían el template literal a mitad. -->
        @for (item of items; track item.ruta) {
          <a
            [routerLink]="item.ruta"
            routerLinkActive="bg-superficie-2 text-texto!"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm text-texto-tenue hover:text-texto hover:bg-superficie-2"
            (click)="sidebar.cerrarMobile()"
          >
            @switch (item.icono) {
              @case ('inicio') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M3 11.5 12 4l9 7.5M5.5 10v9a1 1 0 0 0 1 1h4v-6h3v6h4a1 1 0 0 0 1-1v-9" />
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
              @case ('usuarios') {
                <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM12 14c-4 0-7 2-7 4.5V21h14v-2.5C19 16 16 14 12 14Z" />
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

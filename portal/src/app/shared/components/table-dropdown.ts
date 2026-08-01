import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';

const ANCHO_MENU_PX = 160;

/**
 * Menú de acciones por fila (ver/editar/archivar, lo que haga falta): un botón disparador
 * proyectado con `[boton]` y contenido de menú proyectado con `[menu]`. Genérico a propósito —
 * no sabe nada de clientes ni de ninguna otra entidad, así lo puede reusar cualquier tabla
 * (Etapas 5b-d).
 *
 * Puerto de `shared/components/common/table-dropdown` del origen, que usaba `@popperjs/core`.
 * Acá no hace falta esa dependencia, pero SÍ hace falta resolver el mismo problema que Popper
 * resuelve: el menú no puede ser `position: absolute` dentro de la fila, porque las tablas de este
 * portal envuelven el `<table>` en un contenedor `overflow-x-auto` (para el scroll horizontal en
 * mobile) — y por la regla CSS de "overflow: si un eje es auto y el otro visible, el visible pasa a
 * auto", ESE `overflow-x-auto` vuelve también `overflow-y: auto` el contenedor, y un menú
 * `absolute` queda recortado por ese scroll vertical (se vio manejando la pantalla en el
 * navegador: el menú de acciones era invisible, aunque el DOM/a11y tree lo tenía). La solución es
 * `position: fixed` con coordenadas calculadas desde `getBoundingClientRect()` del botón disparador
 * — `fixed` no lo recorta ningún ancestro con `overflow`, solo el viewport.
 */
@Component({
  selector: 'app-table-dropdown',
  host: {
    '(document:click)': 'cerrarSiFueraDelClick($event)',
    '(window:scroll)': 'cerrar()',
    '(window:resize)': 'cerrar()',
  },
  template: `
    <div class="inline-block text-left">
      <div #disparador (click)="alternar()">
        <ng-content select="[boton]" />
      </div>
      @if (abierto()) {
        <div
          class="fixed z-20 w-40 rounded-lg border border-borde bg-superficie p-1 shadow-lg"
          [style.top.px]="posicion().top"
          [style.left.px]="posicion().left"
          role="menu"
        >
          <ng-content select="[menu]" />
        </div>
      }
    </div>
  `,
})
export class TableDropdownComponent {
  private readonly elementRef = inject(ElementRef<HTMLElement>);
  private readonly disparador = viewChild.required<ElementRef<HTMLElement>>('disparador');

  readonly abierto = signal(false);
  readonly posicion = signal({ top: 0, left: 0 });

  alternar(): void {
    if (this.abierto()) {
      this.cerrar();
      return;
    }
    const rect = this.disparador().nativeElement.getBoundingClientRect();
    this.posicion.set({
      top: rect.bottom + 4,
      left: Math.max(8, rect.right - ANCHO_MENU_PX),
    });
    this.abierto.set(true);
  }

  cerrar(): void {
    this.abierto.set(false);
  }

  /** Cierra el menú si el click fue afuera del componente (botón o contenido). */
  cerrarSiFueraDelClick(evento: MouseEvent): void {
    if (this.abierto() && !this.elementRef.nativeElement.contains(evento.target as Node)) {
      this.cerrar();
    }
  }
}

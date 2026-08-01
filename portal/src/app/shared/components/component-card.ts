import { Component, input } from '@angular/core';

/**
 * Contenedor de card genérico: título opcional + descripción opcional + `<ng-content>` para el
 * cuerpo. Puerto de `shared/components/common/component-card` del origen (Angular 19 + `@Input()`),
 * traducido a `input()` y tokens semánticos. Sin lógica de dominio — lo reusan la pantalla de
 * listado (Etapa 5a) y las de crear/perfil/ver (Etapas 5b-d).
 */
@Component({
  selector: 'app-component-card',
  template: `
    <div class="rounded-2xl border border-borde bg-superficie {{ claseExtra() }}">
      @if (titulo()) {
        <div class="px-6 py-5">
          <h3 class="text-base font-medium text-texto">{{ titulo() }}</h3>
          @if (descripcion()) {
            <p class="mt-1 text-base text-texto-tenue">{{ descripcion() }}</p>
          }
        </div>
      }
      <div class="p-4 sm:p-6" [class.border-t]="!!titulo()" [class.border-borde]="!!titulo()">
        <ng-content />
      </div>
    </div>
  `,
})
export class ComponentCardComponent {
  readonly titulo = input('');
  readonly descripcion = input('');
  /** Clases utilitarias extra (márgenes, ancho, etc.) para no forzar un wrapper en cada uso. */
  readonly claseExtra = input('');
}

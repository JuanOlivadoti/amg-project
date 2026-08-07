import { Component, input } from '@angular/core';

@Component({
  selector: 'app-stat-box',
  template: `
    <div class="bg-superficie rounded-xl border border-borde p-4">
      <p class="text-xs text-texto-tenue">{{ titulo() }}</p>
      <p class="mt-1 text-2xl font-semibold text-texto">{{ valor() }}</p>
    </div>
  `,
})
export class StatBoxComponent {
  readonly titulo = input.required<string>();
  /**
   * `number | string` y no solo `number`: un KPI que **no se conoce** tiene que poder decirlo con
   * palabras (`n/d`) en vez de con un cero. Quien decide qué palabra es la pantalla —este componente
   * es presentacional y no inventa texto—, pero el tipo es lo que le deja la puerta abierta. Ver
   * `core/dinero.ts` para por qué un coste ausente no es un coste de cero.
   */
  readonly valor = input.required<number | string>();
}

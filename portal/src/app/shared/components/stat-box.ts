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
  readonly valor = input.required<number>();
}

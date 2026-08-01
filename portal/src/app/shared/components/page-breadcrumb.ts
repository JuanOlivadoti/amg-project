import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Título de pantalla + link "volver" opcional. Puerto de
 * `shared/components/common/page-breadcrumb` del origen — acá con `routerLink` real (Angular
 * Router) en vez del `routerLink` de string plano del origen, y sin link cuando no hace falta
 * volver a ningún lado (`rutaAtras()` en `null`).
 */
@Component({
  selector: 'app-page-breadcrumb',
  imports: [RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      <h2 class="text-xl font-semibold text-texto">{{ titulo() }}</h2>
      @if (rutaAtras()) {
        <nav>
          <ol class="flex items-center gap-1.5 text-sm text-texto-tenue">
            <li>
              <a [routerLink]="rutaAtras()" class="inline-flex items-center gap-1.5 hover:text-texto">
                {{ etiquetaAtras() }}
              </a>
            </li>
            <li class="text-texto">{{ titulo() }}</li>
          </ol>
        </nav>
      }
    </div>
  `,
})
export class PageBreadcrumbComponent {
  readonly titulo = input.required<string>();
  readonly etiquetaAtras = input('');
  /** `null` = sin link de "volver" (no todas las pantallas tienen un padre obvio). */
  readonly rutaAtras = input<string | null>(null);
}

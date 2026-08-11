import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * Título de pantalla + link "volver" opcional. Puerto de
 * `shared/components/common/page-breadcrumb` del origen — acá con `routerLink` real (Angular
 * Router) en vez del `routerLink` de string plano del origen, y sin link cuando no hace falta
 * volver a ningún lado (`rutaAtras()` en `null`).
 *
 * **El título es un `<h1>`, y antes era un `<h2>`.** Aparece ANTES que cualquier otro encabezado de
 * la pantalla, así que como `h2` hacía que el documento arrancara un nivel por debajo de su propio
 * título. En cuatro de las pantallas que lo usan (`clientes`, `usuarios`, `usuario-perfil`,
 * `cliente-crear`) es además el ÚNICO encabezado que hay: bajarlo a `<p>` las habría dejado sin
 * ninguno. El tamaño no cambia — lo manda la clase, no la etiqueta. Lo fija
 * `core/arbol-encabezados.test.ts`.
 */
@Component({
  selector: 'app-page-breadcrumb',
  imports: [RouterLink],
  template: `
    <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
      @if (esEncabezado()) {
        <h1 class="text-xl font-semibold text-texto">{{ titulo() }}</h1>
      } @else {
        <p class="text-xl font-semibold text-texto">{{ titulo() }}</p>
      }
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

  /**
   * ¿Este título ES el encabezado de la pantalla? Por defecto sí, y se pinta como `<h1>`.
   *
   * `false` en un **shell** —hoy solo `cliente-ficha`—, donde el `<h1>` lo pone la pantalla que monta
   * en el `<router-outlet>`. Es un `input` y no una deducción porque el componente no puede saber si
   * quien lo usa es una pantalla o un contenedor, y adivinarlo mal deja dos `<h1>` en el documento
   * sin que nada avise: el defecto está medido, y lo fija `core/arbol-encabezados.test.ts`.
   */
  readonly esEncabezado = input(true);
}

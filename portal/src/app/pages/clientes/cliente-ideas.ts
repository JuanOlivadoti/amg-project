import { Component } from '@angular/core';

/**
 * Tab `/clientes/:id/ideas`. **Placeholder deliberado**, y el más corto de los dos en vida útil: el
 * backend YA existe —la migración `0013`, `PgIdeas` con sus transiciones y los tres endpoints, más
 * el seed de ejemplo— y lo que falta son las pantallas (etapas 5-7 de la pieza 3 del programa del
 * portal, con plan propio ya escrito). Este tab es el hueco donde caen.
 *
 * Tampoco acá se recicla el mock: la pantalla «Mi Portal» mostraba ideas inventadas mientras la API
 * tiene las de verdad. Un placeholder que dice «faltan las pantallas» es información; una lista falsa
 * encima de un backend real es una pantalla que hay que desmentir antes de poder usarla.
 *
 * El título es un `<h1>` por lo mismo que en `cliente-resenas.ts`: esta pantalla es una HOJA y la
 * ficha que la monta es un contenedor que no declara ninguno. Ver el docblock de ahí.
 */
@Component({
  selector: 'app-cliente-ideas',
  template: `
    <div class="bg-superficie rounded-xl border border-borde p-8 text-center">
      <h1 class="text-sm font-semibold text-texto">Ideas</h1>
      <p class="mt-2 text-sm text-texto-tenue max-w-md mx-auto">
        Todavía no disponible en el portal. Los datos y la API del módulo de ideas ya existen; faltan
        las pantallas.
      </p>
    </div>
  `,
})
export class ClienteIdeasPage {}

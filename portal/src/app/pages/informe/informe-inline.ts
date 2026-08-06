import { Component, input } from '@angular/core';
import type { Inline } from '../../core/markdown';

/**
 * Un tramo de texto del informe: las cuatro variantes de `Inline` de `core/markdown.ts`.
 *
 * Existe porque el mismo dibujo hace falta en cinco lugares (encabezado, párrafo, cita, ítem de lista y
 * celda de tabla) y la alternativa era un `<ng-template>` con `let-`, donde la variable es `any` y
 * `strictTemplates` deja de mirar. Acá el `input()` está tipado, y eso compra una garantía que se midió
 * (2026-08-06, `ng build` con `strictTemplates`): si alguien agrega a la unión una variante **con otra
 * forma** —sin `valor`— y no la dibuja, el `@else` final estrecha a lo que queda y **no compila**:
 * `TS2339: Property 'valor' does not exist`. Dicho con precisión, porque la garantía no es total: una
 * variante nueva que TAMBIÉN tuviera `valor` compilaría y se pintaría como texto llano. Ése es el fallo
 * seguro de este archivo —se ve el dato, no se pierde— pero no es el compilador avisando.
 *
 * `@if`/`@else if` y no `@switch` es una decisión de estilo, **no** una del compilador, y conviene decirlo
 * porque es fácil suponer lo contrario: medido el mismo día, `@switch (t.tipo)` sobre la variable local de
 * un `@for` **sí** estrecha la unión igual de bien. Lo que NO estrecha —también medido— es `@switch
 * (b().tipo)` sobre la llamada a un signal: ahí el discriminante es una expresión de llamada y sale
 * `TS2339`. Si alguna vez se pasa esta plantilla a `@switch`, ése es el único borde a respetar.
 *
 * El `<ng-container>` de la rama de texto **no es decorativo, y no se puede quitar**. Sin él —con el
 * `{{ t.valor }}` suelto, indentado como el resto— Angular deja un nodo de texto que incluye la
 * indentación de la plantilla y la colapsa a UN ESPACIO pegado al dato: medido en Chrome 141 sobre el
 * informe real (2026-08-06), `**No es un 0**: es un dato` se veía como `No es un 0 : es un dato`, y
 * `**…busque**, así que` como `…busque , así que`. Un espacio antes de la coma en el entregable que ve el
 * cliente. El `<ng-container>` acota el nodo de texto a la interpolación exacta y no agrega ningún
 * elemento al DOM; la whitespace que queda entre ramas es whitespace-only y ésa sí la borra el compilador.
 * Lo fija un test de `informe.spec.ts`.
 *
 * **Cero HTML crudo, y eso es el punto entero de la pieza.** El texto sale por interpolación, que Angular
 * escapa siempre; las etiquetas (`<strong>`, `<em>`, `<code>`) las pone la PLANTILLA, no el dato. Un `<b>`
 * que venga en el informe se ve como `<b>`. Lo vigila `core/sin-html-crudo.test.ts`.
 */
@Component({
  selector: 'app-informe-inline',
  template: `@for (t of partes(); track $index) {
    @if (t.tipo === 'negrita') {
      <strong class="font-semibold text-texto">{{ t.valor }}</strong>
    } @else if (t.tipo === 'cursiva') {
      <em>{{ t.valor }}</em>
    } @else if (t.tipo === 'codigo') {
      <code class="rounded bg-superficie-2 px-1 py-0.5 text-[0.9em] font-mono">{{ t.valor }}</code>
    } @else {
      <ng-container>{{ t.valor }}</ng-container>
    }
  }`,
})
export class InformeInlineComponent {
  readonly partes = input.required<readonly Inline[]>();
}

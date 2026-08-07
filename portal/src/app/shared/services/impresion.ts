import { Injectable } from '@angular/core';

/**
 * Abrir el diálogo de impresión del navegador.
 *
 * Una línea, y aun así es un servicio, por el mismo motivo que `DescargasService`: es lo único de la
 * vista imprimible que toca el navegador, y sin el doble un `.spec.ts` que toque el botón le abriría
 * el diálogo de impresión —modal y bloqueante— a quien corre la suite en Karma.
 *
 * **El PDF lo produce el navegador** (Imprimir → Guardar como PDF): es la decisión del dueño del
 * proyecto del 2026-08-07, para no meter la primera dependencia de PDF del repo contra el invariante
 * de `tsx` sin paso de build. El PDF que sale es real —texto seleccionable, enlaces vivos—, y la
 * consecuencia es que **la calidad de la hoja impresa ES el entregable**: lo que se maqueta con
 * `@media print` no es una comodidad, es el producto.
 */
@Injectable({ providedIn: 'root' })
export class ImpresionService {
  imprimir(): void {
    window.print();
  }
}

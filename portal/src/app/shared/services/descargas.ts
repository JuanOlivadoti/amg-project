import { Injectable } from '@angular/core';
import type { ArchivoDescargado } from '../../core/api-core';

/**
 * Guardar en disco un archivo que ya está en memoria.
 *
 * Existe como servicio por dos motivos, y ninguno es simetría:
 *
 * 1. **Es la única parte de la descarga que toca el DOM**, y toda la lógica que sí se puede probar sin
 *    navegador vive en otro lado (`core/api-core.ts`: la petición autenticada y el nombre del archivo).
 *    Mismo reparto que `TemaService` con `core/tema.ts`.
 * 2. **Deja el `.spec.ts` de la pantalla sin efectos secundarios**: un test que renderice el informe y
 *    toque «Descargar» inyecta un doble de este servicio y afirma con qué nombre se pidió guardar, en vez
 *    de hacer que Karma le baje un archivo a quien corre la suite.
 *
 * Por qué un `Blob` y no un `<a href>` al endpoint: la API exige `Authorization`, y meter el token en la
 * query string lo deja escrito en los logs del servidor y en el historial del navegador. Un token en la
 * barra de direcciones es un token filtrado.
 */
@Injectable({ providedIn: 'root' })
export class DescargasService {
  guardar(archivo: ArchivoDescargado): void {
    const url = URL.createObjectURL(archivo.blob);
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = archivo.nombre;
      /*
       * El `appendChild` **no es lo que hace funcionar esto en Chrome**, y conviene decirlo con lo que se
       * midió y no con la superstición habitual: medido en Chrome 141 el 2026-08-06, un anchor
       * DESPRENDIDO del documento también baja el archivo. Se adjunta igual porque es el único de los dos
       * caminos que no depende de esa cortesía, y quitarlo sería apostar a que todos los navegadores que
       * abran el portal se comportan como el único que pude medir.
       */
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      /*
       * Se revoca en el mismo tick, justo después del `click()`. Medido en Chrome 141 el 2026-08-06 con
       * este mismo código: el archivo baja COMPLETO (contenido y nombre correctos), porque la descarga se
       * inicia durante el despacho del click. Sin el revoke, el `Blob` —decenas de KB de informe— se queda
       * vivo hasta que se recargue la pestaña.
       */
      URL.revokeObjectURL(url);
    }
  }
}

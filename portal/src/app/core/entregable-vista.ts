/*
 * Lo que la vista imprimible del entregable necesita saber de su propio documento, como funciones
 * puras.
 *
 * El entregable es el informe de keyword research SIN el bloque de coste, generado al vuelo por
 * `GET /runs/:id/entregable.md`. Llega como Markdown y nada más: no viene un JSON con el nombre del
 * cliente ni con la fecha. Los dos están DENTRO del documento —`renderReport` imprime
 * `# Keyword Research — <cliente>` en la línea 1 y `_ES · es · <ISO>_` en la 3— así que la pantalla
 * los lee de ahí, con la misma mezquindad que `informe-vista.ts` usa para la fecha.
 *
 * Está acá y no en el componente porque es exactamente lo que se puede probar en milisegundos y sin
 * navegador, y porque el modo de fallar —quedarse con el h1 en el cuerpo, o comerse un bloque que no
 * era el título— solo se ve en el papel, donde ya es tarde.
 */
import type { Bloque, Inline } from './markdown';

/** El texto plano de una secuencia de inlines: las cuatro variantes de `Inline` llevan `valor`. */
function textoPlano(partes: readonly Inline[]): string {
  return partes.map((p) => p.valor).join('');
}

export interface DocumentoEntregable {
  /**
   * El título del documento —el h1 que imprime el generador, con el nombre del cliente— o `null` si
   * el documento no empieza por uno. **No se inventa**: sin h1, la pantalla no pone encabezado.
   */
  readonly titulo: string | null;
  /** El resto del documento. Si no se pudo separar un título, es el documento ENTERO. */
  readonly cuerpo: readonly Bloque[];
}

/**
 * Separa el título del cuerpo, para que la hoja impresa tenga un encabezado de documento y no
 * repita el h1 dos veces.
 *
 * **Falla cerrado, y esa es la propiedad que importa:** si el primer bloque no es un encabezado de
 * nivel 1 —porque el generador cambió su cabecera, o porque llegó otra cosa— no se descarta nada.
 * La alternativa (asumir que el primer bloque es el título y quitarlo) haría desaparecer contenido
 * en silencio justo en la hoja que se le manda al restaurante, que es donde nadie lo va a comparar
 * contra el original.
 */
export function partirEncabezado(bloques: readonly Bloque[]): DocumentoEntregable {
  const primero = bloques[0];
  // `nivel === 1` y no `tipo === 'encabezado'` a secas: un documento que empezara con `## Páginas
  // propuestas` perdería esa sección y la mostraría como si fuera su título.
  if (primero?.tipo === 'encabezado' && primero.nivel === 1) {
    return { titulo: textoPlano(primero.texto), cuerpo: bloques.slice(1) };
  }
  return { titulo: null, cuerpo: bloques };
}

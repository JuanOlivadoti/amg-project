import type { EstadoIdea } from './models';
import { TRANSICIONES_IDEA } from './ideas-transiciones';

/**
 * Vocabulario compartido de los estados de una idea: nombre en pantalla y color de la píldora.
 * Vivía duplicado en `cliente-ideas.ts` y `cliente-idea-detalle.ts` (hallazgo M3 de la revisión
 * final de la Pieza 3) — un tercer archivo que lo repitiera hubiera sido peor, así que se junta acá.
 *
 * `ESTADOS_IDEA` se deriva de `TRANSICIONES_IDEA` en vez de repetir la lista una tercera vez: sus
 * claves ya son los cuatro estados, en el mismo orden, y esa copia ya está atada a
 * `db/src/ideas.ts` por `ideas-transiciones.test.ts`.
 */
export const ESTADOS_IDEA: readonly EstadoIdea[] = Object.keys(TRANSICIONES_IDEA) as EstadoIdea[];

export const ETIQUETA_ESTADO_IDEA: Record<EstadoIdea, string> = {
  nueva: 'Nueva',
  en_revision: 'En revisión',
  aprobada: 'Aprobada',
  rechazada: 'Rechazada',
};

/** El color de la píldora de estado. Comparten esta lógica el listado y el detalle. */
export function claseEstadoIdea(s: EstadoIdea): string {
  if (s === 'aprobada') return 'bg-respaldo-suave text-respaldo';
  if (s === 'rechazada') return 'bg-error-suave text-error';
  if (s === 'en_revision') return 'bg-alerta-suave text-alerta';
  return 'bg-superficie-2 text-texto-medio'; // nueva
}

import type { EstadoIdea } from './models';

/**
 * La máquina de estados de una idea, copiada al portal — la SEGUNDA copia de `TRANSICIONES_IDEA`
 * (`db/src/ideas.ts`), que a su vez ya es una segunda copia del trigger `ideas_transicion_estado`
 * de Postgres (0013). La garantía real vive ahí: cualquier `PATCH /ideas/:id { estado }` que pida
 * una transición inválida lo rechaza el servidor con 400, venga el click de donde venga.
 *
 * Esta copia existe solo para DESHABILITAR en el cliente los botones que la API igual va a
 * rechazar — es UX ("no ofrezcas lo que no va a funcionar"), no autorización. El portal no puede
 * importar `db/src/ideas.ts` (ADR-21: habla con la API por HTTP y nada más), así que se repite acá
 * a mano. `ideas-transiciones.test.ts` la ata a la copia de `db` par por par para que un desalineo
 * no pase en silencio.
 */
export const TRANSICIONES_IDEA: Readonly<Record<EstadoIdea, readonly EstadoIdea[]>> = {
  nueva: ['en_revision'],
  en_revision: ['aprobada', 'rechazada'],
  aprobada: [],
  rechazada: [],
};

/** Las transiciones válidas DESDE `estado`. Vacío en los dos estados terminales. */
export function transicionesDesde(estado: EstadoIdea): readonly EstadoIdea[] {
  return TRANSICIONES_IDEA[estado];
}

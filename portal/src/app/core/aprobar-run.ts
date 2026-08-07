/**
 * Por qué NO se puede aprobar un run, en una sola frase — y **una sola a la vez**.
 *
 * ## Por qué esto es una función pura y no dos `@if` en la plantilla
 *
 * Hay dos motivos que se pueden dar **juntos** (un run sembrado, sin ninguna página aprobada), y la
 * plantilla que los pintaba por separado mostraba los dos: «Aprobá al menos una página antes de
 * aprobar el run» **y** «este research no lo lanzó el pipeline». Leídos juntos se contradicen —el
 * primero promete que aprobando una página se destraba, y no se destraba— así que quien los lee
 * aprueba páginas, vuelve al botón y lo sigue encontrando muerto. Decidir cuál gana es una decisión
 * de producto, se prueba en un milisegundo sin navegador, y por eso vive acá y no en el componente.
 *
 * ## Cuál gana, y por qué ése
 *
 * **El de la falta de workflow**, siempre. Es el único de los dos que quien mira la pantalla **no
 * puede resolver desde ella**: aprobar páginas no hace aparecer una ejecución durable esperando el
 * evento. Contar primero el motivo resoluble sería mandar a alguien a hacer un trabajo que no
 * destraba nada.
 */

/** El estado del run del que depende que se pueda aprobar. Nada de Angular, nada de HTTP. */
export interface EstadoAprobacionRun {
  /** `run.tiene_workflow`: hay una ejecución durable esperando el `research/aprobado`. */
  readonly tieneWorkflow: boolean;
  /** Al menos una página aprobada (`puedeAprobarseRun`, `core/evidence.ts`). */
  readonly hayPaginaAprobada: boolean;
}

/**
 * El motivo cuando el run **no lo lanzó el pipeline**.
 *
 * Está redactado para quien lo lee, no para quien lo programó: «este run no tiene workflow» es
 * exacto y no significa nada del otro lado de la pantalla. Lo que le pasa a esa persona es que ese
 * research entró por otro camino (el seed de la demo, una importación) y **no hay nada esperando su
 * aprobación**, así que la acción que le queda es lanzar uno nuevo. Un test fija que la frase no se
 * vuelva jerga.
 */
export const MOTIVO_SIN_WORKFLOW =
  'Este research no lo lanzó el pipeline (viene de la demo o de una importación), así que no hay ' +
  'nada esperando su aprobación: aprobarlo no publicaría nada. Para publicar, lanzá un research ' +
  'nuevo desde el portal.';

/** El motivo cuando el run sí es del pipeline pero todavía no hay nada que publicar. */
export const MOTIVO_SIN_PAGINAS = 'Aprobá al menos una página antes de aprobar el run.';

/**
 * `null` = se puede aprobar, y entonces no hay nada que contar.
 *
 * `null` y no cadena vacía: el consumidor ramifica con `@if (motivo(); as m)`, y una cadena vacía es
 * falsy pero sigue siendo un `string` — el día que alguien la compare con `!== null` la rama se
 * enciende con un aviso en blanco.
 */
export function motivoNoAprobable(estado: EstadoAprobacionRun): string | null {
  // El orden ES la decisión: ver el encabezado. No reordenar sin leerlo.
  if (!estado.tieneWorkflow) return MOTIVO_SIN_WORKFLOW;
  if (!estado.hayPaginaAprobada) return MOTIVO_SIN_PAGINAS;
  return null;
}

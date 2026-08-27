/**
 * Por qué NO se puede aprobar un run, en una sola frase.
 *
 * Hasta este sub-proyecto había DOS motivos posibles («este run no tiene workflow» y «sin páginas
 * aprobadas»), y esta función decidía cuál ganaba cuando se daban juntos. El gate `tiene_workflow`
 * se retiró (`docs/superpowers/plans/2026-08-26-desacoplar-kr-web.md`): con `RunSinWorkflowError`
 * fuera, CUALQUIER run en `pending_approval` puede recibir una decisión de destino, nacido del
 * pipeline o sembrado — así que el único motivo que queda es la falta de páginas aprobadas. Sigue
 * siendo una función y no un `@if` suelto por el mismo criterio de siempre: la decisión de qué
 * mostrar se prueba en un milisegundo sin navegador.
 */

/** El estado del run del que depende que se pueda aprobar. Nada de Angular, nada de HTTP. */
export interface EstadoAprobacionRun {
  /** Al menos una página aprobada (`puedeAprobarseRun`, `core/evidence.ts`). */
  readonly hayPaginaAprobada: boolean;
}

/** El motivo cuando el run todavía no tiene nada que publicar. */
export const MOTIVO_SIN_PAGINAS = 'Aprobá al menos una página antes de aprobar el run.';

/**
 * `null` = se puede aprobar, y entonces no hay nada que contar.
 *
 * `null` y no cadena vacía: el consumidor ramifica con `@if (motivo(); as m)`, y una cadena vacía es
 * falsy pero sigue siendo un `string` — el día que alguien la compare con `!== null` la rama se
 * enciende con un aviso en blanco.
 */
export function motivoNoAprobable(estado: EstadoAprobacionRun): string | null {
  return estado.hayPaginaAprobada ? null : MOTIVO_SIN_PAGINAS;
}

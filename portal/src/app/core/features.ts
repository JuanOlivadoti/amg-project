/**
 * Decisiones de "qué se muestra" que dependen de un flag de despliegue, no solo del rol.
 *
 * Viven acá —puras y testeadas— por la misma razón que `evidence.ts`: un `@if` en el template es
 * fácil de romper sin que nada avise, y esto es una decisión de seguridad de la demo (que Frank NO
 * pueda lanzar una corrida en vivo en Fase 1), no un detalle cosmético.
 */

/**
 * ¿Se muestra el botón/formulario de "lanzar research"?
 *
 * Hacen falta LAS DOS cosas: ser equipo (staff) **y** que el flag esté encendido. La autorización
 * REAL la impone la API/RLS; esto es la UI.
 *
 * El flag estuvo apagado toda la Fase 1 porque no había orquestador detrás del botón. **Encendido en
 * producción el 2026-08-07**, cuando lo hubo.
 */
export function mostrarLanzarResearch(esEquipo: boolean, lanzarHabilitado: boolean): boolean {
  return esEquipo && lanzarHabilitado;
}

/**
 * ¿Se muestra el botón "Aprobar el run y publicar"?
 *
 * Misma forma que lanzar (equipo + flag), pero flag PROPIO (`aprobarRun`) porque son capacidades
 * distintas. (10ª review externa, #2.) Estuvo apagado toda la Fase 1 —aprobar emitía un evento sin
 * orquestador detrás, y el texto "y publicar" prometía algo imposible— y se **encendió el
 * 2026-08-07**, cuando el orquestador se desplegó.
 *
 * **Lo que el flag encendido NO garantiza:** que el botón publique. Publica si el run **nació del
 * pipeline**, porque la compuerta es un `paso.esperarEvento` dentro del workflow y hay que tener un
 * workflow dormido que despertar. Sobre un run insertado directo en la base (el de `sembrarDemo`), el
 * evento no lo espera nadie y no se publica nada. Frank cruza la compuerta aprobando **páginas**, que
 * es solo escritura en la base y no depende de esto.
 */
export function mostrarAprobarRun(esEquipo: boolean, aprobarHabilitado: boolean): boolean {
  return esEquipo && aprobarHabilitado;
}

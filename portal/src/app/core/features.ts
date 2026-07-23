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
 * Hacen falta LAS DOS cosas: ser equipo (staff) **y** que el flag esté encendido. En Fase 1 (Nivel 1
 * "read-mostly") el flag está apagado, así que ni siquiera el equipo lo ve: no hay orquestador
 * detrás. Se reenciende en Fase 2. La autorización REAL igual la impone la API/RLS; esto es la UI.
 */
export function mostrarLanzarResearch(esEquipo: boolean, lanzarHabilitado: boolean): boolean {
  return esEquipo && lanzarHabilitado;
}

/**
 * ¿Se muestra el botón "Aprobar el run y publicar"?
 *
 * Misma forma que lanzar (equipo + flag), pero flag PROPIO (`aprobarRun`) porque son capacidades
 * distintas. En Fase 1 se apaga: aprobar el run emite un evento a Inngest que **no tiene orquestador
 * detrás** —la base quedaría aprobada, el usuario vería un error y nada se publicaría—, y el texto
 * "y publicar" prometería algo imposible. Frank igual cruza la compuerta aprobando PÁGINAS (solo
 * escritura en la base). Se reenciende en Fase 2, con el orquestador. (10ª review externa, #2.)
 */
export function mostrarAprobarRun(esEquipo: boolean, aprobarHabilitado: boolean): boolean {
  return esEquipo && aprobarHabilitado;
}

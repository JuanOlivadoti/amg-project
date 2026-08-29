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
 * **Actualizado tras el sub-proyecto 2** (desacoplar keyword research de creación de webs,
 * 2026-08-26): el mecanismo ya NO es un único workflow con un `paso.esperarEvento` esperando un
 * evento que un run sembrado nunca disparaba. Ahora son DOS funciones de Inngest
 * (`orchestrator/src/functions.ts`): `crearFuncionResearch` deja el run en `pending_approval`, y
 * `crearFuncionDecision` **escucha `research/aprobado`** — el listener que antes faltaba — y lo
 * procesa releyendo la decisión bajo RLS (`workflowDecision`). Por eso el botón publica sobre
 * CUALQUIER run en `pending_approval`, nacido del pipeline o sembrado a mano: ya no hace falta un
 * workflow dormido esperando. Frank cruza la compuerta aprobando **páginas**, que sigue siendo solo
 * escritura en la base y no depende de esto.
 */
export function mostrarAprobarRun(esEquipo: boolean, aprobarHabilitado: boolean): boolean {
  return esEquipo && aprobarHabilitado;
}

/**
 * ¿Se muestra la opción "crear_posts" del selector de destino, aunque deshabilitada?
 *
 * Sub-proyecto 3 (publicar en un blog externo) todavía no existe: este flag queda en `false` hasta
 * que lo haya. Mismo patrón que `mostrarAprobarRun`/`mostrarLanzarResearch` — equipo + flag propio,
 * porque es una capacidad distinta de las otras dos.
 */
export function mostrarDestinoPosts(esEquipo: boolean, destinoPostsHabilitado: boolean): boolean {
  return esEquipo && destinoPostsHabilitado;
}

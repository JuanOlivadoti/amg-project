/**
 * Los códigos de error que el portal DISTINGUE, no los que un humano lee.
 *
 * ## Por qué existen, si el status ya discrimina
 *
 * Hoy cada 409 de la API significa una sola cosa en su endpoint, así que el status alcanzaría. Lo que
 * no alcanza es el `error` de texto: el portal necesita decidir **qué hacer** (deshabilitar un botón,
 * pintar un aviso, mandar a otra pantalla), y decidirlo comparando la frase en español convierte una
 * corrección de redacción en un bug de comportamiento. El mensaje es para el humano; el código, para
 * el programa.
 *
 * ## Alcance, para no prometer de más
 *
 * **Solo los 409 los llevan.** Los 400/403/404 que ya existían siguen respondiendo `{ error }` a
 * secas: agregarles código sería un refactor de toda la superficie, y ninguno lo necesita todavía —
 * el portal no ramifica sobre ellos. Cuando alguno lo necesite, se agrega ahí y esta nota se corrige.
 *
 * Los valores son `SCREAMING_SNAKE` y **estables**: son parte del contrato HTTP, así que renombrar
 * uno rompe al portal aunque `tsc` no diga nada (el portal no importa este archivo — está fuera del
 * monorepo a propósito, y su copia vive en `portal/src/app/core/`).
 */

/** `GET /runs/:id/entregable.md` — el run existe y se puede ver, pero no tiene nada que entregar. */
export const SIN_PAGINAS_APROBADAS = "SIN_PAGINAS_APROBADAS";

/**
 * `POST /runs/:id/approve` — el run existe y se puede ver, pero **nadie está esperando la
 * aprobación**: se insertó directo en la base (el seed de la demo, una importación), así que la API
 * nunca emitió `research/solicitado` por él y no hay ningún `esperarEvento` durmiendo. Aprobarlo
 * devolvería 200 y no publicaría nada (bloque C0; migración 0019).
 *
 * El portal lo usa para dos cosas distintas: deshabilitar el botón por adelantado —para eso lee
 * `run.tiene_workflow`, no este código— y explicar el 409 de quien llegue igual (otra pestaña, el
 * endpoint directo).
 */
export const RUN_SIN_WORKFLOW = "RUN_SIN_WORKFLOW";

/** Todos los códigos, para el test que los ata a la copia del portal. */
export const CODIGOS = { SIN_PAGINAS_APROBADAS, RUN_SIN_WORKFLOW } as const;

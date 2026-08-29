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
 * **Solo los 409 y el 501 de `crear_posts` los llevan.** Los 400/403/404 que ya existían siguen
 * respondiendo `{ error }` a secas: agregarles código sería un refactor de toda la superficie, y
 * ninguno lo necesita todavía — el portal no ramifica sobre ellos. Cuando alguno lo necesite, se
 * agrega ahí y esta nota se corrige.
 *
 * Los valores son `SCREAMING_SNAKE` y **estables**: son parte del contrato HTTP, así que renombrar
 * uno rompe al portal aunque `tsc` no diga nada (el portal no importa este archivo — está fuera del
 * monorepo a propósito, y su copia vive en `portal/src/app/core/`).
 */

/** `GET /runs/:id/entregable.md` — el run existe y se puede ver, pero no tiene nada que entregar. */
export const SIN_PAGINAS_APROBADAS = "SIN_PAGINAS_APROBADAS";

/**
 * `POST /runs/:id/approve` — la transición pedida no califica: ni es la primera decisión de un run
 * en `pending_approval`, ni es el único camino retomable (última decisión completada
 * 'solo_informe' → un destino distinto). Ver `docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`,
 * sección "Modelo de datos".
 */
export const TRANSICION_INVALIDA = "TRANSICION_INVALIDA";

/** `POST /runs/:id/approve` con `destino: 'crear_posts'` — el sub-proyecto 3 todavía no lo implementa. */
export const NO_IMPLEMENTADO = "NO_IMPLEMENTADO";

/** Todos los códigos, para el test que los ata a la copia del portal. */
export const CODIGOS = { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA, NO_IMPLEMENTADO } as const;

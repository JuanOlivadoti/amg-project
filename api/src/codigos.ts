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
 * **El criterio es si el portal RAMIFICA, no el status.** Nada más. Un código que nadie usa para
 * decidir es una entrada que hay que mantener sincronizada en dos copias a cambio de nada.
 *
 * Este párrafo decía *"solo los 409 y el 501 de `crear_posts` los llevan"*, y **era falso por partida
 * doble** (lo destapó el `revisor` el 2026-09-11, al revisar el guardarraíl de «Conectar Google»):
 *
 * 1. **Ese 501 ya no existe.** Se retiró en el sub-proyecto 3 (ver `app.ts`, donde estaba el
 *    `crear_posts` temporal). `NO_IMPLEMENTADO`, abajo, quedó como una constante que **no emite
 *    nadie** — se conserva porque retirarla exige tocar la copia del portal en el mismo cambio
 *    (`portal/src/app/core/codigos.ts`, atada por un `deepEqual`), y eso es otra etapa. Queda dicho
 *    en vez de disimulado.
 * 2. **Nunca fue cierto que todos los 409 llevaran código.** El `onError` ya devolvía un 409 pelado
 *    para *"ya existe y no pertenece"* desde mucho antes de esto. Así que la regla real siempre fue
 *    la de la primera línea de este comentario, no una sobre el status.
 *
 * El 409 del guardarraíl de «Conectar Google» (`CONECTAR_GOOGLE_BLOQUEADO`, en `app.ts`) tampoco
 * lleva código, por el mismo criterio: el portal solo muestra su mensaje, no decide nada con él.
 *
 * Los 400/403/404 siguen respondiendo `{ error }` a secas. Cuando alguno necesite que el portal
 * ramifique, se agrega ahí — y en las dos copias a la vez.
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

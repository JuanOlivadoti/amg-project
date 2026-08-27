/**
 * Los códigos de error que el portal DISTINGUE. **Copia literal de `api/src/codigos.ts`.**
 *
 * ## Por qué es una copia
 *
 * El portal vive fuera del monorepo a propósito (su toolchain no se mezcla con la de los workspaces),
 * así que no puede `import`ar del paquete `api`. Lo que no puede es ser una copia **suelta**:
 * `codigos.test.ts` lee el archivo de la API desde disco y compara los dos conjuntos. Estar fuera del
 * monorepo impide importar el paquete; no impide leer el archivo.
 *
 * ## Por qué el portal ramifica sobre esto y no sobre el mensaje
 *
 * El `error` de un 409 es una frase en español escrita para un humano, y se corrige el día que a
 * alguien le molesta una tilde. Si la pantalla decidiera comparando esa frase, la corrección de
 * redacción sería un cambio de comportamiento: la rama se apagaría y nadie se enteraría hasta que un
 * usuario viera el error genérico. El mensaje es para el humano; el código, para el programa.
 *
 * Los valores son `SCREAMING_SNAKE` y **estables**: son parte del contrato HTTP.
 */

/** `GET /runs/:id/entregable.md` — el run existe y se puede ver, pero no tiene nada que entregar. */
export const SIN_PAGINAS_APROBADAS = 'SIN_PAGINAS_APROBADAS';

/**
 * `POST /runs/:id/approve` — la transición pedida no califica: ni es la primera decisión de un run
 * en `pending_approval`, ni es el único camino retomable (última decisión completada
 * 'solo_informe' → un destino distinto). Ver `docs/superpowers/specs/2026-08-26-desacoplar-kr-web-design.md`,
 * sección "Modelo de datos".
 */
export const TRANSICION_INVALIDA = 'TRANSICION_INVALIDA';

/** Todos los códigos, para el test que ata esta copia a la de la API. */
export const CODIGOS = { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA } as const;

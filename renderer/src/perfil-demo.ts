import { PERFIL_DEMO } from "db";

/**
 * **El perfil del cliente de demo: «Borcelle Burger».**
 *
 * Es un **re-export**, no una copia. El perfil vive en `db/src/seed-demo.ts` porque de ahí lo siembra
 * `reseed:demo` en la base real; acá lo consumen el `dev-server` y el generador del SQL de alta
 * (`cli/sql-demo.ts`). Dos copias del mismo perfil son dos perfiles el día que alguien ajusta uno — y
 * ese día nadie se entera, porque las dos siguen funcionando.
 *
 * ## Por qué el negocio es FICTICIO, y por qué eso es la mitad del asunto
 *
 * Borcelle Burger no existe. Sus fotos son de stock y sus reseñas están escritas para esta demo. Eso
 * es legítimo **precisamente porque no hay un negocio real al que atribuirle nada**: las mismas fotos
 * en la ficha de un restaurante de verdad serían el local de otro, y las mismas reseñas serían
 * reseñas falsas atribuidas a clientes que no existen.
 *
 * Es también la salida al límite de la etapa 3 del bloque K: `testimonios` no tiene contenido por
 * defecto —una reseña inventada es una reseña falsa— y por eso esa sección no se puede enseñar con la
 * ficha de un cliente real. Con un negocio inventado sí.
 *
 * Las fotos están subidas al space de Storyblok y se sirven desde `a.storyblok.com`, el host de la
 * allowlist del renderizador. **Las URL de asset son públicas**: no dependen del token ni del space de
 * quien las lea, así que este perfil funciona bajo cualquier space.
 */
export const PERFIL_BORCELLE = PERFIL_DEMO;

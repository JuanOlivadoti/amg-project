/**
 * El color de las etiquetas de los ejes, desde el tema.
 *
 * Por qué existe: ApexCharts pinta las etiquetas con un gris propio si nadie le dice otra cosa. Ese
 * color **no sale de `styles.css`**, así que `contraste.test.ts` —que lee la hoja de estilos— no
 * podía verlo, y en oscuro quedaba en 1.53:1 contra el 4.5:1 de AA. Lo encontró manejar el dashboard
 * en producción, no la suite. El valor exacto vive en `ejes.test.ts`, que es donde se lo mide.
 *
 * `leerToken` se inyecta en vez de tocar `document` acá adentro: así el contrato se prueba sin DOM
 * (`ejes.test.ts`), que es la diferencia entre un test que corre en `node:test` y uno que necesita
 * un navegador. El componente le pasa el lector real.
 */

/** El rol semántico de una etiqueta de eje: texto secundario sobre la tarjeta (`--superficie`). */
export const TOKEN_EJES = 'texto-medio';

export interface EstiloEjes {
  readonly labels: { readonly style: { readonly colors: string } };
}

/**
 * El fallback es `currentColor` (palabra clave CSS, no un literal): un hex de repuesto quedaría
 * congelado en un tema, y `contraste.test.ts` lo prohíbe en el fuente. Mismo criterio que `colores()`.
 */
export function estiloEjes(leerToken: (nombre: string) => string): EstiloEjes {
  const valor = leerToken(TOKEN_EJES).trim();
  return { labels: { style: { colors: valor || 'currentColor' } } };
}

/** El lector real: el token ya resuelto por el navegador. Fuera del DOM devuelve vacío. */
export function tokenDelDocumento(nombre: string): string {
  if (typeof document === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(`--${nombre}`);
}

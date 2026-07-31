/**
 * Contraste de WCAG 2.1, en veinte líneas y sin dependencias.
 *
 * Por qué existe: la distinción ✅ respaldada / ⚠️ sin validar **es el argumento de venta** del
 * producto, y "se lee bien" no es una garantía si la única prueba es que a alguien le pareció. Con
 * esto, la legibilidad la impone un test, y retocar un color por gusto falla ruidosamente.
 */

/** Los 16 nombres de rol. Si se agrega uno, va acá y a los dos bloques de `styles.css`. */
export const TOKENS: readonly string[] = [
  'fondo',
  'superficie',
  'superficie-2',
  'texto',
  'texto-medio',
  'texto-tenue',
  'texto-invertido',
  'borde',
  'borde-fuerte',
  'accion',
  'respaldo',
  'respaldo-suave',
  'alerta',
  'alerta-suave',
  'error',
  'error-suave',
  'velo',
];

/**
 * `[frente, fondo]` — los pares que existen en la UI, uno por uno, más los del texto principal sobre
 * las tres superficies (que es la combinación que cualquier pantalla nueva va a usar primero).
 *
 * `borde` y `borde-fuerte` no están: no llevan texto. Su contraste contra la superficie es de 1.24:1
 * a 1.83:1, por debajo del 3:1 que WCAG 1.4.11 pide para el límite de un control — es **deuda
 * preexistente**, anotada en el spec, no un olvido.
 */
export const PARES: readonly (readonly [string, string])[] = [
  ['texto', 'fondo'],
  ['texto', 'superficie'],
  // Todavía sin uso: hoy sobre `superficie-2` solo hay `texto-medio` (los badges). Se deja porque la
  // pieza C (el dashboard) va a poner texto principal sobre zonas hundidas, y verificarlo es gratis.
  ['texto', 'superficie-2'],
  ['texto-medio', 'superficie'],
  ['texto-medio', 'superficie-2'], // el badge «Pendiente»
  ['texto-tenue', 'superficie'],
  ['texto-tenue', 'fondo'],
  ['texto-invertido', 'accion'],
  ['texto-invertido', 'respaldo'],
  ['respaldo', 'respaldo-suave'], // el badge ✅
  ['respaldo', 'fondo'], // el TÍTULO ✅, que va sobre el fondo de página
  ['alerta', 'alerta-suave'], // el badge ⚠️
  ['alerta', 'superficie'], // «editar quita la aprobación»
  ['alerta', 'fondo'], // el TÍTULO ⚠️
  ['error', 'error-suave'],
  ['error', 'superficie'],
  ['error', 'fondo'], // el error de `runs`, que no está en una tarjeta
];

/** WCAG AA para texto normal. */
export const AA_TEXTO_NORMAL = 4.5;

/** Luminancia relativa (WCAG 2.1, §relative luminance). */
export function luminancia(hex: string): number {
  const c = normalizar(hex);
  const canales = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = canales.map((x) =>
    x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste entre dos colores. Simétrico: el orden no importa. */
export function ratio(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Extrae los tokens de un bloque de `styles.css`.
 *
 * El test lee los valores **del CSS que se despacha**, no de una copia en TypeScript: una tabla
 * duplicada puede pasar el test mientras la hoja de estilos dice otra cosa. Una sola fuente de verdad.
 */
export function parsearTokens(css: string, selector: string): Record<string, string> {
  const bloque = extraerBloque(css, selector);
  const tokens: Record<string, string> = {};
  for (const m of bloque.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    const [, nombre, valor] = m;
    if (nombre !== undefined && valor !== undefined) tokens[nombre] = valor.trim();
  }
  return tokens;
}

/**
 * Saca los comentarios ANTES de buscar, y exige que el selector esté seguido de `{`.
 *
 * No es paranoia: los comentarios de `styles.css` **mencionan** `:root` y `.oscuro` para explicar la
 * especificidad. Un `indexOf(selector)` encuentra primero la mención, y como el comentario no tiene
 * llaves, se lleva el bloque de la regla SIGUIENTE. Medido: pedirle `.oscuro` devolvía los tokens
 * del tema **claro** — y entonces las 34 aserciones comparaban claro contra claro y pasaban siempre.
 * Un test de contraste que siempre pasa es peor que no tenerlo.
 */
function extraerBloque(css: string, selector: string): string {
  const sinComentarios = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const escapado = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`${escapado}\\s*\\{([^}]*)\\}`).exec(sinComentarios);
  if (!m || m[1] === undefined) throw new Error(`no encontré el selector ${selector} en styles.css`);
  return m[1];
}

function normalizar(hex: string): string {
  const c = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(c)) {
    return c
      .split('')
      .map((d) => d + d)
      .join('');
  }
  if (/^[0-9a-fA-F]{6}$/.test(c)) return c;
  throw new Error(`hex inválido: ${hex}`);
}

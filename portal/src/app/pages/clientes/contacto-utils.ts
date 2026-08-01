/**
 * Helpers puros para armar el jsonb `contacto` desde un formulario de texto plano. Mismo criterio
 * que las funciones privadas de `cliente-crear.ts` (Etapa 5b) — se duplican acá en vez de
 * exportarlas desde ahí porque ese archivo está cerrado (no se toca, ver el brief de la 5c).
 *
 * Usadas por los 4 cards de `/clientes/:id`: cada uno arma su propio `contacto` a partir del
 * `contacto` COMPLETO ya cargado (nunca un objeto parcial de cero), ver `mergearContacto`.
 */

/** `''`/solo espacios → `null` (así el servidor no guarda un string vacío). */
export function limpio(valor: string): string | null {
  const v = valor.trim();
  return v === '' ? null : v;
}

/** Agrega `clave` a `destino` solo si `valor` (recortado) no está vacío — igual que `cliente-crear.ts`. */
export function agregarSi(destino: Record<string, unknown>, clave: string, valor: string): void {
  const v = valor.trim();
  if (v !== '') destino[clave] = v;
}

/**
 * Para los cards de EDICIÓN (a diferencia de `agregarSi`, pensada para armar un `contacto` nuevo
 * desde cero): acá `destino` parte del `contacto` ya existente, así que "el campo quedó vacío" tiene
 * que BORRAR la clave, no solo "no agregarla" — si no, vaciar un campo en el formulario nunca se
 * reflejaría en lo que se guarda (quedaría el valor viejo pisado en silencio).
 */
export function pisarTexto(destino: Record<string, unknown>, clave: string, valor: string): void {
  const v = valor.trim();
  if (v === '') delete destino[clave];
  else destino[clave] = v;
}

/**
 * Punto central de la regla de seguridad del merge: como `contacto` es UN solo campo jsonb
 * compartido por los 4 cards, un card que mande `contacto: { facebook: '...' }` sin las demás
 * claves BORRA `email`/`telefono`/`direccion`/etc. que puso otro card (ADR implícito de la 5c).
 *
 * Por eso todo card que edite `contacto` arranca de una copia del `contacto` COMPLETO ya cargado
 * (`cliente().contacto`, nunca `{}`) y recién ahí pisa sus propias claves. Esta función hace
 * exactamente eso — nada más — para que ningún card se olvide del `{ ...base }` inicial.
 */
export function mergearContacto(base: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return { ...(base ?? {}) };
}

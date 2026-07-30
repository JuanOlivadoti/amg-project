export type Tema = 'auto' | 'claro' | 'oscuro';
export type TemaEfectivo = 'claro' | 'oscuro';

/**
 * La clave de `localStorage` y la clase que lleva `<html>`.
 *
 * Se exportan porque el script inline de `index.html` **las repite** (tiene que correr antes de que
 * exista el bundle). `tema.test.ts` afirma que las dos puntas siguen nombrando lo mismo.
 */
export const CLAVE_TEMA = 'amg.tema';
export const CLASE_OSCURO = 'oscuro';

const TEMAS: readonly string[] = ['auto', 'claro', 'oscuro'];

/**
 * Valida lo que venga de `localStorage`. Espeja a `parseSesion` de `auth-core.ts`, por la misma razón:
 * un valor viejo o manipulado no debería fabricar estado. Ante la duda, `auto`, que es el default.
 */
export function parseTema(raw: string | null): Tema {
  return raw !== null && TEMAS.includes(raw) ? (raw as Tema) : 'auto';
}

/** El ciclo del botón: auto → claro → oscuro → auto. */
export function siguienteTema(t: Tema): Tema {
  if (t === 'auto') return 'claro';
  if (t === 'claro') return 'oscuro';
  return 'auto';
}

/**
 * Qué se pinta.
 *
 * Acá vive la garantía de que **una preferencia explícita manda sobre el sistema**:
 * `sistemaPrefiereOscuro` solo se mira cuando el tema es `auto`. Que la condición esté en esta función
 * pura —y no en el listener de `matchMedia`— es lo que permite probarla sin DOM, y lo que hace que
 * mutarla tumbe un test en vez de pasar desapercibida.
 */
export function temaEfectivo(t: Tema, sistemaPrefiereOscuro: boolean): TemaEfectivo {
  if (t === 'claro') return 'claro';
  if (t === 'oscuro') return 'oscuro';
  return sistemaPrefiereOscuro ? 'oscuro' : 'claro';
}

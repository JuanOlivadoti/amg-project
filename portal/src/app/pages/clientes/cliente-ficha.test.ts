import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOKENS } from '../../core/contraste';

/**
 * La marca del tab activo, defendida.
 *
 * Entre dos utilidades de Tailwind que pisan la misma propiedad con la misma especificidad gana la
 * que va DESPUÉS en la hoja de estilos; el orden dentro del atributo `class` no decide nada. Así que
 * `routerLinkActive` puede poner sus clases y la cascada ignorarlas: las dos que marcan el tab activo
 * pierden contra las dos del estado inactivo, y sin el `!` el tab activo se ve idéntico a los demás.
 *
 * Es una garantía silenciosa de manual: las clases están en el elemento (un test de DOM las encuentra
 * y pasa), no hay error en consola, y el único síntoma es visual. Se descubrió manejando la app, no
 * leyendo el código. Por eso se fija leyendo el FUENTE — mismo patrón que el test de
 * `paramsInheritanceStrategy` en `app.routes.test.ts` y que `core/sin-html-crudo.test.ts`. Karma no
 * puede cubrirlo: los specs de componente no compilan Tailwind, así que ahí `border-accion` no tiene
 * ningún valor computado que comparar.
 *
 * ## El criterio, y las dos veces que estuvo mal calibrado
 *
 * 1. La primera versión exigía `!` en **toda** clase del `routerLinkActive`. Con dos clases que
 *    compiten daba el resultado correcto, pero habría obligado a poner `!important` en la primera
 *    clase que no compitiera con nada — enseñando el reflejo contrario al que este test existe para
 *    dejar.
 * 2. La segunda solo miraba **colores**, y con eso dejó de ver que `font-bold` en el activo pierde
 *    contra el `font-medium` de la base: el tab activo no se pondría en negrita, con el test en verde.
 *    Se generalizó desde el único ejemplo examinado (`font-semibold`, que sí gana solo) tomando por
 *    propiedad de la familia lo que era suerte alfabética de ese valor.
 *
 * Lo que decide de verdad son **dos** cosas, y el criterio de acá abajo mira las dos: que las clases
 * pisen la misma propiedad, y **cuál de las dos va después en la hoja**.
 */
const fuente = readFileSync(new URL('./cliente-ficha.ts', import.meta.url), 'utf8');

/**
 * Los colores que puede llevar una utilidad: los 17 roles del portal (la fuente de verdad es
 * `core/contraste.ts`, importada y no copiada — agregar un rol no desincroniza este test) más las
 * palabras clave que Tailwind también emite.
 */
const COLORES = new Set([...TOKENS, 'transparent', 'current', 'inherit']);

/** Los valores de `font-*` que fijan `font-weight`, y los que fijan `font-family`. No se pisan. */
const PESOS = new Set([
  'thin', 'extralight', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold', 'black',
]);
const TIPOGRAFIAS = new Set(['sans', 'serif', 'mono']);

/** Ídem para `text-*`, que en Tailwind es tres utilidades distintas: color, tamaño y alineación. */
const TAMANOS = new Set(['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl', '7xl']);
const ALINEACIONES = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

/**
 * Qué propiedad CSS pisa una utilidad. Dos clases compiten si —y solo si— devuelven lo mismo.
 *
 * El discriminante es el VALOR, no el prefijo: `text-*` son tres utilidades que no se pisan entre sí
 * (`text-texto` pinta `color`, `text-sm` fija `font-size`, `text-center` alinea), y lo mismo pasa con
 * `font-*` (peso vs familia tipográfica) y `border-*` (color vs ancho). Agrupar por prefijo a secas
 * reintroduciría el falso positivo de la primera versión.
 *
 * Para lo que no reconoce cae en `familia:?`, que agrupa por prefijo: es el lado seguro del error
 * —puede pedir un `!` de más, nunca dejar pasar una colisión— y el rojo se lee y se corrige, mientras
 * que un verde de más no se ve.
 */
function grupoDePropiedad(clase: string): string | null {
  const limpia = clase.replace(/!$/, '');
  // Una variante (`hover:`, `focus:`) no pisa el estado normal: no compite, y contarla haría pedir un
  // `!` para ganarle a un hover que ni siquiera está activo.
  if (limpia.includes(':')) return null;
  const corte = limpia.indexOf('-');
  if (corte < 0) return null; // `italic`, `uppercase`: sin familia con la que comparar
  const familia = limpia.slice(0, corte);
  const valor = limpia.slice(corte + 1);

  if (COLORES.has(valor)) return `${familia}:color`;
  if (familia === 'font' && PESOS.has(valor)) return 'font:peso';
  if (familia === 'font' && TIPOGRAFIAS.has(valor)) return 'font:tipografía';
  if (familia === 'text' && TAMANOS.has(valor)) return 'text:tamaño';
  if (familia === 'text' && ALINEACIONES.has(valor)) return 'text:alineación';
  return `${familia}:?`;
}

/**
 * Qué clase de la base le gana a `activa` — o `null` si no la pisa ninguna.
 *
 * **Tailwind emite las utilidades por orden alfabético de nombre de clase, y eso está medido, no
 * supuesto.** Offsets dentro de `dist/portal-dev/browser/styles.css` (26 257 bytes) el 2026-08-11,
 * cinco pares de cuatro familias independientes — en los cinco gana el mayor alfabético:
 *
 * | Antes | Después (gana) |
 * |---|---|
 * | `.border-accion` 13345 | `.border-transparent` 13592 |
 * | `.text-texto` 17867 | `.text-texto-tenue` 18092 |
 * | `.font-bold` 17129 | `.font-medium` 17237 |
 * | `.font-medium` 17237 | `.font-semibold` 17351 |
 * | `.bg-superficie` 14149 | `.bg-superficie-2` 14213 |
 *
 * Las dos filas de `font-*` son las que descartan la otra hipótesis: si el orden fuera el de
 * definición del tema (thin, extralight, light, normal, medium, semibold, **bold**…), `font-bold`
 * saldría DESPUÉS de `font-semibold`. Sale antes. Es alfabético.
 *
 * Los offsets absolutos se mueven con cada build (el bundle crece); **el orden es lo único de lo que
 * depende esto**. Si algún día Tailwind cambiara ese orden, lo que hay que rehacer es esta función —
 * no aflojar el test.
 */
function pisadaPor(activa: string, base: readonly string[]): string | null {
  const grupo = grupoDePropiedad(activa);
  if (grupo === null) return null;
  const nombre = activa.replace(/!$/, '');
  for (const clase of base) {
    const suya = clase.replace(/!$/, '');
    if (grupoDePropiedad(clase) !== grupo) continue;
    if (nombre < suya) return suya; // va después en la hoja: la pisa
  }
  return null;
}

/** El `<a>` de la barra de tabs, con sus dos listas de clases. */
function anclaDeTabs(): { activas: string[]; base: string[] } {
  const ancla = [...fuente.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .find((a) => a.includes('routerLinkActive='));
  assert.ok(ancla, 'no encontré el <a> de la barra de tabs con su routerLinkActive');
  const activas = /routerLinkActive="([^"]+)"/.exec(ancla)?.[1];
  const base = /\bclass="([^"]+)"/.exec(ancla)?.[1];
  assert.ok(activas, 'el <a> de los tabs no tiene routerLinkActive');
  assert.ok(base, 'el <a> de los tabs no tiene class');
  return { activas: activas.split(/\s+/).filter(Boolean), base: base.split(/\s+/).filter(Boolean) };
}

test('🔴 toda clase activa del tab a la que la base le gana lleva `!`: si no, el activo no se distingue', () => {
  const { activas, base } = anclaDeTabs();
  assert.ok(activas.length >= 2, `esperaba al menos 2 clases activas, encontré ${activas.length}`);

  const pisadas = activas
    .map((clase) => ({ clase, por: pisadaPor(clase, base) }))
    .filter((x): x is { clase: string; por: string } => x.por !== null);

  // Si el barrido dejara de encontrar colisiones (un regex desactualizado, un template reescrito), el
  // bucle de abajo no correría y el test pasaría sin haber probado nada.
  assert.ok(
    pisadas.length >= 2,
    `esperaba al menos las 2 colisiones conocidas (border-*, text-*), encontré ${pisadas.length}: ` +
      `activas=[${activas.join(' ')}] base=[${base.join(' ')}]`,
  );

  for (const { clase, por } of pisadas) {
    assert.ok(
      clase.endsWith('!'),
      `\`${clase}\` no lleva \`!\` y \`${por}\` (del estado inactivo) va después en la hoja, así que la ` +
        'pisa: el tab activo se vería igual que los demás. Tailwind emite por orden alfabético, y el ' +
        'orden del atributo `class` no decide nada.',
    );
  }
});

test('el criterio de colisión mira la propiedad Y el orden de emisión, no solo el prefijo', () => {
  // Sin esto, «compite por propiedad y pierde por orden» sería una afirmación del docblock: el test de
  // arriba podría estar exigiendo `!` a cualquier cosa, o a nada, sin que se note.
  const base = ['border-b-2', 'border-transparent', 'text-texto-tenue', 'font-medium', 'text-sm', 'hover:text-texto'];

  // Las dos colisiones reales de hoy: la base va después en la hoja y las pisa.
  assert.equal(pisadaPor('border-accion', base), 'border-transparent');
  assert.equal(pisadaPor('text-texto', base), 'text-texto-tenue');

  // La familia que el criterio anterior no miraba. `font-bold` < `font-medium`: la base gana.
  assert.equal(pisadaPor('font-bold', base), 'font-medium', 'font-bold pierde contra font-medium');
  // Y su vecino, que gana solo — el caso que hace que «misma familia» a secas sea demasiado grueso.
  assert.equal(pisadaPor('font-semibold', base), null, 'font-semibold va después: no necesita `!`');

  // Propiedades distintas que comparten prefijo: en Tailwind no se pisan. `text-lg` es la prueba
  // fina de que el criterio no mezcla las tres caras de `text-*`: se saltea el `text-texto-tenue` de
  // la base (que es color) y va a chocar con el `text-sm` (que sí es tamaño, y le gana).
  assert.equal(pisadaPor('text-lg', base), 'text-sm', 'text-lg compite por TAMAÑO, no por color');
  assert.equal(pisadaPor('text-xs', base), null, 'text-xs también es tamaño, pero va después: gana');
  assert.equal(pisadaPor('text-center', base), null, 'text-center alinea; no pinta ni dimensiona');
  assert.equal(pisadaPor('font-serif', base), null, 'font-serif es familia tipográfica, no peso');
  // Ídem del lado del borde: `border-2` no choca con `border-transparent` (que es color) sino con el
  // `border-b-2` de la base, que también fija ancho — y que le gana.
  assert.equal(pisadaPor('border-2', base), 'border-b-2', 'border-2 compite por ANCHO, no por color');

  // Y lo que no compite con nada de la base no necesita nada.
  assert.equal(pisadaPor('rounded-t', base), null);
  assert.equal(pisadaPor('bg-superficie', base), null, 'la base no tiene ningún bg-*');
  assert.equal(pisadaPor('hover:text-texto', base), null, 'una variante no pisa el estado normal');

  // El grupo, directamente: las tres caras de `text-*` no se mezclan entre sí.
  assert.equal(grupoDePropiedad('text-texto'), 'text:color');
  assert.equal(grupoDePropiedad('text-sm'), 'text:tamaño');
  assert.equal(grupoDePropiedad('text-center'), 'text:alineación');
  assert.equal(grupoDePropiedad('font-bold'), 'font:peso');
  assert.equal(grupoDePropiedad('font-mono'), 'font:tipografía');
  assert.equal(grupoDePropiedad('border-accion!'), 'border:color', 'el `!` no cambia qué propiedad pisa');
});

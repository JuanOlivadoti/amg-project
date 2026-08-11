import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOKENS } from '../../core/contraste';

/**
 * La marca del tab activo, defendida.
 *
 * Entre dos utilidades de Tailwind que pisan la misma propiedad con la misma especificidad gana la
 * que va DESPUÉS en la hoja de estilos, y Tailwind las emite por orden alfabético — el orden dentro
 * del atributo `class` no decide nada. Medido sobre el CSS servido el 2026-08-11:
 * `.border-accion` en el offset 13054 y `.border-transparent` en 13232; `.text-texto` en 17451 y
 * `.text-texto-tenue` en 17618. O sea: las dos clases que marcan el tab activo PIERDEN contra las
 * dos del estado inactivo, y sin el `!` el tab activo se ve idéntico a los demás.
 *
 * Es una garantía silenciosa de manual: las dos clases están en el elemento (un test de DOM las
 * encuentra y pasa), no hay error en consola, y el único síntoma es visual. Se descubrió manejando
 * la app, no leyendo el código. Por eso se fija leyendo el FUENTE — mismo patrón que el test de
 * `paramsInheritanceStrategy` en `app.routes.test.ts` y que `core/sin-html-crudo.test.ts`.
 *
 * Karma no puede cubrirlo: los specs de componente no compilan Tailwind, así que ahí `border-accion`
 * no tiene ningún valor computado que comparar.
 *
 * **El `!` se exige solo donde hace falta**, y eso es deliberado. La primera versión lo pedía en
 * TODA clase del `routerLinkActive`; con dos clases que compiten daba el mismo resultado, pero las
 * tareas 2 y 4 amplían esta barra de tabs, y el día que alguien agregue un `font-semibold` al estado
 * activo el test le habría exigido un `!important` que no arregla nada. Un test que fuerza
 * `!important` gratuito enseña el reflejo contrario al que este hallazgo quería dejar. Así que se
 * compara por FAMILIA de color: una clase activa necesita `!` si —y solo si— la clase base tiene
 * otra clase de color de su misma familia (`border-*` contra `border-*`, `text-*` contra `text-*`).
 */
const fuente = readFileSync(new URL('./cliente-ficha.ts', import.meta.url), 'utf8');

/**
 * Los colores que puede llevar una utilidad: los 17 roles del portal (la fuente de verdad es
 * `core/contraste.ts`, no una copia) más las palabras clave de CSS que Tailwind también emite.
 *
 * Sirve para separar `text-texto-tenue` (color, compite) de `text-sm` (tamaño, no compite) y
 * `border-transparent` (color) de `border-b-2` (ancho) — que es justo la distinción que hace que
 * este test pida `!` donde importa y se calle donde no.
 */
const COLORES = new Set([...TOKENS, 'transparent', 'current', 'inherit']);

/** `border-accion!` → `{ familia: 'border', color: 'accion' }`; `text-sm` → `null` (no es color). */
function color(clase: string): { familia: string; color: string } | null {
  const limpia = clase.replace(/!$/, '');
  // Una variante (`hover:`, `focus:`) no pisa el estado normal: no compite, y contarla haría pedir
  // un `!` para ganarle a un hover que ni siquiera está activo.
  if (limpia.includes(':')) return null;
  const corte = limpia.indexOf('-');
  if (corte < 0) return null;
  const familia = limpia.slice(0, corte);
  const resto = limpia.slice(corte + 1);
  return COLORES.has(resto) ? { familia, color: resto } : null;
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

test('🔴 toda clase activa del tab que compite con la base lleva `!`: sin eso el activo no se distingue', () => {
  const { activas, base } = anclaDeTabs();
  assert.ok(activas.length >= 2, `esperaba al menos 2 clases activas, encontré ${activas.length}`);

  const familiasDeLaBase = new Set(
    base.map(color).filter((c) => c !== null).map((c) => c.familia),
  );

  const competidoras = activas.filter((clase) => {
    const c = color(clase);
    return c !== null && familiasDeLaBase.has(c.familia);
  });

  // Si el barrido dejara de encontrar colisiones (un regex que se desactualiza, un template
  // reescrito), el bucle de abajo no correría y el test pasaría sin haber probado nada.
  assert.ok(
    competidoras.length >= 2,
    `esperaba al menos las 2 colisiones conocidas (border-*, text-*), encontré ${competidoras.length}: ` +
      `activas=[${activas.join(' ')}] base=[${base.join(' ')}]`,
  );

  for (const clase of competidoras) {
    assert.ok(
      clase.endsWith('!'),
      `\`${clase}\` compite con una clase \`${color(clase)?.familia}-*\` del estado inactivo y no ` +
        'lleva `!`: la base la pisa y el tab activo se ve igual que los demás (Tailwind emite las ' +
        'utilidades por orden alfabético, así que el orden del atributo class no decide nada)',
    );
  }
});

test('el criterio de colisión distingue color de tamaño, y ve la variante como no competitiva', () => {
  // Sin esto, «compite por familia» sería una afirmación del docblock y no una regla verificada — y
  // el test de arriba podría estar exigiendo `!` a cualquier cosa, o a nada, sin que se note.
  assert.deepEqual(color('border-accion!'), { familia: 'border', color: 'accion' });
  assert.deepEqual(color('text-texto-tenue'), { familia: 'text', color: 'texto-tenue' });
  assert.equal(color('text-sm'), null, 'text-sm es un tamaño, no un color: no compite');
  assert.equal(color('border-b-2'), null, 'border-b-2 es un ancho, no un color: no compite');
  assert.equal(color('font-medium'), null, 'font-medium no pisa ningún color');
  assert.equal(color('hover:text-texto'), null, 'una variante no pisa el estado normal');
});

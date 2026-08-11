import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
 */
const fuente = readFileSync(new URL('./cliente-ficha.ts', import.meta.url), 'utf8');

test('🔴 las clases de routerLinkActive del tab llevan `!`: sin eso el activo no se distingue', () => {
  const m = /routerLinkActive="([^"]+)"/.exec(fuente);
  assert.ok(m?.[1], 'no encontré el routerLinkActive de la barra de tabs');

  const clases = m[1].split(/\s+/).filter(Boolean);
  assert.ok(clases.length >= 2, `esperaba al menos 2 clases activas, encontré ${clases.length}`);

  for (const clase of clases) {
    assert.ok(
      clase.endsWith('!'),
      `\`${clase}\` no lleva \`!\`: la clase base del estado inactivo la pisa y el tab activo se ` +
        've igual que los demás (Tailwind emite las utilidades por orden alfabético)',
    );
  }
});

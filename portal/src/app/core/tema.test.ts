import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { CLASE_OSCURO, CLAVE_TEMA, parseTema, siguienteTema, temaEfectivo } from './tema';
import type { Tema } from './tema';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

/**
 * Corre el script inline de `index.html` de verdad, en un contexto con `localStorage`, `matchMedia` y
 * `document` falsos, y devuelve si le puso la clase a `<html>`.
 *
 * Existe porque el script **duplica** `temaEfectivo` (tiene que correr antes de que exista el bundle)
 * y una duplicación que nadie verifica diverge en silencio. De hecho ya había divergido: con la
 * condición `(t === 'auto' || !t)`, un valor basura en `localStorage` con el sistema en oscuro
 * pintaba claro acá y oscuro al bootear — el fogonazo que el script viene a evitar, invertido.
 */
function correrScriptInline(guardado: string | null, sistemaOscuro: boolean): boolean {
  const m = /<script>([\s\S]*?)<\/script>/.exec(HTML);
  assert.ok(m?.[1], 'no encontré el script inline en index.html');
  const clases = new Set<string>();
  const contexto: Record<string, unknown> = {
    localStorage: { getItem: (k: string) => (k === CLAVE_TEMA ? guardado : null) },
    matchMedia: (consulta: string) => ({ matches: consulta.includes('dark') && sistemaOscuro }),
    document: { documentElement: { classList: { add: (c: string) => clases.add(c) } } },
  };
  vm.runInNewContext(m[1], contexto);
  return clases.has(CLASE_OSCURO);
}

test('parseTema acepta los tres temas', () => {
  for (const t of ['auto', 'claro', 'oscuro'] as Tema[]) {
    assert.equal(parseTema(t), t);
  }
});

test('parseTema cae en auto ante cualquier cosa que no reconozca', () => {
  // Un localStorage viejo o manipulado no debería fabricar estado: espeja a `parseSesion`.
  for (const basura of [null, '', 'azul', 'Oscuro', 'AUTO', '{"tema":"oscuro"}', ' claro']) {
    assert.equal(parseTema(basura), 'auto', `${JSON.stringify(basura)} no debería elegir el tema`);
  }
});

test('siguienteTema cicla auto → claro → oscuro → auto', () => {
  assert.equal(siguienteTema('auto'), 'claro');
  assert.equal(siguienteTema('claro'), 'oscuro');
  assert.equal(siguienteTema('oscuro'), 'auto');
  // Tres toques vuelven al principio: el botón no puede quedar en un estado sin salida.
  let t: Tema = 'auto';
  for (let i = 0; i < 3; i++) t = siguienteTema(t);
  assert.equal(t, 'auto');
});

test('temaEfectivo: en auto sigue al sistema', () => {
  assert.equal(temaEfectivo('auto', true), 'oscuro');
  assert.equal(temaEfectivo('auto', false), 'claro');
});

test('🔴 temaEfectivo: una preferencia explícita MANDA sobre el sistema', () => {
  // La garantía de la pieza: si el usuario eligió, el sistema no lo mueve. Vive acá, en una función
  // pura, y no en el listener del servicio: así se puede probar sin DOM.
  assert.equal(temaEfectivo('claro', true), 'claro', 'el sistema en oscuro no puede pisar "claro"');
  assert.equal(temaEfectivo('claro', false), 'claro');
  assert.equal(temaEfectivo('oscuro', false), 'oscuro', 'el sistema en claro no puede pisar "oscuro"');
  assert.equal(temaEfectivo('oscuro', true), 'oscuro');
});

test('🔴 el script inline de index.html no se separa de tema.ts', () => {
  // Ata los NOMBRES; el test de abajo ata el COMPORTAMIENTO. Los dos hacen falta: este falla si
  // alguien renombra la clave o la clase, aunque la lógica siga siendo equivalente.
  //
  // Se afirma sobre la LLAMADA, no sobre la presencia del string: `'oscuro'` aparece cuatro veces en
  // el script (la variable, la comparación, la clase), así que un `includes(CLASE_OSCURO)` seguía en
  // verde aunque `classList.add` pasara a poner otra clase — el único lugar que importa.
  const html = HTML;
  assert.match(
    html,
    new RegExp(`getItem\\(['"]${CLAVE_TEMA}['"]\\)`),
    `index.html tiene que leer la clave ${CLAVE_TEMA}`,
  );
  assert.match(
    html,
    new RegExp(`classList\\.add\\(['"]${CLASE_OSCURO}['"]\\)`),
    `index.html tiene que aplicar la clase ${CLASE_OSCURO}`,
  );
  assert.ok(
    html.includes('prefers-color-scheme: dark'),
    'index.html tiene que resolver `auto` contra el sistema, como temaEfectivo',
  );
  assert.ok(
    html.indexOf(CLAVE_TEMA) < html.indexOf('<app-root>'),
    'el script tiene que correr ANTES del bundle, o el fogonazo blanco sigue ahí',
  );
});

test('🔴 el script inline decide EXACTAMENTE lo mismo que temaEfectivo, caso por caso', () => {
  // La duplicación es deliberada, pero "deliberada" no es "correcta": se ejecuta el script de verdad
  // y se compara con la función pura en los 20 casos. Es la diferencia entre un comentario que dice
  // que coinciden y una garantía de que coinciden.
  const GUARDADOS = [
    null,
    '',
    'auto',
    'claro',
    'oscuro',
    'azul',
    'Oscuro',
    'AUTO',
    ' claro',
    '{"tema":"oscuro"}',
  ];
  for (const guardado of GUARDADOS) {
    for (const sistemaOscuro of [false, true]) {
      assert.equal(
        correrScriptInline(guardado, sistemaOscuro),
        temaEfectivo(parseTema(guardado), sistemaOscuro) === 'oscuro',
        `divergen para ${JSON.stringify(guardado)} con el sistema en ${
          sistemaOscuro ? 'oscuro' : 'claro'
        }`,
      );
    }
  }
});

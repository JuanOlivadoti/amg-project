import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLASE_OSCURO, CLAVE_TEMA, parseTema, siguienteTema, temaEfectivo } from './tema';
import type { Tema } from './tema';

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
  // Test tosco a propósito: no puede probar que la lógica coincida, pero sí que nadie renombre una
  // de las dos puntas sin ver la otra. El script DUPLICA `temaEfectivo` porque corre antes del bundle.
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(html.includes(CLAVE_TEMA), `index.html tiene que leer la clave ${CLAVE_TEMA}`);
  assert.ok(html.includes(CLASE_OSCURO), `index.html tiene que aplicar la clase ${CLASE_OSCURO}`);
  assert.ok(
    html.includes('prefers-color-scheme: dark'),
    'index.html tiene que resolver `auto` contra el sistema, como temaEfectivo',
  );
  assert.ok(
    html.indexOf(CLAVE_TEMA) < html.indexOf('<app-root>'),
    'el script tiene que correr ANTES del bundle, o el fogonazo blanco sigue ahí',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AA_TEXTO_NORMAL, PARES, TOKENS, luminancia, parsearTokens, ratio } from './contraste';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const TEMAS = [
  ['claro', parsearTokens(css, ':root')],
  ['oscuro', parsearTokens(css, '.oscuro')],
] as const;

test('luminancia y ratio: los extremos conocidos de WCAG', () => {
  assert.equal(luminancia('#ffffff'), 1);
  assert.equal(luminancia('#000000'), 0);
  assert.equal(ratio('#ffffff', '#000000').toFixed(0), '21');
  assert.equal(ratio('#ffffff', '#ffffff'), 1);
  // Simétrico: el orden de los argumentos no cambia el contraste.
  assert.equal(ratio('#15803d', '#ffffff'), ratio('#ffffff', '#15803d'));
});

test('🔴 los dos temas definen exactamente los mismos 16 tokens', () => {
  // Un token que falte en `.oscuro` NO da error: hereda el valor claro de `:root` y se ve mal en
  // silencio. Por eso se afirma la igualdad de los dos juegos de nombres, no solo su presencia.
  for (const [nombre, tokens] of TEMAS) {
    assert.deepEqual(
      Object.keys(tokens).sort(),
      [...TOKENS].sort(),
      `el tema ${nombre} no define los 16 tokens exactos`,
    );
  }
});

test('🔴 los 17 pares de la UI llegan a AA en los dos temas', () => {
  for (const [nombre, tokens] of TEMAS) {
    for (const [frente, fondo] of PARES) {
      const a = tokens[frente];
      const b = tokens[fondo];
      assert.ok(a && b, `faltan valores para ${frente}/${fondo} en el tema ${nombre}`);
      const r = ratio(a, b);
      assert.ok(
        r >= AA_TEXTO_NORMAL,
        `${nombre}: ${frente} sobre ${fondo} da ${r.toFixed(2)}:1, y AA pide ${AA_TEXTO_NORMAL}:1`,
      );
    }
  }
});

test('parsearTokens grita si el selector no está', () => {
  assert.throws(() => parsearTokens(css, '.no-existe'), /no encontré el selector/);
});

test('🔴 parsearTokens no se come una MENCIÓN del selector en un comentario', () => {
  // El fallo silencioso más grave posible de esta suite: si `.oscuro` resuelve al bloque de `:root`,
  // las 34 aserciones comparan el tema claro contra sí mismo y pasan SIEMPRE. Y pasa de verdad —
  // los comentarios de `styles.css` nombran los dos selectores para explicar la especificidad.
  const trampa = `/* .oscuro va en <html>, que también es :root */
:root { --fondo: #ffffff; }
.oscuro { --fondo: #000000; }`;
  assert.equal(parsearTokens(trampa, ':root')['fondo'], '#ffffff');
  assert.equal(
    parsearTokens(trampa, '.oscuro')['fondo'],
    '#000000',
    'se llevó el bloque de :root: el test de contraste quedaría comparando claro contra claro',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearMarkdown } from './markdown';
import { bloquesAHtml, bloquesATexto } from './markdown-render';

test('un párrafo con negrita sale como <p><strong>…</strong></p> en html, y sin marcas en texto', () => {
  const bloques = parsearMarkdown('Hola **mundo**.');
  assert.equal(bloquesAHtml(bloques), '<p>Hola <strong>mundo</strong>.</p>');
  assert.equal(bloquesATexto(bloques), 'Hola mundo.');
});

test('🔴 un `<` o `>` del dato se escapa en el HTML: si no, rompe la etiqueta que arma esta función', () => {
  const bloques = parsearMarkdown('cobertura < 500€ y > 100€');
  const html = bloquesAHtml(bloques);
  assert.ok(html.includes('&lt;'), `esperaba "&lt;" en: ${html}`);
  assert.ok(html.includes('&gt;'), `esperaba "&gt;" en: ${html}`);
  assert.ok(!html.includes('< 500€'), 'el "<" crudo se coló sin escapar');
});

test('encabezados van a h1/h2/h3 según su nivel', () => {
  const bloques = parsearMarkdown('# Uno\n\n## Dos\n\n### Tres');
  assert.equal(bloquesAHtml(bloques), '<h1>Uno</h1><h2>Dos</h2><h3>Tres</h3>');
});

test('una lista sale como <ul><li>… en html, y con guiones en texto plano', () => {
  const bloques = parsearMarkdown('- primera\n- segunda');
  assert.equal(bloquesAHtml(bloques), '<ul><li>primera</li><li>segunda</li></ul>');
  assert.equal(bloquesATexto(bloques), '- primera\n- segunda');
});

test('una tabla conserva cabecera y filas en los dos formatos', () => {
  const bloques = parsearMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
  const html = bloquesAHtml(bloques);
  assert.ok(html.startsWith('<table>'), html);
  assert.ok(html.includes('<th>a</th><th>b</th>'), html);
  assert.ok(html.includes('<td>1</td><td>2</td>'), html);
  assert.equal(bloquesATexto(bloques), 'a | b\n1 | 2');
});

test('un bloque vacío devuelve cadena vacía en los dos formatos', () => {
  assert.equal(bloquesAHtml([]), '');
  assert.equal(bloquesATexto([]), '');
});

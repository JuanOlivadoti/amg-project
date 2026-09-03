import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlATextoPlano } from './html-a-texto';

/**
 * El respaldo `text/plain` del botón "Copiar" (Task 11, Step 3.5): el MISMO `post_cuerpo` sanitizado
 * (allowlist de `db/src/sanitizar-html.ts`: p, br, strong, em, b, i, u, h2-4, ul, ol, li, blockquote,
 * a), sin las tags — para pegar en un campo que solo acepta texto plano. No es un sanitizador: el
 * HTML de entrada YA pasó por `sanitizarHtml` en el servidor. Esto solo quita marcado.
 */

test('un párrafo simple pierde sus tags', () => {
  assert.equal(htmlATextoPlano('<p>Hola mundo</p>'), 'Hola mundo');
});

test('negrita/énfasis inline se aplanan a su texto, sin espacios de más', () => {
  assert.equal(htmlATextoPlano('<p>Hola <strong>mundo</strong> y <em>más</em></p>'), 'Hola mundo y más');
});

test('dos párrafos quedan separados por un salto de línea, no pegados', () => {
  assert.equal(htmlATextoPlano('<p>Uno</p><p>Dos</p>'), 'Uno\nDos');
});

test('un <br> se convierte en salto de línea', () => {
  assert.equal(htmlATextoPlano('<p>Uno<br>Dos</p>'), 'Uno\nDos');
});

test('una lista: cada <li> en su propia línea', () => {
  assert.equal(htmlATextoPlano('<ul><li>Uno</li><li>Dos</li></ul>'), 'Uno\nDos');
});

test('encabezados y cita quedan en su propia línea', () => {
  assert.equal(
    htmlATextoPlano('<h2>Título</h2><p>Texto</p><blockquote>Cita</blockquote>'),
    'Título\nTexto\nCita',
  );
});

test('un link conserva el texto visible, no el href', () => {
  assert.equal(htmlATextoPlano('<p>Mirá <a href="https://x.test">acá</a></p>'), 'Mirá acá');
});

test('🔴 saltos de línea repetidos no se acumulan sin límite (varios bloques vacíos seguidos)', () => {
  assert.equal(htmlATextoPlano('<p>Uno</p><p></p><p></p><p>Dos</p>'), 'Uno\n\nDos');
});

test('sin tags de por medio, el texto vuelve intacto', () => {
  assert.equal(htmlATextoPlano('Texto plano sin ninguna tag'), 'Texto plano sin ninguna tag');
});

test('string vacío da string vacío', () => {
  assert.equal(htmlATextoPlano(''), '');
});

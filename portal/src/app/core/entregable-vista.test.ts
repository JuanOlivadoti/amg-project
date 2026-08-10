import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearMarkdown } from './markdown';
import { partirEncabezado } from './entregable-vista';

/** La cabecera real que emite `renderReport` (`contrato/src/informe.ts`), medida el 2026-08-07. */
const REAL = [
  '# Keyword Research — Borcelle Burger',
  '',
  '_ES · es · 2026-07-30T00:16:15.000Z_',
  '',
  '- Keywords analizadas: **55**',
  '- Páginas propuestas: **14**',
].join('\n');

test('el título sale del h1 del documento, con el nombre del cliente', () => {
  const { titulo } = partirEncabezado(parsearMarkdown(REAL));
  assert.equal(titulo, 'Keyword Research — Borcelle Burger');
});

test('🔴 el h1 NO se repite en el cuerpo: pasó a ser el encabezado del documento', () => {
  // Sin esto, la página imprime el título dos veces —una en el <header> y otra como primer bloque—,
  // y un lector de pantalla ve dos h1 en el mismo documento.
  const { cuerpo } = partirEncabezado(parsearMarkdown(REAL));
  assert.ok(
    !cuerpo.some((b) => b.tipo === 'encabezado' && b.nivel === 1),
    'quedó un h1 en el cuerpo',
  );
  // Y no se llevó nada más por delante: lo que seguía al h1 sigue estando.
  assert.equal(cuerpo.length, parsearMarkdown(REAL).length - 1);
});

test('🔴 un documento que NO empieza con h1 no pierde nada, y no se le inventa título', () => {
  /*
   * Falla CERRADO, igual que el parser de Markdown con una marca desconocida: si el generador cambia
   * su cabecera —o la API devuelve otra cosa— la alternativa a esto es que el primer bloque del
   * entregable desaparezca en silencio de la hoja que ve el restaurante.
   */
  const bloques = parsearMarkdown('Un párrafo suelto.\n\n## Sección\n');
  const { titulo, cuerpo } = partirEncabezado(bloques);
  assert.equal(titulo, null);
  assert.deepEqual(cuerpo, bloques, 'el cuerpo tiene que quedar entero');
});

test('🔴 un h2 al principio NO se toma por título: solo el h1 es el título', () => {
  // `nivel === 1` y no `tipo === 'encabezado'` a secas: con la condición floja, un documento que
  // arrancara con `## Páginas propuestas` perdería esa sección y la mostraría como título.
  const bloques = parsearMarkdown('## Páginas propuestas\n\nTexto.\n');
  const { titulo, cuerpo } = partirEncabezado(bloques);
  assert.equal(titulo, null);
  assert.deepEqual(cuerpo, bloques);
});

test('el título conserva el texto de las marcas inline, sin los delimitadores', () => {
  // `Inline` es una unión de cuatro variantes y TODAS llevan `valor`; el título es la concatenación
  // del texto, no del Markdown. Un cliente llamado `Bar **X**` sale como `Bar X`, no como `Bar **X**`.
  const { titulo } = partirEncabezado(parsearMarkdown('# Keyword Research — **Bar X**\n'));
  assert.equal(titulo, 'Keyword Research — Bar X');
});

test('un documento vacío no revienta: sin título y sin cuerpo', () => {
  const { titulo, cuerpo } = partirEncabezado(parsearMarkdown(''));
  assert.equal(titulo, null);
  assert.deepEqual(cuerpo, []);
});

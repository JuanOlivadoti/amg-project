import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsearMarkdown, type Bloque } from './markdown';

/*
 * El fixture de abajo es la salida REAL de `renderReport` (`contrato/src/informe.ts`), copiada
 * literalmente, con los tres huecos `n/d` del informe de la demo (el desglose de coste no registrado y
 * las dos coberturas). Se regenera con:
 *
 *   npx tsx -e "import {renderReport} from './contrato/src/index.js';
 *               import {briefM2} from './contrato/src/fixtures.js';
 *               const b = briefM2(); b.meta_run.coste_breakdown = {};
 *               b.meta_run.calidad_datos = {cobertura_volumen:null, cobertura_kd:null, endpoints_degradados:null};
 *               b.paginas_propuestas[0].volumen = null; b.paginas_propuestas[0].dificultad = null;
 *               console.log(renderReport(b))"
 *
 * Va copiado y no importado a propósito: el portal está FUERA del monorepo y no depende de `contrato`.
 * Un import acá sería una dependencia nueva, que es justo lo que esta tarea no hace.
 */
const INFORME_REAL = [
  '# Keyword Research — Borcelle Burger',
  '',
  '_ES · es · 2026-07-30T12:00:00.000Z_',
  '',
  '- Keywords analizadas: **55**',
  '- Páginas propuestas: **1**',
  '',
  '### Coste del research',
  '',
  '- Coste total: **$0.3097**',
  '',
  '> El **desglose** por proveedor no quedó registrado en esta corrida. El total sí, y es el de arriba: lo que falta es saber en qué se repartió.',
  '',
  '### Calidad de los datos',
  '',
  '| Métrica | Cobertura |',
  '|---|---|',
  '| Keywords con **volumen** conocido | **n/d** |',
  '| Keywords con **dificultad (KD)** conocida | **n/d** |',
  '',
  '> ⚠️ **No se registró** si algún endpoint de datos falló durante esta corrida. Que no haya fallos anotados no es lo mismo que no haber tenido ninguno.',
  '',
  '## Páginas propuestas',
  '',
  '### ✅ Respaldadas por datos de mercado (1)',
  '',
  'Hay demanda de búsqueda **demostrable** detrás de estas páginas.',
  '',
  '| # | Tipo | Keyword principal | Vol. | KD | Score | Conf. | Intención |',
  '|---|---|---|---|---|---|---|---|',
  '| 1 | landing\\_local | hamburgueseria madrid centro | n/d | n/d | 78 | 0.9 | local (local) |',
  '',
  '> **n/d** = el proveedor de datos no devolvió la métrica para esa keyword. **No es un 0**: es un dato que no tenemos, y por eso esas páginas van con la confianza baja.',
  '',
  '## Detalle por página',
  '',
  '### 1. Hamburguesería en Madrid Centro',
  '- **Slug:** `/hamburgueseria-madrid-centro` · **Tipo:** landing\\_local · **Schema:** LocalBusiness',
  '- **Meta title:** Hamburguesería en Madrid Centro',
  '- **Meta description:** Hamburguesas de autor en el centro de Madrid.',
  '- **Keyword principal:** hamburgueseria madrid centro (vol n/d · KD n/d)',
  '- **Secundarias:** hamburguesa de autor madrid',
  '- **Secciones:** La carta · Los locales',
  '- **FAQs:** _¿Hacen reservas?_',
  '',
  '## Backlog (fases futuras)',
  '',
  '- cerveza artesanal madrid — score 41',
  '',
].join('\n');

/** Todo el texto plano de un bloque, para afirmar sobre lo que el lector ve. */
function textoDe(b: Bloque): string {
  const inlines =
    b.tipo === 'lista'
      ? b.items.flat()
      : b.tipo === 'tabla'
        ? [...b.cabecera.flat(), ...b.filas.flat(2)]
        : b.texto;
  return inlines.map((i) => i.valor).join('');
}

// ---------------------------------------------------------------------------
// Los seis tests del brief (contados en el plan de T6: son seis bloques `test(...)`, no siete)
// ---------------------------------------------------------------------------

test('encabezados de los tres niveles', () => {
  const bs = parsearMarkdown('# Uno\n\n## Dos\n\n### Tres');
  assert.deepEqual(
    bs.map((b) => [b.tipo, b.tipo === 'encabezado' ? b.nivel : null]),
    [
      ['encabezado', 1],
      ['encabezado', 2],
      ['encabezado', 3],
    ],
  );
});

test('una tabla con cabecera y filas', () => {
  const bs = parsearMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |');
  assert.equal(bs.length, 1);
  const t = bs[0]!;
  assert.equal(t.tipo, 'tabla');
  if (t.tipo !== 'tabla') return;
  assert.equal(t.cabecera.length, 2);
  assert.equal(t.filas.length, 2);
});

test('listas, citas y énfasis', () => {
  const bs = parsearMarkdown('- uno\n- dos\n\n> una cita\n\nun **fuerte** y un _suave_ y un `codigo`');
  assert.equal(bs[0]?.tipo, 'lista');
  assert.equal(bs[1]?.tipo, 'cita');
  const p = bs[2]!;
  assert.equal(p.tipo, 'parrafo');
  if (p.tipo !== 'parrafo') return;
  assert.deepEqual(
    p.texto.filter((i) => i.tipo !== 'texto').map((i) => [i.tipo, i.valor]),
    [
      ['negrita', 'fuerte'],
      ['cursiva', 'suave'],
      ['codigo', 'codigo'],
    ],
  );
});

test('🔴 el HTML crudo NO es una marca: sale como TEXTO', () => {
  /*
   * La garantía central. El informe lleva texto de LLM (h1, meta_description, FAQs), así que el paso
   * Markdown → pantalla es por definición superficie de inyección. Acá se comprueba que el parser no
   * produce ninguna estructura "html": lo único que puede salir son strings, que Angular escapa.
   */
  for (const hostil of [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '<iframe src="javascript:alert(1)">',
    '<div onclick="alert(1)">hola</div>',
  ]) {
    const bs = parsearMarkdown(hostil);
    const plano = JSON.stringify(bs);
    assert.equal(bs.length, 1);
    assert.equal(bs[0]?.tipo, 'parrafo', `${hostil} tiene que ser un párrafo de texto`);
    assert.match(plano, /"tipo":"texto"/, 'el contenido va como texto');
    assert.doesNotMatch(plano, /"tipo":"html"/, 'no existe un bloque html, y no debe existir nunca');
  }
});

test('🔴 una marca DESCONOCIDA se pinta literal, no se interpreta a medias', () => {
  // Falla cerrado: lo que el generador no emite, el parser no inventa.
  const bs = parsearMarkdown('![una imagen](http://ejemplo.com/x.png)');
  assert.equal(bs[0]?.tipo, 'parrafo');
  assert.match(JSON.stringify(bs), /!\[una imagen\]/, 'se ve tal cual, como texto');
});

test('un informe con datos ausentes se parsea sin perder los `n/d`', () => {
  const bs = parsearMarkdown('| Proveedor | Coste |\n|---|---|\n| DataForSEO | n/d |');
  assert.match(JSON.stringify(bs), /n\/d/);
});

// ---------------------------------------------------------------------------
// Las formas que el generador emite de verdad, y que el brief no lista
// ---------------------------------------------------------------------------

test('🔴 los escapes del generador se deshacen: el lector ve el dato, no la sintaxis', () => {
  /*
   * `renderReport` escapa `\ | ` * _ # [ ] < >` en todo lo que viene del LLM (`texto()` y `celda()`,
   * KR-2a). Medido sobre su salida real: `landing_local` sale como `landing\_local`. Sin deshacer el
   * escapado, el portal le muestra al cliente la sintaxis del Markdown en vez del dato.
   */
  const bs = parsearMarkdown('landing\\_local y \\*\\*no negrita\\*\\* y \\`no codigo\\` y \\\\ y \\#h');
  const p = bs[0]!;
  assert.equal(p.tipo, 'parrafo');
  if (p.tipo !== 'parrafo') return;
  assert.equal(textoDe(p), 'landing_local y **no negrita** y `no codigo` y \\ y #h');
  // Y lo escapado NO es una marca: todo salió como un único trozo de texto.
  assert.deepEqual(
    p.texto.map((i) => i.tipo),
    ['texto'],
  );
});

test('🔴 un `\\|` escapado NO parte la celda de la tabla', () => {
  /*
   * `celda()` escapa el pipe justamente para que una keyword con `|` no desalinee la tabla de ahí para
   * abajo. Si el parser partiera por cualquier `|`, ese escapado dejaría de servir y la fila tendría
   * una columna de más.
   */
  const bs = parsearMarkdown('| Keyword | Vol. |\n|---|---|\n| burger \\| madrid | 1200 |');
  const t = bs[0]!;
  assert.equal(t.tipo, 'tabla');
  if (t.tipo !== 'tabla') return;
  assert.equal(t.filas[0]?.length, 2, 'dos celdas, no tres');
  assert.equal(t.filas[0]?.[0]?.map((i) => i.valor).join(''), 'burger | madrid');
});

test('dos tablas pegadas siguen siendo dos tablas', () => {
  // El generador siempre deja una línea en blanco entre tablas. Si dejara de hacerlo, la cabecera de
  // la segunda no puede colarse como una fila de datos de la primera.
  const bs = parsearMarkdown('| a |\n|---|\n| 1 |\n| b |\n|---|\n| 2 |');
  assert.deepEqual(
    bs.map((b) => b.tipo),
    ['tabla', 'tabla'],
  );
  assert.equal(bs[0]?.tipo === 'tabla' ? bs[0].filas.length : -1, 1);
  assert.equal(bs[1]?.tipo === 'tabla' ? bs[1].filas.length : -1, 1);
});

test('una tabla sin fila de guiones no es tabla: es un párrafo', () => {
  const bs = parsearMarkdown('| a | b |\n| 1 | 2 |');
  assert.equal(bs.length, 1);
  assert.equal(bs[0]?.tipo, 'parrafo');
  assert.match(JSON.stringify(bs), /\| a \| b \|/);
});

test('un encabezado de cuatro almohadillas no es encabezado: se ve literal', () => {
  // El generador emite hasta `###`. Lo que no emite, no se interpreta.
  const bs = parsearMarkdown('#### Cuatro\n\n#SinEspacio');
  assert.deepEqual(
    bs.map((b) => b.tipo),
    ['parrafo', 'parrafo'],
  );
  assert.equal(textoDe(bs[0]!), '#### Cuatro');
  assert.equal(textoDe(bs[1]!), '#SinEspacio');
});

test('las líneas seguidas de un párrafo van juntas', () => {
  // Una `meta_description` con un salto interno se parte en dos líneas y sigue siendo la misma frase:
  // el generador solo le quita la columna 0 a lo que abriría estructura.
  const bs = parsearMarkdown('linea uno\nlinea dos\n\notro parrafo');
  assert.equal(bs.length, 2);
  assert.equal(textoDe(bs[0]!), 'linea uno linea dos');
  assert.equal(textoDe(bs[1]!), 'otro parrafo');
});

test('🔴 una barra FINAL no desaparece: nada se descarta en silencio', () => {
  /*
   * Sin el guard de longitud en `esEscape`, `charAt` fuera de rango devuelve '' y `includes('')` es
   * true (medido en node v24.18.1): la barra del final contaría como escape y se perdería. Un carácter
   * que desaparece es el mismo fallo que una línea descartada, en pequeño.
   */
  assert.equal(textoDe(parsearMarkdown('una barra al final \\')[0]!), 'una barra al final \\');
  assert.equal(textoDe(parsearMarkdown('\\')[0]!), '\\');
  // Y una barra que no escapa nada del conjunto tampoco se come el carácter siguiente.
  assert.equal(textoDe(parsearMarkdown('c:\\ruta y \\d')[0]!), 'c:\\ruta y \\d');
});

test('una marca sin cerrar sale como el carácter que es', () => {
  const bs = parsearMarkdown('un **sin cerrar y un `tampoco y un _menos');
  assert.equal(textoDe(bs[0]!), 'un **sin cerrar y un `tampoco y un _menos');
  assert.deepEqual(
    bs[0]!.tipo === 'parrafo' ? bs[0]!.texto.map((i) => i.tipo) : [],
    ['texto'],
  );
});

test('el informe REAL del generador se parsea entero, sin bloques desconocidos', () => {
  const bs = parsearMarkdown(INFORME_REAL);
  const tipos = new Set(bs.map((b) => b.tipo));
  assert.deepEqual([...tipos].sort(), ['cita', 'encabezado', 'lista', 'parrafo', 'tabla']);

  // Las dos tablas del informe, con sus anchos reales.
  const tablas = bs.filter((b) => b.tipo === 'tabla');
  assert.equal(tablas.length, 2, 'calidad de los datos y páginas propuestas');
  assert.equal(tablas[0]?.tipo === 'tabla' ? tablas[0].cabecera.length : 0, 2);
  assert.equal(tablas[1]?.tipo === 'tabla' ? tablas[1].cabecera.length : 0, 8);

  // Los `n/d` del informe de la demo sobreviven al parseo. Contados a mano sobre el fixture: dos
  // coberturas, dos celdas de la tabla de páginas, la nota que los explica, y dos en el detalle.
  const todo = bs.map(textoDe).join('\n');
  assert.equal((todo.match(/n\/d/g) ?? []).length, 7);

  // El escapado del generador quedó deshecho: el lector ve el tipo, no la sintaxis.
  assert.match(todo, /landing_local/);
  assert.doesNotMatch(todo, /landing\\_local/);

  // Y nada del informe se perdió por el camino: ni un bloque html, ni una línea descartada.
  assert.doesNotMatch(JSON.stringify(bs), /"tipo":"html"/);
  // Contados a mano sobre el fixture: `#` del título, 4 `###`, 3 `##`.
  assert.equal(bs.filter((b) => b.tipo === 'encabezado').length, 8);
});

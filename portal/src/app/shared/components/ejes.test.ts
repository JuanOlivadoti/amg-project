import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AA_TEXTO_NORMAL, parsearTokens, ratio } from '../../core/contraste';
import { TOKEN_EJES, estiloEjes } from './ejes';

/**
 * El hueco que cierra: **el color de las etiquetas de los ejes no sale de `styles.css`**, así que
 * `contraste.test.ts` —que lee la hoja de estilos— no podía verlo. ApexCharts las pinta con su gris
 * por defecto (`#373d3f`) y el tema no lo toca.
 *
 * Medido en producción con el dashboard en oscuro: `#373d3f` sobre `--superficie` (`#171d26`) da
 * **1.53:1**, contra el 4.5:1 que pide AA. 31 etiquetas ilegibles en el primer golpe de la demo.
 */

const css = readFileSync(new URL('../../../styles.css', import.meta.url), 'utf8');
const TEMAS = [
  ['claro', parsearTokens(css, ':root')],
  ['oscuro', parsearTokens(css, '.oscuro')],
] as const;

/** El gris que ApexCharts usa cuando nadie le dice otra cosa. Es el bug, escrito. */
const GRIS_POR_DEFECTO_DE_APEXCHARTS = '#373d3f';

test('el token de los ejes se lee sobre la superficie de la tarjeta, en los dos temas', () => {
  for (const [nombre, tokens] of TEMAS) {
    const color = tokens[TOKEN_EJES];
    const superficie = tokens['superficie'];
    assert.ok(color, `falta --${TOKEN_EJES} en el tema ${nombre}`);
    assert.ok(superficie, `falta --superficie en el tema ${nombre}`);
    const r = ratio(color, superficie);
    assert.ok(
      r >= AA_TEXTO_NORMAL,
      `--${TOKEN_EJES} sobre --superficie en ${nombre} da ${r.toFixed(2)}:1, por debajo de ${AA_TEXTO_NORMAL}:1`,
    );
  }
});

test('el gris por defecto de ApexCharts NO pasa AA en oscuro (por eso existe este arreglo)', () => {
  const oscuro = TEMAS[1][1];
  const superficie = oscuro['superficie'];
  assert.ok(superficie);
  const r = ratio(GRIS_POR_DEFECTO_DE_APEXCHARTS, superficie);
  assert.ok(
    r < AA_TEXTO_NORMAL,
    `si esto pasa, el default de ApexCharts dejó de ser un problema y este arreglo sobra (da ${r.toFixed(2)}:1)`,
  );
});

test('estiloEjes usa el token resuelto por el navegador', () => {
  const estilo = estiloEjes(() => '#d1d5db');
  assert.equal(estilo.labels.style.colors, '#d1d5db');
});

test('sin token resuelto cae a currentColor, nunca a un hex de repuesto', () => {
  // Mismo criterio que `colores()` en los dos gráficos: un hex de repuesto queda congelado en un
  // tema, y `contraste.test.ts` lo prohíbe en el fuente. `currentColor` es una palabra clave CSS.
  const estilo = estiloEjes(() => '');
  assert.equal(estilo.labels.style.colors, 'currentColor');
});

/**
 * Los componentes **se descubren**, no se listan — mismo criterio que `contraste.test.ts`.
 *
 * Con una lista fija, el tercer gráfico que alguien agregue (una dona de reparto de coste, un
 * sparkline por cliente) entra con el gris por defecto y la suite sigue en verde. Recorrer `src/app`
 * es lo que hace que el arreglo cubra los gráficos que todavía no se escribieron.
 */
function componentesConGrafico(): string[] {
  const raiz = fileURLToPath(new URL('../..', import.meta.url));
  const encontrados: string[] = [];
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        if (readFileSync(ruta, 'utf8').includes('<apx-chart')) encontrados.push(ruta);
      }
    }
  };
  recorrer(raiz);
  return encontrados;
}

test('🔴 todo gráfico fija el color de las etiquetas de sus DOS ejes', () => {
  const archivos = componentesConGrafico();
  assert.ok(
    archivos.length >= 2,
    `esperaba al menos bar-chart y line-chart, encontré ${archivos.length}`,
  );

  for (const ruta of archivos) {
    const texto = readFileSync(ruta, 'utf8');
    assert.match(
      texto,
      /estiloEjes/,
      `${basename(ruta)} dibuja un gráfico sin usar estiloEjes(): sus etiquetas salen con el gris por defecto de ApexCharts`,
    );
    // Los dos ejes, no uno: en la barra horizontal las categorías van en el eje Y, y en la línea
    // van en el X. Fijar solo uno deja la mitad de las etiquetas ilegibles según el tipo de gráfico.
    for (const eje of ['xaxis', 'yaxis'] as const) {
      assert.match(
        texto,
        new RegExp(`\\[${eje}\\]`),
        `${basename(ruta)} no le pasa [${eje}] al gráfico: ese eje queda con el color por defecto`,
      );
    }
  }
});

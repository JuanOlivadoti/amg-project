import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  // El umbral en sí. Sin esto, bajarlo a 3 afloja las 34 aserciones y ningún test se entera: sería
  // un default de producción sin dueño.
  assert.equal(AA_TEXTO_NORMAL, 4.5, 'AA para texto normal es 4.5:1, y no se negocia acá');
});

test('🔴 @theme inline expone exactamente los mismos 16 tokens', () => {
  // El triángulo tiene tres lados: `TOKENS`, `styles.css` (:root/.oscuro) y el bloque `@theme
  // inline` que Tailwind v4 usa para emitir las utilidades (bg-fondo, text-texto, etc). El test de
  // abajo ata los dos primeros; sin este, el tercero queda suelto — y borrar `--color-respaldo` de
  // @theme inline deja `text-respaldo` sin emitir, con la suite en verde y el typecheck limpio.
  const tema = parsearTokens(css, '@theme inline');
  const nombres = Object.keys(tema)
    .filter((n) => n.startsWith('color-'))
    .map((n) => n.slice('color-'.length));
  assert.deepEqual(
    nombres.sort(),
    [...TOKENS].sort(),
    'el bloque @theme inline de styles.css y TOKENS se separaron',
  );
  // Lo de arriba solo compara NOMBRES: `--color-respaldo: var(--alerta);` (un typo de variable)
  // deja pasar el assert anterior — el nombre `respaldo` está — mientras el título ✅ se pinta con
  // el color de ⚠️. Cada --color-X tiene que apuntar a --X, no solo existir.
  for (const t of TOKENS) {
    assert.equal(tema[`color-${t}`], `var(--${t})`, `--color-${t} no apunta a --${t}`);
  }
});

test('🔴 los dos temas definen exactamente los mismos tokens', () => {
  // Un token que falte en `.oscuro` NO da error: hereda el valor claro de `:root` y se ve mal en
  // silencio. Por eso se afirma la igualdad de los dos juegos de nombres, no solo su presencia.
  for (const [nombre, tokens] of TEMAS) {
    assert.deepEqual(
      Object.keys(tokens).sort(),
      [...TOKENS].sort(),
      `el tema ${nombre} no define los ${TOKENS.length} tokens exactos`,
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

/**
 * Un color incrustado en una plantilla es, por definición, un color que el tema **no puede cambiar**.
 * Había dos —los títulos ✅ y ⚠️, justo el argumento de venta— en un `style` inline: en oscuro
 * quedaban congelados en el tema claro, a 3.38:1 y 3.37:1, por debajo de AA.
 *
 * El test de contraste de arriba verifica la TABLA de tokens; este verifica que la UI **use** la
 * tabla. Sin él, la garantía era un comentario.
 */
/**
 * Las plantillas **se descubren**, no se listan.
 *
 * Una lista fija solo cubre las cuatro pantallas de hoy: la primera pantalla de la pieza C entraría
 * con un `style="color:#…"` y la suite seguiría en verde. Recorrer `src/app` es lo que convierte
 * «la pieza C hereda el tema por construcción» en algo que se cumple solo.
 */
function plantillas(): string[] {
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  const encontradas: string[] = [];
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.html$/.test(e.name) || (/\.ts$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)))
        encontradas.push(ruta);
    }
  };
  recorrer(raiz);
  return encontradas;
}

test('🔴 ninguna plantilla incrusta un color: todo pasa por un token', () => {
  const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g;
  const ESTILO_COLOR = /style="[^"]*color\s*:/g;
  const FUNCION_COLOR = /\b(?:rgb|rgba|hsl|hsla)\(/g;
  // La paleta cruda de Tailwind sigue existiendo (v4 la trae por defecto en `@theme` global — no
  // hay `tailwind.config.js` que la desactive). Pero `bg-gray-100` queda congelado en claro igual
  // que un hex, y ESO no lo cazaba nada: lo garantizaba un `grep` corrido a mano una vez, no un test.
  const PALETA_CRUDA =
    /\b(?:bg|text|border|ring|divide|placeholder|from|via|to)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)(?:-(?:50|[1-9]00|950))?\b/g;

  const archivos = plantillas();
  assert.ok(archivos.length >= 4, `esperaba al menos las 4 plantillas conocidas, encontré ${archivos.length}`);

  for (const ruta of archivos) {
    const texto = readFileSync(ruta, 'utf8');
    for (const [nombre, patron] of [
      ['un hex', HEX],
      ['un color en un style inline', ESTILO_COLOR],
      ['una función de color', FUNCION_COLOR],
      ['una clase de la paleta cruda de Tailwind', PALETA_CRUDA],
    ] as const) {
      const hallados = [...texto.matchAll(patron)].map((m) => m[0]);
      assert.deepEqual(
        hallados,
        [],
        `${basename(ruta)} tiene ${nombre}: ${hallados.join(', ')} — usá un token, o el tema no lo puede cambiar`,
      );
    }
  }
});

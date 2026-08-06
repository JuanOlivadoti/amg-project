import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Ninguna plantilla del portal pinta HTML crudo.
 *
 * El informe lleva texto generado por LLM, así que el paso Markdown → pantalla es superficie de
 * inyección. La defensa es estructural —el Markdown se parsea a datos (`core/markdown.ts`, donde
 * `Inline` solo contiene `string`s y no existe una variante `html`) y se pinta con `@if`/`@for`, y
 * Angular escapa el texto por defecto—, y este test es lo que impide que alguien la desarme con un
 * atajo.
 *
 * Recorre el árbol en vez de listar archivos: un test que enumera se queda viejo con la próxima
 * pantalla, y ésta es exactamente la clase de garantía que no puede depender de que alguien se
 * acuerde. Mismo patrón que `contraste.test.ts` con los colores incrustados.
 */

/*
 * Los patrones buscan el USO, no la MENCIÓN, y eso no es un detalle de estilo: medido sobre el árbol
 * de hoy (2026-08-06), un `/bypassSecurityTrustHtml|\.innerHTML/` a secas encuentra TRES líneas, y
 * las tres son comentarios que nombran la API justamente para explicar que el portal no la usa
 * (`core/markdown.ts:7`, `pages/clientes/cliente-recursos-card.ts:11` y `:13`). Un test que obliga a
 * borrar la explicación de una decisión de seguridad para poder pasar es un test que empeora el
 * código: se pagaría con un `// eslint-disable` mental, y la próxima persona no sabría por qué la
 * frase no se puede escribir.
 *
 * Así que se exige la sintaxis con la que cada cosa se USA de verdad: el binding lleva `=`, la
 * escritura al DOM lleva `=`, y la función lleva paréntesis. `[innerHTML]` sin `=` es un atributo
 * muerto y `` `innerHTML` `` entre backticks es prosa.
 *
 * `.innerHTML ===` (una comparación, no una escritura) también cae, y se deja así a propósito: el
 * código de producción del portal no tiene ningún motivo para LEER innerHTML tampoco, y afinar el
 * patrón para permitirlo solo agregaría una rendija.
 *
 * Los dos últimos van más allá de lo que pedía el plan (que nombraba tres): `insertAdjacentHTML` y
 * una escritura a `outerHTML` son el MISMO agujero con otro nombre, y dejarlos fuera haría que el
 * barrido se pudiera esquivar sin desobedecerlo.
 */
const PROHIBIDO: readonly (readonly [string, RegExp])[] = [
  ['un binding [innerHTML]=', /\[innerHTML\]\s*=/],
  ['una escritura a .innerHTML', /\.innerHTML\s*=/],
  ['una llamada a bypassSecurityTrustHtml(', /bypassSecurityTrustHtml\s*\(/],
  ['una llamada a insertAdjacentHTML(', /insertAdjacentHTML\s*\(/],
  ['una escritura a .outerHTML', /\.outerHTML\s*=/],
];

/**
 * Los archivos que se revisan: todo `src/` menos los tests.
 *
 * Se recorre `src/` entero y no solo `src/app/` para que entre también `index.html` (que lleva un
 * script inline de verdad, el del tema). Los `*.test.ts` y `*.spec.ts` quedan fuera porque un test
 * legítimamente nombra lo que prohíbe — `cliente-crear.spec.ts` lee `el.innerHTML` para AFIRMAR que
 * un uuid no se filtró a la pantalla, y eso es lo contrario de una vulnerabilidad.
 */
function fuentes(): string[] {
  const raiz = fileURLToPath(new URL('../..', import.meta.url));
  const encontradas: string[] = [];
  const recorrer = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const ruta = join(dir, e.name);
      if (e.isDirectory()) recorrer(ruta);
      else if (/\.(ts|html)$/.test(e.name) && !/\.(test|spec)\.ts$/.test(e.name)) {
        encontradas.push(ruta);
      }
    }
  };
  recorrer(raiz);
  return encontradas;
}

test('🔴 ninguna plantilla usa innerHTML ni bypassSecurityTrustHtml', () => {
  const archivos = fuentes();
  // Un recorrido que encuentra cero archivos pasa en verde sin haber probado nada. El portal tiene
  // más de cincuenta fuentes: el piso está muy por debajo para no romperse al borrar una pantalla,
  // y muy por encima de cero para que un `readdirSync` que apunte al directorio equivocado se note.
  assert.ok(archivos.length >= 30, `esperaba las fuentes del portal, encontré ${archivos.length}`);

  const hallazgos: string[] = [];
  for (const ruta of archivos) {
    const texto = readFileSync(ruta, 'utf8');
    for (const [i, linea] of texto.split('\n').entries()) {
      for (const [nombre, patron] of PROHIBIDO) {
        if (patron.test(linea)) hallazgos.push(`${ruta}:${i + 1}: ${nombre} → ${linea.trim()}`);
      }
    }
  }

  assert.deepEqual(
    hallazgos,
    [],
    `HTML crudo en el portal:\n${hallazgos.join('\n')}\n` +
      `Si hace falta pintar Markdown, se parsea a datos (core/markdown.ts) y se dibuja con @if/@for.`,
  );
});

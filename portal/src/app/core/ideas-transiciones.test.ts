import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TRANSICIONES_IDEA, transicionesDesde } from './ideas-transiciones';
import type { EstadoIdea } from './models';

const ESTADOS: readonly EstadoIdea[] = ['nueva', 'en_revision', 'aprobada', 'rechazada'];

test('la tabla tiene los cuatro estados como claves, ni uno más ni uno menos', () => {
  assert.deepEqual(Object.keys(TRANSICIONES_IDEA).sort(), [...ESTADOS].sort());
});

test('nueva → en_revision es la única transición desde nueva', () => {
  assert.deepEqual(transicionesDesde('nueva'), ['en_revision']);
});

test('en_revision → aprobada | rechazada, en ese orden', () => {
  assert.deepEqual(transicionesDesde('en_revision'), ['aprobada', 'rechazada']);
});

test('aprobada y rechazada son terminales: sin transiciones salientes', () => {
  assert.deepEqual(transicionesDesde('aprobada'), []);
  assert.deepEqual(transicionesDesde('rechazada'), []);
});

/*
 * ---------------------------------------------------------------- la atadura cross-paquete
 *
 * Mismo mecanismo que `core/codigos.test.ts` (leelo para el porqué largo): el portal vive FUERA del
 * monorepo a propósito (ADR-21), así que no puede `import`ar el paquete `db`. Eso impide importar el
 * PAQUETE, no impide LEER EL ARCHIVO — y leerlo de verdad es la única forma de que esta prueba ate
 * algo, en vez de compararse contra una tercera copia escrita a mano en este mismo archivo.
 *
 * La primera versión de este test comparaba `TRANSICIONES_IDEA` (portal) contra un objeto `esperado`
 * tipeado a mano acá mismo, con los mismos cuatro pares que `db/src/ideas.ts` tenía en ese momento.
 * Pasaba en verde, pero no ataba nada: si alguien agrega una transición nueva en `db/src/ideas.ts` y
 * se olvida de tocar el portal, ese test seguía verde — exactamente el defecto que el comentario de
 * `db/src/ideas.ts` (sobre por qué la máquina está duplicada) dice que existe para prevenir. Lo marcó
 * una revisión externa; corregido acá cargando el archivo real en runtime.
 *
 * La ruta se arma con `new URL(...)` a propósito: `tsc` no la resuelve estáticamente (no se lleva
 * medio `db/` por delante en el typecheck del portal); solo `tsx` la sigue al correr el test.
 *
 * **`RUTA_DB` (el path crudo, para el mensaje de error) y la URL que de verdad se le pasa a
 * `import()` NO son la misma cadena, y esa diferencia es la que hace que este test corra en
 * Windows.** Una revisión de integración encontró que la primera versión de este archivo le pasaba
 * `RUTA_DB` —una ruta absoluta cruda, `C:\...`— directo a `import()`: eso lanza en Windows ("Only
 * URLs with a scheme in: file, data, and node are supported") ANTES de llegar al `deepEqual`, así
 * que el test quedaba permanentemente rojo por una excepción y su assert nunca corría — la misma
 * garantía-que-no-se-cumple del hallazgo anterior, con una causa distinta. `codigos.test.ts` tiene
 * el mismo defecto (`import(RUTA_API)` con la ruta cruda) y por eso hoy SÍ falla en Windows — es
 * deuda preexistente de otra pieza, no se toca acá. Este archivo usa `pathToFileURL(RUTA_DB).href`
 * para la llamada real: es la diferencia entre un test que corre y uno que solo parece correr.
 */
const RUTA_DB = fileURLToPath(new URL('../../../../db/src/ideas.ts', import.meta.url));

interface ModuloIdeas {
  readonly TRANSICIONES_IDEA: Readonly<Record<EstadoIdea, readonly EstadoIdea[]>>;
}

const cargarDb = async (): Promise<ModuloIdeas> => {
  try {
    // `pathToFileURL(...).href` y NO `RUTA_DB` a secas: `import()` exige una URL `file://` en
    // Windows, y una ruta absoluta cruda (`C:\...`) lanza antes de llegar al `deepEqual` de abajo —
    // el test quedaba rojo por una excepción, no por el assert, y la atadura no ataba nada.
    return (await import(pathToFileURL(RUTA_DB).href)) as ModuloIdeas;
  } catch (e) {
    throw new Error(
      `no pude cargar la máquina de estados de db en ${RUTA_DB}: ${(e as Error).message}\n` +
        'Si el archivo se movió, actualizá la ruta — pero NO borres este test: es lo único que ' +
        'impide que las dos copias de TRANSICIONES_IDEA se separen sin que nada avise.',
    );
  }
};

test('🔴 espeja EXACTAMENTE TRANSICIONES_IDEA de db/src/ideas.ts: mismos pares, mismo orden (leído del archivo real)', async () => {
  const db = await cargarDb();

  // Un recorrido que no encuentra nada pasa en verde sin haber probado nada: si `db` se quedara sin
  // la tabla, esto tiene que caer y no felicitarnos.
  assert.ok(
    Object.keys(db.TRANSICIONES_IDEA).length >= 1,
    `db/src/ideas.ts no exporta TRANSICIONES_IDEA (o está vacía): ${JSON.stringify(db.TRANSICIONES_IDEA)}`,
  );

  // deepEqual sobre el objeto ENTERO: caza a la vez un par que sobra, uno que falta, un orden
  // distinto dentro de un mismo par, o un estado que se agregó de un lado y no del otro.
  assert.deepEqual(
    TRANSICIONES_IDEA,
    db.TRANSICIONES_IDEA,
    'la máquina de estados del portal y la de db/src/ideas.ts dejaron de coincidir: los botones de ' +
      'transición de la pantalla ramifican sobre esto, así que una diferencia acá es un botón que se ' +
      'ofrece (o se niega) en el cliente por algo que la base ya no dice',
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as portal from './codigos';

/**
 * Los códigos de error del portal y los de la API son la MISMA lista — atado por test.
 *
 * ## Por qué hay dos copias, y por qué esto no es una copia suelta
 *
 * `portal/src/app/core/codigos.ts` es una copia literal de `api/src/codigos.ts`. Existe porque el
 * portal vive **fuera del monorepo a propósito** (su toolchain no se mezcla con la de los workspaces),
 * así que no puede `import`ar del paquete `api`. Lo que estar fuera del monorepo impide es **importar
 * el paquete**; no impide **leer el archivo** — es exactamente el camino que abrió
 * `db/src/cartera-portal.test.ts` el 2026-08-07, después de que el dashboard y el brief mostraran
 * durante días las mismas métricas con nombres distintos y la suite entera en verde.
 *
 * El riesgo acá es peor que el de aquella deriva, porque es silencioso en las dos direcciones: si
 * alguien renombra `SIN_PAGINAS_APROBADAS` en la API, el portal deja de reconocer el 409 y vuelve a
 * pintar la descarga como un error genérico; y `tsc` no dice nada, porque los dos lados compilan
 * perfectamente por separado.
 *
 * La ruta se arma en runtime (`new URL(...)`) a propósito: `tsc` no la resuelve estáticamente, así que
 * el typecheck del portal no se lleva medio `api/` por delante. Solo `tsx` la sigue, al correr el test.
 */

/**
 * Ruta armada en runtime: `tsc` no la sigue, `tsx` sí. Ver el encabezado.
 *
 * `RUTA_API` (el path crudo, para el mensaje de error) y la URL que de verdad se le pasa a
 * `import()` no son la misma cadena: pasar un path absoluto crudo (`C:\...`) directo a `import()`
 * lanza en Windows ("Only URLs with a scheme in: file, data, and node are supported"). Por eso acá
 * se usa `pathToFileURL(RUTA_API).href` y no `RUTA_API` a secas — el mismo defecto que tenía
 * `db/src/cartera-portal.test.ts` hasta que se corrigió.
 */
const RUTA_API = fileURLToPath(new URL('../../../../api/src/codigos.ts', import.meta.url));

interface ModuloCodigos {
  readonly CODIGOS: Readonly<Record<string, string>>;
  readonly [nombre: string]: unknown;
}

const cargarApi = async (): Promise<ModuloCodigos> => {
  try {
    return (await import(pathToFileURL(RUTA_API).href)) as ModuloCodigos;
  } catch (e) {
    throw new Error(
      `no pude cargar los códigos de la API en ${RUTA_API}: ${(e as Error).message}\n` +
        'Si el archivo se movió, actualizá la ruta — pero NO borres este test: es lo único que ' +
        'impide que las dos copias del contrato se separen sin que nada avise.',
    );
  }
};

test('el portal y la API declaran EXACTAMENTE los mismos códigos de error', async () => {
  const api = await cargarApi();

  // Un recorrido que no encuentra nada pasa en verde sin haber probado nada: si la API se queda sin
  // códigos, esto tiene que caer y no felicitarnos.
  assert.ok(
    Object.keys(api.CODIGOS).length >= 1,
    `api/src/codigos.ts no exporta ningún código: ${JSON.stringify(api.CODIGOS)}`,
  );

  // deepEqual en los dos sentidos de una sola vez: caza el renombrado, el que sobra y el que falta.
  assert.deepEqual(
    portal.CODIGOS,
    api.CODIGOS,
    'los códigos del portal y los de la API dejaron de coincidir: el portal ramifica sobre estos ' +
      'valores, así que una diferencia acá es una rama muerta en producción',
  );
});

test('🔴 cada código es la constante exportada, no un literal repetido dentro de CODIGOS', async () => {
  /*
   * La mitad que el `deepEqual` de arriba NO cubre. `CODIGOS` se puede escribir con literales
   * (`{ SIN_PAGINAS_APROBADAS: "SIN_PAGINAS_APROBADAS" }`) y seguir coincidiendo entre los dos
   * archivos mientras la **constante exportada** —que es la que importa el código de producción— dice
   * otra cosa. Ahí el test de arriba queda verde y el portal compara contra un valor que nadie emite.
   */
  const api = await cargarApi();

  for (const modulo of [
    { nombre: 'portal', mod: portal as unknown as ModuloCodigos },
    { nombre: 'api', mod: api },
  ]) {
    for (const [clave, valor] of Object.entries(modulo.mod.CODIGOS)) {
      assert.equal(
        modulo.mod[clave],
        valor,
        `en ${modulo.nombre}, CODIGOS.${clave} vale ${JSON.stringify(valor)} pero la constante ` +
          `exportada ${clave} vale ${JSON.stringify(modulo.mod[clave])}`,
      );
    }
  }
});

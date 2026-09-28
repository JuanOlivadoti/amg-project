import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * El placeholder del campo «nombre de recurso de la ficha» tiene que ser un ejemplo **válido** según
 * la fuente única del formato, que vive en `db/src/resenas.ts`.
 *
 * ## Por qué esto necesita un test y no alcanza con mirarlo
 *
 * El placeholder es lo único que le dice a un humano qué forma pegar: quien copia de la consola de
 * Google ve un id suelto y no tiene por qué saber que la v4 direcciona por nombre de recurso
 * completo. Si `db/` afloja o endurece el formato —Google agrega un segmento, por decir algo— el
 * placeholder se queda mostrando un ejemplo que la API ya rechaza, y **nada avisa**: el portal no
 * valida con esa regex, así que ningún typecheck ni ningún test del portal se entera.
 *
 * Lo encontró el `revisor` el 2026-09-28: el spec de Karma afirmaba la forma con la regex **copiada a
 * mano, carácter por carácter**, que es la misma deriva silenciosa un escalón más abajo.
 *
 * ## Por qué se lee el archivo en vez de importarlo
 *
 * El portal vive **fuera del monorepo a propósito**, así que no puede `import`ar el paquete `db`. Lo
 * que eso impide es importar el paquete; no impide leer el archivo — mismo camino que
 * `core/codigos.test.ts` y que `db/src/cartera-portal.test.ts` (ADR-21). La ruta se arma en runtime
 * (`new URL(...)`) para que `tsc` no la resuelva y el typecheck del portal no se lleve medio `db/`
 * por delante; sólo `tsx` la sigue, al correr el test.
 *
 * `pathToFileURL` y no el path crudo: en Windows un `C:\...` suelto hace lanzar a `import()`.
 */
const RUTA_DB = fileURLToPath(new URL('../../../../../db/src/resenas.ts', import.meta.url));
const RUTA_COMPONENTE = fileURLToPath(new URL('./cliente-resenas.ts', import.meta.url));

interface ModuloResenas {
  readonly NOMBRE_DE_UBICACION_GOOGLE: RegExp;
}

test('el placeholder del campo de ficha es un ejemplo VÁLIDO según la fuente única de `db/`', async () => {
  const { NOMBRE_DE_UBICACION_GOOGLE } = (await import(
    pathToFileURL(RUTA_DB).href
  )) as unknown as ModuloResenas;
  assert.ok(
    NOMBRE_DE_UBICACION_GOOGLE instanceof RegExp,
    `db/src/resenas.ts no exporta NOMBRE_DE_UBICACION_GOOGLE: el formato dejó de tener fuente única`,
  );

  const fuente = readFileSync(RUTA_COMPONENTE, 'utf8');
  const encontrado = fuente.match(/placeholder="([^"]+)"/);
  assert.ok(
    encontrado,
    'no encontré ningún `placeholder="..."` en cliente-resenas.ts: si el campo se renombró o se ' +
      'movió, este test tiene que seguirlo en vez de desaparecer en silencio',
  );

  assert.match(
    encontrado[1]!,
    NOMBRE_DE_UBICACION_GOOGLE,
    `el placeholder "${encontrado[1]}" NO es un nombre de recurso válido: le estaría enseñando a la ` +
      `gente una forma que la API rechaza con 400`,
  );
});

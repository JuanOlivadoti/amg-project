import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * El agujero que cierra: **`npm run typecheck` escribe en el mismo directorio que el build de
 * producción**, y no pasa por el `prebuild` que verifica la config.
 *
 * `typecheck` es `ng build --configuration development` (compilar es la forma de verificar los tipos
 * de las plantillas). Sin un `outputPath` propio, deja en `dist/portal` un bundle con los
 * valores-plantilla de `environment.ts` y con `features.lanzarResearch: true`. Comprobado el
 * 2026-08-01: tras un typecheck, `dist/portal/browser/` contenía `TU-PROYECTO`.
 *
 * Hoy no llega a producción porque Hostinger autodespliega desde `main` y no sube `dist/`. Pero el
 * runbook ya lista el síntoma ("Frank SÍ ve el botón lanzar research → el portal se buildeó en modo
 * development") sin nombrar esta causa, y basta con que alguien suba `dist/` una vez —a mano, por
 * FTP, en un apuro— para publicar el portal de desarrollo con toda la suite en verde.
 */

const angular = JSON.parse(
  readFileSync(new URL('../angular.json', import.meta.url), 'utf8'),
) as {
  projects: Record<
    string,
    { architect: { build: { options?: Record<string, unknown>; configurations: Record<string, Record<string, unknown>> } } }
  >;
};

/** `@angular/build:application` acepta `outputPath` como string o como `{ base, browser }`. */
function base(valor: unknown): string | undefined {
  if (typeof valor === 'string') return valor;
  if (valor && typeof valor === 'object' && 'base' in valor) {
    const b = (valor as { base?: unknown }).base;
    return typeof b === 'string' ? b : undefined;
  }
  return undefined;
}

test('el typecheck no escribe donde escribe el build de producción', () => {
  const build = angular.projects['portal']?.architect.build;
  assert.ok(build, 'no encontré el target build del proyecto portal en angular.json');

  const salidaComun = base(build.options?.['outputPath']);
  const salidaProd = base(build.configurations['production']?.['outputPath']) ?? salidaComun;
  const salidaDev = base(build.configurations['development']?.['outputPath']) ?? salidaComun;

  assert.ok(
    salidaDev,
    'la configuración `development` no fija `outputPath`: hereda la del build de producción y lo pisa',
  );
  assert.notEqual(
    salidaDev,
    salidaProd,
    `development y production escriben los dos en "${salidaDev}": un typecheck deja ahí el bundle de desarrollo`,
  );
});

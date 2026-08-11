// `@angular/router` (importado transitivamente por `./app.routes` vía `authGuard`) ejecuta, al
// cargar el módulo, un `ɵɵngDeclareFactory` de `PlatformLocation` que exige el compiler JIT. Bajo
// `ng test`/Karma el Angular Linker lo resuelve; bajo `node --import tsx` no hay linker, así que
// sin este import el test entero revienta el proceso de node ANTES de correr un solo assert.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { routes } from './app.routes';
import { authGuard } from './guards/auth-guard';

test('login es una ruta hermana, sin hijas — no vive dentro del shell', () => {
  const login = routes.find((r) => r.path === 'login');
  assert.ok(login, 'no encontré la ruta login');
  assert.equal(login?.children, undefined, '/login no debería tener rutas hijas de un shell');
});

test('runs, runs/:id y cartera son hijas de la ruta del shell, protegidas por authGuard', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  assert.ok(shell, 'no encontré la ruta padre del shell (path vacío con children)');
  assert.deepEqual(shell?.canActivate, [authGuard], 'el shell debe estar protegido por authGuard');
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(hijos.includes('runs'), 'runs debe ser hija del shell');
  assert.ok(hijos.includes('runs/:id'), 'runs/:id debe ser hija del shell');
  assert.ok(hijos.includes('cartera'), 'cartera debe ser hija del shell');
});

test('runs/:id/informe es hija del shell (y del authGuard), y carga la pantalla del informe', async () => {
  // El informe lleva el desglose de lo que la agencia le paga a DataForSEO. Que la ruta cuelgue del shell
  // no es lo que lo protege —eso lo hace la política `informe_staff` (0016) dentro de Postgres— pero una
  // ruta hermana de `/login` quedaría fuera del authGuard, y sería la única pantalla del portal sin puerta.
  const shell = routes.find((r) => r.path === '' && r.children);
  const informe = (shell?.children ?? []).find((r) => r.path === 'runs/:id/informe');
  assert.ok(informe, 'runs/:id/informe debe ser hija del shell');
  assert.equal(informe?.canActivate, undefined, 'hereda el authGuard del padre, no lo repite');

  // Y que el `loadComponent` resuelva de verdad: un import mal escrito no rompe el build (es una función
  // perezosa), se rompe al navegar. Acá se paga el import una vez y se sabe.
  const cargado = await informe?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'InformePage');
});

test('ninguna ruta hija ni nieta repite su propio authGuard — lo hereda del padre', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  for (const hijo of shell?.children ?? []) {
    assert.equal(hijo.canActivate, undefined, `${hijo.path} no debería tener su propio canActivate`);
    for (const nieto of hijo.children ?? []) {
      assert.equal(
        nieto.canActivate,
        undefined,
        `${hijo.path}/${nieto.path} no debería tener su propio canActivate`,
      );
    }
  }
});

test('clientes/nuevo se declara ANTES que clientes/:id — si no, :id se traga la palabra "nuevo"', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  const iNuevo = hijos.indexOf('clientes/nuevo');
  const iFicha = hijos.indexOf('clientes/:id');
  assert.ok(iNuevo >= 0, 'no encontré clientes/nuevo');
  assert.ok(iFicha >= 0, 'no encontré clientes/:id');
  assert.ok(iNuevo < iFicha, 'clientes/nuevo debe declararse antes que clientes/:id');
});

test('clientes/:id es un shell con tabs: carga la ficha y redirige a perfil por defecto', async () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const ficha = (shell?.children ?? []).find((r) => r.path === 'clientes/:id');
  assert.ok(ficha, 'clientes/:id debe ser hija del shell');
  assert.ok(ficha?.children, 'clientes/:id debe tener rutas hijas (los tabs)');

  const cargado = await ficha?.loadComponent?.();
  assert.equal((cargado as { name?: string })?.name, 'ClienteFichaComponent');

  const tabs = (ficha?.children ?? []).map((r) => r.path);
  assert.ok(tabs.includes('perfil'), 'el tab perfil debe existir');

  const porDefecto = (ficha?.children ?? []).find((r) => r.path === '');
  assert.equal(porDefecto?.redirectTo, 'perfil');
  assert.equal(porDefecto?.pathMatch, 'full');
});

test('el router hereda los params del padre: sin esto, /clientes/:id/research no ve el :id', () => {
  /*
   * Se lee el FUENTE y no se inspecciona el provider porque `provideRouter(routes, withRouterConfig(...))`
   * devuelve un `EnvironmentProviders` opaco: su configuración no se puede leer sin arrancar el
   * router. Es el mismo patrón que usa `core/sin-html-crudo.test.ts` para barrer plantillas.
   *
   * Lo que se protege es una garantía SILENCIOSA: con el default `'emptyOnly'`, `params.get('id')`
   * en un tab devuelve `null` y la pantalla se queda vacía sin un solo error en consola.
   */
  const fuente = readFileSync(new URL('./app.config.ts', import.meta.url), 'utf8');
  assert.match(
    fuente,
    /paramsInheritanceStrategy:\s*'always'/,
    "app.config.ts debe pasar `withRouterConfig({ paramsInheritanceStrategy: 'always' })`",
  );
});

test('usuarios y usuarios/:id son hijas del shell, y el redirectTo a runs no se toca', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  const hijos = (shell?.children ?? []).map((r) => r.path);
  assert.ok(hijos.includes('usuarios'), 'usuarios debe ser hija del shell (y del authGuard)');
  assert.ok(hijos.includes('usuarios/:id'), 'usuarios/:id debe ser hija del shell');

  // El default de la demo. La pieza 2 es aditiva: si esto cambiara, el portal abriría en otra
  // pantalla y la demo empezaría en un lugar que nadie ensayó.
  const raiz = (shell?.children ?? []).find((r) => r.path === '');
  assert.equal(raiz?.redirectTo, 'runs');
  assert.equal(raiz?.pathMatch, 'full');
});

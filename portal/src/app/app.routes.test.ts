// `@angular/router` (importado transitivamente por `./app.routes` vía `authGuard`) ejecuta, al
// cargar el módulo, un `ɵɵngDeclareFactory` de `PlatformLocation` que exige el compiler JIT. Bajo
// `ng test`/Karma el Angular Linker lo resuelve; bajo `node --import tsx` no hay linker, así que
// sin este import el test entero revienta el proceso de node ANTES de correr un solo assert.
import '@angular/compiler';
import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('ninguna ruta hija repite su propio authGuard — lo hereda del padre', () => {
  const shell = routes.find((r) => r.path === '' && r.children);
  for (const hijo of shell?.children ?? []) {
    assert.equal(hijo.canActivate, undefined, `${hijo.path} no debería tener su propio canActivate`);
  }
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

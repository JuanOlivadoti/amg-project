import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SidebarService } from './sidebar';

test('el drawer mobile arranca cerrado', () => {
  const s = new SidebarService();
  assert.equal(s.mobileAbierto(), false);
});

test('alternarMobile invierte el estado', () => {
  const s = new SidebarService();
  s.alternarMobile();
  assert.equal(s.mobileAbierto(), true);
  s.alternarMobile();
  assert.equal(s.mobileAbierto(), false);
});

test('cerrarMobile fuerza a cerrado sin importar el estado previo', () => {
  const s = new SidebarService();
  s.alternarMobile();
  s.cerrarMobile();
  assert.equal(s.mobileAbierto(), false);
});

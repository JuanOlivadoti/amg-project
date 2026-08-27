import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTIVO_SIN_PAGINAS, motivoNoAprobable, type EstadoAprobacionRun } from './aprobar-run';

const estado = (hayPaginaAprobada: boolean): EstadoAprobacionRun => ({ hayPaginaAprobada });

test('con una página aprobada, no hay motivo: se puede aprobar', () => {
  assert.equal(motivoNoAprobable(estado(true)), null);
});

test('sin ninguna página aprobada, pide aprobar una', () => {
  assert.equal(motivoNoAprobable(estado(false)), MOTIVO_SIN_PAGINAS);
});

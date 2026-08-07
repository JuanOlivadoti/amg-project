import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MOTIVO_SIN_PAGINAS,
  MOTIVO_SIN_WORKFLOW,
  motivoNoAprobable,
  type EstadoAprobacionRun,
} from './aprobar-run';

const estado = (tieneWorkflow: boolean, hayPaginaAprobada: boolean): EstadoAprobacionRun => ({
  tieneWorkflow,
  hayPaginaAprobada,
});

test('un run del pipeline con una página aprobada se puede aprobar: no hay motivo', () => {
  assert.equal(motivoNoAprobable(estado(true, true)), null);
});

test('un run del pipeline sin ninguna página aprobada pide aprobar una página', () => {
  assert.equal(motivoNoAprobable(estado(true, false)), MOTIVO_SIN_PAGINAS);
});

test('🔴 un run que no lanzó el pipeline no se puede aprobar, aunque tenga páginas aprobadas', () => {
  /*
   * El caso que estaba alcanzable en producción (15ª review, H1): el run sembrado de la demo está en
   * `pending_approval` con páginas, y nada esperaba su aprobación. Antes de C0 el botón se veía
   * normal, la API devolvía 200 y no se publicaba nada.
   *
   * Tener páginas aprobadas NO destraba nada acá: son dos condiciones independientes, y ésta gana.
   */
  assert.equal(motivoNoAprobable(estado(false, true)), MOTIVO_SIN_WORKFLOW);
});

test('🔴 con los DOS motivos a la vez se cuenta UNO solo, y es el que no se puede resolver', () => {
  /*
   * La razón de que esto sea una función y no dos `@if` sueltos en la plantilla. Los dos avisos
   * juntos se contradicen: «aprobá al menos una página» promete que aprobando una se destraba, y con
   * un run sembrado no se destraba. Quien lo lee aprueba páginas, vuelve, y el botón sigue muerto.
   */
  const motivo = motivoNoAprobable(estado(false, false));
  assert.equal(motivo, MOTIVO_SIN_WORKFLOW);
  assert.ok(
    !motivo!.includes(MOTIVO_SIN_PAGINAS),
    'se están contando los dos motivos a la vez: el resoluble sobra cuando hay uno que no lo es',
  );
});

test('🔴 el motivo del run sembrado está escrito para quien lo lee, no para quien lo programó', () => {
  /*
   * El default de producción, fijado. «Este run no tiene workflow» es exacto y no significa nada del
   * otro lado de la pantalla: no dice qué pasó ni qué hacer. Este test no puede juzgar la redacción,
   * pero sí puede impedir las dos formas concretas de arruinarla — que se vuelva jerga interna, y que
   * deje de decir qué hacer.
   */
  const jerga = ['workflow', 'esperarEvento', 'waitForEvent', 'solicitud_emitida', '409', 'Inngest'];
  for (const palabra of jerga) {
    assert.ok(
      !MOTIVO_SIN_WORKFLOW.toLowerCase().includes(palabra.toLowerCase()),
      `el motivo le está mostrando jerga interna («${palabra}») a quien mira la pantalla`,
    );
  }
  // Y tiene que terminar en una acción: sin esto, «no se puede publicar» es un callejón sin salida.
  assert.ok(
    MOTIVO_SIN_WORKFLOW.includes('lanzá un research nuevo'),
    'el motivo dice qué pasa pero no qué hacer al respecto',
  );
});

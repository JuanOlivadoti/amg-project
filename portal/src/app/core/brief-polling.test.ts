import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POLL_MS } from './brief-polling';

test('POLL_MS es el valor de producción: 15s — si esto cambia, fue una decisión, no un ajuste al pasar', () => {
  // Fija el número exacto (no solo un rango): un test que solo acotara el rango dejaría que
  // cualquiera dentro del rango pasara en silencio, y el valor elegido en `brief-polling.ts` deja
  // de tener dueño. Mismo criterio que `AA_TEXTO_NORMAL` en `contraste.test.ts`.
  assert.equal(POLL_MS, 15_000);
});

test('POLL_MS es razonable contra la corrida real medida (16m15s = 975s)', () => {
  // Cota inferior: por debajo de 5s se acerca al valor anterior (4s, "a ojo") sin ganar nada
  // frente a una espera de minutos. Cota superior: por encima de 60s, la última pregunta antes de
  // que termine el research puede tardar más de un minuto en notarse, y eso ya se siente lento
  // para quien mira la pantalla esperando.
  const DURACION_MEDIDA_S = 975;
  const preguntasPorCorrida = DURACION_MEDIDA_S / (POLL_MS / 1000);
  assert.ok(POLL_MS >= 5_000, `POLL_MS=${POLL_MS} es casi tan agresivo como el 4s original`);
  assert.ok(POLL_MS <= 60_000, `POLL_MS=${POLL_MS} tardaría más de un minuto en notar que terminó`);
  assert.ok(
    preguntasPorCorrida >= 10 && preguntasPorCorrida <= 200,
    `${preguntasPorCorrida} preguntas por corrida: ni tan pocas que se sienta trabado, ni tantas como el 4s original`,
  );
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment as prod } from './environment.prod';

/**
 * Fija los VALORES DE PRODUCCIÓN de los dos flags de capacidad: son decisiones de despliegue, no
 * config editable.
 *
 * El falso verde que encontró la 10ª review (#4): el test de `mostrarLanzarResearch` prueba la
 * función pura, pero nada probaba qué valor tiene el environment de PRODUCCIÓN. Mutar el flag dejaba
 * todo verde. Este archivo cubre el VALOR que ese `@if` consume; el cableado del `@if` en la
 * plantilla lo cubre el spec de componente de karma.
 *
 * **Los dos estuvieron en `false` hasta el 2026-08-07**, cuando el orquestador se desplegó y su app
 * quedó sincronizada con Inngest — o sea que el motivo escrito ("no hay orquestador detrás") dejó de
 * ser cierto. Lo que NO cambia es para qué está este archivo: que nadie mueva estos dos valores sin
 * enterarse. Por eso siguen fijados, ahora en `true`, y una vuelta atrás accidental cae acá igual.
 */

test('producción es production:true', () => {
  assert.equal(prod.production, true);
});

test('lanzarResearch está ENCENDIDO en producción (hay orquestador desde el 2026-08-07)', () => {
  assert.equal(
    prod.features.lanzarResearch,
    true,
    'apagarlo esconde el botón para todo el equipo: si es a propósito, cambiá también este test',
  );
});

test('aprobarRun está ENCENDIDO en producción (hay orquestador desde el 2026-08-07)', () => {
  assert.equal(
    prod.features.aprobarRun,
    true,
    'apagarlo esconde el botón para todo el equipo: si es a propósito, cambiá también este test',
  );
});

/*
 * Los dos flags son INDEPENDIENTES a propósito —son capacidades distintas y por eso tienen un flag
 * cada uno (10ª review, #2)—, pero hay una combinación que no tiene sentido y conviene que se note:
 * poder aprobar un run y publicar sin poder lanzar ninguno deja la única fuente de runs en el seed, y
 * un run sembrado no tiene workflow esperando su aprobación (ver `environment.prod.ts`). No es un
 * error de tipos ni lo caza `tsc`: es una configuración coherente en la forma e inútil en la práctica.
 */
test('no se puede aprobar-y-publicar sin poder lanzar: no habría runs con workflow detrás', () => {
  if (prod.features.aprobarRun) {
    assert.equal(
      prod.features.lanzarResearch,
      true,
      'con `aprobarRun` encendido y `lanzarResearch` apagado, los únicos runs vienen del seed — y ' +
        'aprobar uno sembrado emite un evento que no espera nadie: el botón parece funcionar y no ' +
        'publica nada',
    );
  }
});

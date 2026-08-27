import { test } from 'node:test';
import assert from 'node:assert/strict';
import { environment as prod } from './environment.prod';

/**
 * Fija los VALORES DE PRODUCCIÓN de los tres flags de capacidad: son decisiones de despliegue, no
 * config editable.
 *
 * El falso verde que encontró la 10ª review (#4): el test de `mostrarLanzarResearch` prueba la
 * función pura, pero nada probaba qué valor tiene el environment de PRODUCCIÓN. Mutar el flag dejaba
 * todo verde. Este archivo cubre el VALOR que ese `@if` consume; el cableado del `@if` en la
 * plantilla lo cubre el spec de componente de karma.
 *
 * **`lanzarResearch` y `aprobarRun` estuvieron en `false` hasta el 2026-08-07**, cuando el
 * orquestador se desplegó y su app quedó sincronizada con Inngest — o sea que el motivo escrito ("no
 * hay orquestador detrás") dejó de ser cierto. Lo que NO cambia es para qué está este archivo: que
 * nadie mueva estos valores sin enterarse. Por eso siguen fijados, y una vuelta atrás accidental cae
 * acá igual.
 *
 * `destinoPosts` es el tercero, y AL REVÉS: se fija en `false` porque el sub-proyecto que lo
 * necesita (publicar en un blog externo) todavía no existe. Encenderlo sin que exista mostraría una
 * opción del selector de destino que la API rechazaría siempre.
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
 * Retirada la nota vieja sobre "no se puede aprobar-y-publicar sin poder lanzar": su razón de ser
 * era que aprobar un run sembrado (sin `solicitud_emitida_at`) emitía un evento que nadie escuchaba.
 * Con el desacople del selector de destino y el retiro de `RunSinWorkflowError`, CUALQUIER run en
 * `pending_approval` puede recibir una decisión, nacido del pipeline o sembrado — la combinación que
 * ese test prohibía ya no es un problema.
 */

test('destinoPosts está APAGADO en producción (sub-proyecto 3 no existe todavía)', () => {
  assert.equal(
    prod.features.destinoPosts,
    false,
    'encenderlo mostraría una opción del selector que la API todavía no puede cumplir',
  );
});

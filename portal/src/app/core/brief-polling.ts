/**
 * Cada cuánto `BriefPage` repregunta por un research que sigue `running` (ADR-21: polling, no
 * realtime). Vive acá, fuera de Angular, para que el valor tenga un test sin navegador — un
 * default de producción sin test es una decisión sin dueño.
 *
 * Antes valía 4000 (4s), puesto **a ojo**. La única corrida real medida —la que documentan
 * `informe-vista.test.ts` y los fixtures de `entregable-vista.test.ts`/`informe.spec.ts` con el
 * timestamp `2026-07-30T00:16:15.000Z`— duró **16m15s** (975s) de principio a fin. Contra esa
 * duración, 4s eran ~244 preguntas por corrida: mucho más seguido de lo que hace falta para que
 * la pantalla se sienta viva, sin ganar nada a cambio.
 *
 * 15s da ~65 preguntas en una corrida de esa duración: sigue sintiéndose responsive apenas
 * termina (el peor caso es notar el fin del research 15s tarde, frente a una espera de 16
 * minutos), y es un orden de magnitud menos tráfico contra la API que el valor anterior.
 *
 * Es un intervalo FIJO y no un backoff progresivo a propósito: el research no expone al portal
 * ninguna fase intermedia (arranca `running` y termina en un estado final) que justifique
 * espaciar más al principio que cerca del final — no hay señal para decidir cuándo acelerar o
 * frenar, así que un backoff acá sería complejidad sin información que lo sostenga.
 */
export const POLL_MS = 15_000;

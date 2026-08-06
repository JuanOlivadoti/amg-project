/*
 * Lo que la pantalla del informe DICE de sí misma, como funciones puras.
 *
 * El informe está congelado: es un render guardado, no una vista en vivo. Si el revisor editó una keyword
 * o retiró una página después, el texto no lo refleja. Eso no se arregla —regenerar el informe en cada
 * visita costaría dinero y borraría el entregable que se le mandó al cliente—, así que **se declara en
 * pantalla**. La alternativa real no es «que esté al día»: es que alguien encuentre la discrepancia solo y
 * no sepa cuál de las dos cosas creer.
 *
 * ── LAS DOS FECHAS ────────────────────────────────────────────────────────────────────────────────────
 *
 * En esta pantalla conviven dos fechas que parecen la misma y no lo son. Decisión del dueño del proyecto
 * (2026-08-06): **se muestran las dos y el aviso explica cuál es cuál**, en vez de esconder una.
 *
 * Los dos hechos, medidos y no supuestos:
 *
 *  · **`generado_at`** (de `kr_informes`, lo que trae el endpoint) es **cuándo se guardó este render**.
 *    `PgStore.guardarInforme` lo deja en el `default now()` de la 0016, y un reintento del step durable lo
 *    ACTUALIZA — hay un test aprobado de KR-2b/T2 que lo fija. Así que no es «cuándo se hizo el research»
 *    ni siquiera aproximadamente cuando el step se reintenta, y en la demo es directamente cuándo corrió
 *    el seed.
 *  · **la fecha que el documento imprime en su encabezado** es cuándo **empezó** el research:
 *    `kr-service/src/pipeline/run.ts:110` sella `generated_at` ANTES de las fases.
 *
 * La brecha real entre las dos es la duración del research: **16 min 15 s** en la corrida de la demo, y
 * días en el dataset sembrado. Por eso el aviso dice explícitamente que son dos fechas distintas y no una
 * que cambió: sin esa frase, un revisor que las ve juntas concluye que el sistema se contradice.
 *
 * Está todo acá y no en el componente porque la frase ES el contrato con el revisor, y así la fija un test
 * de `node:test` en milisegundos en vez de un render de Karma.
 */

/**
 * `2026-07-30T00:16:15.597Z` → `30/07/2026, 00:16 UTC`.
 *
 * Se formatea partiendo la cadena y **no** con `toLocaleString`, a propósito: la salida de `toLocaleString`
 * depende de los datos de ICU del runtime, así que el test correría contra el ICU de node y el usuario
 * vería el de Chrome — dos cadenas que nada obliga a coincidir. Partir la cadena las hace coincidir por
 * construcción, y esa es la única propiedad que hace falta acá.
 *
 * `generado_at` viene garantizado como ISO 8601 en UTC por `PgStore.getInforme` (que convierte en el borde
 * y tiene test propio). Si aun así llega otra cosa, **se muestra tal cual**: no se inventa una fecha ni se
 * esconde el dato: falla cerrado, igual que el parser de Markdown con una marca desconocida.
 *
 * Y va con «UTC» escrito. Sin la etiqueta, `00:16` se lee como hora de Madrid y son las 02:16: una hora
 * sin zona es una hora que miente en la mitad del año.
 */
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

export function fechaLegible(iso: string): string {
  const m = ISO_UTC.exec(iso);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1]}, ${m[4]}:${m[5]} UTC`;
}

/*
 * La fecha del research NO llega como dato: hay que leerla del documento, y esto es lo estrecho que se
 * puede hacer eso.
 *
 * `GET /runs/:id/informe` devuelve dos campos —`informe_md` y `generado_at`— y **ninguno es la fecha del
 * research**. La única copia que el portal tiene delante es la que `renderReport` imprime en el encabezado
 * del propio Markdown (`_ES · es · 2026-07-30T00:16:15.000Z_`). Así que sí, esto lee prosa de un paquete
 * del que el portal no depende a propósito (ADR-21), y por eso la regla es deliberadamente mezquina.
 *
 * ── QUÉ IMPONE ESTA REGLA, MEDIDO (2026-08-06) Y NO SUPUESTO ──────────────────────────────────────────
 *
 * La premisa que NO se puede dar por buena: `contrato/src/esquema.ts:137` tipa `generated_at` como
 * **`z.string()` pelado**. No exige ISO 8601, no exige UTC, no exige nada. Que hoy llegue un instante UTC
 * es una propiedad de los PRODUCTORES (`kr-service` y el seed usan `toISOString()`), no del contrato.
 *
 * Así que la regla no elimina «mostrar una fecha equivocada» en general — **eso el portal no lo puede
 * garantizar desde acá**. Lo que elimina son estos caminos concretos, cada uno con su test:
 *
 *   1. **Elegir entre dos candidatas.** Cero o ≥2 tokens ⇒ `null`. Nunca «la primera».
 *   2. **Leer una fecha del CUERPO** (una promo en una meta description, una FAQ): solo se mira la cabecera.
 *   3. **Leer el nombre del CLIENTE**: la línea 1 se excluye. Es el único texto libre que un humano escribe
 *      en la cabecera, y medido: con `generated_at` no-ISO y un cliente llamado `Bar 2026-07-30T00:00:00Z`,
 *      la versión anterior de esta función devolvía la fecha DEL NOMBRE.
 *   4. **Presentar como UTC algo que no lo es.** Se exige la `Z` final. Medido con la versión anterior, que
 *      la hacía opcional: `2026-07-30T02:16:15+02:00` daba `30/07/2026, 02:16 UTC` cuando el instante real
 *      es `00:16 UTC` — dos horas de error, con la etiqueta «UTC» puesta encima. Un ISO sin zona hacía lo
 *      mismo. Los dos ahora caen a `null`, y ésa es la razón por la que la `Z` no es opcional.
 *
 * **Lo que QUEDA en pie:** si un `renderReport` futuro pusiera OTRO timestamp UTC en las líneas 2-5 y
 * ninguno más, esta función lo devolvería creyendo que es la fecha del research. No hay forma de
 * distinguirlo sin que el contrato publique el campo. Es un riesgo declarado, no cubierto.
 *
 * Y sobre el volumen real: medido sobre el informe de la demo (13.718 bytes, 14 páginas) hay **un solo**
 * token con forma ISO en TODO el documento, en la línea 3. Los límites de arriba no descartan nada que hoy
 * exista — descartan lo que podría aparecer mañana.
 */
const ISO_UTC_EN_TEXTO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z/g;
/**
 * El generador emite el h1 en la 1, un blanco en la 2 y la línea de mercado+fecha en la 3; 5 da holgura.
 * **Se empieza en la 2 y no en la 1** a propósito: la 1 lleva el nombre del cliente, que es texto libre.
 */
const PRIMERA_LINEA_MIRADA = 1; // índice 0-based: se saltea la línea 1
const LINEAS_DE_CABECERA = 5;

export function fechaDelResearch(md: string): string | null {
  const cabecera = md.split('\n', LINEAS_DE_CABECERA).slice(PRIMERA_LINEA_MIRADA).join('\n');
  const hallados = [...cabecera.matchAll(ISO_UTC_EN_TEXTO)].map((m) => m[0]);
  return hallados.length === 1 ? (hallados[0] ?? null) : null;
}

/** La frase que no se negocia: es el motivo por el que este aviso existe (§7.2 de la spec). */
const REFLEJA_EL_BRIEF =
  'Refleja el brief original; las ediciones posteriores del revisor no están incluidas.';

/**
 * El aviso que la pantalla muestra junto al informe.
 *
 * Tres formas, según cuánto se sabe, y ninguna esconde lo que sí se sabe:
 *
 *  1. **Las dos fechas** → se nombran las dos y se dice que son dos hechos distintos.
 *  2. **Solo la de guardado** → se dice de qué es esa fecha y que la del research es otra, **sin remitir a
 *     ninguna parte**. La versión anterior mandaba a leerla «en el encabezado del informe», y eso cubría
 *     UNA de las dos causas del `null`: si `fechaDelResearch` devolvió `null` porque encontró ≥2 candidatas,
 *     el encabezado la muestra; si fue porque encontró CERO —o una que no era UTC, que se descarta—, el
 *     encabezado no la tiene y la frase mandaba al revisor a buscar algo que no está. Una redacción que
 *     depende de cuál de las dos causas se dio es una redacción que se equivoca la mitad de las veces.
 *  3. **Ninguna** —solo posible sin informe, porque `kr_informes.generado_at` es `not null` (0016)— → se
 *     dice lo esencial sin inventar ninguna fecha.
 *
 * El orden de los parámetros importa y el test lo fija: intercambiarlos produce un aviso que miente con
 * las dos fechas correctas, que es exactamente el error que este aviso viene a evitar.
 */
export function avisoCongelado(guardadoAt: string | null, researchAt: string | null): string {
  const guardado = guardadoAt === null ? null : fechaLegible(guardadoAt);
  const research = researchAt === null ? null : fechaLegible(researchAt);

  if (guardado !== null && research !== null) {
    return (
      `Research hecho el ${research}. Este render del informe se guardó el ${guardado}: ` +
      `son dos fechas distintas, no una que cambió. ${REFLEJA_EL_BRIEF}`
    );
  }
  if (guardado !== null) {
    return (
      `Este render del informe se guardó el ${guardado}: es cuándo se guardó, no cuándo se hizo el ` +
      `research, que es otra fecha y no se pudo leer de este informe. ${REFLEJA_EL_BRIEF}`
    );
  }
  return `Informe congelado: es un render guardado, no una vista en vivo. ${REFLEJA_EL_BRIEF}`;
}

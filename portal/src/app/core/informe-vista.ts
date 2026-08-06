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
 * del que el portal no depende a propósito (ADR-21), y por eso la regla es deliberadamente mezquina:
 *
 *   · se mira SOLO la cabecera (las primeras líneas, donde el generador la emite);
 *   · tiene que haber EXACTAMENTE UN timestamp ISO ahí. Cero o dos ⇒ `null`.
 *
 * Con eso, **el modo de fallo "fecha equivocada" no existe**: o hay una sola candidata sin ambigüedad, o
 * no hay ninguna y el aviso pasa a la redacción que remite a la fecha que el documento ya muestra. Una
 * fecha equivocada DENTRO de un aviso que explica cuál fecha es cuál sería el peor resultado posible, peor
 * que no mostrarla.
 *
 * Medido sobre el informe real de la demo el 2026-08-06 (13.718 bytes, 14 páginas): en TODO el documento
 * hay **un solo** token con forma ISO 8601, y está en la línea 3. No es que la cabecera sea el único sitio
 * donde podría aparecer uno — es que hoy no aparece en ningún otro, y si algún día aparece dentro de la
 * cabecera, esta función devuelve `null` en vez de adivinar.
 */
const ISO_EN_TEXTO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?/g;
/** El generador emite el h1 en la 1, un blanco en la 2 y la línea de mercado+fecha en la 3. 5 da holgura. */
const LINEAS_DE_CABECERA = 5;

export function fechaDelResearch(md: string): string | null {
  const cabecera = md.split('\n', LINEAS_DE_CABECERA).join('\n');
  const hallados = [...cabecera.matchAll(ISO_EN_TEXTO)].map((m) => m[0]);
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
 *  2. **Solo la de guardado** (no se pudo leer la del research del documento) → se dice de qué es esa
 *     fecha, y se remite a la del encabezado del informe, que está en pantalla unas líneas más abajo.
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
      `Este render del informe se guardó el ${guardado}; la fecha del research —cuándo se hizo— es la ` +
      `que el informe muestra en su encabezado, y son dos fechas distintas. ${REFLEJA_EL_BRIEF}`
    );
  }
  return `Informe congelado: es un render guardado, no una vista en vivo. ${REFLEJA_EL_BRIEF}`;
}

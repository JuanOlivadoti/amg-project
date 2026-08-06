/*
 * Lo que la pantalla del informe DICE de sí misma, como funciones puras.
 *
 * El informe está congelado en el instante en que se generó: si el revisor editó una keyword o retiró una
 * página después, el texto no lo refleja. Eso no se arregla —regenerar el informe en cada visita costaría
 * dinero y borraría el entregable que se le mandó al cliente—, así que **se declara en pantalla**. La
 * alternativa real no es «que esté al día»: es que alguien encuentre la discrepancia solo y no sepa cuál
 * de las dos cosas creer.
 *
 * Está acá y no en el componente porque la frase ES el contrato con el revisor, y así la fija un test de
 * `node:test` en milisegundos en vez de un render de Karma.
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

/**
 * El aviso que la pantalla muestra junto al informe.
 *
 * Con `null` —que en el contrato solo puede pasar si no hay informe, porque `kr_informes.generado_at` es
 * `not null` (0016)— el aviso sigue diciendo lo esencial **sin inventar una fecha**. La frase se
 * construye entera acá para que el test la pueda fijar: es lo único que le explica al revisor por qué el
 * informe no coincide con lo que acaba de editar.
 */
export function avisoCongelado(generadoAt: string | null): string {
  const cuando = generadoAt === null ? null : fechaLegible(generadoAt);
  return (
    (cuando === null
      ? 'Informe congelado en el momento en que se generó. '
      : `Informe generado el ${cuando}. `) +
    'Refleja el brief original; las ediciones posteriores del revisor no están incluidas.'
  );
}

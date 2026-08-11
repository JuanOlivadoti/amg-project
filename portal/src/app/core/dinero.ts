/**
 * El coste de un run, en dólares y listo para pintar — o `null` cuando no hay dato.
 *
 * ## Por qué devuelve `string | null` y no `string`
 *
 * `RunSummary.coste_micros_usd` es `number | null`, y ese `null` **no es un cero**: es lo que
 * `RUN_SUMMARY_COLS` devuelve cuando quien pregunta no es staff, porque lo decide `app.es_staff()`
 * dentro de Postgres (`db/src/store.ts`, ADR-15) y no un `if` de la API. Formatearlo como `"0.00"`
 * convertiría «la agencia no te muestra su margen» en «el research fue gratis», que es una
 * afirmación distinta y falsa.
 *
 * Es el mismo criterio que el informe ya aplica con `n/d` en vez de `0` para el volumen de búsqueda
 * (`contrato/src/informe.ts`, `metric()`/`pct()`): un dato ausente se declara ausente.
 *
 * Devolver `null` —y no la cadena `'n/d'`— es lo que deja la decisión de QUÉ decir en cada pantalla:
 * el brief y la lista de runs **no pintan la línea**, y el tile de la cartera dice `n/d`. Una cadena
 * fija acá les quitaría esa elección a las tres.
 *
 * Vive en `core/` y no en los componentes porque estaba duplicada como método privado en `BriefPage`
 * y en la pantalla de research (hoy `ClienteResearchPage`, el tab de la ficha del cliente), y dos
 * copias de una regla de formato son dos oportunidades de que solo una aprenda el caso `null`.
 */
export function usdDeMicros(micros: number | null): string | null {
  // `=== null` y no `!micros`: un coste de CERO es un dato, y con la guarda falsy desaparecería.
  return micros === null ? null : (micros / 1_000_000).toFixed(2);
}

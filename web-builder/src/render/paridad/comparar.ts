/**
 * Los extractores del gate de paridad. Ver `casos.ts` para el porqué del gate entero.
 *
 * La idea es separar **lo que el refactor puede cambiar** de **lo que no**. Reorganizar clases,
 * envoltorios e indentación es el objetivo del trabajo; cambiar lo que el visitante lee, adónde
 * llevan los enlaces, qué anclas existen o qué ve Google es una regresión. Estos cuatro extractores
 * son esa línea, escrita como código en vez de como criterio.
 */

/** Dónde viven las fixtures. Una sola definición: la usan el capturador y el test. */
export const DIR_FIXTURES = new URL("./fixtures/", import.meta.url);

/** Lo que hay dentro de cada `<script type="application/ld+json">`, en orden de aparición. */
export function jsonLdDe(html: string): string[] {
  const out: string[] = [];
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  for (const m of html.matchAll(re)) out.push((m[1] ?? "").trim());
  return out;
}

/**
 * El `<script type="application/json" id="research-trace">`, que enlaza la página con el research que
 * la produjo (`source_keyword`, `opportunity_score`, `evidencia`…).
 *
 * **Tiene su propio extractor porque si no se quedaba fuera del gate entero**, y eso lo descubrí
 * auditando estos extractores, no escribiéndolos: `textoVisibleDe` lo borra por ser un `<script>`, y
 * `jsonLdDe` no lo ve porque su tipo es `application/json`, no `application/ld+json`. O sea que el
 * refactor podía perderlo completo con las cuatro comparaciones en verde — un agujero silencioso en
 * la mitad del gate que existe para que nada se pierda en silencio.
 *
 * Devuelve `null` cuando no hay ninguno: las páginas sintetizadas (home, `/menu`, `/blog`) no salen
 * de un research, así que ahí la ausencia es el valor correcto y hay que distinguirla de un `""`.
 */
export function researchTraceDe(html: string): string | null {
  const m = /<script type="application\/json" id="research-trace">([\s\S]*?)<\/script>/.exec(html);
  return m ? (m[1] ?? "").trim() : null;
}

/**
 * El texto que un visitante lee, normalizado.
 *
 * Se quitan `<script>` y `<style>` **con su contenido** —el JSON-LD y el CSS no son texto visible, y
 * cada uno tiene su propia comprobación— y después todas las etiquetas. Los espacios se colapsan
 * porque la indentación del markup nuevo va a ser distinta y eso es precisamente lo permitido.
 *
 * **No se des-escapan las entidades a propósito.** Si `&amp;` pasara a `&`, eso no es un cambio de
 * presentación: es un cambio de escapado, o sea de la defensa contra inyección. Tiene que caer.
 */
export function textoVisibleDe(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<style[\s\S]*?<\/style>/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Los `href` en orden de aparición. El orden importa: si el pie subiera antes del contenido, los
 * enlaces seguirían siendo los mismos y el documento sería otro.
 */
export function hrefsDe(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
}

/**
 * Los `id` en orden. Son los destinos de ancla del nav (`#ubicaciones`, `#contacto`, `#faq`), así que
 * perder uno rompe un enlace que sigue existiendo — el peor tipo de rotura, porque no da error.
 */
export function idsDe(html: string): string[] {
  return [...html.matchAll(/\sid="([^"]*)"/g)].map((m) => m[1] ?? "");
}

/** Las cinco caras que el refactor NO puede cambiar. */
export interface HuellaParidad {
  texto: string;
  hrefs: string[];
  ids: string[];
  jsonLd: string[];
  researchTrace: string | null;
}

export function huellaDe(html: string): HuellaParidad {
  return {
    texto: textoVisibleDe(html),
    hrefs: hrefsDe(html),
    ids: idsDe(html),
    jsonLd: jsonLdDe(html),
    researchTrace: researchTraceDe(html),
  };
}

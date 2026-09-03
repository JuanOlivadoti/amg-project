/**
 * El texto plano de un HTML ya sanitizado, para el respaldo `text/plain` del botón "Copiar" (Task
 * 11, Step 3.5) — la MISMA `post_cuerpo` que se copia como `text/html`, sin tags, para pegar en un
 * campo que solo acepta texto plano.
 *
 * **No es un sanitizador.** El HTML de entrada YA pasó por `sanitizarHtml` en el servidor (allowlist
 * de `db/src/sanitizar-html.ts`: p, br, strong, em, b, i, u, h2-4, ul, ol, li, blockquote, a — sin
 * atributos salvo `href`), así que no hay nada peligroso que neutralizar acá: solo quitar marcado
 * para el destino que no lo entiende. Por eso una expresión regular alcanza y no hace falta el DOM
 * (`document.createElement(...).textContent`) — lo que mantiene esta función pura y testeable con
 * `node:test`, sin navegador (ver `portal-angular`: "si se puede sacar a `core/`, va a `core/`").
 */
export function htmlATextoPlano(html: string): string {
  return html
    // Los cierres de bloque (y `<br>`) se vuelven salto de línea ANTES de quitar el resto de las
    // tags: si se quitaran junto con todo lo demás, dos párrafos pegados leerían como una sola
    // oración ("UnoDos" en vez de "Uno\nDos").
    .replace(/<\/(p|li|h[2-4]|blockquote)>|<br\s*\/?>/gi, '\n')
    // El resto del marcado (aperturas de bloque, tags inline como <strong>/<em>/<a href="…">, y los
    // cierres que no son de bloque) se descarta entero, atributos incluidos — es lo que hace que un
    // <a href="…"> conserve el texto visible del link y nunca la URL.
    .replace(/<[^>]+>/g, '')
    // Varios bloques vacíos seguidos ("<p></p><p></p>") no pueden acumular saltos de línea sin
    // límite: un párrafo en blanco se ve como una línea vacía, no como cuatro.
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

import type { Bloque, Inline } from './markdown';

/**
 * `Bloque[]`/`Inline[]` → HTML y texto plano, para el `text/html`+`text/plain` del botón "Copiar
 * mail" de `pages/comparativas/resultado.ts` — mismo contrato que el "Copiar" de `pages/posts/posts.ts`
 * (dos formatos a la vez vía `ClipboardItem`), pero ahí el origen YA es HTML sanitizado por el
 * servidor y acá el origen es el Markdown del mail (`mailCuerpoMd`), que primero hay que parsear.
 *
 * **Esto NO es una plantilla de Angular y no lo cubre `sin-html-crudo.test.ts` por eso: la cadena que
 * arma no se pinta nunca en el DOM de este portal** —viaja directo a `navigator.clipboard.write` para
 * que la pegue OTRA aplicación (el cliente de correo). Aun así se escapa `&`/`<`/`>` en cada `Inline`:
 * no porque el dato sea peligroso acá, sino porque un `<` suelto en el texto de una opción ("cobertura
 * < 500€") rompería el HTML que arma esta función si no se escapara.
 */

/** Exportada porque `pages/comparativas/resultado.ts` la reusa para escapar `mailAsunto`, que no
 *  pasa por `parsearMarkdown` (es una sola línea de texto, no un documento) pero igual se interpola
 *  en el mismo HTML del portapapeles. */
export function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inlineAHtml(partes: readonly Inline[]): string {
  return partes
    .map((p) => {
      const t = escapar(p.valor);
      if (p.tipo === 'negrita') return `<strong>${t}</strong>`;
      if (p.tipo === 'cursiva') return `<em>${t}</em>`;
      if (p.tipo === 'codigo') return `<code>${t}</code>`;
      return t;
    })
    .join('');
}

/** El documento entero como HTML, para el `text/html` del portapapeles. */
export function bloquesAHtml(bloques: readonly Bloque[]): string {
  return bloques
    .map((b) => {
      if (b.tipo === 'encabezado') return `<h${b.nivel}>${inlineAHtml(b.texto)}</h${b.nivel}>`;
      if (b.tipo === 'parrafo') return `<p>${inlineAHtml(b.texto)}</p>`;
      if (b.tipo === 'cita') return `<blockquote>${inlineAHtml(b.texto)}</blockquote>`;
      if (b.tipo === 'lista') {
        return `<ul>${b.items.map((i) => `<li>${inlineAHtml(i)}</li>`).join('')}</ul>`;
      }
      const cabecera = `<tr>${b.cabecera.map((c) => `<th>${inlineAHtml(c)}</th>`).join('')}</tr>`;
      const filas = b.filas
        .map((f) => `<tr>${f.map((c) => `<td>${inlineAHtml(c)}</td>`).join('')}</tr>`)
        .join('');
      return `<table><thead>${cabecera}</thead><tbody>${filas}</tbody></table>`;
    })
    .join('');
}

function inlineATexto(partes: readonly Inline[]): string {
  return partes.map((p) => p.valor).join('');
}

/** El documento entero como texto plano, para el respaldo `text/plain` del portapapeles. */
export function bloquesATexto(bloques: readonly Bloque[]): string {
  return bloques
    .map((b) => {
      if (b.tipo === 'encabezado' || b.tipo === 'parrafo' || b.tipo === 'cita') {
        return inlineATexto(b.texto);
      }
      if (b.tipo === 'lista') return b.items.map((i) => `- ${inlineATexto(i)}`).join('\n');
      return [b.cabecera, ...b.filas].map((fila) => fila.map(inlineATexto).join(' | ')).join('\n');
    })
    .join('\n\n');
}

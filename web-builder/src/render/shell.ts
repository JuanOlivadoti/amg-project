import { ensamblarCss } from "./css.js";
import { SLUG_BLOG, esc, safeJson } from "./lib.js";
import { CATALOGO, piezaPorId } from "./piezas/index.js";
import type { CtxPieza, Pieza } from "./piezas/tipos.js";
import type { Plantilla } from "./plantilla.js";

/**
 * **El shell del documento: fijo, fuera de la receta.**
 *
 * ```text
 * <head>  (title, meta, canonical, OG, JSON-LD, research trace, <style>)
 * <body>
 *   cabecera          ← zona fija
 *   <main> … </main>  ← AQUÍ va la receta, y SOLO acá
 *   <footer> contacto, locales (dueña de id="ubicaciones"), blog + línea técnica </footer>
 * ```
 *
 * `cabecera`, `contacto` y `locales` no son contenido: son obligaciones del documento y de la
 * navegación. Si vivieran en la receta, el tipo permitiría poner el pie primero, omitir la cabecera o
 * duplicar las ubicaciones, y la única defensa sería la prosa de un documento de diseño.
 *
 * Este archivo es la razón por la que el bug del modo oscuro sobrevivió tanto: antes cada una de las
 * cuatro funciones de render repetía su propio `<!doctype>`, `<head>`, `<style>` y footer, así que
 * arreglar algo del shell había que arreglarlo cuatro veces.
 */

/** Lo que va en el `<head>`. Nada de esto lo decide una pieza: el JSON-LD es del documento. */
export interface CabezaDocumento {
  lang: string;
  title: string;
  /** Vacío → no se emite `<meta name="description">`. */
  description?: string;
  /** Se usa para `<link rel="canonical">` y para `og:url`: una sola fuente de verdad. */
  canonical: string;
  ogTitle: string;
  ogDescription?: string;
  ogImage?: string;
  /** `undefined` → sin bloque `ld+json`. `/blog` no lleva. */
  jsonLd?: unknown;
  /** HTML ya serializado del `<script id="research-trace">`. Solo las stories lo llevan. */
  trace?: string;
}

/** La línea técnica y el enlace al blog: lo que el pie emite pase lo que pase. */
export interface PieDocumento {
  contractVersion: string;
  schemaType: string;
  hayBlog: boolean;
}

export interface Documento {
  cabeza: CabezaDocumento;
  receta: Plantilla;
  ctx: CtxPieza;
  pie: PieDocumento;
}

/**
 * El ensamblador. Los cuatro puntos de entrada de `html.ts` son cuatro llamadas a esta función con
 * distinta receta de contenido.
 *
 * El orden de las operaciones importa: **primero se renderiza todo, después se arma el CSS**, porque
 * el `<style>` solo lleva el CSS de las piezas que efectivamente dibujaron algo.
 */
export function renderDocumento(doc: Documento): string {
  const { cabeza, receta, ctx, pie } = doc;

  const usadas = new Set<string>();
  const emitir = (id: string): string => {
    const pieza = piezaPorId(id);
    if (!pieza) return ""; // receta rota: falta un bloque, no se sirve un 503. Lo caza un test.
    const html = pieza.render(ctx);
    if (html) usadas.add(pieza.id);
    return html;
  };

  const cabeceraHtml = emitir("cabecera");
  const contenido = receta.contenido.map(emitir).filter(Boolean).join("\n");
  const contactoHtml = emitir("contacto");
  const localesHtml = emitir("locales");

  const tecnica = `<p class="tecnica">Página generada por AMG OS · contrato ${esc(pie.contractVersion)} · schema ${esc(pie.schemaType)}</p>`;
  const mas = pie.hayBlog ? `<p class="mas"><a href="/${SLUG_BLOG}">Blog</a></p>` : "";
  const pieHtml = `<footer>\n${[contactoHtml, localesHtml, mas, tecnica].filter(Boolean).join("\n")}\n</footer>`;

  // Orden de CATÁLOGO, no de receta: dos páginas con las mismas piezas usadas → `<style>` idéntico.
  const piezasUsadas: Pieza[] = CATALOGO.filter((p) => usadas.has(p.id));
  const css = ensamblarCss(piezasUsadas, ctx.profile?.brand);

  return `<!doctype html>
<html lang="${esc(cabeza.lang)}">
<head>
${renderCabeza(cabeza, css)}
</head>
<body>
${cabeceraHtml}
<main>
${contenido}
</main>
${pieHtml}
</body>
</html>`;
}

function renderCabeza(c: CabezaDocumento, css: string): string {
  const url = esc(c.canonical);
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${esc(c.title)}</title>`,
    // ⚠️ CAMBIO DE CONDUCTA DELIBERADO, y por eso está escrito acá y no solo en el commit.
    //
    // El render viejo era **mixto**: `renderStory` emitía esta etiqueta y la de `og:description`
    // siempre (aunque `seo.description` fuera `""`), mientras `renderHome` ya las omitía cuando no
    // había descripción. El ensamblado unifica en la conducta de `renderHome`.
    //
    // Se decidió mantenerlo, no restaurar la emisión incondicional: `content=""` es peor señal para
    // un buscador que la ausencia de la etiqueta, no es visible para nadie, y la mezcla anterior no
    // respondía a ninguna decisión. En PROD la story llega de la CDA **sin pasar por Zod**, así que
    // un `seo_description` vacío en el Visual Editor es alcanzable y este es el caso real.
    //
    // El gate de paridad NO cubre el `<head>` salvo el JSON-LD y la traza, así que lo cazó una
    // revisión leyendo el diff, no un test. Ahora hay uno (`shell.test.ts`) que fija la conducta.
    c.description ? `<meta name="description" content="${esc(c.description)}">` : "",
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:title" content="${esc(c.ogTitle)}">`,
    c.ogDescription ? `<meta property="og:description" content="${esc(c.ogDescription)}">` : "",
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${url}">`,
    c.ogImage ? `<meta property="og:image" content="${esc(c.ogImage)}">` : "",
    c.jsonLd !== undefined ? `<script type="application/ld+json">\n${safeJson(c.jsonLd)}\n</script>` : "",
    c.trace ?? "",
    `<style>${css}</style>`,
  ]
    .filter(Boolean)
    .join("\n");
}

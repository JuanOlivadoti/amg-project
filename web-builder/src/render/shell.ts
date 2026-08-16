import type { BrandTheme } from "../types.js";
import { ensamblarCss, rolDeTitulares } from "./css.js";
import { archivoTitulares, rutaPublica } from "./fuentes.js";
import { nuevoPresupuestoImagenes } from "./imagenes.js";
import { nuevoPresupuestoVideos } from "./videos.js";
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
  /**
   * El contexto de las piezas **sin el presupuesto de imágenes**: lo pone el ensamblador.
   *
   * ⚠️ **El `Omit` NO hace imposible reutilizar un presupuesto — solo bloquea el literal.** Esto decía
   * "imposible, no improbable", y una revisión lo midió con `tsc --strict`: pasar un `CtxPieza`
   * completo **desde una variable** compila sin error; solo el literal inline da `TS2353`. Es la regla
   * de *excess property checking* de TypeScript, que únicamente mira objetos literales frescos.
   *
   * Lo que de verdad impone la garantía es el **orden del spread** en `renderDocumento`:
   * `presupuestoImagenes` se asigna *después* de `...doc.ctx`, así que un presupuesto de contrabando se
   * sobrescribe igual. El `Omit` sigue valiendo la pena —documenta la intención y caza el error obvio—
   * pero quien no puede romperse es esa línea, no este tipo.
   */
  ctx: Omit<CtxPieza, "presupuestoImagenes" | "presupuestoVideos">;
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
  const { cabeza, receta, pie } = doc;

  // ⚠️ **Un presupuesto NUEVO por documento, y este `nuevoPresupuestoImagenes()` es todo el asunto.**
  //
  // El tope de 60 `<img>` es del documento (§Política de imágenes, punto 5), así que el contador tiene
  // que nacer y morir con el documento. Si viviera en el módulo —una constante, un `let` de arriba—
  // el renderizador, que es un proceso LARGO que atiende a TODOS los clientes, serviría la primera
  // web con fotos y **todas las siguientes sin ellas**. Y no se vería: casi todo test renderiza una
  // sola vez. Lo fijan dos tests que renderizan dos veces (`imagenes.test.ts`).
  //
  // **El orden del spread es la garantía, no el `Omit` del tipo** (ver `Documento.ctx`): si alguien
  // moviera `presupuestoImagenes` ANTES del `...doc.ctx`, un contexto que trajera uno propio lo
  // pisaría y volveríamos al contador compartido. Esa es la línea que no se puede tocar.
  const ctx: CtxPieza = {
    ...doc.ctx,
    presupuestoImagenes: nuevoPresupuestoImagenes(),
    presupuestoVideos: nuevoPresupuestoVideos(),
  };

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
  // **El pie, en dos zonas** (rediseño 2026-08-10). Arriba las columnas —contacto y locales—, abajo
  // la línea legal. Las dos van dentro de una `.banda`, y el `<footer>` queda full-bleed para que su
  // fondo llegue a los bordes de la pantalla: es la misma decisión que hace full-bleed a `.seccion`.
  //
  // El envoltorio `.pie-cols` existe porque **las columnas las forman los wrappers de las piezas**,
  // que son hermanos: sin un contenedor propio, la rejilla tendría que declararse sobre `<footer>` y
  // entonces la línea legal sería una columna más. Que el contenedor lo emita el shell y no una pieza
  // es lo mismo de siempre: el pie es una obligación del documento, no contenido de una receta.
  const columnas = [contactoHtml, localesHtml].filter(Boolean).join("\n");
  const legal = [mas, tecnica].filter(Boolean).join("\n");
  const pieHtml = `<footer>\n<div class="banda">\n<div class="pie-cols">\n${columnas}\n</div>\n<div class="pie-legal">\n${legal}\n</div>\n</div>\n</footer>`;

  // Orden de CATÁLOGO, no de receta: dos páginas con las mismas piezas usadas → `<style>` idéntico.
  const piezasUsadas: Pieza[] = CATALOGO.filter((p) => usadas.has(p.id));
  const brand = ctx.profile?.brand;
  const css = ensamblarCss(piezasUsadas, brand);

  return `<!doctype html>
<html lang="${esc(cabeza.lang)}">
<head>
${renderCabeza(cabeza, css, preloadDeTitulares(brand))}
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

/**
 * El `preload` de la fuente de titulares. **Una sola familia, o ninguna.**
 *
 * «`preload` **solo** de la fuente de titulares. Precargar tres familias es competir contra el propio
 * LCP» (spec, §Enmienda 2026-08-02 › Las tipografías, self-hosted). Una ficha con manual pide hasta
 * tres familias; las otras dos se descargan cuando el CSS las pida, con la prioridad que les toque.
 *
 * ⚠️ **`crossorigin` no es opcional, y su ausencia no da error en ningún sitio.** Las fuentes se piden
 * SIEMPRE en modo CORS anónimo —lo manda la especificación de CSS Fonts, también para el mismo
 * origen—. Un `<link rel="preload" as="font">` sin `crossorigin` se pide en otro modo, no casa con la
 * petición que después hace la `@font-face`, y el navegador **se descarga el archivo dos veces**: el
 * preload pasa de ahorrar tiempo a costar bytes. Es el fallo más común de esta etiqueta y por eso lo
 * fija un test y no este comentario.
 *
 * La URL sale entera de `FAMILIAS` (código), nunca de la ficha: el cliente solo elige un nombre de rol
 * de la allowlist. Va escapada igual, porque «este valor viene de nuestro código» es la frase con la
 * que empiezan las inyecciones cuando alguien cambia de dónde viene el valor.
 */
function preloadDeTitulares(brand?: BrandTheme | null): string {
  const rol = rolDeTitulares(brand);
  if (!rol) return "";
  const archivo = archivoTitulares(rol);
  if (!archivo) return ""; // rol legacy: es un stack del sistema, no hay nada que descargar.
  return `<link rel="preload" as="font" type="font/woff2" href="${esc(rutaPublica(archivo))}" crossorigin>`;
}

function renderCabeza(c: CabezaDocumento, css: string, preload: string): string {
  const url = esc(c.canonical);
  return [
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    // Arriba del todo y ANTES del `<style>`: un preload declarado después del CSS que lo necesita
    // llega tarde a lo único que hace, que es adelantar la petición.
    preload,
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

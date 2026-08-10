import { envolver, esc, hrefTelefono, localesDe } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * El bloque de contacto del pie. Dueña de `id="contacto"`.
 *
 * **Pieza de SHELL, no de receta** (§1): el nav ancla a `#contacto` desde todas las páginas, así que
 * la región tiene que existir en todas por construcción. Antes era una `<section id="contacto">`
 * dentro de `<main>`, repetida en cada landing y ausente de la home sintetizada.
 *
 * ## El rediseño: la primera COLUMNA del pie
 *
 * El pie pasó de una tira de 760 px a una rejilla a lo ancho de la banda (`.pie-cols`, en el base), y
 * esta pieza es su primera columna: el rótulo, el nombre del negocio en grande y el teléfono. El
 * `<strong>` del nombre se fue porque la jerarquía ya la da el tamaño — dejar los dos era pedir
 * énfasis dos veces.
 *
 * El `letter-spacing` del `h2` **cambió de signo a propósito**: era `-.01em`, heredado de cuando este
 * `h2` era el título de una sección de contenido; hoy es el rótulo de una columna en versalitas, y ahí
 * el espaciado va abierto. La nota histórica del selector sigue abajo porque explica cómo se pierde un
 * valor al repartir un CSS global, que es la lección, no el número.
 */
export const contacto: Pieza = {
  id: "contacto",
  raiz: "p-contacto",
  // `border:0;padding:0` eran los que anulaban el `section{padding:32px 0;border-bottom:…}` global.
  // Se conservan porque el resultado computado tiene que ser idéntico al de antes, no porque hagan
  // falta hoy: si mañana alguien devuelve una regla de `section`, esta pieza ya está a salvo.
  // `h2`/`p` los declara la pieza porque los declaraba `footer h2`/`footer p`, que estilaban también
  // el pie de `locales` y la línea técnica del shell — un selector global de tres dueños.
  css: `.p-contacto .contacto{border:0;padding:0}
/* El rótulo de una COLUMNA del pie, no el título de una sección: pequeño, en versalitas y con el
   filete decorativo debajo. Las tres columnas comparten el aspecto (ver \`locales.ts\`), y son dos
   copias a propósito: el CSS base solo acepta lo que necesitan dos piezas *y* no tiene otro dueño, y
   acá el dueño es cada pieza — la del pie que dibuja sus locales y la que dibuja el contacto. */
.p-contacto h2{font-family:var(--fuente-titulo);font-size:1.05rem;text-transform:uppercase;letter-spacing:.08em;margin:0 0 18px;padding:0 0 12px;color:var(--titulo);border-bottom:2px solid var(--decorativo)}
.p-contacto p{margin:0 0 8px}
.p-contacto .negocio{font-family:var(--fuente-titulo);font-size:1.3rem;font-weight:500;color:var(--titulo);margin:0 0 10px}
/* El \`tel:\` salía con el azul del navegador y el subrayado por defecto: dentro de un pie sobrio es
   lo único que grita, y el azul no es de la marca de nadie. Toma el color del texto y conserva un
   subrayado —tenue, pero subrayado— porque quitarlo dejaría un enlace que no se puede distinguir de
   un párrafo salvo por el cursor. */
.p-contacto a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted)}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile) return "";
    // Mismo fallback que el JSON-LD (`homeLd`/`primaryEntity`): sin esto, un perfil con
    // `locations[0].telephone` pero sin `telephone` clásico de nivel superior no mostraba nada en
    // "Contacto", aunque "Nuestros locales" sí tuviera el teléfono un poco más abajo. Y con ambos,
    // gana `locations`, igual que en el JSON-LD.
    const tel = localesDe(profile)[0]?.telephone ?? profile.telephone;
    const telHtml = tel ? `<p>Tel: <a href="${hrefTelefono(tel)}">${esc(tel)}</a></p>` : "";
    return envolver(
      "p-contacto",
      `<section class="contacto" id="contacto">
  <h2>Contacto</h2>
  <p class="negocio">${esc(profile.name)}</p>
  ${telHtml}
</section>`,
    );
  },
};

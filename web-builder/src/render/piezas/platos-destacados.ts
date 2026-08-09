import type { MenuItem } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import { MAX_DESTACADOS, SLUG_MENU, comoImagen, envolver, esc, preciosDe, renderImagen } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **El extracto de la carta**: hasta seis platos con su foto, que llevan a `/menu`.
 *
 * No es la carta y no debe parecerlo. Es el gancho: lo que hace que alguien que entró por una landing
 * de research entienda en dos segundos qué se come acá y haga clic en "ver la carta completa".
 *
 * ## Solo el PRIMER precio, y sin etiqueta
 *
 * Contrato de la enmienda 2026-08-02, literal: *"repetir ahí «Media 9 € / Ración 15 €» convierte un
 * extracto en una tabla y le quita la razón de existir al enlace"*. `cartaCategorias` —la carta de
 * verdad— sí muestra todos los importes con su etiqueta. Las dos leen el mismo dato por la misma
 * función (`preciosDe`, que resuelve `precios` sobre `price`); lo que cambia es cuánto imprime cada
 * una, y eso es una decisión de diseño de cada pieza, no del modelo.
 *
 * ## Qué seis
 *
 * Los seis **primeros** de `menu`, en el orden de la ficha. Elegir por otro criterio —los que tienen
 * foto, los más caros— sería un ranking que nadie pidió y que el cliente no puede controlar; el orden
 * de su carta sí lo controla él.
 */
export const platosDestacados: Pieza = {
  id: "platosDestacados",
  raiz: "p-platosDestacados",
  // Rejilla con `auto-fill`: dos o tres columnas según el ancho, sin media queries. `minmax(190px,1fr)`
  // es lo que evita que una tarjeta con foto baje de un ancho donde el nombre del plato ya no cabe en
  // una línea.
  css: `.p-platosDestacados .destacados{padding:32px 0;border-bottom:1px solid #f0f0f0}
.p-platosDestacados .destacados h2{font-size:1.45rem;margin:0 0 16px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-platosDestacados .platos{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:20px}
.p-platosDestacados .plato{margin:0}
/* \`aspect-ratio\` fijo + \`object-fit:cover\`: las fotos de la ficha vienen con proporciones distintas y
   sin esto la rejilla queda con las tarjetas descuadradas entre sí. El recorte lo hace el navegador. */
.p-platosDestacados .plato-foto{width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;margin:0 0 10px}
.p-platosDestacados .plato h3{font-size:1.02rem;margin:0 0 4px;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-platosDestacados .desc{margin:0 0 6px;color:var(--muted);font-size:.92rem}
/* \`--acento-legible\` y no \`--accent\`: es texto de acento sobre el fondo de la página, y en oscuro el
   acento pleno de un cliente puede quedar ilegible. Los botones sí conservan \`--accent\`. */
.p-platosDestacados .precio{margin:0;color:var(--acento-legible);font-weight:600}
.p-platosDestacados .ver-carta{margin:20px 0 0}
.p-platosDestacados .ver-carta a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted);font-weight:600}
@media(prefers-color-scheme:dark){.p-platosDestacados .destacados{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const menu = ctx.profile?.menu ?? [];
    // Sin carta no hay extracto que hacer, y el enlace a `/menu` llevaría a una página que el
    // renderizador no sirve (el nav aplica el mismo criterio para mostrar "Menú").
    if (menu.length === 0) return "";

    const tarjetas = menu
      .slice(0, MAX_DESTACADOS)
      .map((it) => unPlato(it, ctx.presupuestoImagenes))
      .join("\n");

    return envolver(
      "p-platosDestacados",
      `<section class="destacados">
  <h2>De la carta</h2>
  <ul class="platos">
${tarjetas}
  </ul>
  <p class="ver-carta"><a href="/${SLUG_MENU}">Ver la carta completa</a></p>
</section>`,
    );
  },
};

function unPlato(it: MenuItem, presupuesto: PresupuestoImagenes): string {
  const foto = renderImagen(comoImagen(it.foto), "plato-foto", presupuesto);
  const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
  // Solo el primero, y solo el importe: ver el bloque de arriba.
  const primero = preciosDe(it)[0];
  const precio = primero ? `<p class="precio">${esc(primero.importe)}</p>` : "";
  return `    <li class="plato">${foto}<h3>${esc(it.name)}</h3>${desc}${precio}</li>`;
}

import type { MenuItem } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import { MAX_PLATOS_DESTACADOS, SLUG_MENU, comoImagen, envolver, esc, preciosDe, renderImagen } from "../lib.js";
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
 *
 * ## El rediseño: dos columnas con el precio a la derecha
 *
 * La referencia presenta su extracto como una **lista a dos columnas** —miniatura, nombre y
 * descripción a la izquierda; el importe alineado a la derecha— en vez de como una rejilla de
 * tarjetas. Es mejor lectura para lo que esta pieza es: seis renglones que se recorren de un vistazo
 * buscando el precio, no seis productos que compiten por un clic. Y de paso la sección deja de
 * parecerse a `indice`, que sí es una rejilla de tarjetas y va justo debajo en la home.
 *
 * El único gancho de la pieza —el enlace a `/menu`— pasa a ser **un botón centrado**, con las medidas
 * del botón de la referencia. Un enlace subrayado al final de una sección con encabezado grande se lee
 * como una nota al pie, y esta pieza no existe para otra cosa.
 *
 * El título de sección deja de ser un `h2` propio y pasa al **encabezado compartido** (antetítulo +
 * `h2`) del CSS base. El rótulo es una etiqueta de plantilla, no contenido del negocio: "Nuestros
 * platos" y no "los más pedidos", que sería un ranking que la ficha no dice en ninguna parte.
 */
export const platosDestacados: Pieza = {
  id: "platosDestacados",
  raiz: "p-platosDestacados",
  css: `/* Dos columnas a partir de 992, una debajo. \`grid\` y no \`columns\`: con columnas CSS un renglón
   se puede partir por la mitad entre dos columnas. Mismo criterio y mismo breakpoint que la carta de
   verdad, para que el extracto y la carta no se lean como dos diseños distintos. */
.p-platosDestacados .platos{list-style:none;margin:0;padding:0;display:grid;gap:0 48px}
@media(min-width:992px){.p-platosDestacados .platos{grid-template-columns:1fr 1fr}}
/* El separador va en negro/blanco translúcido y NO en un gris fijo: esta sección se dibuja sobre
   '--soft', que es un color de la ficha del cliente (el crema del cliente de demo, el que sea del
   siguiente). Un '#f0f0f0' encima de un fondo alterno oscuro desaparecería, y encima de uno muy claro
   se vería como una raya sucia.
   ⚠️ **El separador lo llevan TODOS los renglones, incluido el último, y aquí NO se copia la regla
   de la carta que le quita el borde al último hijo.** Allí existe porque el contenedor de la categoría
   dibuja su propia línea justo debajo y salían dos pegadas; acá no hay ninguna. Y con dos columnas,
   quitarle el borde solo al último del DOM produce lo que se ve en el navegador con un extracto de
   dos platos: la fila con línea debajo del de la izquierda y sin línea debajo del de la derecha. Una
   línea de cierre bajo la última fila es simétrica y hace de remate antes del botón. */
.p-platosDestacados .plato{margin:0;padding:18px 0;border-bottom:1px solid rgba(0,0,0,.09);display:flex;gap:16px;align-items:flex-start}
/* La miniatura no crece ni se encoge: sin \`flex:0 0 auto\`, una descripción larga la aplasta y la lista
   queda con miniaturas de anchos distintos renglón a renglón. */
.p-platosDestacados .plato-foto{flex:0 0 auto;width:84px;height:84px;object-fit:cover;border-radius:10px}
.p-platosDestacados .datos{flex:1 1 auto;min-width:0}
/* ⚠️ **El precio va en la misma línea que el NOMBRE, no como tercera columna del renglón.** En
   escritorio se ve idéntico —'.datos' llega hasta el borde derecho, así que el precio queda donde
   quedaría igual—, pero en móvil cambia todo: medido a 390, con el precio como hermano de '.datos' la
   descripción se quedaba en 134 px y se desmigaba en cinco renglones. Así la descripción se lleva el
   ancho entero bajo el nombre. */
.p-platosDestacados .fila{display:flex;gap:16px;align-items:baseline;justify-content:space-between}
.p-platosDestacados .plato h3{font-size:1.12rem;margin:0 0 4px;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-platosDestacados .desc{margin:0;color:var(--muted);font-size:.92rem}
/* \`--acento-legible\` y no \`--accent\`: es texto de acento sobre el fondo de la página, y en oscuro el
   acento pleno de un cliente puede quedar ilegible. Los botones sí conservan \`--accent\`.
   \`white-space:nowrap\`: "14,50 €" partido en dos líneas deja de ser un precio. */
.p-platosDestacados .precio{flex:0 0 auto;margin:0;color:var(--acento-legible);font-weight:600;white-space:nowrap}
.p-platosDestacados .ver-carta{margin:clamp(28px,3vw,44px) 0 0;text-align:center}
/* Las medidas del botón de la referencia (15px 40px, radio 5, versalita, fuente de titulares). Son las
   mismas que las del botón de la portada, y la duplicación es deliberada: el CSS base solo acepta lo
   que necesitan dos o más piezas Y no tiene dueño, y un '.boton' compartido es un cambio del patrón
   base, no de esta pieza. */
.p-platosDestacados .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:15px 40px;border-radius:5px;font-family:var(--fuente-titulo);font-size:1rem;font-weight:500;text-transform:uppercase;letter-spacing:.02em}
`,

  cssOscuro: `@media(prefers-color-scheme:dark){.p-platosDestacados .plato{border-color:rgba(255,255,255,.1)}}
`,

  render(ctx: CtxPieza): string {
    const menu = ctx.profile?.menu ?? [];
    // Sin carta no hay extracto que hacer, y el enlace a `/menu` llevaría a una página que el
    // renderizador no sirve (el nav aplica el mismo criterio para mostrar "Menú").
    if (menu.length === 0) return "";

    const tarjetas = menu
      .slice(0, MAX_PLATOS_DESTACADOS)
      .map((it) => unPlato(it, ctx.presupuestoImagenes))
      .join("\n");

    // El antetítulo y el título son ETIQUETAS DE PLANTILLA, no contenido del negocio — mismo criterio
    // que en `cartaCategorias`. Lo que no se inventa es el dato del cliente; cómo se rotula una
    // sección es del diseño.
    return envolver(
      "p-platosDestacados",
      `<section class="seccion alt"><div class="banda">
  <div class="encabezado"><p class="antetitulo">De la carta</p><h2>Nuestros platos</h2></div>
  <ul class="platos">
${tarjetas}
  </ul>
  <p class="ver-carta"><a class="cta" href="/${SLUG_MENU}">Ver la carta completa</a></p>
</div></section>`,
    );
  },
};

function unPlato(it: MenuItem, presupuesto: PresupuestoImagenes): string {
  const foto = renderImagen(comoImagen(it.foto), "plato-foto", presupuesto);
  const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
  // Solo el primero, y solo el importe: ver el bloque de arriba.
  const primero = preciosDe(it)[0];
  const precio = primero ? `<p class="precio">${esc(primero.importe)}</p>` : "";
  return `    <li class="plato">${foto}<div class="datos"><div class="fila"><h3>${esc(it.name)}</h3>${precio}</div>${desc}</div></li>`;
}

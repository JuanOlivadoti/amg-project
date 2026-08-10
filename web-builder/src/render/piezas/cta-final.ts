import { datosAccionables, envolver, esc, hrefTelefono } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **El cierre de la página, con la acción que el dato permite.**
 *
 * Es el arreglo de la queja 2 de la spec: *"el CTA no es un botón, es un párrafo rojo… y apunta a
 * `#contacto`, un ancla al pie: no es una acción"*. Acá las acciones son las dos que un restaurante
 * puede cumplir de verdad con lo que hay en su ficha: **llamar** y **cómo llegar**.
 *
 * ## Lo que esta pieza NO hace: inventar
 *
 * No dice "reserva tu mesa" (no hay integración de reservas), no promete horarios que la ficha no
 * trae, y **no se dibuja si no hay ninguna acción posible**. Un cierre sin acción es el título de la
 * página repetido al final, que es exactamente el relleno que el catálogo de piezas existe para
 * evitar. Es la misma línea que el `postalCode` opcional y el `null` de las métricas: antes ausente
 * que inventado.
 *
 * `Llamar` exige teléfono; `Cómo llegar` exige **dirección** —no `hayUbicaciones`, ver
 * `datosAccionables`—. La resolución del dato es la misma que la de `barraDatos` y por la misma
 * función: dos botones del mismo documento marcando teléfonos distintos sería un fallo que solo
 * descubre quien llama.
 *
 * ## El rediseño: una franja con fondo, no una cajita
 *
 * Era una tarjeta de 28 px de alto encerrada en el ancho de lectura, y se leía como un aviso. En la
 * referencia el cierre es una **franja de sección con fondo** y un botón grande, que es lo que le da
 * peso de conclusión a la página. Aquí el fondo lo pone `.seccion.alt` —el token `--soft`, o sea el
 * `fondoAlt` de la ficha del cliente— y el titular pasa al encabezado compartido, así que el nombre
 * del negocio cierra la página al mismo tamaño con el que la abrió.
 *
 * Los botones toman las medidas del botón de la referencia (15px 40px, radio 5, versalita).
 */
export const ctaFinal: Pieza = {
  id: "ctaFinal",
  raiz: "p-ctaFinal",
  css: `/* El horario va justo bajo el encabezado compartido, que ya trae su propio margen inferior: acá
   solo hace falta el hueco hasta los botones. */
.p-ctaFinal .horario{margin:-8px 0 clamp(24px,3vw,36px);text-align:center;color:var(--muted)}
/* Los botones se envuelven en un flex centrado con \`wrap\`: en un móvil estrecho el segundo baja solo,
   en vez de encogerse hasta que su etiqueta se parta. */
.p-ctaFinal .acciones{margin:0;display:flex;flex-wrap:wrap;gap:14px;justify-content:center}
/* Las medidas del botón de la referencia. El borde transparente del sólido no es decorativo: sin él
   mide 2 px menos de alto que el de contorno de la línea siguiente, y los dos van uno al lado del
   otro. \`transparent\` no depende del modo, así que no necesita contrapartida oscura. */
.p-ctaFinal .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:15px 40px;border:1px solid transparent;border-radius:5px;font-family:var(--fuente-titulo);font-size:1rem;font-weight:500;text-transform:uppercase;letter-spacing:.02em}
/* La segunda acción va en versión de contorno: dos botones sólidos del mismo color compiten y ninguno
   gana. El color y el borde salen de \`--acento-legible\`, que sí tiene variante oscura. */
.p-ctaFinal .cta.suave{background:transparent;color:var(--acento-legible);border-color:var(--acento-legible)}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile) return "";
    const { telefono, horario, hayDireccion } = datosAccionables(profile);

    const acciones: string[] = [];
    if (telefono) acciones.push(`<a class="cta" href="${hrefTelefono(telefono)}">Llamar</a>`);
    if (hayDireccion) acciones.push(`<a class="cta suave" href="#ubicaciones">Cómo llegar</a>`);
    // Ver el bloque de arriba: sin acción, este bloque es el título repetido.
    if (acciones.length === 0) return "";

    // El antetítulo es una ETIQUETA DE PLANTILLA y está elegido con el mismo criterio que gobierna la
    // pieza entera: no promete nada que la ficha no sostenga. "Te esperamos" lo cumple cualquier
    // restaurante con teléfono o dirección — que es justo la condición para que esta pieza exista.
    return envolver(
      "p-ctaFinal",
      `<section class="seccion alt"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Te esperamos</p><h2>${esc(profile.name)}</h2></div>
  ${horario ? `<p class="horario">${esc(horario)}</p>` : ""}
  <p class="acciones">${acciones.join("")}</p>
</div></section>`,
    );
  },
};

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
 */
export const ctaFinal: Pieza = {
  id: "ctaFinal",
  raiz: "p-ctaFinal",
  css: `.p-ctaFinal .cierre{background:var(--soft);border-radius:12px;padding:28px 24px;margin:32px 0;text-align:center}
.p-ctaFinal .cierre h2{font-size:1.45rem;margin:0 0 6px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-ctaFinal .horario{margin:0 0 18px;color:var(--muted)}
/* Los botones se envuelven en un flex centrado con \`wrap\`: en un móvil estrecho el segundo baja solo,
   en vez de encogerse hasta que su etiqueta se parta. */
.p-ctaFinal .acciones{margin:0;display:flex;flex-wrap:wrap;gap:12px;justify-content:center}
.p-ctaFinal .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
/* La segunda acción va en versión de contorno: dos botones sólidos del mismo color compiten y ninguno
   gana. \`transparent\` no depende del modo, así que no necesita contrapartida oscura; el color y el
   borde salen de \`--acento-legible\`, que sí la tiene. */
.p-ctaFinal .cta.suave{background:transparent;color:var(--acento-legible);border:1px solid var(--acento-legible)}
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

    return envolver(
      "p-ctaFinal",
      `<section class="cierre">
  <h2>${esc(profile.name)}</h2>
  ${horario ? `<p class="horario">${esc(horario)}</p>` : ""}
  <p class="acciones">${acciones.join("")}</p>
</section>`,
    );
  },
};

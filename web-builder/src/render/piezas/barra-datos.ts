import { datosAccionables, envolver, esc, hrefTelefono } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La franja de datos, justo debajo del titular.**
 *
 * Es el arreglo del punto 4 de la spec: *"lo que la gente busca está enterrado en el pie. Teléfono,
 * horarios y direcciones viven solo en `renderFooter`, y en un restaurante eso es el grueso de las
 * visitas"*. Subir esos tres datos a la primera pantalla no es decoración: es la razón por la que
 * alguien abre la web de un restaurante en el móvil.
 *
 * **No se pisa con `locales`** (spec, §2): ésta es el **resumen accionable del primer local**, arriba;
 * aquélla el **detalle de todos**, en el pie. Los dos salen del mismo dato y con la misma precedencia
 * —`locations[0]` manda sobre los campos sueltos, igual que el JSON-LD—, y por eso esa resolución vive
 * en `datosAccionables` y no repetida acá: una franja que dijera un teléfono y un pie que dijera otro
 * es el fallo que se descubre cuando un cliente llama al número viejo.
 *
 * ⚠️ **"Cómo llegar" exige una DIRECCIÓN, no `hayUbicaciones`.** El bloque `#ubicaciones` se dibuja
 * también con un perfil que solo trae horario, así que apoyarse en `hayUbicaciones` mandaría a quien
 * quiere llegar a un bloque donde solo hay un horario. El enlace y su destino útil salen del mismo
 * dato — mismo criterio que el nav y que el CTA del hero.
 */
export const barraDatos: Pieza = {
  id: "barraDatos",
  raiz: "p-barraDatos",
  // Flex con `wrap`: en escritorio los tres datos van en una línea y en un móvil se apilan sin que
  // haga falta un media query — la franja no tiene un layout que defender, solo tres cosas que caben
  // o no caben.
  css: `/* Andamio del rediseno: esta pieza todavia no usa la banda ancha, asi que se queda en el
   ancho de lectura. Se quita cuando la seccion se rediseñe. */
.p-barraDatos{max-width:var(--ancho-lectura);margin:0 auto}
.p-barraDatos .franja{display:flex;flex-wrap:wrap;gap:14px 28px;margin:0;padding:16px 0;border-bottom:1px solid #f0f0f0}
.p-barraDatos .dato{margin:0;display:flex;flex-direction:column;gap:2px;padding-left:12px;border-left:3px solid var(--decorativo)}
/* La etiqueta es el rótulo del dato ("Teléfono"), no el dato: menor, en el gris de texto secundario y
   en versalitas, para que el ojo salte directo al número. */
.p-barraDatos .etiqueta{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.p-barraDatos .valor{font-weight:600}
.p-barraDatos a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted);font-weight:600}
`,

  cssOscuro: `@media(prefers-color-scheme:dark){.p-barraDatos .franja{border-color:#1e1e1e}}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile) return "";
    const { telefono, horario, hayDireccion } = datosAccionables(profile);

    const datos: string[] = [];
    if (telefono) {
      datos.push(
        `  <p class="dato"><span class="etiqueta">Teléfono</span><a href="${hrefTelefono(telefono)}">${esc(telefono)}</a></p>`,
      );
    }
    if (horario) {
      datos.push(
        `  <p class="dato"><span class="etiqueta">Horario</span><span class="valor">${esc(horario)}</span></p>`,
      );
    }
    if (hayDireccion) {
      datos.push(
        `  <p class="dato"><span class="etiqueta">Dónde</span><a href="#ubicaciones">Cómo llegar</a></p>`,
      );
    }
    // Sin ninguno de los tres no hay franja: una barra vacía bajo el titular es peor que su ausencia.
    if (datos.length === 0) return "";

    return envolver("p-barraDatos", `<section class="franja">\n${datos.join("\n")}\n</section>`);
  },
};

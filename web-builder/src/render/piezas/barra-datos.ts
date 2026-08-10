import { datosAccionables, envolver, esc, hrefTelefono } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La tarjeta de contacto, justo debajo del titular.**
 *
 * Es el arreglo del punto 4 de la spec: *"lo que la gente busca está enterrado en el pie. Teléfono,
 * horarios y direcciones viven solo en `renderFooter`, y en un restaurante eso es el grueso de las
 * visitas"*. Subir esos tres datos a la primera pantalla no es decoración: es la razón por la que
 * alguien abre la web de un restaurante en el móvil.
 *
 * ## El rediseño: de franja de tres datos a TARJETA con el teléfono grande
 *
 * Los tres datos y sus condiciones de omisión no cambian ni una coma —son el contrato de la pieza—;
 * lo que cambia es el peso visual. En la referencia el equivalente es una tarjeta destacada donde el
 * teléfono es el elemento más grande del bloque, y eso responde a la misma medición que puso la pieza
 * en la primera pantalla: en un restaurante, la acción más frecuente del visitante de móvil es marcar.
 * Tres datos del mismo tamaño en una línea obligan a leer los tres para encontrar el que se busca.
 *
 * El horario y "Cómo llegar" se quedan al lado, en su tamaño normal: son el contexto que decide si
 * llamar ahora o ir. Bajarlos a otra sección los devolvería al pie, que es el problema que la pieza
 * vino a resolver.
 *
 * **No se pisa con `locales`** (spec, §2): ésta es el **resumen accionable del primer local**, arriba;
 * aquélla el **detalle de todos**, en el pie. Los dos salen del mismo dato y con la misma precedencia
 * —`locations[0]` manda sobre los campos sueltos, igual que el JSON-LD—, y por eso esa resolución vive
 * en `datosAccionables` y no repetida acá: una franja que dijera un teléfono y un pie que dijera otro
 * es el fallo que se descubre cuando un cliente llama al número viejo.
 *
 * No tiene `cssOscuro` y eso es una respuesta, no un olvido: tras el rediseño **ningún valor de esta
 * pieza es un color literal** —fondo, filete y textos salen de tokens semánticos, que el base ya
 * reescribe en oscuro—. La regla vieja (`border-color:#1e1e1e`) existía para el separador de la
 * franja, que ya no hay.
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
  // haga falta un media query — la tarjeta no tiene un layout que defender, solo tres cosas que caben
  // o no caben. Y las tres son opcionales: cualquier subconjunto tiene que verse deliberado.
  css: `/* Menos aire que una sección normal, y es lo único que esta pieza le discute al patrón. Medido
   en el navegador a 1440: con '--pad-seccion' (120px) los dos huecos de arriba y abajo sumaban 230px
   de blanco alrededor de una tarjeta de 100px de alto, y en '/menu' la primera categoría de la carta
   se iba de la pantalla. Esto no es una sección de contenido: es la ficha del negocio colgando del
   titular. */
.p-barraDatos .seccion{padding:clamp(28px,3.5vw,56px) 0}
/* La tarjeta va sobre el fondo de la página (la sección NO lleva '.alt'): si la sección
   también fuera '--soft', la tarjeta desaparecería dentro de su propio fondo. */
.p-barraDatos .tarjeta{background:var(--soft);border-radius:14px;padding:clamp(24px,3vw,40px);display:flex;flex-wrap:wrap;gap:clamp(20px,3vw,48px)}
/* 'flex:1 1 200px' en los tres y el doble de crecimiento para el teléfono: reparte el ancho sobrante
   sin fijar columnas, así que con uno, dos o tres datos la tarjeta se llena igual. Por debajo de la
   base los tres se apilan solos. */
.p-barraDatos .dato{margin:0;flex:1 1 200px;display:flex;flex-direction:column;justify-content:center;gap:4px;padding-left:18px;border-left:3px solid var(--decorativo)}
.p-barraDatos .principal{flex:2 1 280px}
/* La etiqueta es el rótulo del dato ("Teléfono"), no el dato: menor, en el gris de texto secundario y
   en versalitas, para que el ojo salte directo al número. */
.p-barraDatos .etiqueta{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.p-barraDatos .valor{font-weight:600}
.p-barraDatos a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted);font-weight:600}
/* EL TELÉFONO GRANDE, que es todo el rediseño de esta pieza.
   Peso 700 y no 500: es el único archivo de la fuente de titulares que el documento precarga, así que
   pedirlo aquí no cuesta ninguna descarga nueva. Y sin subrayado: a este tamaño el subrayado parte los
   dígitos, y el color de acento más el tamaño ya dicen que se puede pulsar.
   La especificidad manda sobre la regla de enlaces de arriba —(0,2,0) contra (0,1,1)— así que el orden
   de las dos reglas no decide nada. */
.p-barraDatos .numero{font-family:var(--fuente-titulo);font-size:clamp(1.75rem,1.2rem + 1.8vw,2.6rem);line-height:1.15;font-weight:700;color:var(--acento-legible);text-decoration:none;letter-spacing:.01em}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile) return "";
    const { telefono, horario, hayDireccion } = datosAccionables(profile);

    const datos: string[] = [];
    if (telefono) {
      datos.push(
        `    <p class="dato principal"><span class="etiqueta">Teléfono</span><a class="numero" href="${hrefTelefono(telefono)}">${esc(telefono)}</a></p>`,
      );
    }
    if (horario) {
      datos.push(
        `    <p class="dato"><span class="etiqueta">Horario</span><span class="valor">${esc(horario)}</span></p>`,
      );
    }
    if (hayDireccion) {
      datos.push(
        `    <p class="dato"><span class="etiqueta">Dónde</span><a href="#ubicaciones">Cómo llegar</a></p>`,
      );
    }
    // Sin ninguno de los tres no hay tarjeta: una caja vacía bajo el titular es peor que su ausencia.
    if (datos.length === 0) return "";

    return envolver(
      "p-barraDatos",
      `<section class="seccion"><div class="banda">
  <div class="tarjeta">
${datos.join("\n")}
  </div>
</div></section>`,
    );
  },
};

import { envolver, esc } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La bienvenida: el primer párrafo del sitio que habla del negocio.**
 *
 * Es la sección "Welcome at X" del template de referencia, y la primera de las tres que el bloque K
 * replica **con contenido por defecto** — la excepción consciente a *antes ausente que inventado* que
 * está razonada en `renderer/docs/04-plantilla-base.md`.
 *
 * ## Por qué esta pieza puede tener default y `testimonios` no
 *
 * Un párrafo de bienvenida es una **invitación**, y una invitación no puede ser falsa: "nos alegra
 * que estés aquí" lo firma cualquier negocio que tenga una web. El default está escrito con esa
 * restricción y no con la de sonar bien — por eso no dice *producto de mercado*, ni *cocina de
 * temporada*, ni *desde 1998*: cada una de esas frases es un hecho sobre el negocio que un cliente
 * podría no cumplir, y publicarla por él sería ponerle en la boca algo que no dijo.
 *
 * La regla completa, para cuando haya que tocar este texto: **un default puede rellenar una sección,
 * nunca afirmar un hecho sobre el negocio.**
 *
 * ## Lo que NO lleva, y por qué
 *
 * **El horario.** El original lo pone acá en dos cajas (lunch/dinner). En nuestra plantilla el
 * horario ya está en `barraDatos`, dos secciones más arriba y en la primera pantalla; repetirlo
 * aquí sería decir el mismo dato dos veces en el mismo scroll.
 *
 * **Un titular propio.** El `h2` es "Bienvenidos a X", con el nombre que ya está en el perfil. Un
 * campo `bienvenida.titulo` sería un segundo sitio donde escribir el nombre, y el día que los dos
 * digan cosas distintas nadie sabría cuál manda.
 *
 * **Un antetítulo.** Es la única sección rediseñada que no lo lleva, y se le quitó **mirando la
 * página**: en la home sintetizada el `h1` es el nombre del negocio y el cierre (`ctaFinal`) lo
 * repite, así que con "BIENVENIDOS" arriba y el nombre debajo salía tres veces en dos pantallas. Con
 * el saludo y el nombre en la misma línea —que además es literalmente lo que hace la referencia— la
 * sección dice lo mismo en la mitad de renglones.
 */

/**
 * El texto que se dibuja cuando la ficha no trae `bienvenida`.
 *
 * Vive acá con su nombre y su test, y no incrustado en un `??`, porque **es contenido que se publica
 * en la web de un cliente real**: cambiarlo tiene que ser una decisión visible en un diff, no una
 * edición de una línea perdida dentro de una plantilla de string.
 */
export const BIENVENIDA_DEFAULT =
  "Nos alegra que estés aquí. Echa un vistazo a la carta con calma y ven a vernos cuando te apetezca: " +
  "te contamos lo que tenemos y te ayudamos a elegir.";

export const bienvenida: Pieza = {
  id: "bienvenida",
  raiz: "p-bienvenida",
  // El párrafo se queda en el ancho de LECTURA aunque la banda mida 1320, igual que la prosa de una
  // story: es texto largo, y un renglón de 1280 px no se lee.
  css: `.p-bienvenida .texto{max-width:var(--ancho-lectura);margin:0 auto;text-align:center;font-size:1.15rem;line-height:1.9;color:var(--muted)}
/* El filete decorativo cierra el bloque. Es el mismo remate que lleva la portada tipográfica, y sale
   del segundo color de la marca — superficie decorativa, nunca texto (ver \`--decorativo\`). */
.p-bienvenida .texto::after{content:"";display:block;width:72px;height:3px;margin:32px auto 0;background:var(--decorativo)}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    // Sin perfil no hay nombre que poner en el titular, y una bienvenida anónima no es una
    // bienvenida. Es el mismo criterio que `cabecera` y `contacto`.
    if (!profile) return "";

    // `.trim()` y no solo la ausencia: un `bienvenida: "   "` guardado desde un formulario es una
    // ficha vacía escrita de otra forma, y dibujar tres espacios donde va el párrafo es el hueco que
    // el default viene justamente a evitar.
    const texto = profile.bienvenida?.trim() || BIENVENIDA_DEFAULT;

    return envolver(
      "p-bienvenida",
      `<section class="seccion alt"><div class="banda">
  <div class="encabezado"><h2>Bienvenidos a ${esc(profile.name)}</h2></div>
  <p class="texto">${esc(texto)}</p>
</div></section>`,
    );
  },
};

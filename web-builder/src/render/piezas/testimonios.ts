import { MAX_TESTIMONIOS_RENDER, envolver, esc } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **Las reseñas de clientes.**
 *
 * Tercera de las secciones que el bloque K replica del template de referencia, y **la única de las
 * tres que NO tiene contenido por defecto.** Eso no es una pieza a medio hacer: es la decisión.
 *
 * ## Por qué acá se corta la excepción
 *
 * El límite que gobierna las otras dos —*un default puede rellenar una sección, nunca afirmar un
 * hecho sobre el negocio*— aquí no se puede cumplir, porque **una reseña ES una afirmación sobre el
 * negocio y además atribuida a una persona**. Un texto de muestra en una bienvenida es una propuesta
 * editable; una reseña de muestra publicada en el dominio de un restaurante es una reseña falsa, y en
 * España eso tiene nombre en la ley de competencia desleal, no solo en un documento de diseño. El
 * riesgo tampoco depende de lo genérico que sea el texto: lo que lo convierte en engaño es el hueco
 * donde está, que dice "esto lo dijo un cliente".
 *
 * Así que sin `testimonios` en la ficha, la sección **no existe** — el mismo `""` que devuelven
 * `galeria` sin fotos o `ctaFinal` sin ninguna acción posible. La receta la nombra igual, de modo que
 * la sección aparece sola en cuanto la agencia carga la primera reseña.
 *
 * ## Sin estrellas, y eso también es la pieza
 *
 * No hay campo de puntuación en ninguna de las cuatro fronteras (ver `Testimonio` en `types.ts` y la
 * migración `0020`). Una valoración numérica publicada por el propio negocio, sin plataforma que la
 * respalde, es un dato que nadie puede comprobar; y emitida como `Review` en el JSON-LD sería
 * exactamente lo que las directrices de Google llaman reseña auto-servida. La pieza dibuja lo que
 * alguien dijo y quién lo dijo, si lo firmó.
 */
export const testimonios: Pieza = {
  id: "testimonios",
  raiz: "p-testimonios",
  css: `/* Dos columnas en escritorio y una en móvil. No tres: una cita es texto para leer, y a tres
   columnas en la banda de 1320 cada una se queda en 400px y se parte en ocho renglones cortos. */
.p-testimonios .citas{list-style:none;margin:0;padding:0;display:grid;gap:clamp(20px,2.5vw,32px);grid-template-columns:1fr}
@media(min-width:768px){.p-testimonios .citas{grid-template-columns:repeat(2,1fr)}}
/* La tarjeta va sobre el fondo de la PÁGINA y la sección lleva '.alt': al revés que en 'barraDatos',
   donde la tarjeta es '--soft' y la sección no. Es la misma regla mirada del otro lado — dos fondos
   iguales, uno dentro del otro, hacen desaparecer la tarjeta. */
.p-testimonios .cita{margin:0;background:var(--bg);border-radius:14px;padding:clamp(24px,3vw,36px);display:flex;flex-direction:column;gap:16px}
.p-testimonios blockquote{margin:0;position:relative}
/* Las comillas de apertura, en grande. Van en un pseudo-elemento por lo mismo que el número de
   'destacados': no son contenido, así que no se leen ni entran en el texto visible.
   ⚠️ El color es '--acento-legible' y NO '--decorativo', aunque el papel del glifo sea decorativo: un
   pseudo-elemento con 'content' dibuja TEXTO, y el segundo color de marca no está obligado a pasar
   contraste (el oro del cliente de demo da 2.62:1 sobre su fondo). Lo caza 'tema.test.ts' recorriendo
   el catálogo, y lo cazó acá. Lo que lo vuelve discreto es la opacidad, que no es un color. */
.p-testimonios blockquote::before{content:"\\201C";display:block;font-family:var(--fuente-titulo);font-size:3.5rem;line-height:.8;color:var(--acento-legible);opacity:.35;margin:0 0 8px}
.p-testimonios blockquote p{margin:0;font-size:1.08rem;line-height:1.85;color:var(--fg)}
/* La firma en versalitas y en el color de acento: es el remate de la cita, no una segunda frase. */
.p-testimonios .autor{margin:0;font-family:var(--fuente-titulo);font-size:.95rem;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--acento-legible)}
`,

  render(ctx: CtxPieza): string {
    // **Frontera 4.** Se revalida entrada por entrada aunque Zod y `perfilValido` ya corten: en PROD
    // el perfil llega de la base sin pasar por el Zod de este paquete. Y se descarta **la entrada, no
    // la sección**, igual que un precio mal cargado no borra el plato.
    const lista = (ctx.profile?.testimonios ?? [])
      .filter((t) => typeof t?.texto === "string" && t.texto.trim().length > 0)
      .slice(0, MAX_TESTIMONIOS_RENDER);
    // Ver el bloque de arriba: sin reseñas reales no hay sección. No hay default y no lo va a haber.
    if (lista.length === 0) return "";

    const citas = lista
      .map(
        (t) => `    <li class="cita">
      <blockquote><p>${esc(t.texto)}</p></blockquote>
      ${t.autor ? `<p class="autor">${esc(t.autor)}</p>` : ""}
    </li>`,
      )
      .join("\n");

    // Etiquetas de plantilla. "Quienes ya han venido" describe de quién es el texto y no promete nada
    // sobre él — que es la diferencia con un "Nos adoran" o un "5 de 5".
    return envolver(
      "p-testimonios",
      `<section class="seccion alt"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Reseñas</p><h2>Lo que dicen quienes ya han venido</h2></div>
  <ul class="citas">
${citas}
  </ul>
</div></section>`,
    );
  },
};

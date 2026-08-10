import type { Destacado } from "../../types.js";
import { MAX_DESTACADOS_RENDER, envolver, esc } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **Los motivos para venir**: la sección de bullets del template de referencia.
 *
 * Segunda de las tres secciones que el bloque K replica **con contenido por defecto**. El límite es
 * el mismo que gobierna a `bienvenida`, y acá aprieta más, porque un bullet de "por qué nosotros" es
 * el sitio natural de las frases que no se pueden firmar por otro: *producto fresco a diario*,
 * *treinta años de oficio*, *el mejor arroz de la ciudad*. Ninguna de las tres entra.
 *
 * ## Los defaults hablan del SITIO, no del negocio
 *
 * La salida fue mover el sujeto: los tres motivos por defecto describen **lo que esta web te
 * resuelve** —la carta consultable, la dirección y el horario, y que no hay que registrarse para
 * nada—, y eso es cierto por construcción para cualquier cliente, porque lo cumple el propio
 * renderizador. Un cliente que quiera hablar de su cocina reescribe los tres desde su ficha, que es
 * exactamente para lo que el campo existe.
 *
 * ## Sin iconos, con números
 *
 * El original pone un icono por bullet. Un icono es un asset por cliente y una decisión de estilo que
 * nadie ha tomado; el número correlativo lo dibuja un contador de CSS, sale de la nada y no hay que
 * mantenerlo. Va en `::before` a propósito: es **decoración**, no contenido, así que no lo lee un
 * lector de pantalla ni entra en el texto visible del gate de paridad.
 */

/**
 * Los tres motivos que se dibujan cuando la ficha no trae `destacados`.
 *
 * Están acá, con nombre y con test, por el mismo motivo que `BIENVENIDA_DEFAULT`: es contenido
 * publicado en la web de un cliente real. **Cada línea es una afirmación sobre la página, no sobre el
 * negocio** — leerlas con esa lente es la forma de comprobar si un cambio futuro sigue siendo válido.
 */
export const DESTACADOS_DEFAULT: readonly Destacado[] = [
  {
    titulo: "La carta, a mano",
    texto: "Los platos y sus precios, para mirarlos con calma antes de venir.",
  },
  {
    titulo: "Dónde y cuándo",
    texto: "La dirección y el horario de cada local, en esta misma página.",
  },
  {
    titulo: "Sin registros",
    texto: "Toda la información es pública: no hace falta crear una cuenta ni instalar nada.",
  },
];

export const destacados: Pieza = {
  id: "destacados",
  raiz: "p-destacados",
  css: `/* Tres columnas en escritorio y una en móvil, con 'auto-fit': con tres motivos —los que trae el
   default— salen tres columnas exactas en la banda de 1320, y una ficha con cuatro cae en 3+1 sin que
   haya que decidir nada. El mínimo de 260px es lo que impide que seis motivos den seis columnas de
   texto ilegible, que es la trampa que ya mordió la galería. */
.p-destacados .motivos{list-style:none;margin:0;padding:0;counter-reset:motivo;display:grid;gap:clamp(24px,3vw,40px);grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.p-destacados .motivo{margin:0;padding:0 0 0 4px;border-top:2px solid var(--decorativo);padding-top:24px}
/* El número es DECORACIÓN: va en un pseudo-elemento para que no lo lea un lector de pantalla ni entre
   en el texto visible. 'decimal-leading-zero' da 01, 02, 03 — el mismo tic tipográfico del original,
   sin un solo asset. */
.p-destacados .motivo::before{counter-increment:motivo;content:counter(motivo,decimal-leading-zero);display:block;font-family:var(--fuente-titulo);font-size:1rem;font-weight:500;letter-spacing:.08em;color:var(--acento-legible);margin:0 0 10px}
.p-destacados h3{font-family:var(--fuente-titulo);font-size:1.35rem;line-height:1.25;margin:0 0 10px;color:var(--titulo)}
.p-destacados p{margin:0;color:var(--muted);line-height:1.8}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    // Sin perfil no hay ficha de la que salgan los motivos ni a la que pertenezcan los del default:
    // esta sección le pertenece a un negocio, y una página sin perfil no tiene ninguno.
    if (!profile) return "";

    // **Frontera 4.** El tope se vuelve a aplicar acá aunque Zod y `perfilValido` ya corten, porque en
    // PROD el perfil llega de `clients.business_profile_publico` sin pasar por el Zod de este paquete.
    // Que las cifras coincidan lo exige un test.
    const propios = (profile.destacados ?? []).filter((d) => d?.titulo?.trim());
    const lista = (propios.length ? propios : DESTACADOS_DEFAULT).slice(0, MAX_DESTACADOS_RENDER);

    const items = lista
      .map(
        (d) => `    <li class="motivo">
      <h3>${esc(d.titulo)}</h3>
      ${d.texto ? `<p>${esc(d.texto)}</p>` : ""}
    </li>`,
      )
      .join("\n");

    // El antetítulo y el título son ETIQUETAS DE PLANTILLA: rotulan la sección sin afirmar nada. "Lo
    // que vas a encontrar aquí" habla de la página, igual que los tres motivos por defecto.
    return envolver(
      "p-destacados",
      `<section class="seccion"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Antes de venir</p><h2>Lo que vas a encontrar aquí</h2></div>
  <ul class="motivos">
${items}
  </ul>
</div></section>`,
    );
  },
};

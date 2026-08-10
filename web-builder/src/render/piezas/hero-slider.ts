import type { FaqBlok, Foto, HeroBlok } from "../../types.js";
import { comoImagen, envolver, esc, renderImagen, resolverCta } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * **La portada: titular a un lado, carrusel de fotos al otro.**
 *
 * Reemplaza a `heroPortada` en la receta de `story` y a `hero` en la de `home`. Cubre los dos casos
 * —story y página sintetizada— porque son la misma portada con distinta fuente de titular:
 *
 *  - **story**: el blok `hero` del brief aprobado (titular, bajada, CTA);
 *  - **home**: el `titulo`/`bajada` del contexto, que salen del perfil.
 *
 * ## El carrusel mueve FOTOS, no diapositivas
 *
 * El template de referencia tiene un slider cuyas diapositivas llevan cada una su titular, su oferta
 * y su precio. Nosotros **no tenemos ese dato y no se inventa**: el perfil no guarda ofertas, ni
 * precios de portada, ni un texto por diapositiva, y el research produce un titular por página, no
 * cinco. Así que el texto es fijo y lo que rota es la imagen — que es exactamente el dato que sí
 * sobra (`portada` + `fotos`, hasta 30 en la ficha).
 *
 * Vale la pena decir lo que se descubrió al medirlo: en `home-6` **los dos slides del template llevan
 * contenido idéntico**. Es el mismo, duplicado por el loop de la librería. O sea que ni el original
 * usa el slider para decir dos cosas distintas.
 *
 * ## Sin una línea de JavaScript
 *
 * El renderizador es la única superficie expuesta a internet anónimo y no emite JS. El carrusel es
 * `scroll-snap` sobre un contenedor con `overflow-x`, y los puntos son **anclas** a cada figura: el
 * navegador desplaza el contenedor él solo, con inercia táctil gratis en el móvil y navegación por
 * teclado gratis en el escritorio.
 *
 * Lo que esto NO da es **avance automático**, que sí necesitaría JS. Es una pérdida menor y
 * probablemente una mejora: un hero que se mueve solo cambia la foto justo cuando alguien está
 * leyendo el titular.
 *
 * ## Sin fotos: hero TIPOGRÁFICO, no un hueco
 *
 * Misma regla que traía `heroPortada`, y sigue importando porque **ninguna ficha de producción tiene
 * una sola foto**: sin imágenes la portada pasa a una columna y el titular crece a ocupar el espacio.
 * No es un fallback triste; es el otro estado del diseño, y es el que ven todos los clientes hasta
 * que suben su primera foto.
 */

/** Cuántas fotos entran en el carrusel. Más de cinco nadie las pasa, y cada una es una descarga. */
const MAX_SLIDES = 5;

export const heroSlider: Pieza = {
  id: "heroSlider",
  raiz: "p-heroSlider",
  css: `.p-heroSlider .portada{max-width:var(--ancho-pagina);margin:0 auto;padding:56px 0 64px;display:grid;gap:40px;align-items:center}
/* El titular crece con la pantalla en vez de saltar en un breakpoint: 39px en un móvil de 390 y 80px
   en un escritorio de 1440, que son los dos extremos medidos en el template de referencia. */
/* ⚠️ **SIN \`font-weight\`, y es deliberado.** El template de referencia pone 500 en su titular, pero
   \`shell.ts\` precarga el archivo de **700** — el peso que los \`h1\` heredan de la hoja del navegador.
   Declarar 500 haría que el navegador pidiera OTRO archivo, dejando el preload como una descarga
   tirada justo en el elemento que mide el LCP. Lo fija un test de \`ensamblado.test.ts\`, que es quien
   lo cazó. Cambiar esto es cambiar \`PESO_TITULARES\`, y eso afecta a todos los titulares del sitio. */
.p-heroSlider h1{font-family:var(--fuente-titulo);font-size:clamp(2.44rem,1.2rem + 4.2vw,5rem);line-height:1.1;text-transform:uppercase;margin:0 0 20px;color:var(--titulo);letter-spacing:-.01em}
.p-heroSlider .lede{font-size:1.25rem;line-height:1.8;color:var(--muted);margin:0 0 28px;max-width:38ch}
.p-heroSlider .cta-lede{font-size:1.05rem;color:var(--muted);margin:0 0 20px;max-width:38ch}
/* Radio de 5px y versalita, como el botón del hero del template — que NO es el mismo que el de su
   cabecera (allí es una píldora de 30px). Son dos botones distintos a propósito. */
.p-heroSlider .cta{display:inline-block;background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:15px 40px;border-radius:5px;font-family:var(--fuente-titulo);font-size:1rem;font-weight:500;text-transform:uppercase;letter-spacing:.02em}
.p-heroSlider .carrusel{position:relative}
/* ⚠️ **Los controles son RADIOS, no anclas, y la primera versión sí usaba anclas.**
   Medido en el navegador: pulsar un ancla a la tercera diapositiva movía el carrusel
   (scrollLeft 0 → 925) **y la página entera 203 px hacia abajo**, porque el navegador desplaza todos
   los ancestros para hacer visible el destino del ancla. No hay CSS que lo cancele, y en una portada
   ese salto tira al visitante fuera del titular justo al mirar la segunda foto.
   (El ejemplo va sin escribir el atributo literal a propósito: el gate de paridad extrae los enlaces
   del documento con una expresión regular que **también entra en el <style>**, así que un atributo
   citado en un comentario se cuela en su huella como si fuera un enlace de la página.)
   Con radios ocultos + \`:checked ~\` la pista se mueve con \`transform\` y no hay navegación ninguna.
   De paso sale gratis lo que las anclas no daban: recorrer las fotos con las flechas del teclado,
   que es como un radiogroup se maneja. */
.p-heroSlider .sel{position:absolute;width:1px;height:1px;opacity:0;margin:0}
.p-heroSlider .ventana{overflow:hidden}
.p-heroSlider .pista{display:flex;list-style:none;margin:0;padding:0;transition:transform .45s ease}
.p-heroSlider .diapo{flex:0 0 100%;margin:0;display:flex;justify-content:center}
.p-heroSlider .sel:nth-of-type(1):checked~.ventana .pista{transform:translateX(0)}
.p-heroSlider .sel:nth-of-type(2):checked~.ventana .pista{transform:translateX(-100%)}
.p-heroSlider .sel:nth-of-type(3):checked~.ventana .pista{transform:translateX(-200%)}
.p-heroSlider .sel:nth-of-type(4):checked~.ventana .pista{transform:translateX(-300%)}
.p-heroSlider .sel:nth-of-type(5):checked~.ventana .pista{transform:translateX(-400%)}
.p-heroSlider .sel:nth-of-type(1):checked~.puntos label:nth-of-type(1){opacity:1}
.p-heroSlider .sel:nth-of-type(2):checked~.puntos label:nth-of-type(2){opacity:1}
.p-heroSlider .sel:nth-of-type(3):checked~.puntos label:nth-of-type(3){opacity:1}
.p-heroSlider .sel:nth-of-type(4):checked~.puntos label:nth-of-type(4){opacity:1}
.p-heroSlider .sel:nth-of-type(5):checked~.puntos label:nth-of-type(5){opacity:1}
/* El foco del radio se dibuja sobre su punto: el input mide 1 px y sin esto, recorrer el carrusel
   con el teclado no se vería en ninguna parte. */
.p-heroSlider .sel:focus-visible~.puntos label{outline:2px solid var(--acento-legible);outline-offset:3px}
@media(prefers-reduced-motion:reduce){.p-heroSlider .pista{transition:none}}
/* El círculo es la lectura del plato redondo del template, que allí es un PNG ya recortado. Como
   nuestra foto es rectangular y viene del cliente, el recorte lo hace el CSS: \`object-fit:cover\`
   llena el círculo sin deformar, se recorte lo que se recorte. */
.p-heroSlider .foto{width:100%;max-width:480px;aspect-ratio:1;border-radius:50%;object-fit:cover;display:block}
.p-heroSlider .puntos{display:flex;justify-content:center;gap:10px;margin:24px 0 0}
/* 12 px de punto, pero 32 px de área tocable: el objetivo mínimo de un control táctil es 24 px, y un
   círculo de 12 obliga a apuntar. El relleno lo da el padding, no el tamaño visible. */
.p-heroSlider .puntos label{width:12px;height:12px;border-radius:50%;background:var(--decorativo);opacity:.35;display:block;text-indent:-9999px;overflow:hidden;cursor:pointer;box-sizing:content-box;padding:10px;background-clip:content-box}
.p-heroSlider .puntos label:hover{opacity:1}
/* Sin foto el titular es lo único que hay en la portada, así que se lleva el espacio y la regla
   decorativa hace de remate. */
.p-heroSlider .portada.sin-img{padding:72px 0 60px}
.p-heroSlider .portada.sin-img h1::after{content:"";display:block;width:72px;height:3px;margin:22px 0 0;background:var(--decorativo)}
@media(min-width:992px){.p-heroSlider .portada{grid-template-columns:minmax(0,1fr) 480px;gap:60px;padding:72px 0 88px}
.p-heroSlider .portada.sin-img{grid-template-columns:1fr}}
`,

  cssOscuro: `@media(prefers-color-scheme:dark){.p-heroSlider .puntos a{opacity:.5}}
`,

  render(ctx: CtxPieza): string {
    const body = ctx.story?.content.body;
    const h = body?.find((b): b is HeroBlok => b.component === "hero");

    // El titular manda el brief cuando hay story; si no, el del contexto (home sintetizada). Sin
    // ninguno de los dos no hay portada que dibujar.
    const titulo = h?.headline ?? ctx.titulo;
    if (!titulo) return "";
    const bajada = h?.subhead ?? ctx.bajada;

    const hayFaq = Boolean(body?.find((b): b is FaqBlok => b.component === "faq"));
    const cta = resolverCta(h?.cta_label, ctx, hayFaq);

    // El orden de las fotos es el de importancia: la del blok (la subió alguien mirando ESTA página),
    // después la portada de la ficha, después la galería. `renderImagen` descarta sin gastar cupo lo
    // que no pasa la política de imágenes, así que una URL mala no deja un hueco: no produce slide.
    const candidatas = [
      h?.image,
      comoImagen(ctx.profile?.portada),
      ...(ctx.profile?.fotos ?? []).map((f: Foto) => comoImagen(f)),
    ];
    const slides: string[] = [];
    for (const img of candidatas) {
      if (slides.length >= MAX_SLIDES) break;
      // Solo la PRIMERA foto es prioritaria: es el LCP de la portada. Marcar las cinco es no marcar
      // ninguna, porque compiten por el mismo ancho de banda.
      const html = renderImagen(img, "foto", ctx.presupuestoImagenes, slides.length === 0 ? "alta" : "normal");
      if (html) slides.push(html);
    }

    const texto = `<div class="texto">
  <h1>${esc(titulo)}</h1>
  ${bajada ? `<p class="lede">${esc(bajada)}</p>` : ""}
  ${cta.bajada ? `<p class="cta-lede">${esc(cta.bajada)}</p>` : ""}
  ${cta.etiqueta && cta.href ? `<a class="cta" href="${cta.href}">${esc(cta.etiqueta)}</a>` : ""}
</div>`;

    if (slides.length === 0) {
      return envolver("p-heroSlider", `<header class="portada sin-img">\n${texto}\n</header>`);
    }

    const diapos = slides.map((img) => `<li class="diapo">${img}</li>`).join("\n      ");

    // Los controles solo existen si hay algo entre lo que elegir. Un punto único es un control que no
    // controla nada — y con una sola foto tampoco hacen falta los radios.
    const hayVarias = slides.length > 1;
    const radios = hayVarias
      ? slides
          .map(
            (_, i) =>
              `<input class="sel" type="radio" name="hs" id="hs-${i + 1}"${i === 0 ? " checked" : ""} aria-label="Foto ${i + 1} de ${slides.length}">`,
          )
          .join("\n    ")
      : "";
    const puntos = hayVarias
      ? `<div class="puntos">${slides
          .map((_, i) => `<label for="hs-${i + 1}">${i + 1}</label>`)
          .join("")}</div>`
      : "";

    return envolver(
      "p-heroSlider",
      `<header class="portada">
${texto}
  <div class="carrusel">
    ${radios}
    <div class="ventana">
      <ul class="pista">
      ${diapos}
      </ul>
    </div>
    ${puntos}
  </div>
</header>`,
    );
  },
};

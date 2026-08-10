import { envolver, esc, hrefTelefono, localesDe } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * Los locales del negocio, en el pie. **Dueña de `id="ubicaciones"`.**
 *
 * **Pieza de SHELL, no de receta** (§1), y es el caso que mejor explica por qué el shell existe: el
 * nav de arriba ancla a `#ubicaciones` desde *todas* las páginas. Si `locales` viviera en la receta,
 * el tipo permitiría una receta sin ella —o con ella dos veces— y el nav apuntaría a la nada sin que
 * nada diera error. La primera versión del diseño lo parcheaba con la prosa "`locales` es obligatoria
 * en toda receta"; que hiciera falta esa frase era la señal de que el corte estaba mal.
 *
 * Se omite si no hay locales, y en ese caso el nav tampoco ofrece "Ubicaciones" (`hayUbicaciones`):
 * las dos decisiones salen del mismo dato, así que no queda un ancla huérfana.
 *
 * ## El rediseño: los locales SON las columnas del pie
 *
 * En la referencia el pie tiene cuatro columnas fijas. Acá el número lo decide la ficha: contacto +
 * una por local. Con los dos locales del perfil de demo son tres; con un solo local, dos. Una rejilla
 * de cuatro huecos habría dejado uno vacío en la web de casi todos los clientes, y las dos columnas
 * que faltan para llegar a cuatro son, en el original, un menú de enlaces que duplica el nav de arriba
 * y un formulario de newsletter que no tiene backend. Nunca una columna vacía.
 *
 * ⚠️ La foto del local y el enlace a mapa siguen pendientes.
 */
export const locales: Pieza = {
  id: "locales",
  raiz: "p-locales",
  // `h2`/`h3`/`p` los declara la pieza: venían de `footer h2`/`footer h3`/`footer p`, selectores que
  // estilaban a la vez esta pieza, `contacto` y la línea técnica del shell.
  css: `.p-locales .ubicaciones{border:0;padding:0}
/* El mismo rótulo de columna que \`contacto\`: ver ahí por qué son dos copias y no una regla del base. */
.p-locales h2{font-family:var(--fuente-titulo);font-size:1.05rem;text-transform:uppercase;letter-spacing:.08em;margin:0 0 18px;padding:0 0 12px;color:var(--titulo);border-bottom:2px solid var(--decorativo)}
/* **Cada local es una COLUMNA**, y por eso el pie tiene tantas como la ficha sostenga: con dos
   locales son tres (contacto + dos), con uno son dos. 'auto-fit' y no un número fijo justamente por
   eso — una rejilla de cuatro huecos dejaría huecos vacíos en la web de un negocio de un solo local,
   que es el caso más común. */
.p-locales .locales{display:grid;gap:clamp(20px,3vw,40px);grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.p-locales h3{font-family:var(--fuente-titulo);font-size:1.05rem;margin:0 0 8px;color:var(--titulo)}
.p-locales p{margin:0 0 6px}
.p-locales .local{margin:0;color:var(--muted)}
/* Mismo arreglo que en \`contacto\`, y por el mismo motivo: ver el comentario de ahí. */
.p-locales a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted)}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile) return "";
    const lista = localesDe(profile);
    if (lista.length === 0) return "";

    const bloques = lista
      .map((l) => {
        const titulo = l.name ? `<h3>${esc(l.name)}</h3>` : "";
        // `postalCode` es opcional: se imprime solo si está, nunca un hueco ni un "undefined".
        const dir = l.address
          ? `<p>${esc(l.address.streetAddress)}, ${l.address.postalCode ? `${esc(l.address.postalCode)} ` : ""}${esc(l.address.addressLocality)}</p>`
          : "";
        const tel = l.telephone
          ? `<p>Tel: <a href="${hrefTelefono(l.telephone)}">${esc(l.telephone)}</a></p>`
          : "";
        const horas = l.opening_hours ? `<p>${esc(l.opening_hours)}</p>` : "";
        return `    <div class="local">${titulo}${dir}${tel}${horas}</div>`;
      })
      .join("\n");

    return envolver(
      "p-locales",
      `<section class="ubicaciones" id="ubicaciones">
  <h2>${lista.length > 1 ? "Nuestros locales" : "Dónde estamos"}</h2>
  <div class="locales">
${bloques}
  </div>
</section>`,
    );
  },
};

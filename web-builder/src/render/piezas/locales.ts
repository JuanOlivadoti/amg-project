import { envolver, esc, localesDe } from "../lib.js";
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
 * ⚠️ La foto del local y el enlace a mapa son la entrega 3.
 */
export const locales: Pieza = {
  id: "locales",
  raiz: "p-locales",
  // `h2`/`h3`/`p` los declara la pieza: venían de `footer h2`/`footer h3`/`footer p`, selectores que
  // estilaban a la vez esta pieza, `contacto` y la línea técnica del shell.
  css: `.p-locales .ubicaciones{border:0;padding:16px 0 0}
/* El \`letter-spacing\` viene de \`section h2\` del CSS viejo, no de \`footer h2\`: ver la explicación
   completa en \`contacto.ts\`, que perdió el mismo valor por el mismo empate de especificidad. */
.p-locales h2{font-size:1.15rem;margin:0 0 10px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-locales h3{font-size:.95rem;margin:0 0 4px;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-locales p{margin:0 0 6px}
.p-locales .local{margin:0 0 16px;color:var(--muted)}
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
          ? `<p>Tel: <a href="tel:${esc(l.telephone.replace(/\s/g, ""))}">${esc(l.telephone)}</a></p>`
          : "";
        const horas = l.opening_hours ? `<p>${esc(l.opening_hours)}</p>` : "";
        return `  <div class="local">${titulo}${dir}${tel}${horas}</div>`;
      })
      .join("\n");

    return envolver(
      "p-locales",
      `<section class="ubicaciones" id="ubicaciones">
  <h2>${lista.length > 1 ? "Nuestros locales" : "Dónde estamos"}</h2>
${bloques}
</section>`,
    );
  },
};

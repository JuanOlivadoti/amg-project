import { envolver, esc, localesDe } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * El bloque de contacto del pie. Dueña de `id="contacto"`.
 *
 * **Pieza de SHELL, no de receta** (§1): el nav ancla a `#contacto` desde todas las páginas, así que
 * la región tiene que existir en todas por construcción. Antes era una `<section id="contacto">`
 * dentro de `<main>`, repetida en cada landing y ausente de la home sintetizada.
 */
export const contacto: Pieza = {
  id: "contacto",
  raiz: "p-contacto",
  // `border:0;padding:0` eran los que anulaban el `section{padding:32px 0;border-bottom:…}` global.
  // Se conservan porque el resultado computado tiene que ser idéntico al de antes, no porque hagan
  // falta hoy: si mañana alguien devuelve una regla de `section`, esta pieza ya está a salvo.
  // `h2`/`p` los declara la pieza porque los declaraba `footer h2`/`footer p`, que estilaban también
  // el pie de `locales` y la línea técnica del shell — un selector global de tres dueños.
  css: `.p-contacto .contacto{border:0;padding:0}
/* El \`letter-spacing\` NO es decorativo acá: lo heredaba de \`section h2\`, porque este \`<h2>\` vive
   dentro de un \`<section>\` del pie. \`section h2\` (0,0,2) y \`footer h2\` (0,0,2) empataban en
   especificidad, así que \`footer h2\` ganaba \`font-size\` y \`margin\` —los únicos que declaraba— y
   \`letter-spacing\` seguía llegando del otro. Al repartir el CSS por piezas se cayó, y una revisión
   lo cazó con un comparador de cascada; el método de "buscar dueño por declaración" no podía verlo,
   porque la declaración SÍ tenía dueño (cuatro piezas se la llevaron) y aun así dejó de llegar acá. */
.p-contacto h2{font-size:1.15rem;margin:0 0 10px;letter-spacing:-.01em;color:var(--titulo);font-family:var(--fuente-titulo)}
.p-contacto p{margin:0 0 6px}
/* El \`tel:\` salía con el azul del navegador y el subrayado por defecto: dentro de un pie sobrio es
   lo único que grita, y el azul no es de la marca de nadie. Toma el color del texto y conserva un
   subrayado —tenue, pero subrayado— porque quitarlo dejaría un enlace que no se puede distinguir de
   un párrafo salvo por el cursor. */
.p-contacto a{color:inherit;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px;text-decoration-color:var(--muted)}
`,

  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile) return "";
    // Mismo fallback que el JSON-LD (`homeLd`/`primaryEntity`): sin esto, un perfil con
    // `locations[0].telephone` pero sin `telephone` clásico de nivel superior no mostraba nada en
    // "Contacto", aunque "Nuestros locales" sí tuviera el teléfono un poco más abajo. Y con ambos,
    // gana `locations`, igual que en el JSON-LD.
    const tel = localesDe(profile)[0]?.telephone ?? profile.telephone;
    const telHtml = tel
      ? `<p>Tel: <a href="tel:${esc(tel.replace(/\s/g, ""))}">${esc(tel)}</a></p>`
      : "";
    return envolver(
      "p-contacto",
      `<section class="contacto" id="contacto">
  <h2>Contacto</h2>
  <p><strong>${esc(profile.name)}</strong></p>
  ${telHtml}
</section>`,
    );
  },
};

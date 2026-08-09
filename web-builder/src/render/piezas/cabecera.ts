import type { BusinessProfile } from "../../types.js";
import { consumirCupo, fuentePermitida } from "../imagenes.js";
import { SLUG_HOME, SLUG_MENU, envolver, esc, hayUbicaciones } from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";

/**
 * Cabecera del sitio: marca (logo o nombre) + la barra de navegación. Es lo que hace que la página se
 * sienta DE alguien y, con la nav, lo que impide que un visitante quede varado en una landing aislada.
 *
 * **Es una pieza de SHELL, no de receta** (§1). El nav ancla a `#ubicaciones` desde todas las páginas,
 * así que esa región tiene que existir en todas *por construcción*, no por disciplina — y si la
 * cabecera viviera en la receta, el tipo permitiría una receta que la omitiera.
 *
 * Se omite entera si no hay perfil: una página suelta sin contexto de sitio (el caso de
 * `renderStory(story)` a secas en un test) no lleva cabecera.
 */

/** Un ítem del nav de arriba. `slug` solo lo tienen las secciones que SON una página (para `aria-current`). */
interface ItemNav {
  href: string;
  label: string;
  slug?: string;
}

/**
 * El nav de arriba: las **secciones del sitio**, derivadas del perfil.
 *
 * Antes se armaba con la lista de páginas publicadas (Links API), así que un sitio con 14 landings de
 * research mostraba 14 títulos SEO larguísimos: parecía el índice de un blog y no el sitio de un
 * restaurante. Las landings siguen publicadas y enlazadas —desde el índice de la home—, pero ya no
 * ocupan la barra.
 *
 * Cada ítem es **condicional al dato que lo hace útil**: sin carta no hay "Menú", sin locales ni
 * dirección no hay "Ubicaciones". Un enlace a una sección vacía es peor que no tener el enlace.
 */
function navPrincipal(profile: BusinessProfile): ItemNav[] {
  const items: ItemNav[] = [{ href: "/", label: "Inicio", slug: SLUG_HOME }];
  if (profile.menu && profile.menu.length > 0) {
    items.push({ href: `/${SLUG_MENU}`, label: "Menú", slug: SLUG_MENU });
  }
  // Ubicaciones y Contacto son ANCLAS al footer, no páginas: el footer está en todas las páginas, así
  // que el enlace funciona desde cualquiera sin cargar nada.
  if (hayUbicaciones(profile)) items.push({ href: "#ubicaciones", label: "Ubicaciones" });
  items.push({ href: "#contacto", label: "Contacto" });
  return items;
}

function renderNav(items: ItemNav[], activeSlug: string): string {
  const html = items
    .map((it) => {
      const activo = it.slug !== undefined && it.slug === activeSlug;
      const attrs = activo ? ` class="activo" aria-current="page"` : "";
      return `<a href="${esc(it.href)}"${attrs}>${esc(it.label)}</a>`;
    })
    .join("");
  return `<nav class="nav" aria-label="Secciones del sitio">${html}</nav>`;
}

export const cabecera: Pieza = {
  id: "cabecera",
  raiz: "p-cabecera",
  css: `.p-cabecera .sitebar{border-bottom:1px solid #eee;padding:14px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;max-width:1100px;margin:0 auto}
.p-cabecera .sitebar .brand{display:inline-flex;align-items:center;text-decoration:none;color:var(--fg)}
/* El nombre del negocio ES el logotipo cuando no hay imagen, así que se dibuja con la fuente
   DECORATIVA del manual — es el único sitio del sitio donde una tipografía de rótulo tiene sentido.
   Sin manual, ese token cae a la fuente del cuerpo y la cabecera se ve exactamente como hoy. */
.p-cabecera .sitebar .marca{font-weight:700;font-size:1.15rem;letter-spacing:-.01em;font-family:var(--fuente-decorativa)}
.p-cabecera .sitebar .logo{display:block}
.p-cabecera .nav{display:flex;gap:6px 18px;flex-wrap:wrap;margin-left:auto;font-size:.95rem}
.p-cabecera .nav a{text-decoration:none;color:var(--muted);padding:4px 2px;border-bottom:2px solid transparent;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.p-cabecera .nav a:hover{color:var(--fg)}
.p-cabecera .nav a.activo{color:var(--fg);border-bottom-color:var(--acento-legible);font-weight:600}
@media(prefers-color-scheme:dark){.p-cabecera .sitebar{border-color:#222}}
`,

  render(ctx: CtxPieza): string {
    // Sin perfil no hay sitio del que ser cabecera: una story renderizada suelta (un test, un preview
    // sin ficha cargada) sale sin barra, como hasta ahora.
    const profile = ctx.profile;
    if (!profile) return "";
    const navHtml = renderNav(navPrincipal(profile), ctx.activeSlug);
    // ⚠️ **El logo es el SEGUNDO emisor de `<img>` del render** —el otro es `renderImagen`— y es el
    // único que aparece en TODAS las páginas del sitio. Como vector de fuga hacia un host arbitrario
    // es, por tanto, el PEOR de los dos: una foto de hero se ve en una página; el logo, en todas.
    //
    // Por eso pasa por la §Política de imágenes **entera**, igual que cualquier foto: `fuentePermitida`
    // (https + allowlist de hosts exacta), `referrerpolicy="no-referrer"` (punto 4, "en cada `<img>`")
    // y presupuesto del documento — un `<img>` exento del conteo convierte el tope de 60 en una cifra
    // falsa.
    //
    // **Esto endureció una conducta que antes tenía test propio** (`html.test.ts` renderizaba un logo
    // en `cdn.ej` y exigía que saliera). Se cambió a propósito, con dos comprobaciones antes: ninguna
    // ficha sembrada tiene `brand.logo` fuera de Storyblok —el seed de demo no siembra logo y los
    // `cdn.ej` del repo son hosts de test— y **el fallo es benigno y visible**: un logo que no pasa cae
    // al nombre del negocio en texto, que es la misma conducta que "sin logo". Nadie se queda con una
    // cabecera rota; como mucho, con una menos bonita hasta que el asset se suba al space.
    //
    // Que la cabecera se emita ANTES que el contenido (ver `renderDocumento`) hace que el logo nunca
    // sea el que se cae por falta de cupo: se lleva el primer hueco. Es deliberado — es el elemento de
    // marca, no una foto más.
    const logo = profile.brand?.logo;
    const logoOk = typeof logo === "string" && fuentePermitida(logo);
    const marca =
      logoOk && consumirCupo(ctx.presupuestoImagenes)
        // Sin `loading="lazy"`: el logo está sobre el pliegue y diferirlo penaliza el LCP. Lo único
        // que se le añade es la política de referrer.
        ? `<img class="logo" src="${esc(logo)}" alt="${esc(profile.name)}" referrerpolicy="no-referrer" height="40">`
        : `<span class="marca">${esc(profile.name)}</span>`;
    return envolver(
      "p-cabecera",
      `<header class="sitebar"><a href="/" class="brand">${marca}</a>${navHtml}</header>`,
    );
  },
};

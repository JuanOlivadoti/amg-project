import type { BusinessProfile } from "../../types.js";
import { consumirCupo, fuentePermitida } from "../imagenes.js";
import {
  SLUG_HOME,
  SLUG_MENU,
  datosAccionables,
  envolver,
  esc,
  hayUbicaciones,
  hrefTelefono,
} from "../lib.js";
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
  css: `/* ⚠️ **Sin esto el sticky de la barra NO funciona, y falla en silencio.**
   Toda pieza va envuelta en un div con su raíz (ver \`envolver\`), y un elemento sticky solo se queda
   pegado mientras su CONTENEDOR sigue a la vista: como este envoltorio mide lo que miden las dos
   barras y nada más, la barra se despegaba a los ~130 px de scroll. Medido: con scrollY 900, la
   barra estaba en top:-856 — o sea, se había ido con la página.
   \`display:contents\` hace que el envoltorio no genere caja: sus hijos pasan a ser hijos del body y
   el sticky se mide contra el documento entero, que es lo que se quiere. No afecta al aislamiento,
   que es por selector y no por caja. */
.p-cabecera{display:contents}
/* **La franja de datos, arriba del todo.** Teléfono y horario dejan de estar solo en el pie: en un
   restaurante son lo que más se busca, y en la barra superior se ven sin bajar ni una pantalla. No
   lleva email ni redes porque el perfil no los tiene — antes ausente que inventado. */
.p-cabecera .topbar{background:var(--accent);color:var(--sobre-acento)}
.p-cabecera .topbar .interior{max-width:var(--ancho-pagina);margin:0 auto;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;gap:8px 24px;flex-wrap:wrap;font-size:.95rem}
.p-cabecera .topbar a{color:var(--sobre-acento);text-decoration:none}
.p-cabecera .topbar a:hover{text-decoration:underline}
.p-cabecera .topbar .horario{opacity:.9}
/* La barra se queda al bajar: en una landing larga la navegación desaparecía y no volvía. La sombra
   es permanente y no aparece con el scroll — detectar el scroll exige JavaScript, y el renderizador
   no emite ni una línea (es la única superficie expuesta a internet anónimo). */
.p-cabecera .sitebar{position:sticky;top:0;z-index:20;background:var(--bg);box-shadow:0 2px 20px rgba(7,20,52,.10)}
.p-cabecera .sitebar .interior{max-width:var(--ancho-pagina);margin:0 auto;padding:0 20px;display:flex;align-items:center;gap:24px}
.p-cabecera .brand{display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:var(--fg);padding:10px 0}
/* El nombre del negocio ES el logotipo cuando no hay imagen, así que se dibuja con la fuente
   DECORATIVA del manual — es el único sitio del sitio donde una tipografía de rótulo tiene sentido,
   y **es su único consumidor**: pintarlo con la de titulares deja el token del manual sin nadie que
   lo use, o sea una ficha que pide Dancing Script, paga su descarga y no la ve en ninguna parte.
   Sin manual, ese token cae a la fuente del cuerpo. Crece de 1.15 a 1.35rem para sostener la barra
   nueva, que es más alta. */
.p-cabecera .sitebar .marca{font-weight:700;font-size:1.35rem;letter-spacing:-.01em;font-family:var(--fuente-decorativa);color:var(--titulo)}
.p-cabecera .sitebar .logo{display:block;height:56px;width:auto}
/* El nav va CENTRADO entre la marca y la acción, no pegado a la derecha: los dos margin auto se
   reparten el espacio sobrante. Es el patrón del template de referencia (logo · nav · acción). */
.p-cabecera .nav{display:flex;margin:0 auto;flex-wrap:wrap;justify-content:center}
/* La fuente de TITULARES, no la del cuerpo: en el manual de Borcelle es una condensada, y una
   condensada en versalita es exactamente el rótulo de carta que el nav de un restaurante pide.
   Sin manual cae a la del cuerpo y el nav se ve como hasta ahora. */
.p-cabecera .nav a{padding:28px 15px;font-family:var(--fuente-titulo);font-size:1.1rem;font-weight:500;color:var(--titulo);text-decoration:none;border-bottom:3px solid transparent}
.p-cabecera .nav a:hover{color:var(--acento-legible)}
.p-cabecera .nav a.activo{color:var(--acento-legible);border-bottom-color:var(--acento-legible)}
/* El CTA es el único botón del documento que no pertenece a una sección: es la acción del sitio
   entero. Usa el primario de la marca, no un rojo fijo — dos clientes con la misma plantilla siguen
   teniendo dos webs distintas. */
.p-cabecera .cta{background:var(--accent);color:var(--sobre-acento);text-decoration:none;padding:11px 30px;border-radius:30px;font-size:1rem;font-weight:600;white-space:nowrap}
/* ⚠️ Los selectores de acá dentro repiten .sitebar POR ESPECIFICIDAD, no por estilo: las reglas de
   arriba son ".p-cabecera .sitebar .logo" (0,3,0) y un ".p-cabecera .logo" (0,2,0) pierde aunque
   esté después y dentro de una at-rule. El síntoma sería un logo de 56 px en un móvil de 390 px,
   sin ningún error en ninguna parte. */
/* La franja roja se ESCONDE en móvil, igual que en el template de referencia: en 390 px de ancho el
   teléfono y el horario ocupan dos líneas de una pantalla donde cada línea es cara, y los dos datos
   siguen a un toque de distancia en el botón Llamar y en la franja de datos. */
@media(max-width:900px){.p-cabecera .topbar{display:none}
.p-cabecera .sitebar .interior{flex-wrap:wrap;padding:8px 16px;gap:12px}
.p-cabecera .sitebar .logo{height:44px}
.p-cabecera .sitebar .marca{font-size:1.1rem}
.p-cabecera .cta{margin-left:auto;padding:9px 22px;font-size:.95rem}
.p-cabecera .nav{order:3;width:100%;margin-left:0;flex-wrap:nowrap;overflow-x:auto;border-top:1px solid rgba(0,0,0,.08)}
.p-cabecera .nav a{padding:12px 14px;font-size:.98rem;white-space:nowrap;border-bottom-width:2px}}
`,

  /* ⚠️ La franja superior es el único sitio del documento con un color de texto LITERAL (`#fff`), y
     por eso necesita las cuatro líneas de abajo. Su fondo es `var(--titulo)` —oscuro en claro—, pero
     en modo oscuro ese token se invierte a `#e8e8e8`: sin redeclarar, la barra quedaría con texto
     blanco sobre fondo casi blanco, o sea ilegible. Lo cazó `huecosDeModoOscuro` al primer intento;
     lo escribo acá porque es la clase de fallo que un vistazo al CSS claro no muestra. */
  cssOscuro: `@media(prefers-color-scheme:dark){.p-cabecera .sitebar{box-shadow:0 2px 20px rgba(0,0,0,.5)}
.p-cabecera .topbar{background:#1b1b1b;color:#e8e8e8}
.p-cabecera .topbar a{color:#e8e8e8}
.p-cabecera .nav{border-color:rgba(255,255,255,.12)}}
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
        ? `<img class="logo" src="${esc(logo)}" alt="${esc(profile.name)}" referrerpolicy="no-referrer" height="56">`
        : `<span class="marca">${esc(profile.name)}</span>`;

    const { telefono, horario } = datosAccionables(profile);
    // La franja superior solo existe si tiene algo que decir. Una barra oscura vacía sobre la
    // cabecera no es "sobria": es un elemento de diseño que anuncia que falta un dato.
    const topbar =
      telefono || horario
        ? `<div class="topbar"><div class="interior">${
            telefono
              ? `<a class="tel" href="${hrefTelefono(telefono)}">${esc(telefono)}</a>`
              : `<span></span>`
          }${horario ? `<span class="horario">${esc(horario)}</span>` : ""}</div></div>`
        : "";
    // El CTA es un `tel:` porque es la acción que este sistema puede cumplir de verdad. Un "Reservar"
    // que abriera un formulario inexistente sería una promesa que el sitio no sostiene, y sin
    // teléfono no se emite ningún botón.
    const cta = telefono
      ? `<a class="cta" href="${hrefTelefono(telefono)}">Llamar</a>`
      : "";

    return envolver(
      "p-cabecera",
      `${topbar}<header class="sitebar"><div class="interior"><a href="/" class="brand">${marca}</a>${navHtml}${cta}</div></header>`,
    );
  },
};

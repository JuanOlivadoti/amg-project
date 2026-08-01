import type {
  BrandTheme,
  BusinessProfile,
  FaqBlok,
  HeroBlok,
  Imagen,
  Location,
  MenuItem,
  NavItem,
  PageContent,
  PostalAddress,
  SchemaType,
  SectionBlok,
  Story,
} from "../types.js";

/**
 * Render AI-search-first (ADR-04): HTML semántico + JSON-LD por tipo de página.
 * Página autocontenida (CSS inline, sin dependencias externas).
 *
 * OJO — quién sirve esto en producción está SIN DECIDIR (OBS-03). ADR-16 quitó Next del
 * stack, así que este render dejó de ser "un preview de lo que hará Next" y es, de hecho,
 * el único renderizador que existe. Falta el paso que lo publique en un dominio y lo
 * regenere cuando alguien edite en Storyblok.
 *
 * `profile` (opcional): datos NAP del negocio → enriquecen JSON-LD y agregan contacto.
 */
export function renderStory(
  story: Story,
  profile?: BusinessProfile | null,
  languageCode = "es",
  hayBlog = false,
): string {
  const c = story.content;
  const lang = esc(languageCode);
  const url = resolveCanonical(c.seo.canonical, profile);
  const hero = c.body.find((b): b is HeroBlok => b.component === "hero");
  const sections = c.body.filter((b): b is SectionBlok => b.component === "section");
  const faq = c.body.find((b): b is FaqBlok => b.component === "faq");
  // Destino del CTA: contacto si hay perfil, si no las FAQs; si no hay ninguno, sin ancla.
  const ctaHref = profile ? "#contacto" : faq ? "#faq" : null;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(c.seo.title)}</title>
<meta name="description" content="${esc(c.seo.description)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(c.seo.og_title)}">
<meta property="og:description" content="${esc(c.seo.og_description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
${profile?.image ? `<meta property="og:image" content="${esc(profile.image)}">` : ""}
<script type="application/ld+json">
${safeJson(jsonLd(c, url, profile))}
</script>
${researchTrace(c)}
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile, story.slug)}
<main>
${hero ? renderHero(hero, ctaHref) : ""}
${sections.map(renderSection).join("\n")}
${faq ? renderFaq(faq) : ""}
</main>
${renderFooter(profile, c.meta.contract_version, c.schema_type, hayBlog)}
</body>
</html>`;
}

/** El slug convencional de la portada. La raíz del dominio la sirve. */
const SLUG_HOME = "home";

/**
 * La **home sintetizada**: la portada que el renderizador sirve en la raíz de un dominio cuando en el
 * space NO existe una story `home`.
 *
 * Sin esto, la raíz de una web recién publicada da 404 (las páginas que produce el pipeline son
 * landings aisladas, no hay portada). Antes de que el cliente redacte su home en el Visual Editor,
 * esta página lo cubre: el nombre del negocio + un índice de las páginas publicadas. Es HTML válido y
 * autocontenido, con su JSON-LD, igual que una página normal — no un placeholder feo.
 *
 * Cuando el cliente crea su propia `home` en Storyblok, esa gana: el renderizador la sirve y esta
 * función deja de invocarse. Es un fallback, no una imposición.
 */
export function renderHome(
  profile?: BusinessProfile | null,
  nav: NavItem[] = [],
  languageCode = "es",
  hayBlog = false,
): string {
  const lang = esc(languageCode);
  const nombre = profile?.name ?? "Inicio";
  const url = profile?.url ? profile.url.replace(/\/+$/, "") + "/" : "/";
  const descripcion = profile
    ? `${profile.name}${profile.address ? ` · ${profile.address.addressLocality}` : ""}`
    : "";

  const tarjetas = nav.length
    ? `<div class="cards">
${nav.map(tarjetaIndice).join("\n")}
</div>`
    : `<p class="pending">Aún no hay páginas publicadas. Aparecerán aquí en cuanto se publiquen.</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(nombre)}</title>
${descripcion ? `<meta name="description" content="${esc(descripcion)}">` : ""}
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(nombre)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
${profile?.image ? `<meta property="og:image" content="${esc(profile.image)}">` : ""}
<script type="application/ld+json">
${safeJson(homeLd(profile, url))}
</script>
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile, SLUG_HOME)}
<main>
<header class="hero">
  <h1>${esc(nombre)}</h1>
  ${descripcion ? `<p class="lede">${esc(descripcion)}</p>` : ""}
</header>
<section class="indice">
  <h2>Páginas</h2>
  ${tarjetas}
</section>
</main>
${renderFooter(profile, "web.v0.1", "WebPage", hayBlog)}
</body>
</html>`;
}

/** Una tarjeta del índice de la home: enlace a una página publicada. */
function tarjetaIndice(item: NavItem): string {
  return `  <a class="card" href="${esc(hrefDeSlug(item.slug))}"><h3>${esc(item.name)}</h3></a>`;
}

/** JSON-LD de la home: LocalBusiness con NAP si hay perfil; si no, un WebSite mínimo. */
function homeLd(profile: BusinessProfile | null | undefined, url: string): unknown {
  if (!profile) {
    return { "@context": "https://schema.org", "@type": "WebSite", url };
  }
  const entity: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: profile.name,
    url,
  };
  // Mismo fallback que `primaryEntity`: sin address/telephone de nivel superior, el primer local
  // (vía `localesDe`) los provee — `locations` MANDA para el JSON-LD (spec). Por eso el primer
  // operando es `principal`, no `profile`: si un perfil trae AMBOS, gana el local.
  const principal = localesDe(profile)[0];
  const telephone = principal?.telephone ?? profile.telephone;
  const address = principal?.address ?? profile.address;
  if (telephone) entity.telephone = telephone;
  if (profile.priceRange) entity.priceRange = profile.priceRange;
  if (profile.image) entity.image = profile.image;
  if (address) entity.address = postalAddressLd(address);
  return entity;
}

/**
 * La página `/menu`: la carta del negocio.
 *
 * **Sintetizada, igual que la home**: sale del perfil, no de una story ni del LLM. Un menú es una
 * lista de producto con precio — no hay nada que "redactar", y generarlo por IA metería una fuente
 * más de contenido que revisar en la compuerta humana (ADR-06). Si el cliente crea su propia story
 * `menu` en Storyblok, esa gana: el renderizador la sirve y esta función no se invoca.
 */
export function renderMenu(
  profile?: BusinessProfile | null,
  languageCode = "es",
  hayBlog = false,
): string {
  const lang = esc(languageCode);
  const nombre = profile?.name ?? "Menú";
  const items = profile?.menu ?? [];
  const url = profile?.url ? `${profile.url.replace(/\/+$/, "")}/${SLUG_MENU}` : `/${SLUG_MENU}`;
  const titulo = `Menú · ${nombre}`;

  const grupos = agruparCarta(items);
  const cuerpo = grupos.length
    ? grupos.map(renderGrupoCarta).join("\n")
    : `<p class="pending">La carta todavía no está cargada.</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(`La carta de ${nombre}.`)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
${items.length && profile ? `<script type="application/ld+json">\n${safeJson(menuLd(profile, url))}\n</script>` : ""}
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile, SLUG_MENU)}
<main>
<header class="hero">
  <h1>${esc(titulo)}</h1>
</header>
${cuerpo}
</main>
${renderFooter(profile, "web.v0.1", "Menu", hayBlog)}
</body>
</html>`;
}

/**
 * El índice `/blog`: las páginas de research que son artículos (`schema_type: Article`).
 *
 * Existe para que los posts no queden como enlaces sueltos en el pie ni compitiendo con las landings
 * comerciales en el índice de la home. Solo entran las `Article` — las `landing_local`/`servicio` son
 * páginas de producto, no editoriales, y siguen viviendo en el índice de la home.
 */
export function renderBlogIndex(
  profile: BusinessProfile | null | undefined,
  posts: NavItem[],
  languageCode = "es",
): string {
  const lang = esc(languageCode);
  const nombre = profile?.name ?? "Blog";
  const titulo = `Blog · ${nombre}`;
  const url = profile?.url ? `${profile.url.replace(/\/+$/, "")}/${SLUG_BLOG}` : `/${SLUG_BLOG}`;

  const tarjetas = posts.length
    ? `<div class="cards">\n${posts.map(tarjetaIndice).join("\n")}\n</div>`
    : `<p class="pending">Todavía no hay artículos publicados.</p>`;

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(`Artículos de ${nombre}.`)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(url)}">
<style>${CSS}${themeCss(profile?.brand)}</style>
</head>
<body>
${renderSiteHeader(profile, SLUG_BLOG)}
<main>
<header class="hero">
  <h1>${esc(titulo)}</h1>
</header>
<section class="indice">
  ${tarjetas}
</section>
</main>
${renderFooter(profile, "web.v0.1", "WebPage", false)}
</body>
</html>`;
}

/** Agrupa la carta por categoría conservando el orden de aparición. Los sin categoría, al final. */
function agruparCarta(items: MenuItem[]): Array<{ categoria: string | null; items: MenuItem[] }> {
  const grupos = new Map<string, MenuItem[]>();
  const sueltos: MenuItem[] = [];
  for (const it of items) {
    const cat = it.category?.trim();
    if (!cat) {
      sueltos.push(it);
      continue;
    }
    const g = grupos.get(cat);
    if (g) g.push(it);
    else grupos.set(cat, [it]);
  }
  const salida: Array<{ categoria: string | null; items: MenuItem[] }> = [...grupos.entries()].map(
    ([categoria, items]) => ({ categoria, items }),
  );
  if (sueltos.length) salida.push({ categoria: null, items: sueltos });
  return salida;
}

function renderGrupoCarta(g: { categoria: string | null; items: MenuItem[] }): string {
  const filas = g.items
    .map((it) => {
      const precio = it.price ? `<span class="precio">${esc(it.price)}</span>` : "";
      const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
      return `  <li><div class="fila"><span class="nombre">${esc(it.name)}</span>${precio}</div>${desc}</li>`;
    })
    .join("\n");
  return `<section class="carta">
  ${g.categoria ? `<h2>${esc(g.categoria)}</h2>` : ""}
  <ul class="items">
${filas}
  </ul>
</section>`;
}

/** JSON-LD de la carta: `Menu` con una `MenuSection` por categoría. */
function menuLd(profile: BusinessProfile, url: string): unknown {
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    url,
    name: `Menú · ${profile.name}`,
    hasMenuSection: agruparCarta(profile.menu ?? []).map((g) => ({
      "@type": "MenuSection",
      ...(g.categoria ? { name: g.categoria } : {}),
      hasMenuItem: g.items.map((it) => ({
        "@type": "MenuItem",
        name: it.name,
        ...(it.description ? { description: it.description } : {}),
        // `price` es texto libre: va como `Offer.price` sin inventar moneda ni parsear el número.
        ...(it.price ? { offers: { "@type": "Offer", price: it.price } } : {}),
      })),
    })),
  };
}

/** Los slugs de las páginas que sintetiza el renderizador (no viven en Storyblok salvo que el cliente las cree). */
const SLUG_MENU = "menu";
const SLUG_BLOG = "blog";

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

/** ¿Hay algo que mostrar en "Ubicaciones"? Locales explícitos, o los campos sueltos del perfil clásico. */
function hayUbicaciones(p: BusinessProfile): boolean {
  if (p.locations && p.locations.length > 0) return true;
  return Boolean(p.address || p.telephone || p.opening_hours);
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

/**
 * Un slug de Storyblok → un `href` seguro. Mismo criterio que la CDA con el slug de la petición: los
 * segmentos de navegación (`.`, `..`) se descartan y cada segmento se escapa. Un `slug` como
 * `javascript:alert(1)` sale como `/javascript:alert(1)` codificado — una ruta, nunca un esquema.
 */
function hrefDeSlug(slug: string): string {
  const ruta = slug
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .map(encodeURIComponent)
    .join("/");
  return `/${ruta}`;
}

/**
 * El pie, común a TODAS las páginas: contacto + locales + blog + la línea técnica.
 *
 * Antes el contacto era una `<section id="contacto">` dentro de `<main>`, repetida en cada landing y
 * ausente de la home sintetizada. En el pie está en todas por construcción —incluidas `/menu` y
 * `/blog`— y deja de competir con el contenido. Los `id` no cambian, así que el nav de arriba ancla acá.
 */
function renderFooter(
  profile: BusinessProfile | null | undefined,
  contractVersion: string,
  schemaType: string,
  hayBlog: boolean,
): string {
  const tecnica = `<p class="tecnica">Página generada por AMG OS · contrato ${esc(contractVersion)} · schema ${esc(schemaType)}</p>`;
  if (!profile) return `<footer>${tecnica}</footer>`;

  const locales = localesDe(profile);
  // Mismo fallback que el JSON-LD (`homeLd`/`primaryEntity`): sin esto, un perfil con
  // `locations[0].telephone` pero sin `telephone` clásico de nivel superior no mostraba nada en
  // "Contacto", aunque "Nuestros locales" sí tuviera el teléfono un poco más abajo. Y con ambos,
  // gana `locations`, igual que en el JSON-LD.
  const tel = locales[0]?.telephone ?? profile.telephone;
  const telHtml = tel
    ? `<p>Tel: <a href="tel:${esc(tel.replace(/\s/g, ""))}">${esc(tel)}</a></p>`
    : "";

  return `<footer>
<section class="contacto" id="contacto">
  <h2>Contacto</h2>
  <p><strong>${esc(profile.name)}</strong></p>
  ${telHtml}
</section>
${locales.length ? renderUbicaciones(locales) : ""}
${hayBlog ? `<p class="mas"><a href="/${SLUG_BLOG}">Blog</a></p>` : ""}
${tecnica}
</footer>`;
}

/**
 * Los locales del negocio, normalizados.
 *
 * Con `locations` explícito manda esa lista. Sin ella se sintetiza UNO con los campos clásicos
 * (`address`/`telephone`/`opening_hours`), que es como se describía un negocio de un solo local antes
 * de que existiera `locations` — así un perfil viejo no pierde su dirección cuando el footer pasa a
 * ser multi-local.
 */
function localesDe(p: BusinessProfile): Location[] {
  if (p.locations && p.locations.length > 0) return p.locations;
  if (!p.address && !p.telephone && !p.opening_hours) return [];
  return [
    {
      ...(p.address ? { address: p.address } : {}),
      ...(p.telephone ? { telephone: p.telephone } : {}),
      ...(p.opening_hours ? { opening_hours: p.opening_hours } : {}),
    },
  ];
}

function renderUbicaciones(locales: Location[]): string {
  const bloques = locales
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
  return `<section class="ubicaciones" id="ubicaciones">
  <h2>${locales.length > 1 ? "Nuestros locales" : "Dónde estamos"}</h2>
${bloques}
</section>`;
}

/** Familias tipográficas seguras, por nombre. La marca elige un nombre, NUNCA escribe el stack. */
const FONT_STACKS: Record<NonNullable<BrandTheme["font"]>, string> = {
  sistema: "system-ui,-apple-system,Segoe UI,Roboto,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  moderna: "'Helvetica Neue',Arial,sans-serif",
};

/**
 * Traduce el tema de marca a CSS, **revalidando cada valor** aunque ya lo haya validado Zod: en PROD
 * el perfil puede venir de Storyblok sin pasar por `parseProfile`, así que el renderizador no confía.
 * Lo que no valida, lo descarta → cae al default. Un color inválido no rompe la página, la deja sobria.
 */
function themeCss(brand?: BrandTheme | null): string {
  if (!brand) return "";
  const reglas: string[] = [];

  if (typeof brand.color === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(brand.color)) {
    reglas.push(`--accent:${brand.color}`);
  }
  if (brand.font && brand.font in FONT_STACKS) {
    reglas.push(`--font:${FONT_STACKS[brand.font]}`);
  }
  return reglas.length ? `\n:root{${reglas.join(";")}}` : "";
}

/**
 * Cabecera del sitio: marca (logo o nombre) + la barra de navegación. Es lo que hace que la página se
 * sienta DE alguien y, con la nav, lo que impide que un visitante quede varado en una landing aislada.
 *
 * Se omite entera si no hay perfil: una página suelta sin contexto de sitio (el caso de
 * `renderStory(story)` a secas en un test) no lleva cabecera.
 */
function renderSiteHeader(profile: BusinessProfile | null | undefined, activeSlug: string): string {
  // Sin perfil no hay sitio del que ser cabecera: una story renderizada suelta (un test, un preview
  // sin ficha cargada) sale sin barra, como hasta ahora.
  if (!profile) return "";
  const navHtml = renderNav(navPrincipal(profile), activeSlug);
  // El logo va a un `<img src>`: se exige http(s) acá también, no solo en Zod (en PROD el perfil
  // puede venir de Storyblok sin validar). Un logo dudoso cae al nombre, no rompe la cabecera.
  const logo = profile.brand?.logo;
  const logoOk = typeof logo === "string" && /^https?:\/\//i.test(logo);
  const marca = logoOk
    ? `<img class="logo" src="${esc(logo)}" alt="${esc(profile.name)}" height="40">`
    : `<span class="marca">${esc(profile.name)}</span>`;
  return `<header class="sitebar"><a href="/" class="brand">${marca}</a>${navHtml}</header>`;
}

/**
 * Una `<img>` de contenido, lista para Core Web Vitals: `loading="lazy"`, `decoding="async"`, y
 * `width`/`height` cuando se pueden inferir del asset de Storyblok (evita el salto de layout, CLS).
 * Sin src válido no se renderiza nada — una imagen rota es peor que ninguna.
 */
function renderImagen(img: Imagen | undefined, clase: string): string {
  if (!img || typeof img.src !== "string" || !/^https?:\/\//i.test(img.src)) return "";
  const dim = dimsDeStoryblok(img.src);
  const wh = dim ? ` width="${dim.w}" height="${dim.h}"` : "";
  return `<img class="${clase}" src="${esc(img.src)}" alt="${esc(img.alt ?? "")}" loading="lazy" decoding="async"${wh}>`;
}

/**
 * Las URLs de assets de Storyblok llevan las dimensiones en la ruta: `.../f/<space>/1200x800/<hash>/…`.
 * Extraerlas deja fijar `width`/`height` sin descargar la imagen. Si no matchea, se omite (mejor sin
 * dimensiones que con dimensiones inventadas).
 */
function dimsDeStoryblok(src: string): { w: number; h: number } | null {
  const m = src.match(/\/(\d{1,5})x(\d{1,5})\//);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Resuelve el canonical: una sola fuente de verdad = el `canonical` del brief (#16 review Codex).
 * Antes se re-derivaba de `story.slug` ignorando el canonical aprobado. Reglas:
 *  - si el canonical ya es absoluto (http/https), se respeta tal cual;
 *  - si es una ruta, se resuelve contra el dominio del perfil (validado por Zod);
 *  - sin dominio, queda relativo (el frontend Next.js le antepondrá su base en PROD).
 */
function resolveCanonical(canonical: string, profile?: BusinessProfile | null): string {
  if (/^https?:\/\//i.test(canonical)) return canonical;
  const path = canonical.startsWith("/") ? canonical : `/${canonical}`;
  if (profile?.url) return `${profile.url.replace(/\/+$/, "")}${path}`;
  return path;
}

function renderHero(h: HeroBlok, ctaHref: string | null): string {
  // La foto de portada va como banner arriba del título: es lo primero que ve un humano.
  const foto = renderImagen(h.image, "hero-img");
  return `<header class="hero${foto ? " has-img" : ""}">
  ${foto}
  <h1>${esc(h.headline)}</h1>
  ${h.subhead ? `<p class="lede">${esc(h.subhead)}</p>` : ""}
  ${h.cta_label && ctaHref ? `<a class="cta" href="${ctaHref}">${esc(h.cta_label)}</a>` : ""}
</header>`;
}

function renderSection(s: SectionBlok): string {
  const body = s.body
    ? `<p>${esc(s.body)}</p>`
    : `<p class="pending">Contenido pendiente de redacción (generación por LLM — siguiente paso del pipeline).</p>`;
  const foto = renderImagen(s.image, "section-img");
  return `<section${foto ? " class=\"has-img\"" : ""}>
  <h2>${esc(s.heading)}</h2>
  ${foto}
  ${body}
</section>`;
}

function renderFaq(f: FaqBlok): string {
  const items = f.items
    .map(
      (it) => `  <details>
    <summary>${esc(it.question)}</summary>
    <p>${it.answer ? esc(it.answer) : `<span class="pending">Respuesta pendiente de redacción.</span>`}</p>
  </details>`,
    )
    .join("\n");
  return `<section class="faq" id="faq">
  <h2>Preguntas frecuentes</h2>
${items}
</section>`;
}

/** JSON-LD: tipo primario + FAQPage cuando hay FAQs, unidos en un @graph. */
function jsonLd(c: PageContent, url: string, profile?: BusinessProfile | null): unknown {
  const graph: unknown[] = [primaryEntity(c, url, profile)];
  const faq = c.body.find((b): b is FaqBlok => b.component === "faq");
  if (faq && faq.items.length > 0) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: faq.items.map((it) => ({
        "@type": "Question",
        name: it.question,
        acceptedAnswer: { "@type": "Answer", text: it.answer || it.question },
      })),
    });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

function primaryEntity(c: PageContent, url: string, profile?: BusinessProfile | null): unknown {
  if (c.schema_type === "Article") {
    return { "@type": "Article", headline: c.seo.title, description: c.seo.description, url };
  }
  const type: Record<SchemaType, string> = {
    LocalBusiness: "LocalBusiness",
    Article: "Article",
    FAQPage: "WebPage", // el FAQPage va en el graph aparte; el primario cae a WebPage
    WebPage: "WebPage",
  };
  const entity: Record<string, unknown> = {
    "@type": type[c.schema_type],
    url,
    name: profile?.name ?? c.seo.title,
    description: c.seo.description,
  };

  // Enriquecimiento con datos NAP del negocio (cierra los warnings de LocalBusiness).
  if (c.schema_type === "LocalBusiness" && profile) {
    // `locations` MANDA (spec): sin address/telephone de nivel superior (el caso real, un perfil
    // multi-local sin campos clásicos), el primer local los provee. Los locales adicionales no
    // entran al @graph primario — alcanza con que el primero no se pierda. Y si el perfil trae
    // AMBOS (un `telephone` clásico viejo Y `locations` con uno distinto), gana `locations`: por
    // eso `principal` va primero en el `??`, no `profile`.
    const principal = localesDe(profile)[0];
    const telephone = principal?.telephone ?? profile.telephone;
    const address = principal?.address ?? profile.address;
    if (telephone) entity.telephone = telephone;
    if (profile.priceRange) entity.priceRange = profile.priceRange;
    if (profile.image) entity.image = profile.image;
    if (address) entity.address = postalAddressLd(address);
  }
  return entity;
}

/** El PostalAddress de schema.org. Compartido por la página (LocalBusiness) y la home. */
function postalAddressLd(address: PostalAddress): Record<string, unknown> {
  return {
    "@type": "PostalAddress",
    streetAddress: address.streetAddress,
    addressLocality: address.addressLocality,
    ...(address.postalCode ? { postalCode: address.postalCode } : {}),
    ...(address.addressRegion ? { addressRegion: address.addressRegion } : {}),
    ...(address.addressCountry ? { addressCountry: address.addressCountry } : {}),
  };
}

/**
 * Trazabilidad hacia el research como <script type="application/json"> (machine-readable).
 * Antes iba en un comentario HTML, donde datos no confiables (keyword) podían inyectar `-->`.
 * Un bloque script con serialización segura evita ese vector.
 */
function researchTrace(c: PageContent): string {
  const t = {
    source_keyword: c.meta.source_keyword,
    intent: c.intent,
    is_local: c.is_local,
    page_type: c.page_type,
    opportunity_score: c.meta.opportunity_score,
    volumen: c.meta.volumen,
    dificultad: c.meta.dificultad,
    evidencia: c.meta.evidencia,
    score_confidence: c.meta.score_confidence,
    word_count_objetivo: c.meta.word_count_objetivo,
  };
  return `<script type="application/json" id="research-trace">\n${safeJson(t)}\n</script>`;
}

/**
 * Serializa a JSON seguro para incrustar en <script>: neutraliza `<`, `>`, `&`, que
 * `JSON.stringify` NO escapa y que permitirían cerrar el <script> (`</script>`) e
 * inyectar markup. El JSON resultante sigue siendo válido (usa escapes \\uXXXX).
 */
function safeJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CSS = `
:root{--fg:#1a1a1a;--muted:#6b7280;--accent:#b91c1c;--bg:#fff;--soft:#f8f7f5;--font:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 var(--font);color:var(--fg);background:var(--bg)}
img{max-width:100%;height:auto}
.sitebar{border-bottom:1px solid #eee;padding:14px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;max-width:1100px;margin:0 auto}
.sitebar .brand{display:inline-flex;align-items:center;text-decoration:none;color:var(--fg)}
.sitebar .marca{font-weight:700;font-size:1.15rem;letter-spacing:-.01em}
.sitebar .logo{display:block}
.nav{display:flex;gap:6px 18px;flex-wrap:wrap;margin-left:auto;font-size:.95rem}
.nav a{text-decoration:none;color:var(--muted);padding:4px 2px;border-bottom:2px solid transparent;max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nav a:hover{color:var(--fg)}
.nav a.activo{color:var(--fg);border-bottom-color:var(--accent);font-weight:600}
.indice{padding:8px 0 32px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-top:8px}
.card{display:block;text-decoration:none;color:var(--fg);border:1px solid #e7e5e0;border-radius:12px;padding:20px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px)}
.card h3{margin:0;font-size:1.1rem;letter-spacing:-.01em}
.carta{padding:24px 0;border-bottom:1px solid #f0f0f0}
.carta .items{list-style:none;margin:0;padding:0}
.carta li{padding:10px 0;border-bottom:1px solid #f5f4f2}
.carta .fila{display:flex;justify-content:space-between;gap:16px;align-items:baseline}
.carta .nombre{font-weight:600}
.carta .precio{color:var(--accent);font-weight:600;white-space:nowrap}
.carta .desc{margin:4px 0 0;color:var(--muted);font-size:.95rem}
main{max-width:760px;margin:0 auto;padding:0 20px}
.hero{padding:48px 0 40px;border-bottom:1px solid #eee}
.hero.has-img{padding-top:24px}
.hero-img{width:100%;border-radius:14px;margin:0 0 28px;object-fit:cover;aspect-ratio:16/9}
.hero h1{font-size:2.3rem;line-height:1.12;margin:0 0 12px;letter-spacing:-.02em}
.lede{font-size:1.18rem;color:var(--muted);margin:0 0 24px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
section{padding:32px 0;border-bottom:1px solid #f0f0f0}
section h2{font-size:1.45rem;margin:0 0 12px;letter-spacing:-.01em}
.section-img{width:100%;border-radius:12px;margin:0 0 18px;object-fit:cover;aspect-ratio:3/2}
.pending{color:var(--muted);font-style:italic}
.faq{background:var(--soft);border-radius:12px;padding:24px;margin:32px 0}
details{padding:12px 0;border-bottom:1px solid #e7e5e0}
summary{font-weight:600;cursor:pointer}
footer{max-width:760px;margin:40px auto 48px;padding:24px 20px 0;border-top:1px solid #eee;color:var(--fg)}
footer h2{font-size:1.15rem;margin:0 0 10px}
footer h3{font-size:.95rem;margin:0 0 4px;color:var(--fg)}
footer p{margin:0 0 6px}
footer .local{margin:0 0 16px;color:var(--muted)}
footer .ubicaciones{border:0;padding:16px 0 0}
footer .contacto{border:0;padding:0}
footer .tecnica{color:var(--muted);font-size:.85rem;margin-top:20px}
footer .mas{margin-top:12px}
@media(prefers-color-scheme:dark){:root{--fg:#e8e8e8;--muted:#9aa0aa;--bg:#111;--soft:#1b1b1b}body{background:var(--bg)}.sitebar,.hero,footer{border-color:#222}section{border-color:#1e1e1e}.card{border-color:#2a2a2a}}
`;

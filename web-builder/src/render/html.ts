import type { BusinessProfile, NavItem, Story, Vertical } from "../types.js";
import { imagenPublicable } from "./imagenes.js";
import { catalogoLd, homeLd, jsonLd, menuLd, researchTrace } from "./json-ld.js";
import {
  SLUG_BLOG,
  SLUG_HOME,
  agruparCarta,
  catalogoSlug,
  resolveCanonical,
  urlDeSeccion,
} from "./lib.js";
import type { CtxPieza } from "./piezas/tipos.js";
import { juegoDe } from "./plantilla.js";
import { renderDocumento } from "./shell.js";

/**
 * Render AI-search-first (ADR-04): HTML semántico + JSON-LD por tipo de página.
 * Página autocontenida (CSS inline, sin dependencias externas).
 *
 * **Este archivo es la frontera pública del render y su firma no cambia**: `renderer/` importa estas
 * cuatro funciones por nombre de paquete, y lo que sale de acá se sirve a internet anónimo. Desde la
 * entrega 2 de la spec de plantillas de landing son **cuatro llamadas al mismo ensamblador**
 * (`shell.ts`) con distinta receta de contenido (`plantilla.ts`); el HTML lo producen las piezas
 * (`piezas/`) y el CSS se ensambla con las que dibujaron algo (`css.ts`).
 *
 * Antes cada una repetía su propio `<!doctype>`, `<head>`, `<style>` y footer: cuatro copias de la
 * misma estructura, que es la razón por la que el bug del modo oscuro sobrevivió —había que
 * arreglarlo cuatro veces— y por la que el contacto existía en la landing y no en la home.
 */

/**
 * El contexto que reciben las piezas, con los huecos de las páginas sintetizadas ya rellenos.
 *
 * **Sin `presupuestoImagenes` ni `presupuestoVideos`**: esos los crea `renderDocumento`, uno por
 * documento. Acá ni se nombran, y el tipo de `Documento.ctx` lo impide — ver el `Omit` en `shell.ts`.
 */
type CtxDeEntrada = Omit<CtxPieza, "presupuestoImagenes" | "presupuestoVideos">;

function ctx(
  over: Partial<CtxDeEntrada> & Pick<CtxDeEntrada, "activeSlug" | "vertical">,
): CtxDeEntrada {
  return {
    story: null,
    profile: null,
    titulo: "",
    bajada: "",
    paginas: [],
    ...over,
  };
}

/**
 * Una landing de research: viene de una story de Storyblok, aprobada en la compuerta humana.
 *
 * `profile` (opcional): datos NAP del negocio → enriquecen JSON-LD y agregan contacto.
 */
export function renderStory(
  story: Story,
  profile: BusinessProfile | null | undefined,
  vertical: Vertical,
  languageCode = "es",
  hayBlog = false,
): string {
  const c = story.content;
  const url = resolveCanonical(c.seo.canonical, profile);
  // `og:image` es el TERCER camino de una URL de la ficha al HTML, después de `renderImagen` y del
  // logo. No lo carga el visitante sino el crawler de la red social, pero es https obligatorio y sale
  // de la ficha igual: pasa por la misma puerta. Ver `imagenPublicable`.
  const ogImage = imagenPublicable(profile?.image);

  return renderDocumento({
    cabeza: {
      lang: languageCode,
      title: c.seo.title,
      description: c.seo.description,
      canonical: url,
      ogTitle: c.seo.og_title,
      ogDescription: c.seo.og_description,
      ...(ogImage ? { ogImage } : {}),
      jsonLd: jsonLd(c, url, profile),
      trace: researchTrace(c),
    },
    receta: juegoDe(vertical).story,
    ctx: ctx({ story, profile: profile ?? null, activeSlug: story.slug, vertical }),
    pie: { contractVersion: c.meta.contract_version, schemaType: c.schema_type, hayBlog },
  });
}

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
  profile: BusinessProfile | null | undefined,
  nav: NavItem[] = [],
  vertical: Vertical,
  languageCode = "es",
  hayBlog = false,
): string {
  const nombre = profile?.name ?? "Inicio";
  const url = profile?.url ? profile.url.replace(/\/+$/, "") + "/" : "/";
  const descripcion = profile
    ? `${profile.name}${profile.address ? ` · ${profile.address.addressLocality}` : ""}`
    : "";
  const ogImage = imagenPublicable(profile?.image); // ver `renderStory`: el tercer camino al HTML.

  return renderDocumento({
    cabeza: {
      lang: languageCode,
      title: nombre,
      description: descripcion,
      canonical: url,
      ogTitle: nombre,
      ...(ogImage ? { ogImage } : {}),
      jsonLd: homeLd(profile, url),
    },
    receta: juegoDe(vertical).home,
    ctx: ctx({
      profile: profile ?? null,
      activeSlug: SLUG_HOME,
      titulo: nombre,
      bajada: descripcion,
      paginas: nav,
      vertical,
    }),
    pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog },
  });
}

/**
 * La página de catálogo: `/menu` (restauración) o `/polizas` (correduría de seguros).
 *
 * **Sintetizada, igual que la home**: sale del perfil, no de una story ni del LLM. Un catálogo es una
 * lista de producto/oferta — no hay nada que "redactar", y generarlo por IA metería una fuente más de
 * contenido que revisar en la compuerta humana (ADR-06). Si el cliente crea su propia story en ese
 * slug en Storyblok, esa gana: el renderizador la sirve y esta función no se invoca.
 */
export function renderCatalogo(
  profile: BusinessProfile | null | undefined,
  vertical: Vertical,
  languageCode = "es",
  hayBlog = false,
): string {
  const nombre = profile?.name ?? "Catálogo";
  const items = profile?.menu ?? [];
  const slug = catalogoSlug(vertical);
  const url = urlDeSeccion(profile, slug);
  const esRestauracion = vertical === "restauracion";
  const titulo = esRestauracion ? `Menú · ${nombre}` : `Pólizas y coberturas · ${nombre}`;
  const descripcion = esRestauracion ? `La carta de ${nombre}.` : `Los seguros que ofrece ${nombre}.`;

  return renderDocumento({
    cabeza: {
      lang: languageCode,
      title: titulo,
      description: descripcion,
      canonical: url,
      ogTitle: titulo,
      // Sin ítems no hay catálogo que declarar: un JSON-LD con listas vacías le diría a Google que
      // este negocio no tiene nada que ofrecer, que es peor que no decir nada.
      ...(items.length && profile
        ? {
            jsonLd: esRestauracion
              ? menuLd(profile, url, agruparCarta(items))
              : catalogoLd(profile, url, agruparCarta(items)),
          }
        : {}),
    },
    receta: juegoDe(vertical).menu,
    ctx: ctx({ profile: profile ?? null, activeSlug: slug, titulo, vertical }),
    pie: {
      contractVersion: "web.v0.1",
      schemaType: esRestauracion ? "Menu" : "ItemList",
      hayBlog,
    },
  });
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
  vertical: Vertical,
  languageCode = "es",
): string {
  const nombre = profile?.name ?? "Blog";
  const titulo = `Blog · ${nombre}`;
  const url = urlDeSeccion(profile, SLUG_BLOG);

  return renderDocumento({
    cabeza: {
      lang: languageCode,
      title: titulo,
      description: `Artículos de ${nombre}.`,
      canonical: url,
      ogTitle: titulo,
    },
    receta: juegoDe(vertical).blog,
    ctx: ctx({ profile: profile ?? null, activeSlug: SLUG_BLOG, titulo, paginas: posts, vertical }),
    // `hayBlog: false` a propósito: el pie de /blog no se autoenlaza.
    pie: { contractVersion: "web.v0.1", schemaType: "WebPage", hayBlog: false },
  });
}

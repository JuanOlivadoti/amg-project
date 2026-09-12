import type { Sitio } from "db";
import { catalogoSlug, renderBlogIndex, renderCatalogo, renderHome, renderStory } from "web-builder";
import type { NavItem, Story } from "web-builder";
import { perfilValido } from "./perfil.js";

/**
 * **Qué HTML le corresponde a un slug.** La decisión, separada de cómo se consiguen los ingredientes.
 *
 * ## Por qué existe este archivo
 *
 * Vivía dentro del handler de `app.ts` como una función anidada (`traer()`), y ahí estaba bien
 * mientras el sitio vivo era el único consumidor. Dejó de estarlo con el **snapshot estático**
 * (ADR-11, `snapshot.ts`): el entregable de un cliente que se da de baja tiene que ser *su web*, no
 * *una versión de su web*. Una segunda implementación de "cuándo hay `/menu`", "cuándo hay `/blog`" o
 * "qué índice lleva la home" se desincroniza en la primera regla nueva, y el síntoma sería que el
 * snapshot se ve distinto del sitio que el cliente estuvo pagando — sin error y sin log.
 *
 * Así que la decisión vive acá y la comparten los dos. Lo que **no** entra: cachear, coalescer,
 * pedirle nada a nadie, ni el Bridge del preview. Esta función es pura — recibe los ingredientes ya
 * traídos y devuelve HTML o `null`.
 *
 * `null` significa **"no está"** (404 legítimo), nunca "falló": quien llama distingue las dos cosas
 * (ver el `catch` de `app.ts`, que responde 503 y **no** cachea).
 */

/** El slug que se sirve cuando alguien entra a la raíz del dominio. */
export const SLUG_HOME = "home";

/**
 * El otro slug fijo que el renderizador sabe sintetizar. Una story real con ese slug siempre gana.
 *
 * El de catálogo NO es fijo: varía por vertical (`catalogoSlug(sitio.vertical)` — "menu" para
 * restauración, "polizas" para correduría de seguros), así que no tiene una constante acá.
 */
export const SLUG_BLOG = "blog";

export interface EntradaPagina {
  slug: string;
  /** La story publicada de ese slug, o `null` si en el space no existe. */
  story: Story | null;
  /** Las páginas publicadas del space (Links API). Degrada a `[]`: es una mejora, no un requisito. */
  nav: NavItem[];
  /** Los artículos del space. Degrada a `[]` por lo mismo. */
  blog: NavItem[];
  sitio: Sitio;
}

/**
 * Story → landing; y si no hay story, las **tres páginas sintetizadas** (home, catálogo, blog).
 * Cualquier otro slug sin story es un 404 legítimo → `null`.
 */
export function renderPagina({ slug, story, nav, blog, sitio }: EntradaPagina): string | null {
  const perfil = perfilValido(sitio.businessProfile);
  const hayBlog = blog.length > 0;

  if (story) {
    // No autoenlazar `/blog` cuando la story que se está sirviendo ES `/blog`: el fix anterior
    // solo cubrió `renderBlogIndex` (la síntesis) — una story REAL con ese slug se sirve por
    // acá, y sin este chequeo no sabía que el slug activo ya es el destino del enlace.
    const blogAquí = slug === SLUG_BLOG;
    return renderStory(story, perfil, sitio.vertical, sitio.languageCode, hayBlog && !blogAquí);
  }

  const slugCatalogo = catalogoSlug(sitio.vertical);
  if (slug === SLUG_HOME) {
    // El índice de la home son las landings de research: la home no se lista a sí misma, y los
    // artículos viven en /blog (si estuvieran también acá, cada post aparecería dos veces).
    const slugsBlog = new Set(blog.map((b) => b.slug));
    const indice = nav.filter(
      (n) => n.slug !== SLUG_HOME && n.slug !== SLUG_BLOG && n.slug !== slugCatalogo && !slugsBlog.has(n.slug),
    );
    return renderHome(perfil, indice, sitio.vertical, sitio.languageCode, hayBlog);
  }
  if (slug === slugCatalogo && perfil?.menu?.length) {
    return renderCatalogo(perfil, sitio.vertical, sitio.languageCode, hayBlog);
  }
  if (slug === SLUG_BLOG && hayBlog) {
    return renderBlogIndex(perfil, blog, sitio.vertical, sitio.languageCode);
  }
  return null;
}

/**
 * **Qué páginas tiene un sitio**, en el orden en que se recorren.
 *
 * Es la misma pregunta que el sitio vivo contesta *por petición* —"¿este slug da algo?"— hecha de
 * una vez para el conjunto. La usa el snapshot; el servicio no la necesita porque nunca enumera.
 *
 * Sale de las mismas fuentes que el render: la home siempre (la sintetiza `renderPagina` si no hay
 * story), cada página publicada del space (`nav`, que la Links API ya devuelve sin carpetas), cada
 * artículo (`blog`), y los dos slugs sintéticos —catálogo y `/blog`— que solo existen si hay carta o
 * hay artículos. Sin duplicados y con `home` primero.
 */
export function slugsDelSitio(sitio: Sitio, nav: NavItem[], blog: NavItem[]): string[] {
  const perfil = perfilValido(sitio.businessProfile);
  const slugs = new Set<string>([SLUG_HOME]);

  for (const n of nav) slugs.add(n.slug);
  for (const b of blog) slugs.add(b.slug);
  if (perfil?.menu?.length) slugs.add(catalogoSlug(sitio.vertical));
  if (blog.length > 0) slugs.add(SLUG_BLOG);

  return [...slugs];
}

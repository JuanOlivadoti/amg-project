import type { BlogPublisher, CredencialesBlogExterno } from "./publisher.js";

/**
 * No sale del proceso — mismo criterio que `MockPublisher` de web-builder (Storyblok). Devuelve una
 * URL determinística a partir del slug. `identificadorExterno` no se usa acá (no hay estado real que
 * deduplicar en un mock) — una implementación real SÍ tiene que usarlo, ver `BlogPublisher`.
 */
export class MockBlogPublisher implements BlogPublisher {
  async publicar(
    post: { titulo: string; cuerpo: string; slug: string },
    _identificadorExterno: string,
    credenciales: CredencialesBlogExterno,
  ): Promise<{ url: string; publicado: boolean }> {
    // Normaliza LOS DOS bordes: la barra final de la URL base y la barra inicial del slug (los
    // slugs reales de kr_pages empiezan con "/", ver url_slug) -- sin esto, el resultado real
    // hubiera sido "https://blog.cliente.com//mejores-tacos".
    const base = credenciales.url.replace(/\/$/, "");
    const slug = post.slug.replace(/^\//, "");
    return { url: `${base}/${slug}`, publicado: true };
  }
}

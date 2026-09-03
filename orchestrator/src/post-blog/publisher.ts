export interface CredencialesBlogExterno {
  // Etiqueta informativa (ENMENDADO 2026-08-31): no hay integración real todavía, así que "tipo" no
  // gobierna ninguna lógica de `MockBlogPublisher` -- es solo lo que el staff configuró para
  // recordar dónde va cada cliente. Cuando se construya una implementación real de un tipo concreto
  // (ej. WordPressPublisher), ESE publisher es quien decide si el "tipo" que le llega es el suyo.
  tipo: string;
  url: string;
  credencial: string;
}

export interface BlogPublisher {
  publicar(
    post: { titulo: string; cuerpo: string; slug: string },
    // Clave de idempotencia — siempre el pageId de kr_pages. Una implementación real DEBE usarla
    // para no duplicar en un reintento: buscar un post existente marcado con este identificador
    // antes de crear uno nuevo (ver la spec, "Idempotencia de la publicación").
    identificadorExterno: string,
    credenciales: CredencialesBlogExterno,
  ): Promise<{ url: string; publicado: boolean }>;
}

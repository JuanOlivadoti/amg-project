import sanitizeHtml from "sanitize-html";

/**
 * Allowlist mínimo para el cuerpo de un post de blog: párrafos, énfasis, listas, subtítulos y
 * enlaces http(s). Sin `img` a propósito (YAGNI — se agrega cuando un caso real lo necesite, no
 * antes). Cualquier tag/atributo fuera de esta lista se descarta; el texto de adentro se conserva.
 */
const OPCIONES: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "em", "b", "i", "u", "h2", "h3", "h4", "ul", "ol", "li", "blockquote", "a"],
  allowedAttributes: { a: ["href"] },
  // Enlaces http(s) y relativos (sin esquema) permitidos; protocol-relative (`//host`) rechazados
  // explícitamente -- `allowedSchemes` por sí solo NO cubre eso (Codex, ronda 1 sobre el plan,
  // hallazgo Minor: "enlaces http(s)" era más estricto que lo que esta config imponía de verdad).
  allowedSchemes: ["http", "https"],
  allowProtocolRelative: false,
};

/**
 * Sanitiza HTML por allowlist (ADR-19: todo valor que termina en HTML es superficie de inyección).
 * Se llama en los DOS puntos donde `kr_pages.post_cuerpo` cambia — `guardarPost` (después del LLM) y
 * `editarPost` (después de un humano) — nunca se persiste sin pasar por acá.
 */
export function sanitizarHtml(html: string): string {
  return sanitizeHtml(html, OPCIONES);
}

import { createHash } from "node:crypto";

/**
 * `_uid` DETERMINISTA para los bloks de Storyblok (#12 review Codex).
 *
 * Antes se usaba `randomUUID()`: cada publicación regeneraba TODOS los `_uid`, aunque el
 * contenido no hubiera cambiado. Consecuencias: Storyblok ve bloks completamente nuevos en cada
 * update → se pierde la identidad estable (historial, comentarios, estado de plugins del editor)
 * y los diffs son ruido puro.
 *
 * Ahora el `_uid` se deriva de una **clave estable ligada a la identidad del contenido**
 * (slug de la página + tipo de blok + su identificador natural: el heading de la sección, la
 * pregunta de la FAQ). Mismo blok → mismo `_uid` entre corridas. Si cambia el heading, es
 * conceptualmente otro blok y le corresponde otro `_uid`.
 *
 * Formato: UUID v5-like (SHA-1 truncado con los bits de versión/variante correctos), que es lo
 * que Storyblok espera.
 */
export function stableUid(...parts: string[]): string {
  const h = createHash("sha1").update(parts.join("::")).digest("hex");
  const version = `5${h.slice(13, 16)}`; // nibble de versión = 5
  const variantNibble = ((parseInt(h.slice(16, 17), 16) & 0x3) | 0x8).toString(16); // RFC-4122
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    version,
    `${variantNibble}${h.slice(17, 20)}`,
    h.slice(20, 32),
  ].join("-");
}

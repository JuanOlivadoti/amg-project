/**
 * Clave canónica para matchear una keyword entre proveedores (DataForSEO, LLM) y el pipeline.
 * Distintas fuentes devuelven la misma keyword con casing, espacios o forma Unicode diferentes
 * ("Pizza  Napolitana" vs "pizza napolitana"); sin normalizar, el lookup falla y la métrica se
 * pierde en silencio (#7 review Codex). Se usa SOLO como clave de mapa; el texto original se
 * preserva para mostrar.
 */
export function canonicalKey(s: string): string {
  return s.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

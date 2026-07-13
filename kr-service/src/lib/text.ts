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

/**
 * Deduplica keywords por su clave canónica, conservando la primera grafía vista.
 *
 * Un `Set` de strings crudos NO alcanza: "pasta fresca Madrid" y "pasta fresca madrid" son la
 * misma keyword para Google, pero el Set las guarda como dos. Y a DataForSEO se le paga POR
 * KEYWORD, así que cada duplicado es dinero tirado, además de ensuciar los clusters con miembros
 * redundantes. Detectado en la primera corrida real: 4 de 60 keywords eran duplicados de casing.
 */
export function dedupeByCanonical(keywords: string[]): string[] {
  const seen = new Map<string, string>();
  for (const k of keywords) {
    const key = canonicalKey(k);
    if (key && !seen.has(key)) seen.set(key, k);
  }
  return [...seen.values()];
}

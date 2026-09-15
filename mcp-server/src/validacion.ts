/**
 * Mismo patrón que `api/src/auth.ts:UUID` — no se importa desde ahí porque `mcp-server` no depende
 * de `api/` como paquete (spec §1). Es una constante de 5 líneas; duplicarla es más barato y más
 * seguro que abrir un import cruzado entre dos paquetes que el diseño mantiene separados a propósito.
 */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La barrera contra la clase de error que el spec nombra explícitamente (§3.4): elegir un cliente o
 * un run por nombre desde un chat. Toda tool de escritura, y toda tool que recibe un id como
 * argumento, valida con esto ANTES de llamar a la API.
 */
export function esUuid(v: string): boolean {
  return UUID_RE.test(v);
}

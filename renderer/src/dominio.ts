/**
 * De la cabecera `Host` a un dominio canónico. Es lo primero que toca una petición anónima, así que
 * es la primera cosa que un atacante controla por completo.
 *
 * ## Lo que hay que tener presente
 *
 * `Host` lo escribe el cliente. No es un dato de confianza en ningún sentido —lo único que hace
 * legítimo usarlo como clave es que **una respuesta equivocada solo puede mostrar contenido que ya
 * es público**, y que el `null` de aquí termina en un 404 sin explicación (ver `sitios.ts`).
 *
 * Lo que NO puede pasar es que dos formas distintas del mismo host devuelvan resultados distintos,
 * ni que un host raro se cuele hasta la query. Por eso esto normaliza y valida ANTES de la base,
 * y la base además tiene un `check` que exige la forma canónica: si un día alguien inserta un
 * dominio a mano en mayúsculas, la fila es inalcanzable, no ambigua.
 */

/** El largo máximo de un nombre de dominio (RFC 1035). No es cosmético: acota lo que llega al `where`. */
const LARGO_MAX = 253;

/**
 * Etiquetas alfanuméricas con guiones internos, separadas por puntos, al menos dos.
 *
 * Deliberadamente estrecho: no acepta IDN en crudo (tiene que venir ya en punycode `xn--`, que
 * encaja acá porque es ASCII), ni IPs, ni `localhost` a secas. Un dominio de cliente es un nombre
 * comprado; nada de lo otro lo es.
 */
const DOMINIO = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * `null` = no es un host servible. El llamador responde 404, nunca un fallback.
 *
 * **No hay dominio por defecto y no puede haberlo.** Un "si no reconozco el host, sirvo el primer
 * cliente" convierte cualquier dominio apuntado a nuestra IP en una copia de la web de un cliente
 * ajeno — contenido duplicado que Google penaliza, y en el peor caso el sitio de un restaurante
 * servido bajo un dominio que no controla.
 */
export function normalizarHost(host: string | null | undefined): string | null {
  if (!host) return null;

  let h = host.trim().toLowerCase();

  // El puerto no es parte de la identidad del sitio: `bella.es` y `bella.es:443` son el mismo.
  // Se corta por el ÚLTIMO `:` para no destrozar un `[::1]:3000`, que igual va a caer en el regex.
  const dosPuntos = h.lastIndexOf(":");
  if (dosPuntos > -1 && !h.endsWith("]")) h = h.slice(0, dosPuntos);

  // Un FQDN con punto final (`bella.es.`) es el mismo host y algunos clientes lo mandan así.
  if (h.endsWith(".")) h = h.slice(0, -1);

  if (h.length === 0 || h.length > LARGO_MAX) return null;
  if (!DOMINIO.test(h)) return null;

  // El TLD no puede ser numérico. Sin esto, `127.0.0.1` pasa: los dígitos son válidos dentro de una
  // etiqueta, y "cuatro etiquetas separadas por puntos" describe igual de bien a una IPv4 que a un
  // dominio. Aceptar una IP haría que el sitio fuera alcanzable por una vía que nadie compró y que
  // no aparece en ninguna fila de `clients` — pero el punto no es que fallaría, es que el conjunto
  // de hosts servibles tiene que ser el que yo pueda enunciar.
  const tld = h.slice(h.lastIndexOf(".") + 1);
  if (!/[a-z]/.test(tld)) return null;

  return h;
}

/**
 * De dónde sacar el host, según si hay un proxy delante.
 *
 * `X-Forwarded-Host` lo pone el proxy, pero **también puede ponerlo cualquiera** si llega directo
 * al servicio. Confiarlo siempre sería regalar la elección del sitio a quien pida; ignorarlo
 * siempre rompería detrás de un balanceador. Así que es una decisión de despliegue explícita
 * (`TRUST_PROXY`), y el default es NO confiar: si me equivoco, que sea del lado de romper.
 */
export function hostDeLaPeticion(
  headers: { get(nombre: string): string | null },
  confiarEnProxy = false,
): string | null {
  if (confiarEnProxy) {
    // Puede venir encadenado (`a.com, b.com`): el primero es el que vio el cliente.
    const reenviado = headers.get("x-forwarded-host")?.split(",")[0];
    const h = normalizarHost(reenviado);
    if (h) return h;
  }
  return normalizarHost(headers.get("host"));
}

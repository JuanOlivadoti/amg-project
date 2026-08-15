/**
 * **La política de video**, calcada de la §Política de imágenes (`imagenes.ts`) — ver ese archivo
 * para el razonamiento completo de cada regla, que acá no se repite.
 *
 * Un `<video>` es el mismo vector que un `<img>`: una petición que el navegador del visitante hace
 * solo, y el host que la recibe se lleva su IP, su user-agent y el patrón de tráfico de esa visita.
 * La pregunta que gobierna el diseño es la misma: *si me lo toman, ¿qué se llevan?*.
 */

/**
 * Los hosts de video permitidos. **Comparación exacta**, nunca `endsWith`/`includes` — mismo criterio
 * y misma trampa que `HOSTS_DE_ASSETS` en `imagenes.ts`.
 *
 * Hoy solo `a.storyblok.com`, la misma allowlist que las fotos: es el host que sirve el space real.
 * Si Storyblok terminara sirviendo video desde un host distinto, ampliar esta lista es un cambio de
 * código revisado — exactamente lo que la distingue de un campo de la ficha.
 */
export const HOSTS_DE_VIDEO: ReadonlySet<string> = new Set(["a.storyblok.com"]);

/**
 * Tope de videos por documento. Mucho más bajo que el de imágenes (60): un video pesa órdenes de
 * magnitud más que una foto, y no hay motivo para que una carta entera tenga video en cada plato.
 * Default de PRODUCCIÓN: lo fija un test (`videos.test.ts`), no quien renderiza.
 */
export const MAX_VIDEOS_POR_DOCUMENTO = 10;

/**
 * El presupuesto de videos de **UN** documento. Mismo criterio que `PresupuestoImagenes`: mutable,
 * uno por documento, nunca una constante de módulo — el renderizador es un proceso largo que atiende
 * a todos los clientes.
 */
export interface PresupuestoVideos {
  restantes: number;
}

export function nuevoPresupuestoVideos(): PresupuestoVideos {
  return { restantes: MAX_VIDEOS_POR_DOCUMENTO };
}

/** `false` = no queda cupo. Se llama solo cuando el video se va a emitir de verdad — una URL
 *  rechazada por la allowlist no gasta cupo (mismo criterio que `consumirCupo`). */
export function consumirCupoVideo(p: PresupuestoVideos): boolean {
  if (p.restantes <= 0) return false;
  p.restantes--;
  return true;
}

/** ¿Puede esta `src` llegar a un `<video src>` que se sirve a internet anónimo? Exige https y host de
 *  la allowlist — misma implementación que `fuentePermitida`, duplicada a propósito: una imagen y un
 *  video son políticas independientes aunque hoy compartan la lista de hosts, y fusionarlas ataría el
 *  día que dejen de coincidir. */
export function fuenteVideoPermitida(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return HOSTS_DE_VIDEO.has(url.hostname.toLowerCase());
}

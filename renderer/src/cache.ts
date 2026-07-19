/**
 * Cache de páginas renderizadas. Es lo que sostiene la decisión de ADR-19 de renderizar en runtime:
 * sin esto, cada visita golpea la Content Delivery API y "en vivo" significa lento y caro.
 *
 * ## Qué es esto y qué NO es
 *
 * Es una cache **en proceso**, con TTL, tope de entradas e invalidación por webhook. ADR-19 habla de
 * "cache en el borde", y quiero ser explícito en vez de dejar que el ADR se lea como si estuviera
 * hecho: **el borde es una decisión de despliegue (una CDN delante), no código de este repositorio**.
 * Esta capa es la que hace que el origen no se derrita; la CDN es la que hace que el origen ni se
 * entere. Las dos hacen falta y solo una está acá.
 *
 * La consecuencia práctica, dicha antes de que la descubra alguien en producción: con N instancias
 * del renderizador hay N caches, y un webhook llega a UNA. Ver el comentario de `invalidarSpace()`.
 *
 * ## Por qué la clave incluye el space y no solo el slug
 *
 * `/menu` y `/contacto` son los slugs de TODOS los restaurantes. Una cache indexada por slug serviría
 * el menú de un cliente bajo el dominio de otro — que es, exactamente, el bug que la migración 0006
 * arregló del lado de la escritura. La misma colisión, del lado de la lectura.
 */

export interface EntradaCache {
  html: string;
  expiraEn: number;
}

export interface OpcionesCache {
  /** Cuánto vive una página sin que nadie la invalide. Default 5 min. */
  ttlMs?: number;
  /** Tope de entradas: una cache sin tope es una fuga de memoria con buena prensa. Default 500. */
  maxEntradas?: number;
  /** Reloj inyectable — el TTL se prueba sin esperar cinco minutos. */
  ahora?: () => number;
}

export class CacheRender {
  private readonly entradas = new Map<string, EntradaCache>();
  private readonly ttlMs: number;
  private readonly maxEntradas: number;
  private readonly ahora: () => number;

  constructor(opts: OpcionesCache = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxEntradas = opts.maxEntradas ?? 500;
    this.ahora = opts.ahora ?? Date.now;
  }

  private static clave(spaceId: string, slug: string): string {
    return `${spaceId} ${slug}`;
  }

  get(spaceId: string, slug: string): string | null {
    const k = CacheRender.clave(spaceId, slug);
    const e = this.entradas.get(k);
    if (!e) return null;

    if (e.expiraEn <= this.ahora()) {
      this.entradas.delete(k);
      return null;
    }

    // Reinsertar mueve la clave al final del orden de iteración del Map: es lo que convierte el
    // desalojo de abajo en LRU en vez de "el más viejo por fecha de entrada".
    this.entradas.delete(k);
    this.entradas.set(k, e);
    return e.html;
  }

  set(spaceId: string, slug: string, html: string): void {
    const k = CacheRender.clave(spaceId, slug);
    this.entradas.delete(k);
    this.entradas.set(k, { html, expiraEn: this.ahora() + this.ttlMs });

    while (this.entradas.size > this.maxEntradas) {
      const masVieja = this.entradas.keys().next();
      if (masVieja.done) break;
      this.entradas.delete(masVieja.value);
    }
  }

  /**
   * Invalida TODO un space. Lo llama el webhook de Storyblok al publicar.
   *
   * **Por qué el space entero y no la story sola.** El webhook trae el id de la story, pero una
   * publicación puede cambiar más de una página: un cambio en el nombre del negocio toca el JSON-LD
   * de todas, y el enlazado interno del brief cruza páginas. Invalidar de más cuesta unos renders;
   * invalidar de menos deja la web mostrando lo viejo, que es justo lo que ADR-19 vino a arreglar.
   *
   * **Lo que esto NO hace, y hay que saberlo antes de escalar:** con varias instancias del
   * renderizador, cada una tiene su cache y el webhook llega a UNA sola. Las demás sirven contenido
   * viejo hasta que venza el TTL. Con una instancia —que es donde arranca esto— no pasa; con dos,
   * el TTL deja de ser una red de seguridad y pasa a ser EL mecanismo. Antes de correr más de una
   * instancia hay que mover esto a una cache compartida o bajar el TTL a sabiendas.
   */
  invalidarSpace(spaceId: string): number {
    const prefijo = `${spaceId} `;
    let n = 0;
    for (const k of [...this.entradas.keys()]) {
      if (k.startsWith(prefijo)) {
        this.entradas.delete(k);
        n++;
      }
    }
    return n;
  }

  get tamano(): number {
    return this.entradas.size;
  }
}

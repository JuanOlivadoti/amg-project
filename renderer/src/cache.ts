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
  bytes: number;
}

export interface OpcionesCache {
  /** Cuánto vive una página sin que nadie la invalide. Default 5 min. */
  ttlMs?: number;
  /** Tope de entradas: una cache sin tope es una fuga de memoria con buena prensa. Default 500. */
  maxEntradas?: number;
  /**
   * Tope de BYTES. Default 64 MB.
   *
   * El tope de entradas no acota la memoria: 500 páginas de 2 MB son 1 GB. Lo que agota el proceso
   * son los bytes, no las claves — y con ADR-19 un proceso agotado son **todas** las webs de cliente
   * caídas a la vez. (10ª review, #2.)
   */
  maxBytes?: number;
  /** Reloj inyectable — el TTL se prueba sin esperar cinco minutos. */
  ahora?: () => number;
}

export class CacheRender {
  private readonly entradas = new Map<string, EntradaCache>();
  private readonly ttlMs: number;
  private readonly maxEntradas: number;
  private readonly maxBytes: number;
  private readonly ahora: () => number;
  private bytesUsados = 0;

  constructor(opts: OpcionesCache = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60_000;
    this.maxEntradas = opts.maxEntradas ?? 500;
    this.maxBytes = opts.maxBytes ?? 64 * 1024 * 1024;
    this.ahora = opts.ahora ?? Date.now;
  }

  /**
   * Clave **inambigua**, con la longitud del space delante.
   *
   * Antes era `${spaceId} ${slug}`, y el espacio **puede aparecer en un slug** — que lo controla
   * quien hace la petición. Con eso, `("11", "1 menu")` y `("11 1", "menu")` daban la misma clave:
   * un cliente sirviendo la página de otro, con la mitad de la clave puesta por el atacante.
   *
   * Prefijar la longitud hace la codificación **inyectiva**: dos pares distintos no pueden producir
   * la misma cadena, sin importar qué caracteres traigan. Es la misma razón por la que el HMAC de
   * `preview.ts` separa sus campos — ambigüedad de concatenación, el mismo error dos veces.
   */
  private static clave(spaceId: string, slug: string): string {
    return `${spaceId.length}:${spaceId}:${slug}`;
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
    const bytes = Buffer.byteLength(html, "utf8");

    // Una página que por sí sola no entra en el tope NO se guarda. Si se guardara, el bucle de
    // desalojo vaciaría la cache entera intentando hacerle lugar a algo que igual no cabe.
    if (bytes > this.maxBytes) return;

    const k = CacheRender.clave(spaceId, slug);
    this.olvidar(k);
    this.entradas.set(k, { html, expiraEn: this.ahora() + this.ttlMs, bytes });
    this.bytesUsados += bytes;

    while (this.entradas.size > this.maxEntradas || this.bytesUsados > this.maxBytes) {
      const masVieja = this.entradas.keys().next();
      if (masVieja.done) break;
      this.olvidar(masVieja.value);
    }
  }

  /** Borra una clave manteniendo el contador de bytes coherente. */
  private olvidar(k: string): boolean {
    const e = this.entradas.get(k);
    if (!e) return false;
    this.bytesUsados -= e.bytes;
    this.entradas.delete(k);
    return true;
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
    // El prefijo lleva la longitud, igual que la clave: así `11` no puede llevarse por delante a
    // `111`, ni un space cuyo id empiece igual que otro.
    const prefijo = `${spaceId.length}:${spaceId}:`;
    let n = 0;
    for (const k of [...this.entradas.keys()]) {
      if (k.startsWith(prefijo) && this.olvidar(k)) n++;
    }
    return n;
  }

  get tamano(): number {
    return this.entradas.size;
  }

  /** Bytes de HTML retenidos. Lo expone `/_health` para poder ver la presión de memoria. */
  get bytes(): number {
    return this.bytesUsados;
  }
}

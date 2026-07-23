import { fromStoryblokContent } from "web-builder";
import type { NavItem, Story } from "web-builder";

/** La story CRUDA de Storyblok: `content` aplanado, con `_uid`/`_editable`. La convierte el CDA. */
interface RawStoryblokStory {
  name?: unknown;
  slug?: unknown;
  content?: Record<string, unknown>;
}

/**
 * Cliente de la **Content Delivery API** de Storyblok. Solo lectura.
 *
 * ⚠️ **No es la Management API, y esa distinción es de seguridad, no de estilo.** La Management API
 * puede modificar y borrar el contenido de un space, y su token es una credencial de escritura. El
 * renderizador —la única pieza expuesta a internet anónimo— **nunca** la toca: publicar es asunto
 * del orquestador (`web-builder/src/publish/`). Si un día alguien "resuelve" un problema acá
 * importando la Management API, el radio de explosión del servicio pasa de *leer lo que ya es
 * público* a *reescribir la web de todos los clientes*.
 */

export const CDA_BASE = "https://api.storyblok.com/v2/cdn";

/** `published` = lo que ve el mundo. `draft` = borradores, SOLO tras validar una firma de preview. */
export type Version = "published" | "draft";

export interface PeticionStory {
  slug: string;
  token: string;
  version: Version;
  /** Rompe la cache de la CDN de Storyblok en preview: un borrador tiene que verse al instante. */
  cacheVersion?: string;
}

/** La navegación se pide con el token del space y una versión; no lleva slug (es el mapa entero). */
export interface PeticionNav {
  token: string;
  version: Version;
  cacheVersion?: string;
}

export interface Cda {
  /** `null` = la story no existe en ese space (404). Cualquier otro fallo LANZA. */
  traerStory(p: PeticionStory): Promise<Story | null>;
  /**
   * La lista de páginas publicadas del space, para armar la navegación. Un fallo LANZA (igual que
   * `traerStory`): quien llama decide si degradar a "sin nav" o propagar. Nunca inventa una lista.
   *
   * **Opcional a propósito.** La nav es una mejora, no parte de servir una página: un `Cda` que no la
   * implemente (o que falle al pedirla) deja el sitio sin barra, no caído. El renderizador lo trata así.
   */
  traerNav?(p: PeticionNav): Promise<NavItem[]>;
}

/** Tope de páginas que se guardan de la Links API. Una nav no necesita más; acota la memoria. */
const MAX_NAV_ITEMS = 50;

/** Un enlace tal como lo emite la Links API de Storyblok (`cdn/links`). Todo es no confiable. */
interface RawLink {
  slug?: unknown;
  name?: unknown;
  is_folder?: unknown;
  is_startpage?: unknown;
  position?: unknown;
}

/**
 * De la respuesta cruda de la Links API a `NavItem[]`.
 *
 * Se descartan las **carpetas** (no son páginas) y la **startpage** (es la home, se llega por el logo,
 * no por la barra). Se ordena por `position` (el orden que fija el editor en Storyblok) y se corta a
 * `MAX_NAV_ITEMS`. Cada `slug`/`name` se valida como string: en PROD esto viene de la red sin Zod.
 */
export function normalizarLinks(links: unknown): NavItem[] {
  if (!links || typeof links !== "object") return [];
  const filas = Object.values(links as Record<string, unknown>)
    .filter((l): l is RawLink => !!l && typeof l === "object")
    .filter((l) => l.is_folder !== true && l.is_startpage !== true)
    .filter((l) => typeof l.slug === "string" && (l.slug as string).length > 0);

  filas.sort((a, b) => posDe(a.position) - posDe(b.position));

  return filas.slice(0, MAX_NAV_ITEMS).map((l) => ({
    slug: l.slug as string,
    // Sin nombre, el slug es un fallback razonable (nunca un enlace sin texto).
    name: typeof l.name === "string" && l.name.length > 0 ? (l.name as string) : (l.slug as string),
  }));
}

function posDe(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** `fetch` inyectable: es lo que permite probar todo esto sin red ni credenciales. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Distingue "no está" de "se rompió". Un 404 es contenido faltante (→ 404 al visitante); un 500 o
 * un timeout es que el ORIGEN falló, y eso no puede convertirse en un 404 cacheado: cachear un
 * "no existe" porque Storyblok tuvo un mal minuto borra la web del cliente hasta que el TTL venza.
 */
export class ErrorCda extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ErrorCda";
  }
}

export interface OpcionesCda {
  fetch?: FetchLike;
  base?: string;
  /**
   * Plazo para la respuesta **COMPLETA**, cuerpo incluido. Default 5 s.
   *
   * El nombre importa porque la versión anterior no cumplía lo que decía: cortaba al recibir los
   * headers y después leía el cuerpo sin plazo. Un origen que manda `200 OK` al instante y deja el
   * body abierto colgaba la petición para siempre (10ª review, #2).
   */
  timeoutMs?: number;
  /** Tope de bytes de la respuesta. Default 4 MB. Una story de un restaurante no llega ni cerca. */
  maxBytes?: number;
}

export class StoryblokCda implements Cda {
  private readonly fetch: FetchLike;
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;

  constructor(opts: OpcionesCda = {}) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.base = opts.base ?? CDA_BASE;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
    this.maxBytes = opts.maxBytes ?? 4 * 1024 * 1024;
  }

  async traerStory({ slug, token, version, cacheVersion }: PeticionStory): Promise<Story | null> {
    // `slug` viene del path de una petición anónima, así que acá se lo trata como dato hostil.
    //
    // Dos pasos, y el segundo NO es redundante: `encodeURIComponent` escapa `?`, `#` y `&` —o sea
    // que un slug no puede inyectar parámetros—, pero **el punto es un carácter no reservado y pasa
    // intacto**. Un segmento `..` sobrevive al escapado y `new URL()` lo colapsa DESPUÉS, comiéndose
    // el `/stories/` de la base: `../../spaces/111` terminaba pegándole a otro endpoint de la API de
    // Storyblok. Lo encontró el test; yo había dado el escapado por suficiente.
    //
    // Por eso los segmentos de navegación se descartan antes de escapar. Un slug de Storyblok nunca
    // es `.` ni `..`, así que no se pierde nada legítimo.
    const ruta = slug
      .split("/")
      .filter((s) => s.length > 0 && s !== "." && s !== "..")
      .map(encodeURIComponent)
      .join("/");

    const url = new URL(`${this.base}/stories/${ruta}`);
    url.searchParams.set("token", token);
    url.searchParams.set("version", version);
    if (cacheVersion) url.searchParams.set("cv", cacheVersion);

    return this.conPlazo(async (signal) => {
      const res = await this.fetch(url.toString(), { signal });

      if (res.status === 404) return null;
      if (!res.ok) {
        // El cuerpo NO se propaga: puede traer el token en un mensaje de error de Storyblok, y de
        // acá el mensaje termina en un log. Lo que hace falta para diagnosticar es el status.
        throw new ErrorCda(`Storyblok respondió ${res.status} para /${slug}`, res.status);
      }

      const cuerpo = (await this.leerAcotado(res)) as { story?: RawStoryblokStory };
      if (!cuerpo.story) return null;

      // **La costura.** Storyblok devuelve el contenido APLANADO (`seo_title`, bloks `faq_item`…),
      // que NO es la forma que consume `renderStory` (`seo` objeto anidado). `fromStoryblokContent`
      // deshace el aplanado. Sin esto, `renderStory` hacía `c.seo.title` con `c.seo` undefined y
      // tiraba un TypeError → 500 → 503. Lo cazó la demo contra el space real (ver web-builder).
      return fromStoryblokContent(cuerpo.story);
    });
  }

  /**
   * La lista de páginas publicadas del space, vía la Links API (`cdn/links`).
   *
   * Mismas defensas que `traerStory`, y no por copiar: la Links API es OTRO vector hacia internet
   * anónimo. `conPlazo` cubre la respuesta completa (un body colgado no cuelga la nav), `leerAcotado`
   * la corta por bytes, y un fallo del origen LANZA (el renderizador degrada a "sin nav", no sirve una
   * nav inventada). Un 404 acá es un space sin páginas → lista vacía, no un error.
   */
  async traerNav({ token, version, cacheVersion }: PeticionNav): Promise<NavItem[]> {
    const url = new URL(`${this.base}/links`);
    url.searchParams.set("token", token);
    url.searchParams.set("version", version);
    if (cacheVersion) url.searchParams.set("cv", cacheVersion);

    return this.conPlazo(async (signal) => {
      const res = await this.fetch(url.toString(), { signal });

      if (res.status === 404) return [];
      if (!res.ok) {
        // El cuerpo NO se propaga: puede traer el token en un mensaje de error de Storyblok.
        throw new ErrorCda(`Storyblok respondió ${res.status} para /links`, res.status);
      }

      const cuerpo = (await this.leerAcotado(res)) as { links?: unknown };
      return normalizarLinks(cuerpo.links);
    });
  }

  /**
   * Corre `fn` con un plazo que cubre **todo** lo que haga, no solo la primera promesa.
   *
   * El `AbortController` se aborta al vencer y el timer se limpia recién en el `finally` de afuera,
   * así que sigue armado mientras se lee el cuerpo. Y como un `signal` abortado no interrumpe un
   * `res.json()` que ya está en curso en todos los runtimes, además se corre contra un
   * `Promise.race`: lo que garantiza el plazo es la carrera, no la señal. La señal es lo que además
   * libera el socket.
   */
  private async conPlazo<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ac = new AbortController();
    let t: NodeJS.Timeout | undefined;

    const vencimiento = new Promise<never>((_, rej) => {
      t = setTimeout(() => {
        ac.abort();
        rej(new ErrorCda(`Storyblok no completó la respuesta en ${this.timeoutMs} ms`, 504));
      }, this.timeoutMs);
    });

    try {
      return await Promise.race([fn(ac.signal), vencimiento]);
    } catch (e) {
      // Un ErrorCda ya viene clasificado (404 ya salió por return, 4xx/5xx del origen, o el 504 de
      // arriba). Lo demás es un fallo de red o un abort: el origen no contestó → 504.
      if (e instanceof ErrorCda) throw e;
      throw new ErrorCda(`Storyblok no respondió: ${(e as Error).message}`, 504);
    } finally {
      clearTimeout(t);
    }
  }

  /**
   * Lee el JSON con tope de bytes.
   *
   * `res.json()` no permite acotar nada: consume lo que venga. Con `body` disponible se lee por
   * chunks y se corta al pasarse; si el runtime no lo expone (o un mock no lo trae), se cae a
   * `json()` y el tope lo aplica el `Promise.race` de arriba por tiempo. Un JSON que excede el tope
   * es **502**: el origen mandó algo que no se puede procesar, y eso no es ni un 404 ni un timeout.
   */
  private async leerAcotado(res: Response): Promise<unknown> {
    const body = res.body as ReadableStream<Uint8Array> | null | undefined;

    if (!body || typeof body.getReader !== "function") {
      const j = (await res.json()) as unknown;
      const bytes = Buffer.byteLength(JSON.stringify(j) ?? "", "utf8");
      if (bytes > this.maxBytes) {
        throw new ErrorCda(`La story excede el tope (${bytes} > ${this.maxBytes} bytes)`, 502);
      }
      return j;
    }

    const reader = body.getReader();
    const trozos: Uint8Array[] = [];
    let total = 0;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > this.maxBytes) {
        await reader.cancel(); // corta la descarga: no se sigue pagando ancho de banda ni memoria
        throw new ErrorCda(`La story excede el tope (> ${this.maxBytes} bytes)`, 502);
      }
      trozos.push(value);
    }

    try {
      return JSON.parse(Buffer.concat(trozos).toString("utf8"));
    } catch {
      throw new ErrorCda("Storyblok devolvió algo que no es JSON", 502);
    }
  }
}

/** CDA en memoria, para tests y para el modo mock (`RENDERER_MOCK=1`). */
export class MockCda implements Cda {
  /** Clave: `${token}:${version}:${slug}`. El token forma parte para que un space no vea otro. */
  private readonly stories = new Map<string, Story>();
  /** Nav por `${token}:${version}`. La deriva de las stories puestas si no se fijó una explícita. */
  private readonly navs = new Map<string, NavItem[]>();
  readonly pedidos: PeticionStory[] = [];
  readonly pedidosNav: PeticionNav[] = [];

  poner(token: string, version: Version, slug: string, story: Story): void {
    this.stories.set(`${token}:${version}:${slug}`, story);
  }

  /** Fija la nav de un space explícitamente (para probar el orden, el escape, el cap…). */
  ponerNav(token: string, version: Version, items: NavItem[]): void {
    this.navs.set(`${token}:${version}`, items);
  }

  async traerStory(p: PeticionStory): Promise<Story | null> {
    this.pedidos.push(p);
    return this.stories.get(`${p.token}:${p.version}:${p.slug}`) ?? null;
  }

  async traerNav(p: PeticionNav): Promise<NavItem[]> {
    this.pedidosNav.push(p);
    const explicita = this.navs.get(`${p.token}:${p.version}`);
    if (explicita) return explicita;
    // Sin nav explícita, se deriva de las stories puestas para ese token+versión (menos la home).
    const prefijo = `${p.token}:${p.version}:`;
    return [...this.stories.entries()]
      .filter(([k]) => k.startsWith(prefijo))
      .map(([k, s]) => ({ slug: k.slice(prefijo.length), name: s.name }))
      .filter((n) => n.slug !== "home");
  }
}

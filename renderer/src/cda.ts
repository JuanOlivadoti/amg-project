import type { Story } from "web-builder";

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

export interface Cda {
  /** `null` = la story no existe en ese space (404). Cualquier otro fallo LANZA. */
  traerStory(p: PeticionStory): Promise<Story | null>;
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
  /** Ni una petición al origen puede colgar al renderizador entero. Default 5 s. */
  timeoutMs?: number;
}

export class StoryblokCda implements Cda {
  private readonly fetch: FetchLike;
  private readonly base: string;
  private readonly timeoutMs: number;

  constructor(opts: OpcionesCda = {}) {
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.base = opts.base ?? CDA_BASE;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
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

    const res = await this.conTimeout(url.toString());

    if (res.status === 404) return null;
    if (!res.ok) {
      // El cuerpo NO se propaga: puede traer el token en un mensaje de error de Storyblok, y de acá
      // el mensaje termina en un log. Lo que hace falta para diagnosticar es el status.
      throw new ErrorCda(`Storyblok respondió ${res.status} para /${slug}`, res.status);
    }

    const cuerpo = (await res.json()) as { story?: Story };
    return cuerpo.story ?? null;
  }

  private async conTimeout(url: string): Promise<Response> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      return await this.fetch(url, { signal: ac.signal });
    } catch (e) {
      // Un abort o un fallo de red son 504: el origen no contestó. NO es un 404.
      throw new ErrorCda(`Storyblok no respondió: ${(e as Error).message}`, 504);
    } finally {
      clearTimeout(t);
    }
  }
}

/** CDA en memoria, para tests y para el modo mock (`RENDERER_MOCK=1`). */
export class MockCda implements Cda {
  /** Clave: `${token}:${version}:${slug}`. El token forma parte para que un space no vea otro. */
  private readonly stories = new Map<string, Story>();
  readonly pedidos: PeticionStory[] = [];

  poner(token: string, version: Version, slug: string, story: Story): void {
    this.stories.set(`${token}:${version}:${slug}`, story);
  }

  async traerStory(p: PeticionStory): Promise<Story | null> {
    this.pedidos.push(p);
    return this.stories.get(`${p.token}:${p.version}:${p.slug}`) ?? null;
  }
}

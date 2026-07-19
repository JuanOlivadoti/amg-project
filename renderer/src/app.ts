import { createHash } from "node:crypto";
import type { SitioResolver, Sitio } from "db";
import { Hono } from "hono";
import type { Context } from "hono";
import { renderStory } from "web-builder";
import { ErrorCda, type Cda } from "./cda.js";
import { CacheRender } from "./cache.js";
import { hostDeLaPeticion } from "./dominio.js";
import { CacheNegativa, Coalescedor, Saturado, Semaforo } from "./limites.js";
import { perfilValido } from "./perfil.js";
import { previewAutorizado, scriptBridge } from "./preview.js";
import { firmaValida, HEADER_FIRMA, parsearEvento } from "./webhook.js";

/**
 * El renderizador público (ADR-19): **1 servicio, N dominios**.
 *
 * Igual que `api/src/app.ts`, esto no sabe de Postgres ni de red: recibe interfaces. Es lo que
 * permite probar el servicio entero —incluido el 404 de un dominio desconocido y el rechazo de un
 * webhook sin firma— sin credenciales y sin salir a internet.
 *
 * ## El orden de las cosas, que acá es la seguridad
 *
 * 1. `Host` → dominio canónico (`dominio.ts`). Si no es un dominio válido, 404 y se acabó.
 * 2. dominio → sitio, **bajo RLS como `app_render`** (`db/src/sitios.ts`). Sin sitio, 404.
 * 3. ¿preview autorizado? Solo entonces se leen borradores.
 * 4. cache → CDA → `renderStory()`.
 *
 * Nada de esto consulta un tenant, porque del otro lado no hay usuario. Ver la migración 0007 para
 * por qué el dominio ES la autorización acá y por qué filtrar por tenant sería teatro.
 */

export interface RendererDeps {
  sitios: SitioResolver;
  cda: Cda;
  cache?: CacheRender;
  /** Secreto del webhook de Storyblok. Sin él, el endpoint de invalidación queda CERRADO. */
  webhookSecret?: string;
  /** Secreto de los enlaces de preview. Sin él, no se sirven borradores. Nunca. */
  previewSecret?: string;
  /** ¿Hay un proxy delante en el que se pueda confiar para `X-Forwarded-Host`? Default `false`. */
  confiarEnProxy?: boolean;
  /** Trabajo externo (Postgres + CDA) simultáneo. Default 64. Pasado el tope: 503, no cola infinita. */
  maxConcurrencia?: number;
  /** Cache de 404s. Inyectable para poder probar su vencimiento sin esperar. */
  cacheNegativa?: CacheNegativa;
  /** Dedupe de entregas repetidas del webhook. `false` lo apaga (tests). */
  dedupeWebhook?: boolean;
}

/** El slug que se sirve cuando alguien entra a la raíz del dominio. */
const SLUG_HOME = "home";

/**
 * Tope del cuerpo del webhook: 256 KB. Un evento de Storyblok pesa menos de 1 KB.
 *
 * Se comprueba **antes** de leerlo, porque verificar la firma exige el cuerpo entero: sin el corte,
 * un anónimo sin el secreto nos hace bufferear lo que quiera y la firma lo rechaza *después*.
 */
const MAX_BODY_WEBHOOK = 256 * 1024;

export function createApp(deps: RendererDeps) {
  const app = new Hono();
  const cache = deps.cache ?? new CacheRender();

  /**
   * Cache de la resolución dominio → sitio.
   *
   * **No es una optimización: es lo que impide que Postgres cuelgue páginas que ya están en
   * memoria.** El orden anterior era `resolver dominio (DB) → mirar cache`, así que una base lenta
   * o un pool agotado dejaba pendiente incluso una página cacheada — y `/_health` seguía
   * respondiendo 200 mientras el servicio no servía nada (10ª review, #4).
   *
   * TTL corto: cambiar el dominio de un cliente o archivarlo tiene que notarse rápido. Un minuto es
   * suficiente para absorber una ráfaga y poco para que un cambio se sienta atascado.
   */
  const sitios = new Map<string, { sitio: Sitio | null; hasta: number }>();
  const TTL_SITIO_MS = 60_000;
  const MAX_SITIOS = 1_000;

  const coalescer = new Coalescedor<string | null>();
  const faltantes = deps.cacheNegativa ?? new CacheNegativa();
  const semaforo = new Semaforo(deps.maxConcurrencia ?? 64);
  /** Entregas del webhook ya vistas, por hash del cuerpo. Ventana de 5 min. */
  const entregas = new CacheNegativa(5 * 60_000, 500);

  async function resolver(dominio: string): Promise<Sitio | null> {
    const guardado = sitios.get(dominio);
    if (guardado && guardado.hasta > Date.now()) return guardado.sitio;

    const sitio = await deps.sitios.porDominio(dominio);

    // Se cachea también el `null`: si no, un dominio inexistente golpea la base en cada petición y
    // enumerar hosts sale gratis del lado del atacante y caro del nuestro.
    sitios.set(dominio, { sitio, hasta: Date.now() + TTL_SITIO_MS });
    while (sitios.size > MAX_SITIOS) {
      const vieja = sitios.keys().next();
      if (vieja.done) break;
      sitios.delete(vieja.value);
    }
    return sitio;
  }

  /**
   * Salud del proceso. **No toca la base ni Storyblok a propósito**: un health check que depende de
   * sus dependencias hace que el orquestador de despliegue mate y reinicie el servicio cuando quien
   * está caído es Storyblok — cambiando una degradación (servir desde cache) por una caída total.
   * Y con ADR-19 eso son TODAS las webs de cliente a la vez.
   *
   * Lo que sí reporta es **presión interna** (bytes, entradas, trabajo en vuelo), que es lo que un
   * operador necesita para saber si el proceso está sano *por dentro* sin preguntarle a nadie.
   */
  app.get("/_health", (c) =>
    c.json({
      ok: true,
      cache: cache.tamano,
      bytes: cache.bytes,
      enVuelo: semaforo.ocupados,
      faltantes: faltantes.tamano,
    }),
  );

  /**
   * Invalidación por webhook. Es lo que convierte "runtime" en algo que no pega contra la CDA en
   * cada visita: se re-renderiza al publicar, no al visitar.
   */
  app.post("/_webhook/storyblok", async (c) => {
    if (!deps.webhookSecret) {
      // Fail-closed. Un webhook sin secreto es un botón público para tirar la cache (ver webhook.ts).
      return c.json({ error: "Webhook no configurado." }, 503);
    }

    // El tope se comprueba ANTES de leer nada. La verificación de firma exige el cuerpo entero, así
    // que sin este corte un anónimo sin el secreto puede hacernos bufferear lo que quiera: la firma
    // lo rechazaría **después** de que ya nos comimos la memoria (10ª review, #3).
    const declarado = Number(c.req.header("content-length") ?? "0");
    if (Number.isFinite(declarado) && declarado > MAX_BODY_WEBHOOK) {
      return c.json({ error: "Cuerpo demasiado grande." }, 413);
    }

    // El cuerpo CRUDO, antes de parsear: la firma cubre estos bytes exactos.
    const body = await c.req.text();

    // Y otra vez tras leerlo: `content-length` lo declara quien pide, y puede mentir o faltar.
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_WEBHOOK) {
      return c.json({ error: "Cuerpo demasiado grande." }, 413);
    }

    if (!firmaValida(body, c.req.header(HEADER_FIRMA), deps.webhookSecret)) {
      return c.json({ error: "Firma inválida." }, 401);
    }

    const evento = parsearEvento(body);
    const spaceId = evento?.space_id;
    if (spaceId === undefined || spaceId === null || `${spaceId}`.length === 0) {
      return c.json({ error: "El evento no dice de qué space es." }, 400);
    }

    // Replay: la firma autentica el CUERPO, y nada más — no lleva timestamp ni id de entrega, así
    // que una petición legítima capturada se puede repetir para siempre sin conocer el secreto.
    // Repetirla es cache busting gratis: invalidar en bucle deja al origen recibiendo cada visita.
    //
    // Se deduplica por hash del cuerpo en una ventana corta. No es una defensa perfecta —quien
    // capture DOS entregas distintas puede alternarlas— pero convierte "infinitas invalidaciones"
    // en "una por ventana", que es la diferencia entre un ataque y una molestia (10ª review, #7).
    if (deps.dedupeWebhook !== false) {
      const huella = createHash("sha256").update(body).digest("hex");
      if (entregas.falta(huella)) {
        return c.json({ ok: true, invalidadas: 0, repetido: true });
      }
      entregas.anotar(huella);
    }

    const invalidadas = cache.invalidarSpace(`${spaceId}`);
    // Un contenido nuevo publicado tiene que poder verse aunque su 404 esté anotado como faltante.
    faltantes.olvidarTodo();
    return c.json({ ok: true, invalidadas });
  });

  /** Todo lo demás es una página de cliente. */
  app.get("/*", async (c) => {
    const dominio = hostDeLaPeticion(
      { get: (n: string) => c.req.header(n) ?? null },
      deps.confiarEnProxy ?? false,
    );
    if (!dominio) return c.text("Not Found", 404);

    const url = new URL(c.req.url);
    const slug = url.pathname.replace(/^\/+|\/+$/g, "") || SLUG_HOME;
    const esPreview = previewAutorizado(deps.previewSecret, dominio, url.searchParams);

    let sitio: Sitio | null;
    try {
      sitio = await resolver(dominio);
    } catch (e) {
      console.error("[renderer] no se pudo resolver el dominio:", (e as Error).message);
      return c.text("Service Unavailable", 503);
    }

    // Las tres razones (no existe / archivado / sin space) dan la MISMA respuesta: un 404 que
    // explica por qué falló convierte esto en un oráculo para enumerar la cartera de la agencia.
    if (!sitio || !sitio.spaceId) return responder404(c);

    const token = esPreview ? sitio.previewToken : sitio.publicToken;
    if (!token) return responder404(c);

    const espacio = sitio.spaceId;

    // El preview NUNCA se cachea: el editor tiene que ver lo que acaba de escribir, y guardar un
    // borrador en la misma cache que sirve al público es cómo un borrador se publica solo.
    if (!esPreview) {
      const guardado = cache.get(espacio, slug);
      if (guardado) {
        cabecerasPublicas(c, "hit");
        return c.html(guardado);
      }
      // Un 404 reciente no vuelve a molestar al origen: enumerar `/a-1`, `/a-2`… deja de amplificar.
      if (faltantes.falta(`${espacio}:${slug}`)) return responder404(c);
    }

    let html: string | null;
    try {
      // Coalescing: N visitas simultáneas al mismo slug frío se convierten en UNA llamada al origen.
      // Y el semáforo acota cuánto trabajo externo puede haber en vuelo a la vez: un pico se rechaza
      // rápido en vez de acumular sockets hasta que el proceso muere (10ª review, #3).
      html = await semaforo.correr(() =>
        // El preview no se coalesce: cada editor tiene que ver SU borrador, no el de otro.
        esPreview ? traer() : coalescer.hacer(`${espacio}:${slug}`, traer),
      );

      async function traer(): Promise<string | null> {
        const story = await deps.cda.traerStory({
          slug,
          token: token as string,
          version: esPreview ? "draft" : "published",
          ...(esPreview ? { cacheVersion: `${Date.now()}` } : {}),
        });
        if (!story) return null;

        const salida = renderStory(story, perfilValido(sitio!.businessProfile), sitio!.languageCode);
        return esPreview ? salida.replace("</body>", `${scriptBridge()}</body>`) : salida;
      }
    } catch (e) {
      if (e instanceof Saturado) {
        console.warn(`[renderer] saturado: ${dominio}/${slug}`);
        c.header("retry-after", "2");
        return c.text("Service Unavailable", 503);
      }
      const status = e instanceof ErrorCda ? e.status : 500;
      console.error(`[renderer] ${dominio}/${slug}: Storyblok falló (${status})`);
      // Un fallo del ORIGEN no es un 404 y no se cachea: cachear "no existe" porque Storyblok tuvo
      // un mal minuto borra la web del cliente hasta que venza el TTL.
      return c.text("Service Unavailable", 503);
    }

    if (html === null) {
      // Esto SÍ es un "no está" del origen, no un fallo: se puede recordar un rato.
      if (!esPreview) faltantes.anotar(`${espacio}:${slug}`);
      return responder404(c);
    }

    if (!esPreview) cache.set(espacio, slug, html);

    if (esPreview) {
      // El preview NO puede terminar en ninguna cache, ni la nuestra ni la de una CDN.
      //
      // `X-Robots-Tag: noindex` evita que se indexe, pero **no** evita que se cachee: una CDN
      // configurada para cachear HTML por host+path —ignorando los parámetros `_amg_*`, que es un
      // default frecuente— guardaría el borrador y se lo serviría a un anónimo. ADR-19 exige
      // precisamente una CDN delante, así que el servicio tiene que decirlo él y no depender de que
      // la configuración externa sea perfecta (10ª review, #5).
      c.header("cache-control", "private, no-store, no-cache, must-revalidate, max-age=0");
      c.header("vary", "*");
      c.header("x-robots-tag", "noindex, nofollow");
      c.header("x-amg-cache", "bypass");
    } else {
      cabecerasPublicas(c, "miss");
    }
    return c.html(html);
  });

  /** Un 404 tampoco debe quedar cacheado en el borde por mucho tiempo. */
  function responder404(c: Context) {
    c.header("cache-control", "public, max-age=30");
    return c.text("Not Found", 404);
  }

  /**
   * Lo público SÍ se cachea, y decirlo explícitamente es la otra mitad de #5: sin `Cache-Control`,
   * cada CDN inventa su propia heurística. Acá se declara la intención una vez.
   */
  function cabecerasPublicas(c: Context, estado: "hit" | "miss") {
    c.header("cache-control", "public, max-age=60, stale-while-revalidate=600");
    c.header("x-amg-cache", estado);
  }

  return app;
}


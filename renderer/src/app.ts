import type { SitioResolver, Sitio } from "db";
import { Hono } from "hono";
import { renderStory } from "web-builder";
import { ErrorCda, type Cda } from "./cda.js";
import { CacheRender } from "./cache.js";
import { hostDeLaPeticion } from "./dominio.js";
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
}

/** El slug que se sirve cuando alguien entra a la raíz del dominio. */
const SLUG_HOME = "home";

export function createApp(deps: RendererDeps) {
  const app = new Hono();
  const cache = deps.cache ?? new CacheRender();

  /**
   * Salud del proceso. **No toca la base ni Storyblok a propósito**: un health check que depende de
   * sus dependencias hace que el orquestador de despliegue mate y reinicie el servicio cuando quien
   * está caído es Storyblok — cambiando una degradación (servir desde cache) por una caída total.
   * Y con ADR-19 eso son TODAS las webs de cliente a la vez.
   */
  app.get("/_health", (c) => c.json({ ok: true, cache: cache.tamano }));

  /**
   * Invalidación por webhook. Es lo que convierte "runtime" en algo que no pega contra la CDA en
   * cada visita: se re-renderiza al publicar, no al visitar.
   */
  app.post("/_webhook/storyblok", async (c) => {
    if (!deps.webhookSecret) {
      // Fail-closed. Un webhook sin secreto es un botón público para tirar la cache (ver webhook.ts).
      return c.json({ error: "Webhook no configurado." }, 503);
    }

    // El cuerpo CRUDO, antes de parsear: la firma cubre estos bytes exactos.
    const body = await c.req.text();

    if (!firmaValida(body, c.req.header(HEADER_FIRMA), deps.webhookSecret)) {
      return c.json({ error: "Firma inválida." }, 401);
    }

    const evento = parsearEvento(body);
    const spaceId = evento?.space_id;
    if (spaceId === undefined || spaceId === null || `${spaceId}`.length === 0) {
      return c.json({ error: "El evento no dice de qué space es." }, 400);
    }

    const invalidadas = cache.invalidarSpace(`${spaceId}`);
    return c.json({ ok: true, invalidadas });
  });

  /** Todo lo demás es una página de cliente. */
  app.get("/*", async (c) => {
    const dominio = hostDeLaPeticion(
      { get: (n: string) => c.req.header(n) ?? null },
      deps.confiarEnProxy ?? false,
    );
    if (!dominio) return c.text("Not Found", 404);

    let sitio: Sitio | null;
    try {
      sitio = await deps.sitios.porDominio(dominio);
    } catch (e) {
      console.error("[renderer] no se pudo resolver el dominio:", (e as Error).message);
      return c.text("Service Unavailable", 503);
    }

    // Las tres razones (no existe / archivado / sin space) dan la MISMA respuesta: un 404 que
    // explica por qué falló convierte esto en un oráculo para enumerar la cartera de la agencia.
    if (!sitio || !sitio.spaceId) return c.text("Not Found", 404);

    const url = new URL(c.req.url);
    const slug = url.pathname.replace(/^\/+|\/+$/g, "") || SLUG_HOME;

    const esPreview = previewAutorizado(deps.previewSecret, dominio, url.searchParams);
    const token = esPreview ? sitio.previewToken : sitio.publicToken;
    if (!token) return c.text("Not Found", 404);

    // El preview NUNCA se cachea: el editor tiene que ver lo que acaba de escribir, y guardar un
    // borrador en la misma cache que sirve al público es cómo un borrador se publica solo.
    if (!esPreview) {
      const guardado = cache.get(sitio.spaceId, slug);
      if (guardado) {
        c.header("x-amg-cache", "hit");
        return c.html(guardado);
      }
    }

    let html: string;
    try {
      const story = await deps.cda.traerStory({
        slug,
        token,
        version: esPreview ? "draft" : "published",
        ...(esPreview ? { cacheVersion: `${Date.now()}` } : {}),
      });
      if (!story) return c.text("Not Found", 404);

      html = renderStory(story, perfilValido(sitio.businessProfile), sitio.languageCode);
      if (esPreview) html = html.replace("</body>", `${scriptBridge()}</body>`);
    } catch (e) {
      const status = e instanceof ErrorCda ? e.status : 500;
      console.error(`[renderer] ${dominio}/${slug}: Storyblok falló (${status})`);
      // Un fallo del ORIGEN no es un 404 y no se cachea: cachear "no existe" porque Storyblok tuvo
      // un mal minuto borra la web del cliente hasta que venza el TTL.
      return c.text("Service Unavailable", 503);
    }

    if (!esPreview) cache.set(sitio.spaceId, slug, html);
    c.header("x-amg-cache", esPreview ? "bypass" : "miss");
    if (esPreview) c.header("x-robots-tag", "noindex"); // un borrador no se indexa
    return c.html(html);
  });

  return app;
}


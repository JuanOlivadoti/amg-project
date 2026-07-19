import { NodePgPool, PgSitios } from "db";
import type { RendererDeps } from "./app.js";
import { CacheRender } from "./cache.js";
import { StoryblokCda } from "./cda.js";

/**
 * El composition root del renderizador: el ÚNICO lugar que toca credenciales y red.
 *
 * Mismo patrón que `api/src/deps.ts`, y por la misma razón: `app.ts` recibe interfaces y no sabe si
 * detrás hay Postgres o un Map. Es lo que permite probar el servicio entero sin credenciales.
 */
export interface ConfigRenderer {
  /** Cadena del login `amg_render`. Ese login SOLO puede asumir `app_render` (0007). */
  databaseUrl: string;
  /** Secreto del webhook de Storyblok. **Obligatorio**: sin él la invalidación queda cerrada. */
  webhookSecret: string;
  /** Secreto de los enlaces de preview. Opcional: sin él, no hay Visual Editor pero la web sirve. */
  previewSecret?: string;
  confiarEnProxy?: boolean;
  cacheTtlMs?: number;
}

/**
 * Lee el entorno y **falla cerrado**.
 *
 * `WEBHOOK_SECRET` es obligatorio aunque el servicio podría arrancar sin él, y la razón es que sin
 * webhook la cache solo caduca por TTL: una edición del cliente tardaría hasta cinco minutos en
 * verse. Eso convierte "el Visual Editor funciona" —la premisa de ADR-04 y el motivo de ADR-19— en
 * algo que *casi* funciona. Prefiero que no arranque a que arranque a medias y nadie lo note.
 */
export function leerConfig(): ConfigRenderer {
  const databaseUrl = process.env["DATABASE_URL_RENDER"];
  const webhookSecret = process.env["STORYBLOK_WEBHOOK_SECRET"];

  const faltan = [
    !databaseUrl && "DATABASE_URL_RENDER (login amg_render → rol app_render)",
    !webhookSecret && "STORYBLOK_WEBHOOK_SECRET (firma del webhook de invalidación)",
  ].filter((x): x is string => Boolean(x));

  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno del renderizador:\n  - ${faltan.join("\n  - ")}`);
  }

  const preview = process.env["PREVIEW_SECRET"]?.trim();
  const ttl = Number(process.env["CACHE_TTL_MS"] ?? "");

  return {
    databaseUrl: databaseUrl as string,
    webhookSecret: webhookSecret as string,
    ...(preview ? { previewSecret: preview } : {}),
    confiarEnProxy: process.env["TRUST_PROXY"] === "1",
    ...(Number.isFinite(ttl) && ttl > 0 ? { cacheTtlMs: ttl } : {}),
  };
}

export async function crearDeps(
  config: ConfigRenderer,
): Promise<{ deps: RendererDeps; cerrar: () => Promise<void> }> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.databaseUrl });

  return {
    deps: {
      sitios: new PgSitios(new NodePgPool(pool)),
      cda: new StoryblokCda(),
      cache: new CacheRender(config.cacheTtlMs ? { ttlMs: config.cacheTtlMs } : {}),
      webhookSecret: config.webhookSecret,
      ...(config.previewSecret ? { previewSecret: config.previewSecret } : {}),
      confiarEnProxy: config.confiarEnProxy ?? false,
    },
    cerrar: () => pool.end(),
  };
}

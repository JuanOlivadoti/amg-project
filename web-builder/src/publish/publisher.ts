import { config } from "../config.js";
import type { Story } from "../types.js";
import { MockPublisher } from "./mock-publisher.js";
import { StoryblokDryRunPublisher, StoryblokPublisher } from "./storyblok-publisher.js";

export interface PublishResult {
  slug: string;
  /** Ubicación del artefacto: ruta local (mock) o id de story en Storyblok (live). */
  location: string;
  mode: "mock" | "storyblok";
  /**
   * ¿Quedó **realmente publicada**? No "¿la mandamos?", sino "¿el proveedor confirma que lo está?".
   *
   * Existe porque la respuesta era que no: el publisher mandaba las stories **como draft** y la base
   * escribía `published_at` igual. La distinción entre "lo pedí" y "pasó" es la que evita que la
   * base mienta sobre el mundo exterior.
   */
  published: boolean;
}

/** Publica las stories generadas. Implementaciones: mock (out/) | storyblok (Management API). */
export interface Publisher {
  publish(stories: Story[], html: Map<string, string>): Promise<PublishResult[]>;
}

/**
 * Elige el publisher. **El space viaja como argumento, no por variable de entorno.**
 *
 * Sin `spaceId` no hay publisher live: es preferible **detenerse** a escribir en el space de otro
 * cliente. Quien lo resuelve es el orquestador, leyendo `clients.storyblok_space_id` **bajo RLS**
 * (ADR-04: un space por cliente). El CLI, que es monocliente por definición, lo toma de la config.
 */
export function getPublisher(spaceId?: string | null): Publisher {
  if (config.publishMode !== "storyblok") return new MockPublisher();

  const space = spaceId ?? config.storyblok.spaceId;

  // Dry-run si se pide explícito, si falta el token o si NO SABEMOS DÓNDE publicar.
  if (config.storyblok.dryRun || !config.storyblok.managementToken || !space) {
    if (!config.storyblok.managementToken) {
      console.warn(
        "  [publish] sin token de Storyblok → DRY-RUN (escribo el payload en out/storyblok/, no publico).",
      );
    } else if (!space) {
      console.warn(
        "  [publish] el cliente no tiene storyblok_space_id → DRY-RUN. NO se publica a ciegas: " +
          "escribir en el space equivocado sobrescribe las páginas de otro cliente.",
      );
    }
    return new StoryblokDryRunPublisher();
  }

  return new StoryblokPublisher({
    spaceId: space,
    managementToken: config.storyblok.managementToken,
    mapiHost: config.storyblok.mapiHost,
  });
}

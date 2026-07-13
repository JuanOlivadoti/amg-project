import { config } from "../config.js";
import type { Story } from "../types.js";
import { MockPublisher } from "./mock-publisher.js";
import { StoryblokDryRunPublisher, StoryblokPublisher } from "./storyblok-publisher.js";

export interface PublishResult {
  slug: string;
  /** Ubicación del artefacto: ruta local (mock) o id de story en Storyblok (live). */
  location: string;
  mode: "mock" | "storyblok";
}

/** Publica las stories generadas. Implementaciones: mock (out/) | storyblok (Management API). */
export interface Publisher {
  publish(stories: Story[], html: Map<string, string>): Promise<PublishResult[]>;
}

/**
 * Elige el publisher según config. Igual que en kr-service, cambiar de mock a producción
 * es solo una variable de entorno (WEB_PUBLISH_MODE=storyblok) + credenciales. Cero código.
 */
export function getPublisher(): Publisher {
  if (config.publishMode === "storyblok") {
    // Dry-run si se pide explícito o si faltan credenciales: escribe el payload sin publicar.
    if (config.storyblok.dryRun || !config.storyblok.hasCredentials) {
      if (!config.storyblok.hasCredentials) {
        console.warn(
          "  [publish] sin credenciales Storyblok → DRY-RUN (escribo el payload en out/storyblok/, no publico).",
        );
      }
      return new StoryblokDryRunPublisher();
    }
    return new StoryblokPublisher();
  }
  return new MockPublisher();
}

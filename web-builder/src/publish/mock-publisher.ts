import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Story } from "../types.js";
import type { PublishResult, Publisher } from "./publisher.js";

const OUT_DIR = "out";

/**
 * Publisher mock: escribe cada story como JSON de Storyblok y su preview HTML en out/.
 * Permite demostrar el pipeline completo (research → web visible) SIN cuenta de Storyblok.
 */
export class MockPublisher implements Publisher {
  async publish(stories: Story[], html: Map<string, string>): Promise<PublishResult[]> {
    await mkdir(join(OUT_DIR, "stories"), { recursive: true });
    await mkdir(join(OUT_DIR, "preview"), { recursive: true });

    const results: PublishResult[] = [];
    for (const story of stories) {
      const file = safeName(story.slug);

      // Modelo CANÓNICO de la story (seo anidado, sin _uid), para inspección/debug.
      // OJO: NO es el payload que se envía a Storyblok — ese es el formato Storyblok-nativo
      // (con _uid, faq_item bloks) que produce toStoryblokContent(); vé el modo storyblok/dry-run.
      const storyJson = join(OUT_DIR, "stories", `${file}.json`);
      await writeFile(storyJson, JSON.stringify({ story }, null, 2), "utf8");

      const previewHtml = join(OUT_DIR, "preview", `${file}.html`);
      await writeFile(previewHtml, html.get(story.slug) ?? "", "utf8");

      results.push({ slug: story.slug, location: previewHtml, mode: "mock" });
    }
    return results;
  }
}

function safeName(slug: string): string {
  return slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "inicio";
}

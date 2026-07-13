import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { toStoryblokContent } from "../storyblok/content.js";
import type { Story } from "../types.js";
import type { PublishResult, Publisher } from "./publisher.js";

/**
 * Publisher live: crea/actualiza cada story en Storyblok vía Management API.
 * Preparado para PROD; se activa con WEB_PUBLISH_MODE=storyblok + token + space (ADR-04).
 *
 * NOTA de provisioning (previo a usar en serio): el space debe tener definidos los
 * componentes (`page`, `hero`, `section`, `faq`) para que el Visual Editor los renderice.
 * Eso es un setup one-time del space (Management API /components), no del handoff por página.
 * ADR-11: un space por cliente → la transferencia de salida queda limpia.
 */
export class StoryblokPublisher implements Publisher {
  private base = `${config.storyblok.mapiHost}/v1/spaces/${config.storyblok.spaceId}`;

  async publish(stories: Story[], _html: Map<string, string>): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (const story of stories) {
      const existingId = await this.findStoryId(story.slug);
      const id = existingId
        ? await this.updateStory(existingId, story)
        : await this.createStory(story);
      results.push({ slug: story.slug, location: `story:${id}`, mode: "storyblok" });
    }
    return results;
  }

  private async findStoryId(slug: string): Promise<number | null> {
    const res = await this.req(`/stories?with_slug=${encodeURIComponent(slug)}`, "GET");
    const json = (await res.json()) as { stories?: Array<{ id: number }> };
    return json.stories?.[0]?.id ?? null;
  }

  private async createStory(story: Story): Promise<number> {
    const res = await this.req("/stories/", "POST", { story: this.payload(story) });
    const json = (await res.json()) as { story: { id: number } };
    return json.story.id;
  }

  private async updateStory(id: number, story: Story): Promise<number> {
    await this.req(`/stories/${id}`, "PUT", { story: this.payload(story) });
    return id;
  }

  /** Storyblok pide `content` con la estructura de bloks (con _uid); el resto son metadatos. */
  private payload(story: Story) {
    return { name: story.name, slug: story.slug, content: toStoryblokContent(story) };
  }

  private async req(path: string, method: string, body?: unknown): Promise<Response> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: config.storyblok.managementToken,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(`Storyblok ${method} ${path} → HTTP ${res.status}: ${await res.text()}`);
    }
    return res;
  }
}

/**
 * Dry-run: escribe en out/storyblok/ el payload EXACTO que se enviaría a la Management API,
 * sin llamarla. Permite inspeccionar el formato Storyblok-nativo (con _uid, faq_item bloks)
 * y validar el shaping sin cuenta. Se usa cuando falta el token o STORYBLOK_DRY_RUN=1.
 */
export class StoryblokDryRunPublisher implements Publisher {
  async publish(stories: Story[], _html: Map<string, string>): Promise<PublishResult[]> {
    const dir = join("out", "storyblok");
    await mkdir(dir, { recursive: true });
    const results: PublishResult[] = [];
    for (const story of stories) {
      const payload = {
        name: story.name,
        slug: story.slug,
        content: toStoryblokContent(story),
      };
      const file = join(dir, `${safeName(story.slug)}.json`);
      await writeFile(file, JSON.stringify({ story: payload }, null, 2), "utf8");
      results.push({ slug: story.slug, location: file, mode: "storyblok" });
    }
    return results;
  }
}

function safeName(slug: string): string {
  return slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "inicio";
}

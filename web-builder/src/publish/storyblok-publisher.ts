import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { HttpError, fetchWithRetry } from "../lib/http.js";
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
      const id = await this.upsertStory(story);
      results.push({ slug: story.slug, location: `story:${id}`, mode: "storyblok" });
    }
    return results;
  }

  /**
   * Upsert idempotente (#12). El "consultar y después crear" es una carrera: dos corridas
   * concurrentes (o un reintento del orquestador) pueden ver "no existe" a la vez y crear DOS
   * stories con el mismo slug. Acá, si la creación choca con un slug ya tomado, se re-resuelve
   * y se actualiza en vez de duplicar. Publicar dos veces converge al mismo estado.
   */
  private async upsertStory(story: Story): Promise<number> {
    const existingId = await this.findStoryId(story.slug);
    if (existingId) return this.updateStory(existingId, story);

    try {
      return await this.createStory(story);
    } catch (e) {
      const conflict = e instanceof HttpError && (e.status === 409 || e.status === 422);
      if (!conflict) throw e;

      // Alguien la creó entre nuestro lookup y nuestro create.
      const raced = await this.findStoryId(story.slug);
      if (raced == null) throw e; // el 422 no era por slug duplicado → error real
      console.warn(
        `  [storyblok] "${story.slug}" ya existía (carrera) → actualizo en vez de duplicar.`,
      );
      return this.updateStory(raced, story);
    }
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
    // Con timeout y reintentos (#11): la Management API de Storyblok tiene rate limit (429).
    return fetchWithRetry(
      `${this.base}${path}`,
      {
        method,
        headers: {
          Authorization: config.storyblok.managementToken,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
      {
        ...config.http,
        onRetry: (attempt, delayMs, reason) =>
          console.warn(`  [storyblok] reintento ${attempt} en ${method} ${path} tras ${delayMs}ms (${reason})`),
      },
    );
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

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { HttpError, fetchWithRetry } from "../lib/http.js";
import { toStoryblokContent } from "../storyblok/content.js";
import type { Story } from "../types.js";
import type { PublishResult, Publisher } from "./publisher.js";

/**
 * Publisher live: crea/actualiza cada story en Storyblok vía Management API.
 *
 * ## El space es un ARGUMENTO, no una variable de entorno
 *
 * Antes esta clase leía `config.storyblok.spaceId`: **el mismo space para todos los clientes**. Y
 * como los slugs de un restaurante son siempre los mismos (`/menu`, `/contacto`…), publicar el
 * research del cliente A **pisaba las páginas del cliente B**:
 *
 *   1. B ya tiene `/menu` en el space global
 *   2. A aprueba su propia `/menu`
 *   3. `findStoryId("/menu")` encuentra la story de B
 *   4. `updateStory()` la sobrescribe con el contenido de A
 *
 * El aislamiento entre tenants era impecable dentro de Postgres y se perdía **al salir por la
 * puerta**. Ahora el destino llega por constructor y lo resuelve el orquestador **desde la fila del
 * cliente, bajo RLS** (ADR-04: un space por cliente → offboarding limpio, ADR-11).
 *
 * NOTA de provisioning: el space debe tener definidos los componentes (`page`, `hero`, `section`,
 * `faq`) para que el Visual Editor los renderice. Es un setup one-time del space.
 */
export interface DestinoStoryblok {
  spaceId: string;
  managementToken: string;
  mapiHost: string;
}

export class StoryblokPublisher implements Publisher {
  private readonly base: string;

  constructor(private readonly destino: DestinoStoryblok) {
    if (!destino.spaceId) {
      throw new Error(
        "StoryblokPublisher sin space_id. NO se publica sin destino: escribir en el space " +
          "equivocado sobrescribe las páginas de otro cliente.",
      );
    }
    this.base = `${destino.mapiHost}/v1/spaces/${destino.spaceId}`;
  }

  async publish(stories: Story[], _html: Map<string, string>): Promise<PublishResult[]> {
    const results: PublishResult[] = [];
    for (const story of stories) {
      const { id, published } = await this.upsertStory(story);
      results.push({ slug: story.slug, location: `story:${id}`, mode: "storyblok", published });
    }
    return results;
  }

  /**
   * Upsert idempotente (#12). El "consultar y después crear" es una carrera: dos corridas
   * concurrentes (o un reintento del orquestador) pueden ver "no existe" a la vez y crear DOS
   * stories con el mismo slug. Acá, si la creación choca con un slug ya tomado, se re-resuelve
   * y se actualiza en vez de duplicar. Publicar dos veces converge al mismo estado.
   */
  private async upsertStory(story: Story): Promise<StoryPublicada> {
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

  private async createStory(story: Story): Promise<StoryPublicada> {
    const res = await this.req("/stories/", "POST", this.cuerpo(story));
    return leerStory(await res.json());
  }

  private async updateStory(id: number, story: Story): Promise<StoryPublicada> {
    const res = await this.req(`/stories/${id}`, "PUT", this.cuerpo(story));
    return leerStory(await res.json());
  }

  /**
   * `publish: 1` NO es opcional, y su ausencia era una mentira sobre el mundo.
   *
   * La Management API deja la story en **draft** si no se le pide publicar. El cuerpo era solo
   * `{story}` → todo quedaba sin publicar. Y sin embargo el orquestador escribía `published_at` en
   * la base inmediatamente después: **la ejecución terminaba en `publicado` y no había nada
   * publicado.** La base afirmaba un hecho del mundo exterior que no había ocurrido.
   */
  private cuerpo(story: Story) {
    return {
      story: { name: story.name, slug: story.slug, content: toStoryblokContent(story) },
      publish: 1,
    };
  }

  private async req(path: string, method: string, body?: unknown): Promise<Response> {
    // Con timeout y reintentos (#11): la Management API de Storyblok tiene rate limit (429).
    return fetchWithRetry(
      `${this.base}${path}`,
      {
        method,
        headers: {
          Authorization: this.destino.managementToken,
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

interface StoryPublicada {
  id: number;
  published: boolean;
}

/**
 * Lee la respuesta de Storyblok **sin creerle al pedido, sino a la respuesta**.
 *
 * Que hayamos mandado `publish: 1` no prueba que se haya publicado. Lo que decide si la base puede
 * escribir `published_at` es lo que Storyblok dice que pasó — no lo que nosotros pedimos que pasara.
 */
function leerStory(json: unknown): StoryPublicada {
  const story = (json as { story?: { id?: number; published?: boolean } }).story;
  if (typeof story?.id !== "number") {
    throw new Error("Storyblok no devolvió el id de la story: no se puede confirmar la publicación.");
  }
  return { id: story.id, published: story.published === true };
}

/**
 * Dry-run: escribe en out/storyblok/ el payload EXACTO que se enviaría a la Management API,
 * sin llamarla. Permite inspeccionar el formato Storyblok-nativo (con _uid, faq_item bloks)
 * y validar el shaping sin cuenta. Se usa cuando falta el token, falta el space, o STORYBLOK_DRY_RUN=1.
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
      await writeFile(file, JSON.stringify({ story: payload, publish: 1 }, null, 2), "utf8");
      // `published: false` a propósito: un dry-run NO publica nada. Si dijera `true`, la base
      // escribiría `published_at` para páginas que nunca salieron de este disco.
      results.push({ slug: story.slug, location: file, mode: "storyblok", published: false });
    }
    return results;
  }
}

function safeName(slug: string): string {
  return slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "inicio";
}

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "../config.js";
import { COMPONENT_SCHEMAS } from "../storyblok/components.js";

/**
 * Provisiona los componentes del space de Storyblok (page/hero/section/faq/faq_item) para que
 * el Visual Editor pueda renderizar/editar las páginas generadas. Setup one-time por space.
 *
 * Uso:
 *   npm run setup:storyblok            # requiere token + space; crea/actualiza los componentes
 *   npm run setup:storyblok -- --dry-run   # escribe los esquemas en out/ sin llamar a la API
 */
async function main() {
  const dryRun = process.argv.includes("--dry-run") || config.storyblok.dryRun;

  console.log("▶ Provisioning de componentes Storyblok");
  console.log(`  Componentes: ${COMPONENT_SCHEMAS.map((c) => c.name).join(", ")}`);

  if (dryRun || !config.storyblok.hasCredentials) {
    if (!config.storyblok.hasCredentials && !dryRun) {
      console.warn("  Sin STORYBLOK_MANAGEMENT_TOKEN / STORYBLOK_SPACE_ID → DRY-RUN.");
    }
    await mkdir("out", { recursive: true });
    const file = join("out", "storyblok-components.json");
    await writeFile(file, JSON.stringify(COMPONENT_SCHEMAS, null, 2), "utf8");
    console.log(`\n✅ DRY-RUN · esquemas escritos en ${file} (no se tocó ningún space).`);
    return;
  }

  const base = `${config.storyblok.mapiHost}/v1/spaces/${config.storyblok.spaceId}`;
  const existing = await listComponents(base);

  for (const comp of COMPONENT_SCHEMAS) {
    const found = existing.get(comp.name);
    if (found) {
      await req(base, `/components/${found}`, "PUT", { component: comp });
      console.log(`  ~ actualizado: ${comp.name}`);
    } else {
      await req(base, "/components/", "POST", { component: comp });
      console.log(`  + creado: ${comp.name}`);
    }
  }
  console.log(`\n✅ Componentes provisionados en el space ${config.storyblok.spaceId}.`);
}

async function listComponents(base: string): Promise<Map<string, number>> {
  const res = await req(base, "/components/", "GET");
  const json = (await res.json()) as { components?: Array<{ id: number; name: string }> };
  return new Map((json.components ?? []).map((c) => [c.name, c.id]));
}

async function req(base: string, path: string, method: string, body?: unknown): Promise<Response> {
  const res = await fetch(`${base}${path}`, {
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

main().catch((e) => {
  console.error(`\n✖ ${(e as Error).message}`);
  process.exit(1);
});

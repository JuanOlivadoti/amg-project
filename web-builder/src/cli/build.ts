import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "../config.js";
import { briefToStories } from "../handoff/adapter.js";
import { renderStory } from "../render/html.js";
import { getPublisher } from "../publish/publisher.js";
import { applyProse, loadProfile } from "../enrich.js";
import { parseBrief } from "../contract.js";
import type { KrBrief } from "../types.js";

/**
 * PoC del Módulo 1: brief SEO (M2) → stories de Storyblok + preview HTML.
 * Uso: npm run build:web [ruta/al/brief.json]
 */
async function main() {
  const briefPath = resolve(process.argv[2] ?? config.briefPath);

  console.log("▶ Creador de Webs (PoC · Módulo 1)");
  console.log(`  Publicación: ${config.publishMode.toUpperCase()} · Prose: ${config.prose.mode.toUpperCase()}`);
  console.log(`  Brief M2: ${briefPath}`);

  const brief = await loadBrief(briefPath);
  console.log(`  Cliente: ${brief.cliente} · market ${brief.market.country} · status "${brief.status}"`);

  if (brief.paginas_propuestas.length === 0) {
    console.error("✖ El brief no tiene páginas propuestas.");
    process.exit(1);
  }

  // Compuerta de aprobación humana (ADR-06). Para publicar EN VIVO exige DOS condiciones:
  //  (a) status global "approved", y (b) aprobación por página (page.approved === true).
  // Así, cambiar solo el status global NO publica páginas que el revisor no aprobó.
  // El preview (mock) y el dry-run se permiten siempre: no publican nada real.
  const willPublishLive =
    config.publishMode === "storyblok" && config.storyblok.hasCredentials && !config.storyblok.dryRun;
  if (brief.status === "rejected") {
    console.error("✖ El brief está rechazado. No se genera la web.");
    process.exit(1);
  }

  const pages = brief.paginas_propuestas;
  const approvedPages = pages.filter((p) => p.approved);
  if (willPublishLive) {
    if (brief.status !== "approved") {
      console.error(
        `✖ Compuerta: para publicar en Storyblok el brief debe estar "approved" (está "${brief.status}").`,
      );
      process.exit(1);
    }
    if (approvedPages.length === 0) {
      console.error(
        "✖ Compuerta: el brief está aprobado pero ninguna página tiene approved=true. Nada para publicar.",
      );
      process.exit(1);
    }
    if (approvedPages.length < pages.length) {
      console.warn(
        `  [compuerta] ${pages.length - approvedPages.length} página(s) sin aprobar → se OMITEN. ` +
          `Publico solo las ${approvedPages.length} aprobada(s).`,
      );
    }
  }

  // En vivo: solo las páginas aprobadas. En preview/dry-run: todas (para revisión).
  const pagesToBuild = willPublishLive ? approvedPages : pages;

  // Aviso de evidencia (kr.v0.5). La compuerta de aprobación (ADR-06) existe para que un humano
  // decida con criterio, pero hasta ahora decidía A CIEGAS: el M2 calculaba `score_confidence` y
  // `evidencia`, y el esquema del M1 ni siquiera los tenía, así que Zod los descartaba al parsear.
  // Se podía aprobar y publicar una página basada en CERO datos de mercado sin enterarse.
  const sinValidar = pagesToBuild.filter((p) => p.evidencia === "sin_validar");
  if (sinValidar.length) {
    console.warn(
      `\n  ⚠️  [evidencia] ${sinValidar.length} de ${pagesToBuild.length} página(s) NO tienen datos de mercado ` +
        `que las respalden:`,
    );
    for (const p of sinValidar) {
      const conf = p.score_confidence != null ? ` · confianza ${p.score_confidence}` : "";
      console.warn(`      · ${p.url_slug}  (${p.keyword_principal})${conf}`);
    }
    console.warn(
      `      Ninguna keyword de esos grupos tiene volumen de búsqueda conocido. Pueden ser páginas\n` +
        `      legítimas (servicios que el negocio ofrece), pero NO se pueden presentar como\n` +
        `      oportunidad SEO validada. Revisalo antes de mostrárselo al cliente.\n`,
    );
  }

  // Handoff → prose (LLM) → render → publish
  const stories = briefToStories({ ...brief, paginas_propuestas: pagesToBuild });
  console.log(`  [handoff] ${stories.length} página(s) → stories Storyblok`);

  const profile = await loadProfile(config.businessProfilePath);
  console.log(`  [perfil] ${profile ? `cargado: ${profile.name}` : "sin perfil de negocio (JSON-LD básico)"}`);

  const filled = await applyProse(stories, brief, profile);
  console.log(`  [prose] ${filled}/${stories.length} página(s) redactada(s) (${config.prose.mode})`);

  const html = new Map(
    stories.map((s) => [s.slug, renderStory(s, profile, brief.market.language_code)]),
  );

  const results = await getPublisher().publish(stories, html);

  // Índice navegable del preview (útil para mostrarle al cliente).
  if (config.publishMode === "mock") {
    await writeIndex(brief, results);
  }

  console.log("\n✅ Web generada");
  for (const r of results) {
    console.log(`   /${r.slug}  →  ${r.location}`);
  }
  if (config.publishMode === "mock") {
    console.log("\n📂 Abrí out/preview/index.html para ver las páginas.");
  }
}

async function loadBrief(path: string): Promise<KrBrief> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new Error(
      `No se pudo leer el brief en ${path}. Corré primero el spike del M2 (kr-service) ` +
        `o pasá la ruta: npm run build:web <ruta/brief.json>`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`El brief en ${path} no es JSON válido: ${(e as Error).message}`);
  }
  // Validación de contrato (Zod) + versión soportada: rechaza briefs corruptos o incompatibles.
  return parseBrief(json);
}

async function writeIndex(brief: KrBrief, results: { slug: string }[]): Promise<void> {
  await mkdir("out/preview", { recursive: true });
  const links = results
    .map((r) => `<li><a href="./${safe(r.slug)}.html">/${r.slug}</a></li>`)
    .join("\n");
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Preview — ${escAttr(brief.cliente)}</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 20px}
h1{font-size:1.5rem}li{margin:6px 0}</style></head>
<body><h1>${escAttr(brief.cliente)}</h1>
<p>Páginas generadas desde el research (market ${escAttr(brief.market.country)}):</p>
<ul>${links}</ul></body></html>`;
  await writeFile("out/preview/index.html", html, "utf8");
}

function safe(slug: string): string {
  return slug.replace(/[^a-z0-9-]+/gi, "-").replace(/^-|-$/g, "") || "inicio";
}
function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

main().catch((e) => {
  console.error(`\n✖ ${(e as Error).message}`);
  process.exit(1);
});

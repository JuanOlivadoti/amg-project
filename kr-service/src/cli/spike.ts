import { mkdir, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { SCHEMA_VERSION } from "../types.js";
import { runResearch } from "../pipeline/run.js";
import type { ResearchDataset } from "../pipeline/run.js";
import { renderReport } from "../pipeline/brief.js";
import { briefSchema } from "../validation/brief.schema.js";

// Caso por defecto del spike (restaurante italiano en Madrid).
const DEFAULT_PROMPT =
  "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, " +
  "pasta fresca, menú del día, cenas para grupos y brunch de fin de semana.";

/**
 * Tope de gasto del run, en USD (opcional). Es la red de seguridad para las corridas contra
 * producción: si una fase no entra en el remanente, el run aborta ANTES de gastar.
 *   MAX_COST_USD=0.50 npm run spike "..."
 */
function maxCostMicrosFromEnv(): number | undefined {
  const raw = process.env.MAX_COST_USD?.trim();
  if (!raw) return undefined;
  const usd = Number(raw);
  if (!Number.isFinite(usd) || usd <= 0) {
    console.warn(`  ⚠️ MAX_COST_USD inválido (${raw}); se ignora el tope.`);
    return undefined;
  }
  return Math.round(usd * 1_000_000);
}

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim() || DEFAULT_PROMPT;
  const maxCostMicros = maxCostMicrosFromEnv();

  console.log("▶ Spike Keyword Research (Fase 0)");
  if (config.dataforseo.mode === "mock") {
    console.log("  DataForSEO: MOCK (datos ficticios locales, sin cuenta)");
  } else {
    console.log(`  DataForSEO: LIVE ${config.dataforseo.baseUrl}${config.dataforseo.isSandbox ? " (SANDBOX)" : ""}`);
    console.log(`  Credenciales DFS: ${config.dataforseo.hasCredentials ? "ok" : "FALTAN (.env)"}`);
  }
  console.log(`  LLM (generación): ${config.llm.provider}`);
  console.log(`  Embeddings: ${config.llm.embeddingProvider}`);
  console.log(`  Prompt: ${prompt}\n`);

  let dataset: ResearchDataset | undefined;
  const brief = await runResearch(
    maxCostMicros === undefined
      ? { prompt }
      : { prompt, options: { max_cost_micros: maxCostMicros } },
    (d) => {
      dataset = d;
    },
  );

  // Validación del contrato (Zod) — la "validación" del pipeline.
  const parsed = briefSchema.safeParse(brief);
  if (!parsed.success) {
    console.error(`\n❌ El brief NO cumple el esquema ${SCHEMA_VERSION}:`);
    console.error(parsed.error.issues.slice(0, 10));
    process.exitCode = 1;
  } else {
    console.log(`\n✅ Brief válido contra el esquema ${SCHEMA_VERSION}`);
  }

  await mkdir("out", { recursive: true });
  await writeFile("out/brief.json", JSON.stringify(brief, null, 2), "utf8");
  await writeFile("out/informe.md", renderReport(brief), "utf8");
  // El dataset crudo son los datos que se le pagaron a DataForSEO. Se persiste para poder ajustar
  // scoring/clustering offline sin volver a pagar por una corrida.
  if (dataset) {
    await writeFile("out/keywords.json", JSON.stringify(dataset, null, 2), "utf8");
    console.log(`\n📄 Escrito: out/brief.json · out/informe.md · out/keywords.json (${dataset.keywords.length} keywords)`);
  } else {
    console.log("\n📄 Escrito: out/brief.json  ·  out/informe.md");
  }
  console.log(`   Páginas: ${brief.meta_run.paginas_propuestas} · Coste: $${(brief.meta_run.coste_micros_usd / 1_000_000).toFixed(4)}`);
}

main().catch((e) => {
  console.error("\n💥 Error en el spike:", e);
  process.exit(1);
});

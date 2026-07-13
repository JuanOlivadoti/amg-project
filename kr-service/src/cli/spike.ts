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

  // El checkpoint ESCRIBE A DISCO en cuanto los datos pagos existen, y se vuelve a llamar tras el
  // clustering. Antes solo se guardaba el objeto en memoria y el archivo se escribía al final: si
  // el presupuesto abortaba o fallaban los embeddings, el proceso rechazaba y los ~$0.25 de
  // DataForSEO ya gastados se perdían enteros.
  await mkdir("out", { recursive: true });
  let dataset: ResearchDataset | undefined;
  const saveDataset = async (d: ResearchDataset) => {
    dataset = d;
    await writeFile("out/keywords.json", JSON.stringify(d, null, 2), "utf8");
  };

  const brief = await runResearch(
    maxCostMicros === undefined
      ? { prompt }
      : { prompt, options: { max_cost_micros: maxCostMicros } },
    saveDataset,
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

  await writeFile("out/brief.json", JSON.stringify(brief, null, 2), "utf8");
  await writeFile("out/informe.md", renderReport(brief), "utf8");
  const kwCount = dataset ? ` (${dataset.keywords.length} keywords)` : "";
  console.log(`\n📄 Escrito: out/brief.json · out/informe.md · out/keywords.json${kwCount}`);
  console.log(`   Páginas: ${brief.meta_run.paginas_propuestas} · Coste: $${(brief.meta_run.coste_micros_usd / 1_000_000).toFixed(4)}`);
}

main().catch((e) => {
  console.error("\n💥 Error en el spike:", e);
  process.exit(1);
});

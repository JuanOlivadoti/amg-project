import { mkdir, writeFile } from "node:fs/promises";
import { config } from "../config.js";
import { SCHEMA_VERSION } from "../types.js";
import { runResearch } from "../pipeline/run.js";
import type { RunDeps, ResearchDataset } from "../pipeline/run.js";
import type { ProviderTaskLog } from "../dataforseo/task-log.js";
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

/**
 * El registro de idempotencia DURABLE para una corrida contra PRODUCCIÓN.
 *
 * `getProvider` lo exige en live+prod (ADR-14): sin él, DataForSEO cobra como "nueva" cada petición y
 * un crash + re-run vuelve a pagar los ~$0.25. El CLI es un composition root —igual que
 * `orchestrator/deps.ts`—, así que ACÁ sí conoce la implementación (`PgTaskLog` de `db`), aunque la
 * LIBRERÍA de kr-service siga sin saber que existe una base de datos.
 *
 * Usa `DATABASE_URL_CACHE` (login `amg_cache`) y el MISMO namespace que el orquestador, para que
 * ambos compartan el ledger: una petición que pagó uno, el otro la ve pagada. Sin esa variable, en
 * producción se ABORTA — no se gasta dinero real sin dónde anotarlo. En sandbox (gratis) y mock no
 * hace falta registro.
 */
async function registroDurable(): Promise<{ taskLog?: ProviderTaskLog; cerrar: () => Promise<void> }> {
  const sinRegistro = { cerrar: async () => {} };
  if (config.dataforseo.mode !== "live" || config.dataforseo.isSandbox) return sinRegistro;

  const url = process.env["DATABASE_URL_CACHE"];
  if (!url) {
    throw new Error(
      "Corrida de PRODUCCIÓN sin DATABASE_URL_CACHE: DataForSEO cobra de verdad y no hay registro de " +
        "idempotencia durable donde anotarlo (un crash + re-run pagaría dos veces). Configurá " +
        "DATABASE_URL_CACHE (login amg_cache) o corré contra sandbox. Ver ADR-14 y docs/proyecto/12-credenciales.md.",
    );
  }

  const { NodePgPool, PgTaskLog } = await import("db");
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url });
  const ns = `dfs:${config.dataforseo.isSandbox ? "sandbox" : "prod"}`;
  const taskLog = new PgTaskLog(new NodePgPool(pool), ns);
  return { taskLog, cerrar: () => pool.end() };
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

  // El registro durable se abre ANTES de gastar y se cierra pase lo que pase (el pool deja el
  // proceso colgado si no). En prod es obligatorio; en sandbox/mock, `taskLog` viene undefined.
  const { taskLog, cerrar } = await registroDurable();
  const deps: RunDeps = taskLog ? { taskLog } : {};

  let brief;
  try {
    brief = await runResearch(
      maxCostMicros === undefined
        ? { prompt }
        : { prompt, options: { max_cost_micros: maxCostMicros } },
      saveDataset,
      deps,
    );
  } finally {
    await cerrar();
  }

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

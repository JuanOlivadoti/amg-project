import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * LA COSTURA, no las piezas.
 *
 * `refineIsLocal` tiene sus tests y `clusterKeywords` los suyos, pero eso ya pasó antes en este
 * repo: 199 tests verdes probando `MemTaskLog` y `PgTaskLog` por separado mientras **nadie probaba
 * que el POST facturable pasara por el registro** (ver la cabecera de `client.test.ts`). Acá el
 * riesgo equivalente es que la señal se recoja, la función exista, y **run.ts no las conecte** —o
 * las conecte en el orden equivocado, después de armar las páginas, cuando `is_local` ya decidió el
 * `schema_type` y refinarlo no cambia nada—.
 *
 * ## Por qué esto no puede gastar un centavo
 *
 * `config` se congela al importarse y lee del entorno, así que el entorno se fija ANTES del import
 * dinámico. Se apaga dotenv (que si no cargaría `kr-service/.env`, donde puede haber keys reales),
 * se fuerza el proveedor a mock, se comprueba que la config quedó en mock —y si no, el test FALLA
 * en vez de correr— y encima se rompe `fetch`: cualquier intento de salir a la red revienta.
 */

// dotenv/config respeta DOTENV_CONFIG_PATH; apuntándolo a un archivo inexistente no carga nada.
process.env["DOTENV_CONFIG_PATH"] = "/nonexistent/.env.jamas";
delete process.env["OPENAI_API_KEY"];
delete process.env["ANTHROPIC_API_KEY"];
process.env["LLM_PROVIDER"] = "mock";
process.env["DATAFORSEO_MODE"] = "mock";

const { config, MARKET_ES } = await import("../config.js");
const { runResearch } = await import("./run.js");
const { MockProvider } = await import("../dataforseo/mock-provider.js");
const { canonicalKey } = await import("../lib/text.js");
import type { ResearchDataset } from "./run.js";

test("guarda: la config de este test es 100% mock (si no, abortar antes de gastar)", () => {
  assert.equal(config.dataforseo.mode, "mock");
  assert.equal(config.llm.provider, "mock");
  assert.equal(config.llm.embeddingProvider, "mock");
});

const PROMPT =
  "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, " +
  "menú del día, cenas para grupos y brunch de fin de semana.";

let logs: string[] = [];
let logOriginal: typeof console.log;
let fetchOriginal: typeof globalThis.fetch;

beforeEach(() => {
  logs = [];
  logOriginal = console.log;
  fetchOriginal = globalThis.fetch;
  console.log = (...args: unknown[]) => void logs.push(args.map(String).join(" "));
  globalThis.fetch = (() => {
    throw new Error("este test no puede tocar la red");
  }) as unknown as typeof globalThis.fetch;
});

afterEach(() => {
  console.log = logOriginal;
  globalThis.fetch = fetchOriginal;
});

/** Los pasos, en el orden en que run.ts los reportó. */
const pasos = () => logs.map((l) => l.trim().match(/^\[([a-z]+)\]/)?.[1]).filter(Boolean) as string[];

async function correr(): Promise<{ dataset: ResearchDataset; heads: string[] }> {
  const snapshots: ResearchDataset[] = [];
  await runResearch({ prompt: PROMPT }, (d) => void snapshots.push(structuredClone(d)));
  const dataset = snapshots.at(-1)!;
  return { dataset, heads: dataset.clusters.map((c) => c.head) };
}

test("run: el refinamiento por SERP corre, y corre ENTRE el clustering y el mapeo a páginas", async () => {
  await correr();
  const orden = pasos();
  const i = { cluster: orden.indexOf("cluster"), local: orden.indexOf("local"), map: orden.indexOf("map") };

  assert.ok(i.local >= 0, `no hubo paso [local]. Pasos: ${orden.join(" → ")}`);
  assert.ok(i.cluster >= 0 && i.cluster < i.local, "el SERP se observa DURANTE el clustering: antes no hay señal");
  assert.ok(
    i.local < i.map,
    "después del mapeo ya no sirve: es `is_local` quien decide el tipo de página, y de ahí el schema_type",
  );
});

/**
 * 🔴 Que la señal LLEGUE. Si el callback no se cableara, o el mapa quedara vacío, todo lo demás
 * seguiría verde: el refinamiento sería un no-op silencioso y `is_local` seguiría saliendo del LLM.
 */
test("🔴 se observan cabezas de verdad y el refinamiento CORRIGE is_local", async () => {
  await correr();
  const linea = logs.find((l) => l.includes("[local]"));
  assert.ok(linea, "falta la línea [local]");

  const observadas = Number(linea.match(/observado en (\d+)\//)?.[1]);
  const corregidas = Number(linea.match(/(\d+) is_local corregido/)?.[1]);

  assert.ok(observadas > 0, `no se observó ninguna cabeza: la señal no llegó. Línea: ${linea}`);
  assert.ok(
    corregidas > 0,
    `se observaron ${observadas} cabezas y no se corrigió ninguna. Con el mock —cuyo map pack NO ` +
      `se correlaciona con los tokens geográficos— eso significa que la señal no se está aplicando.`,
  );
});

/**
 * Ninguna señal se pierde por el camino. Con el mock nunca hay `mapPack: null` (siempre responde),
 * así que TODA cabeza consultada tiene que contarse como observada. Si `observadas < M`, algo entre
 * el proveedor y `refineIsLocal` está tirando señales —el cruce por clave canónica, típicamente—.
 */
test("run: todas las cabezas consultadas se cruzan con el dataset (no se pierde ninguna señal)", async () => {
  await correr();
  const linea = logs.find((l) => l.includes("[local]"))!;
  const [, observadas, consultadas] = linea.match(/observado en (\d+)\/(\d+)/)!;

  assert.ok(Number(consultadas) > 0, "no se consultó ningún SERP");
  assert.equal(
    Number(observadas),
    Number(consultadas),
    "el mock siempre responde: si alguna no se observó, el cruce por canonicalKey está fallando",
  );
  assert.ok(!linea.includes("sin señal"), "y ninguna quedó sin señal");
});

/**
 * El resultado, contra la fuente.
 *
 * Se comprueba **la cabeza mejor puntuada** y no todas a propósito: solo se validan por SERP las
 * ~15 primeras cabezas del clustering PRE-fusión, y desde fuera no se puede reconstruir cuáles
 * fueron. La primera sí es segura —es la keyword de mayor `opportunity_score`, siempre entra—, y es
 * además la que más manda: encabeza la página mejor rankeada del brief.
 *
 * Que se compruebe sobre el dataset del CHECKPOINT 2 tampoco es casual: el dataset persistido tiene
 * que llevar el `is_local` que DE VERDAD gobernó las páginas. Si el refinamiento corriera después
 * del checkpoint, el tuning offline —la razón de ser del dataset— se haría contra números que nunca
 * corrieron.
 */
test("run: la cabeza top lleva el is_local de su SERP, y el dataset persistido también", async () => {
  const { dataset, heads } = await correr();
  const porClave = new Map(dataset.keywords.map((k) => [canonicalKey(k.keyword), k]));

  const primera = heads[0]!;
  const { mapPack } = await new MockProvider().serp(primera, MARKET_ES);
  assert.equal(
    porClave.get(canonicalKey(primera))!.is_local,
    mapPack,
    `"${primera}": el dataset y su SERP tienen que decir lo mismo`,
  );
});

/**
 * Y las que NADIE miró quedan como estaban: el refinamiento no puede "limpiar" el dataset entero
 * a base de silencio. Con el mock, `is_local` sale de la heurística/LLM para las no observadas, y
 * en un prompt de Madrid eso significa que muchas siguen locales.
 */
test("run: las keywords no observadas conservan su is_local (no se desmarcan en bloque)", async () => {
  const { dataset } = await correr();
  const linea = logs.find((l) => l.includes("[local]"))!;
  const consultadas = Number(linea.match(/observado en \d+\/(\d+)/)![1]);

  const locales = dataset.keywords.filter((k) => k.is_local).length;
  assert.ok(dataset.keywords.length > consultadas, "el dataset tiene más keywords que SERP consultados");
  assert.ok(locales > 0, "el refinamiento no puede dejar el dataset sin una sola keyword local");
});

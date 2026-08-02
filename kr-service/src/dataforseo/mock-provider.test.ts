import { test } from "node:test";
import assert from "node:assert/strict";
import { MockProvider } from "./mock-provider.js";
import { MARKET_ES } from "../config.js";

const KEYWORDS = [
  "restaurante italiano madrid",
  "pizza napolitana madrid",
  "pasta fresca",
  "como hacer pasta fresca",
  "menu del dia madrid centro",
  "cenas para grupos",
  "brunch fin de semana",
  "trattoria cerca de mi",
];

/**
 * Si el mock devolviera SIEMPRE lo mismo, ningún test recorrería el camino que importa: el de una
 * señal del SERP que CONTRADICE al LLM. Un mock uniforme deja verde un refinamiento que no refina.
 */
test("mock: el map pack sale true para unas keywords y false para otras", async () => {
  const p = new MockProvider();
  const vistos = new Set<boolean | null>();
  for (const kw of KEYWORDS) vistos.add((await p.serp(kw, MARKET_ES)).mapPack);

  assert.ok(vistos.has(true), "alguna keyword tiene que traer map pack");
  assert.ok(vistos.has(false), "y alguna NO, o no hay nada que distinguir");
});

/** El mock siempre responde: la observación existe. `null` es solo para "no se pudo observar". */
test("mock: nunca devuelve mapPack null (siempre hay observación)", async () => {
  const p = new MockProvider();
  for (const kw of KEYWORDS) {
    assert.notEqual((await p.serp(kw, MARKET_ES)).mapPack, null, kw);
  }
});

test("mock: la señal es determinista (misma keyword → misma respuesta)", async () => {
  const a = await new MockProvider().serp("pizza napolitana madrid", MARKET_ES);
  const b = await new MockProvider().serp("pizza napolitana madrid", MARKET_ES);
  assert.deepEqual(a, b);
});

/**
 * El map pack NO se deriva de los tokens geográficos. Si lo hiciera, el mock estaría copiando la
 * misma señal que mira `intent.ts:detectLocal` y el SERP jamás podría desmentir al LLM — que es
 * exactamente el escenario que KR-3 existe para cubrir.
 */
test("mock: el map pack no está atado a que la keyword diga 'madrid'", async () => {
  const p = new MockProvider();
  const conGeo = KEYWORDS.filter((k) => k.includes("madrid"));
  const señales = await Promise.all(conGeo.map(async (k) => (await p.serp(k, MARKET_ES)).mapPack));

  assert.ok(
    señales.some((s) => s === false),
    "alguna keyword con 'madrid' tiene que salir SIN map pack: es el falso positivo que se corrige",
  );
});

test("mock: las URLs orgánicas siguen ahí y respetan depth", async () => {
  const r = await new MockProvider().serp("pizza napolitana madrid", MARKET_ES, 5);
  assert.equal(r.urls.length, 5);
  assert.ok(r.urls.every((u) => u.startsWith("https://")));
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPOS_MAP_PACK, serpOrganic } from "./endpoints.js";
import type { DataForSeoClient } from "./client.js";
import { MARKET_ES } from "../config.js";

/**
 * Cliente de mentira: devuelve los bloques que se le den. `endpoints.ts` solo importa el TIPO de
 * `DataForSeoClient`, así que acá no se instancia nada real — ni red, ni credenciales, ni registro
 * de idempotencia. Lo que se prueba es la EXTRACCIÓN, que es lo único que vive en este archivo.
 */
function clienteQueDevuelve(bloques: unknown[]): DataForSeoClient {
  return { async postStandard() { return bloques; } } as unknown as DataForSeoClient;
}

const organicas = [
  { type: "organic", url: "https://a.com" },
  { type: "organic", url: "https://b.com" },
];

test("serpOrganic: sigue devolviendo las URLs orgánicas, en orden", async () => {
  const r = await serpOrganic(clienteQueDevuelve([{ items: organicas }]), "pizza", MARKET_ES);
  assert.deepEqual(r.urls, ["https://a.com", "https://b.com"]);
});

test("serpOrganic: respeta `depth` al recortar", async () => {
  const r = await serpOrganic(clienteQueDevuelve([{ items: organicas }]), "pizza", MARKET_ES, 1);
  assert.deepEqual(r.urls, ["https://a.com"]);
});

/**
 * Los DOS nombres de tipo que la constante declara tienen que detectarse. Si un día se agrega un
 * tercero, este test lo cubre solo — recorre la constante, no una lista propia.
 */
for (const tipo of TIPOS_MAP_PACK) {
  test(`serpOrganic: un item de tipo "${tipo}" cuenta como map pack`, async () => {
    const cliente = clienteQueDevuelve([{ items: [...organicas, { type: tipo }] }]);
    const r = await serpOrganic(cliente, "restaurante italiano madrid", MARKET_ES);

    assert.equal(r.mapPack, true);
    assert.deepEqual(r.urls, ["https://a.com", "https://b.com"], "el bloque local no ensucia las URLs");
  });
}

/**
 * 🔴 `false` ≠ `null`. Si el proveedor RESPONDIÓ y no había bloque local, eso es una observación
 * válida y negativa: se miró, y no hay. Devolver `null` acá desactivaría el refinamiento entero
 * (la regla es "sin observación no se pisa nada"), o sea que la pieza no serviría para nada.
 */
test("🔴 el proveedor respondió sin bloque local → mapPack false, NUNCA null", async () => {
  const r = await serpOrganic(clienteQueDevuelve([{ items: organicas }]), "que es el sofrito", MARKET_ES);
  assert.equal(r.mapPack, false);
});

test("serpOrganic: un tipo desconocido no se toma por map pack", async () => {
  const cliente = clienteQueDevuelve([{ items: [...organicas, { type: "people_also_ask" }] }]);
  assert.equal((await serpOrganic(cliente, "pizza", MARKET_ES)).mapPack, false);
});

/**
 * La constante es la ÚNICA definición de qué cuenta como map pack, y está declarada como no
 * verificada contra la API real (ver su comentario). Que esté vacía o pierda un nombre convertiría
 * la señal en un `false` constante y silencioso.
 */
test("TIPOS_MAP_PACK cubre local_pack y map, y NADA más", () => {
  assert.ok(TIPOS_MAP_PACK.includes("local_pack"), "el nombre principal de la API");
  assert.ok(TIPOS_MAP_PACK.includes("map"), "la variante que aparece en algunos SERP");
  // Fijada también POR ARRIBA. Los dos asserts de recién impiden que la lista se encoja, pero no que
  // crezca — y crecerla es plausible justamente porque los nombres no están verificados contra la
  // API real. Un `"organic"` de más acá convertiría CASI TODO SERP en map pack: `is_local` se
  // marcaría en vez de corregirse, que es lo contrario de lo que la pieza existe para hacer, y el
  // bucle de arriba seguiría en verde porque se genera desde la propia constante.
  assert.deepEqual([...TIPOS_MAP_PACK].sort(), ["local_pack", "map"], "agregar un tipo es una decisión: cambiá también este test");
});

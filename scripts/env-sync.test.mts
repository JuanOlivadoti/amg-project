/**
 * El contrato de env-sync. Lo que se prueba acá NO es la implementación: es la compartimentación.
 * Si alguien "simplifica" el generador a un `.env` único en la raíz, estos tests caen.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAPA, RAIZ, claveDePaquete, parsear, repartir, serializar, type Paquete } from "./env-sync.mts";

const PAQUETES = Object.keys(MAPA) as Paquete[];

/** Todas las claves de un `.env.example`, que es el contrato público de cada paquete. */
function clavesDelExample(pkg: Paquete): string[] {
  const txt = readFileSync(join(RAIZ, pkg, ".env.example"), "utf8");
  return [...parsear(txt).keys()];
}

for (const pkg of PAQUETES) {
  test(`${pkg}: MAPA coincide EXACTAMENTE con su .env.example`, () => {
    // Las dos direcciones a propósito: si alguien agrega una clave al example y se olvida del MAPA,
    // el paquete se quedaría sin esa variable en silencio. Y si el MAPA tiene una de más, le estamos
    // entregando a ese proceso algo que su propio contrato no pide.
    assert.deepEqual([...MAPA[pkg]].sort(), clavesDelExample(pkg).sort());
  });
}

test("el renderizador NUNCA recibe el token de ESCRITURA de Storyblok", () => {
  // El orquestador escribe por la Management API; el renderizador lee por la Content Delivery API.
  // El proceso anónimo no puede tener a mano una credencial que modifique el space.
  assert.ok(!(MAPA.renderer as readonly string[]).includes("STORYBLOK_MANAGEMENT_TOKEN"));
});

test("el renderizador NUNCA recibe una credencial de base de datos", () => {
  const conBase = (MAPA.renderer as readonly string[]).filter((k) => k.startsWith("DATABASE_URL"));
  assert.deepEqual(conBase, []);
});

/**
 * 🔴 Las dos mitades de Inngest viven en procesos distintos, y el reparto lo tiene que imponer.
 *
 * `INNGEST_EVENT_KEY` autentica el **envío** (la API emite `research/solicitado`);
 * `INNGEST_SIGNING_KEY` verifica la **recepción** (el orquestador comprueba que quien invoca
 * `/api/inngest` es Inngest Cloud). Cruzarlas no da error de arranque —cada proceso falla mucho
 * después, con un `send()` que lanza o un 401 en cada invocación— así que la separación la fija
 * este test o no la fija nadie.
 */
test("las dos claves de Inngest NO se cruzan entre la API y el orquestador", () => {
  const api = MAPA.api as readonly string[];
  const orq = MAPA.orchestrator as readonly string[];
  assert.ok(api.includes("INNGEST_EVENT_KEY"), "la API emite eventos: necesita la de ENVÍO");
  assert.ok(!api.includes("INNGEST_SIGNING_KEY"), "la API no recibe invocaciones de Inngest");
  assert.ok(orq.includes("INNGEST_SIGNING_KEY"), "el orquestador las recibe: necesita la de RECEPCIÓN");
  assert.ok(!orq.includes("INNGEST_EVENT_KEY"), "el orquestador no emite eventos (medido: no hay `send`)");
});

/**
 * 🔴 El orquestador asume `app_service` y NO puede tener a mano una credencial de más poder.
 *
 * Es el mismo argumento que el de la API con `DATABASE_URL_ADMIN`, y acá pesa más: el orquestador es
 * el composition root, el único proceso que conoce a los tres módulos a la vez. Si su entorno llevara
 * la conexión de admin, `set local role` dejaría de ser una barrera para ser una costumbre.
 */
test("el orquestador NUNCA recibe la conexión de ADMIN ni la de la API (ADR-17)", () => {
  const orq = MAPA.orchestrator as readonly string[];
  assert.ok(!orq.includes("DATABASE_URL_ADMIN"), "la de admin es solo para migrar y sembrar, a mano");
  assert.ok(!orq.includes("DATABASE_URL_API"), "un login por proceso: el de la API es de la API");
});

test("la API NUNCA recibe la conexión de ADMIN (ADR-17)", () => {
  // La API usa `amg_api`, que es NOINHERIT y va bajo RLS. Si tuviera DATABASE_URL_ADMIN en su
  // entorno, el aislamiento de roles sería una convención en vez de una barrera.
  assert.ok(!(MAPA.api as readonly string[]).includes("DATABASE_URL_ADMIN"));
});

test("repartir no filtra: cada paquete recibe SOLO las claves de su MAPA", () => {
  const fuente = new Map<string, string>();
  for (const claves of Object.values(MAPA)) for (const k of claves) fuente.set(k, `valor-de-${k}`);
  fuente.set("UNA_CLAVE_QUE_NO_MAPEA_A_NADIE", "secreto");

  const reparto = repartir(fuente);
  for (const pkg of PAQUETES) {
    assert.deepEqual([...reparto[pkg].keys()].sort(), [...MAPA[pkg]].sort());
    assert.ok(!reparto[pkg].has("UNA_CLAVE_QUE_NO_MAPEA_A_NADIE"), `${pkg} recibió una clave sin destino`);
  }
});

test("una clave ausente en la fuente llega vacía, no `undefined` ni omitida", () => {
  // Un `.env` con `CLAVE=undefined` es peor que uno con `CLAVE=`: la app lo leería como el string
  // "undefined" y pasaría cualquier chequeo de "está definida".
  const reparto = repartir(new Map());
  const texto = serializar(reparto.api);
  assert.match(texto, /^DATABASE_URL_API=$/m);
  assert.doesNotMatch(texto, /undefined/);
});

test("parsear: ignora comentarios y respeta los `=` dentro del valor", () => {
  const m = parsear("# comentario\n\nA=1\nB=postgres://u:p@h:5432/d?x=1\n");
  assert.equal(m.get("A"), "1");
  assert.equal(m.get("B"), "postgres://u:p@h:5432/d?x=1");
  assert.equal(m.size, 2);
});

test("lo generado se puede volver a parsear sin perder nada (ida y vuelta)", () => {
  const original = new Map([["DATABASE_URL_API", "postgres://a.b:c@d:5432/e"]]);
  assert.deepEqual([...parsear(serializar(original))], [...original]);
});

test("el archivo generado avisa que no se edita a mano", () => {
  assert.match(serializar(new Map([["A", "1"]])), /NO editar a mano/);
});

test("el override por paquete gana sobre el valor global", () => {
  const fuente = new Map([
    ["OPENAI_API_KEY", "global"],
    [claveDePaquete("web-builder", "OPENAI_API_KEY"), "solo-de-web-builder"],
  ]);
  const r = repartir(fuente);
  assert.equal(r["web-builder"].get("OPENAI_API_KEY"), "solo-de-web-builder");
  // kr-service comparte la clave pero no tiene override: le toca la global.
  assert.equal(r["kr-service"].get("OPENAI_API_KEY"), "global");
});

test("el override de un paquete NO se filtra a otro", () => {
  // El riesgo del override es volverse una puerta trasera: si `RENDERER__X` terminara en el .env de
  // web-builder, la compartimentación se caería por donde nadie mira.
  const fuente = new Map([[claveDePaquete("renderer", "STORYBLOK_SPACE_ID"), "solo-renderer"]]);
  const r = repartir(fuente);
  assert.equal(r.renderer.get("STORYBLOK_SPACE_ID"), "solo-renderer");
  assert.equal(r["web-builder"].get("STORYBLOK_SPACE_ID"), "");
  for (const pkg of PAQUETES) {
    assert.ok(![...r[pkg].keys()].some((k) => k.includes("__")), `${pkg} recibió una clave con prefijo`);
  }
});

test("claveDePaquete normaliza los guiones del nombre del paquete", () => {
  assert.equal(claveDePaquete("web-builder", "X"), "WEB_BUILDER__X");
  assert.equal(claveDePaquete("kr-service", "X"), "KR_SERVICE__X");
});

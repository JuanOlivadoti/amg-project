import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

/**
 * Tests del FACTORY de publicación y del publisher live.
 *
 * No existían, y su ausencia dejaba pasar dos bugs que la 6ª review encontró:
 *  · un cliente **sin** space caía al `STORYBLOK_SPACE_ID` global → publicaba en el space de OTRO;
 *  · el cuerpo iba **sin** `publish: 1` → las stories quedaban en draft y la base las daba por
 *    publicadas.
 *
 * `config` se congela al importarse, así que el entorno se fija ANTES del import dinámico: acá
 * simulamos producción con un space global configurado, que es justo el escenario peligroso.
 */

process.env["WEB_PUBLISH_MODE"] = "storyblok";
process.env["STORYBLOK_MANAGEMENT_TOKEN"] = "tok";
process.env["STORYBLOK_SPACE_ID"] = "space-GLOBAL"; // el legado: el de algún cliente anterior
process.env["STORYBLOK_REGION"] = "eu";
// Explícito, y no "no lo toco": `config` importa `dotenv/config`, así que un `.env` del paquete con
// `STORYBLOK_DRY_RUN=1` volvería dry-run TODO este archivo y lo de abajo dejaría de probar el modo live.
process.env["STORYBLOK_DRY_RUN"] = "0";

const { getPublisher, modoPublicacion } = await import("./publisher.js");
const { StoryblokPublisher, StoryblokDryRunPublisher } = await import("./storyblok-publisher.js");
const { MockPublisher } = await import("./mock-publisher.js");
const { briefToStories } = await import("../handoff/adapter.js");
const { validBrief } = await import("../fixtures.js");

let urls: Array<{ url: string; method: string; body: any }> = [];
let fetchOriginal: typeof globalThis.fetch;

function stubStoryblok() {
  urls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    urls.push({ url: u, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
    // GET /stories?with_slug → "no existe" → fuerza un create (POST).
    if ((init?.method ?? "GET") === "GET") {
      return new Response(JSON.stringify({ stories: [] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    // POST/PUT → devuelve la story publicada.
    return new Response(
      JSON.stringify({ story: { id: 123, published: true } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof globalThis.fetch;
}

beforeEach(() => {
  fetchOriginal = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/** Una story real, construida por el adapter desde un brief válido (no un mock a medias). */
const story = () => briefToStories(validBrief())[0]!;

// ================================================================
// #1 — el factory NO debe caer al space global cuando el cliente no tiene el suyo
// ================================================================

/**
 * 🔴 EL AGUJERO DEL `??`.
 *
 * `null` = el orquestador consultó y el cliente NO tiene space. Eso debe ir a dry-run, JAMÁS al
 * global: publicar ahí sobrescribe las páginas de otro cliente. El bug era `spaceId ?? global`, que
 * trata `null` igual que "no me pasaron nada".
 */
test("🔴 un cliente con space null NO obtiene un publisher live al space global", () => {
  const pub = getPublisher(null);
  assert.ok(
    pub instanceof StoryblokDryRunPublisher,
    "sin space del cliente NO se publica: escribir en el space global es escribir en el de otro",
  );
});

test("undefined (el CLI monocliente) SÍ puede usar el space global", () => {
  const pub = getPublisher(undefined);
  assert.ok(pub instanceof StoryblokPublisher, "el CLI sin cliente usa la config global, es su modo");
});

test("con el space del cliente, publica en ESE space y en ningún otro", async () => {
  stubStoryblok();
  const pub = getPublisher("space-A");
  assert.ok(pub instanceof StoryblokPublisher);

  await pub.publish([story()], new Map([["menu", "<html></html>"]]));

  assert.ok(urls.length > 0, "hubo llamadas");
  for (const { url } of urls) {
    assert.ok(url.includes("/spaces/space-A/"), `toda llamada va a space-A, no a: ${url}`);
    assert.ok(!url.includes("space-GLOBAL"), "NUNCA se toca el space global");
  }
});

test("mock cuando WEB_PUBLISH_MODE no es storyblok se maneja por config — acá es storyblok, así que live", () => {
  // Guarda de humo: en este entorno el modo es storyblok, no mock.
  assert.ok(!(getPublisher("space-A") instanceof MockPublisher));
});

// ================================================================
// #1b — lo que `/_health` reporta (paso C-0 del plan)
// ================================================================

/**
 * El estado **live**, que es el único que gasta y el único irreversible. Los otros dos viven en sus
 * propios archivos porque `config` se congela al importarse y cada estado necesita su entorno.
 */
test("con token y modo storyblok, el proceso se reporta `live`", () => {
  assert.equal(modoPublicacion(), "live");
  assert.ok(getPublisher("space-A") instanceof StoryblokPublisher, "y construye lo que reporta");
});

/**
 * 🔴 **El modo es del PROCESO, no de la corrida**, y esta es la diferencia que un comentario no
 * puede sostener solo.
 *
 * Un cliente sin `storyblok_space_id` publica en dry-run —lo fija el primer test de este archivo—
 * pero eso **no** convierte al servicio en dry-run: la próxima publicación, la de un cliente que sí
 * tiene space, va a escribir de verdad. Si `modoPublicacion()` mirase al cliente, `/_health`
 * respondería `dry-run` en un proceso armado para publicar, que es la mentira tranquilizadora.
 */
test("🔴 un cliente sin space NO baja el modo del servicio: sigue siendo `live`", () => {
  assert.ok(getPublisher(null) instanceof StoryblokDryRunPublisher, "esa publicación es dry-run…");
  assert.equal(modoPublicacion(), "live", "…pero el proceso sigue armado para publicar de verdad");
});

// ================================================================
// #2 — el publisher live manda `publish: 1` (si no, quedan drafts)
// ================================================================

/**
 * 🔴 EL DRAFT DISFRAZADO DE PUBLICADO.
 *
 * Sin `publish: 1`, la Management API deja la story en draft. El cuerpo tiene que llevarlo, y el
 * resultado tiene que reflejar lo que el proveedor confirma (`published`), no lo que pedimos.
 */
test("🔴 el cuerpo del create/update lleva publish: 1", async () => {
  stubStoryblok();
  const pub = new StoryblokPublisher({ spaceId: "space-A", managementToken: "tok", mapiHost: "https://mapi.storyblok.com" });

  const res = await pub.publish([story()], new Map([["menu", "<html></html>"]]));

  const escrituras = urls.filter((u) => u.method === "POST" || u.method === "PUT");
  assert.ok(escrituras.length > 0, "hubo al menos un create/update");
  for (const e of escrituras) {
    assert.equal(e.body?.publish, 1, "sin publish:1 la story queda en draft y la base mentiría");
  }
  assert.equal(res[0]?.published, true, "se refleja lo que el proveedor CONFIRMA, no lo que pedimos");
});

test("🔴 si el proveedor devuelve published:false, el resultado NO dice publicado", async () => {
  urls = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "GET") return new Response(JSON.stringify({ stories: [] }), { status: 200, headers: { "content-type": "application/json" } });
    // El proveedor NO confirma la publicación (quedó en draft).
    return new Response(JSON.stringify({ story: { id: 9, published: false } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof globalThis.fetch;

  const pub = new StoryblokPublisher({ spaceId: "space-A", managementToken: "tok", mapiHost: "https://mapi.storyblok.com" });
  const res = await pub.publish([story()], new Map([["menu", "<html></html>"]]));
  assert.equal(res[0]?.published, false, "la base no puede afirmar 'publicado' si el proveedor no lo confirma");
});

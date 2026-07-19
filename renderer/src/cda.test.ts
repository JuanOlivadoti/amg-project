import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CDA_BASE, ErrorCda, StoryblokCda, type FetchLike } from "./cda.js";

/** `fetch` de mentira que anota la URL pedida: es lo que hace testeable esto sin red ni credenciales. */
function espia(respuesta: Partial<Response> & { json?: () => Promise<unknown> }) {
  const urls: string[] = [];
  const fetch: FetchLike = async (url) => {
    urls.push(url);
    return {
      status: 200,
      ok: true,
      json: async () => ({ story: { name: "x", slug: "menu", content: {} } }),
      ...respuesta,
    } as Response;
  };
  return { fetch, urls };
}

const pedir = (fetch: FetchLike, slug = "menu") =>
  new StoryblokCda({ fetch }).traerStory({ slug, token: "pub-111", version: "published" });

describe("StoryblokCda", () => {
  it("pega a la Content Delivery API con el token y la versión", async () => {
    const { fetch, urls } = espia({});
    await pedir(fetch);

    const url = new URL(urls[0]!);
    assert.ok(urls[0]!.startsWith(`${CDA_BASE}/stories/menu`));
    assert.equal(url.searchParams.get("token"), "pub-111");
    assert.equal(url.searchParams.get("version"), "published");
  });

  it("un 404 es `null`: la story no existe", async () => {
    const { fetch } = espia({ status: 404, ok: false });
    assert.equal(await pedir(fetch), null);
  });

  it("🔴 un 500 LANZA en vez de devolver null", async () => {
    // Si un fallo del origen se convirtiera en `null`, el renderizador cachearía un 404 y borraría
    // la web del cliente hasta que venciera el TTL. "No está" y "se rompió" no son lo mismo.
    const { fetch } = espia({ status: 500, ok: false });
    await assert.rejects(() => pedir(fetch), (e: ErrorCda) => e.status === 500);
  });

  it("🔴 un timeout es 504, no un cuelgue", async () => {
    // Una petición colgada al origen sin tope bloquea al renderizador — y con ADR-19 eso son todas
    // las webs de cliente a la vez.
    const fetch: FetchLike = () => new Promise((_, rej) => setTimeout(() => rej(new Error("abort")), 5));
    const cda = new StoryblokCda({ fetch, timeoutMs: 1 });

    await assert.rejects(
      () => cda.traerStory({ slug: "menu", token: "t", version: "published" }),
      (e: ErrorCda) => e.status === 504,
    );
  });

  it("🔴 el mensaje de error NO propaga el cuerpo de Storyblok", async () => {
    // El cuerpo de un error de Storyblok puede traer el token, y de acá el mensaje va a un log.
    const { fetch } = espia({
      status: 403,
      ok: false,
      json: async () => ({ error: "token pub-111 inválido" }),
    });

    await assert.rejects(
      () => pedir(fetch),
      (e: ErrorCda) => !e.message.includes("pub-111") && e.status === 403,
    );
  });

  it("🔴 un slug con `../` no puede salirse de la ruta de stories", async () => {
    // El slug viene del path de una petición anónima. Sin escapar, un `../` reescribe a qué endpoint
    // de la API de Storyblok se está llamando.
    // El invariante es "queda bajo /stories/", no "no aparece la palabra spaces": un slug legítimo
    // podría llamarse `spaces/111` y estaría perfecto. Lo que no puede es SALIRSE de la base.
    const { fetch, urls } = espia({});
    await pedir(fetch, "../../spaces/111");

    assert.equal(new URL(urls[0]!).pathname, "/v2/cdn/stories/spaces/111");
  });

  it("🔴 un slug de puros `..` no deja una URL sin ruta", async () => {
    const { fetch, urls } = espia({});
    await pedir(fetch, "../../..");
    assert.equal(new URL(urls[0]!).pathname, "/v2/cdn/stories/");
  });

  it("🔴 un slug no puede inyectar parámetros de query", async () => {
    // Sin escapar, `menu?version=draft` cambiaría la versión pedida: borradores servidos al público
    // por la vía más tonta posible.
    const { fetch, urls } = espia({});
    await pedir(fetch, "menu?version=draft&token=otro");

    const url = new URL(urls[0]!);
    assert.equal(url.searchParams.get("version"), "published");
    assert.equal(url.searchParams.get("token"), "pub-111");
  });

  it("un slug anidado se conserva como ruta", async () => {
    const { fetch, urls } = espia({});
    await pedir(fetch, "carta/postres");
    assert.ok(urls[0]!.startsWith(`${CDA_BASE}/stories/carta/postres`));
  });

  it("una respuesta 200 sin `story` es null, no una excepción", async () => {
    const { fetch } = espia({ json: async () => ({}) });
    assert.equal(await pedir(fetch), null);
  });
});

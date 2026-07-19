import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { MemSitios, type Sitio } from "db";
import type { Story } from "web-builder";
import { createApp } from "./app.js";
import { CacheRender } from "./cache.js";
import { ErrorCda, MockCda } from "./cda.js";
import { firmarPreview, PARAM_FIRMA, PARAM_VENCE } from "./preview.js";
import { HEADER_FIRMA } from "./webhook.js";

// ------------------------------------------------------------------ andamiaje

const WEBHOOK_SECRET = "secreto-de-webhook";
const PREVIEW_SECRET = "secreto-de-preview";

/**
 * `titular` y no `name`: `renderStory()` no renderiza el nombre de la story. Las fixtures tienen que
 * diferenciarse por lo que de verdad SALE al HTML, si no un test de aislamiento pasa por accidente
 * comparando algo que ninguna página muestra.
 */
function story(titular = "La carta", over: Partial<Story> = {}): Story {
  return {
    name: titular,
    slug: "menu",
    content: {
      component: "page",
      seo: {
        title: "Menú | Trattoria",
        description: "Nuestra carta",
        canonical: "https://bellanapoli.es/menu",
        og_title: "Menú",
        og_description: "Nuestra carta",
      },
      schema_type: "LocalBusiness",
      page_type: "servicio",
      intent: "local",
      is_local: true,
      body: [{ component: "hero", headline: titular, subhead: "Cocina napolitana" }],
      meta: {
        contract_version: "web.v0.1",
        source_keyword: "restaurante italiano madrid",
        secondary_keywords: [],
        internal_links: [],
        word_count_objetivo: 800,
        opportunity_score: 70,
        volumen: 1000,
        dificultad: 30,
      },
    },
    ...over,
  };
}

const sitioA: Sitio = {
  clientId: "c-a",
  domain: "bellanapoli.es",
  spaceId: "111",
  publicToken: "pub-111",
  previewToken: "prv-111",
  businessProfile: null,
  languageCode: "es",
};

const sitioB: Sitio = {
  clientId: "c-b",
  domain: "sushizen.es",
  spaceId: "222",
  publicToken: "pub-222",
  previewToken: "prv-222",
  businessProfile: null,
  languageCode: "es",
};

function montar(over: Partial<Parameters<typeof createApp>[0]> = {}) {
  const cda = new MockCda();
  cda.poner("pub-111", "published", "menu", story("La carta"));
  cda.poner("pub-111", "published", "home", story("Trattoria Bella Napoli", { slug: "home" }));
  cda.poner("prv-111", "draft", "menu", story("La carta BORRADOR"));
  cda.poner("pub-222", "published", "menu", story("Sushi Zen"));

  const cache = new CacheRender();
  const app = createApp({
    sitios: new MemSitios([sitioA, sitioB]),
    cda,
    cache,
    webhookSecret: WEBHOOK_SECRET,
    previewSecret: PREVIEW_SECRET,
    ...over,
  });
  return { app, cda, cache };
}

const pedir = (app: ReturnType<typeof createApp>, path: string, host: string, headers: Record<string, string> = {}) =>
  app.request(`http://${host}${path}`, { headers: { host, ...headers } });

// ------------------------------------------------------------------ servir

describe("renderizador — servir la web del cliente", () => {
  it("sirve la página del dominio, renderizada", async () => {
    const { app } = montar();
    const res = await pedir(app, "/menu", "bellanapoli.es");

    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1>La carta<\/h1>/);
    assert.match(html, /application\/ld\+json/, "el JSON-LD es la razón de ser del render (ADR-04)");
  });

  it("la raíz del dominio sirve `home`", async () => {
    const { app, cda } = montar();
    const res = await pedir(app, "/", "bellanapoli.es");

    assert.equal(res.status, 200);
    assert.equal(cda.pedidos.at(-1)?.slug, "home");
  });

  it("🔴 el MISMO path en dos dominios sirve cada web con SU token", async () => {
    // Es el corazón de "1 servicio, N dominios". Si esto se cruza, un restaurante muestra el menú
    // de otro — la fuga de 0006, del lado de la lectura.
    const { app, cda } = montar();

    const a = await (await pedir(app, "/menu", "bellanapoli.es")).text();
    const b = await (await pedir(app, "/menu", "sushizen.es")).text();

    assert.match(a, /<h1>La carta<\/h1>/);
    assert.match(b, /Sushi Zen/);
    assert.deepEqual(
      cda.pedidos.map((p) => p.token),
      ["pub-111", "pub-222"],
      "cada dominio tiene que consultar el space de SU cliente",
    );
  });

  it("🔴 un dominio desconocido es 404, sin fallback a ningún cliente", async () => {
    // Un "si no reconozco el host, sirvo el primero" convierte cualquier dominio apuntado a nuestra
    // IP en una copia de la web de un cliente ajeno.
    const { app, cda } = montar();
    const res = await pedir(app, "/menu", "dominio-cualquiera.es");

    assert.equal(res.status, 404);
    assert.equal(cda.pedidos.length, 0, "ni siquiera se consulta a Storyblok");
  });

  it("un cliente con dominio pero SIN space es 404, no un 500", async () => {
    const { app } = montar({
      sitios: new MemSitios([{ ...sitioA, spaceId: null }]),
    });
    assert.equal((await pedir(app, "/menu", "bellanapoli.es")).status, 404);
  });

  it("una story que no existe es 404", async () => {
    const { app } = montar();
    assert.equal((await pedir(app, "/no-existe", "bellanapoli.es")).status, 404);
  });

  it("🔴 si Storyblok falla, es 503 y NO se cachea el fallo", async () => {
    // Cachear "no existe" porque el origen tuvo un mal minuto borra la web del cliente hasta el TTL.
    const cda = {
      llamadas: 0,
      async traerStory() {
        this.llamadas++;
        throw new ErrorCda("caído", 500);
      },
    };
    const cache = new CacheRender();
    const app = createApp({ sitios: new MemSitios([sitioA]), cda, cache });

    assert.equal((await pedir(app, "/menu", "bellanapoli.es")).status, 503);
    assert.equal(cache.tamano, 0, "un fallo del origen no deja rastro en la cache");
    await pedir(app, "/menu", "bellanapoli.es");
    assert.equal(cda.llamadas, 2, "la siguiente visita tiene que reintentar");
  });

  it("🔴 no confía en X-Forwarded-Host por defecto", async () => {
    const { app } = montar();
    const res = await pedir(app, "/menu", "bellanapoli.es", { "x-forwarded-host": "sushizen.es" });

    assert.match(await res.text(), /<h1>La carta<\/h1>/, "la cabecera del atacante no elige el sitio");
  });
});

// ------------------------------------------------------------------ cache

describe("renderizador — cache", () => {
  it("la segunda visita no vuelve a pegarle a Storyblok", async () => {
    const { app, cda } = montar();

    const uno = await pedir(app, "/menu", "bellanapoli.es");
    const dos = await pedir(app, "/menu", "bellanapoli.es");

    assert.equal(uno.headers.get("x-amg-cache"), "miss");
    assert.equal(dos.headers.get("x-amg-cache"), "hit");
    assert.equal(cda.pedidos.length, 1, "es lo que hace que 'runtime' no sea caro (ADR-19)");
  });

  it("el webhook firmado invalida el space y la visita siguiente re-renderiza", async () => {
    const { app, cda } = montar();
    await pedir(app, "/menu", "bellanapoli.es");

    const body = JSON.stringify({ action: "published", space_id: 111, story_id: 9 });
    const res = await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body,
      headers: { [HEADER_FIRMA]: createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex") },
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, invalidadas: 1 });

    await pedir(app, "/menu", "bellanapoli.es");
    assert.equal(cda.pedidos.length, 2);
  });

  it("🔴 un webhook SIN firma no vacía nada", async () => {
    // Sin esto, el endpoint es un botón público para tirar la cache de cualquier cliente: se
    // convierte un servicio que sirve de memoria en uno que paga la CDA en cada visita.
    const { app, cache } = montar();
    await pedir(app, "/menu", "bellanapoli.es");
    assert.equal(cache.tamano, 1);

    const res = await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body: JSON.stringify({ space_id: 111 }),
    });

    assert.equal(res.status, 401);
    assert.equal(cache.tamano, 1, "la cache sigue intacta");
  });

  it("🔴 un webhook con firma de OTRO secreto tampoco", async () => {
    const { app, cache } = montar();
    await pedir(app, "/menu", "bellanapoli.es");

    const body = JSON.stringify({ space_id: 111 });
    const res = await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body,
      headers: { [HEADER_FIRMA]: createHmac("sha1", "otro-secreto").update(body).digest("hex") },
    });

    assert.equal(res.status, 401);
    assert.equal(cache.tamano, 1);
  });

  it("🔴 sin secreto configurado el webhook queda CERRADO, no abierto", async () => {
    const app = createApp({ sitios: new MemSitios([sitioA]), cda: new MockCda() });
    const res = await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body: JSON.stringify({ space_id: 111 }),
    });
    assert.equal(res.status, 503, "fail-closed: una config incompleta no puede abrir la puerta");
  });

  it("🔴 un webhook del space 222 NO vacía la cache del 111", async () => {
    const { app, cache } = montar();
    await pedir(app, "/menu", "bellanapoli.es");
    await pedir(app, "/menu", "sushizen.es");
    assert.equal(cache.tamano, 2);

    const body = JSON.stringify({ space_id: 222 });
    await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body,
      headers: { [HEADER_FIRMA]: createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex") },
    });

    assert.equal(cache.get("111", "menu")?.includes("La carta"), true);
    assert.equal(cache.get("222", "menu"), null);
  });

  it("el health check no depende de Storyblok ni de la base", async () => {
    // Si dependiera, el orquestador de despliegue mataría el servicio cuando el caído es Storyblok
    // — cambiando "servir de cache" por "todas las webs abajo a la vez" (el riesgo de ADR-19).
    const app = createApp({
      sitios: {
        porDominio: () => {
          throw new Error("base caída");
        },
      },
      cda: {
        traerStory: () => {
          throw new Error("storyblok caído");
        },
      },
    });
    assert.equal((await app.request("http://x/_health")).status, 200);
  });
});

// ------------------------------------------------------------------ preview

describe("renderizador — preview del Visual Editor", () => {
  const conFirma = (dominio: string) => {
    const { firma, vence } = firmarPreview(PREVIEW_SECRET, dominio);
    return `${PARAM_FIRMA}=${firma}&${PARAM_VENCE}=${vence}`;
  };

  it("con firma válida sirve el BORRADOR y mete el Bridge", async () => {
    const { app } = montar();
    const res = await pedir(app, `/menu?${conFirma("bellanapoli.es")}`, "bellanapoli.es");

    const html = await res.text();
    assert.match(html, /La carta BORRADOR/);
    assert.match(html, /storyblok-v2-latest\.js/, "sin el Bridge el Visual Editor no funciona");
    assert.equal(res.headers.get("x-robots-tag"), "noindex");
  });

  it("🔴 SIN firma sirve lo publicado, no el borrador", async () => {
    // Es el punto entero: publicado es público por definición, el borrador es lo contrario.
    const { app } = montar();
    const html = await (await pedir(app, "/menu", "bellanapoli.es")).text();

    assert.doesNotMatch(html, /BORRADOR/);
    assert.doesNotMatch(html, /storyblok-v2-latest/);
  });

  it("🔴 una firma de OTRO dominio no sirve para espiar este borrador", async () => {
    const { app } = montar();
    const html = await (await pedir(app, `/menu?${conFirma("sushizen.es")}`, "bellanapoli.es")).text();
    assert.doesNotMatch(html, /BORRADOR/);
  });

  it("🔴 una firma vencida no sirve", async () => {
    const { firma, vence } = firmarPreview(PREVIEW_SECRET, "bellanapoli.es", -1_000);
    const { app } = montar();
    const html = await (
      await pedir(app, `/menu?${PARAM_FIRMA}=${firma}&${PARAM_VENCE}=${vence}`, "bellanapoli.es")
    ).text();

    assert.doesNotMatch(html, /BORRADOR/, "un enlace filtrado tiene que dejar de servir solo");
  });

  it("🔴 sin PREVIEW_SECRET configurado no hay borradores, ni con firma", async () => {
    const { app } = montar({ previewSecret: undefined });
    const html = await (await pedir(app, `/menu?${conFirma("bellanapoli.es")}`, "bellanapoli.es")).text();
    assert.doesNotMatch(html, /BORRADOR/);
  });

  it("🔴 el preview NO se guarda en la cache pública", async () => {
    // Guardar un borrador en la cache que sirve al público es cómo un borrador se publica solo.
    const { app, cache } = montar();
    const res = await pedir(app, `/menu?${conFirma("bellanapoli.es")}`, "bellanapoli.es");

    assert.equal(res.headers.get("x-amg-cache"), "bypass");
    assert.equal(cache.tamano, 0);
    assert.doesNotMatch(await (await pedir(app, "/menu", "bellanapoli.es")).text(), /BORRADOR/);
  });
});

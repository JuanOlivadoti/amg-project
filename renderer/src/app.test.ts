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

  it("🔴 una base COLGADA no tumba las páginas que ya están en cache (10ª review, #4)", async () => {
    // El orden era `resolver dominio (DB) → mirar cache`, así que una base que acepta la conexión y
    // no responde dejaba pendiente hasta una página cacheada. Ahora la resolución se cachea y una
    // visita repetida no vuelve a pasar por Postgres.
    let colgada = false;
    const sitiosLentos = {
      porDominio: async (d: string) => {
        if (colgada) return new Promise<never>(() => {}); // no resuelve NUNCA
        return d === "bellanapoli.es" ? sitioA : null;
      },
    };
    const app = createApp({ sitios: sitiosLentos, cda: montar().cda, cache: new CacheRender() });

    assert.equal((await pedir(app, "/menu", "bellanapoli.es")).status, 200);
    colgada = true;

    const conPlazo = await Promise.race<number | string>([
      Promise.resolve(pedir(app, "/menu", "bellanapoli.es")).then((r) => r.status),
      new Promise<string>((r) => setTimeout(() => r("COLGADA"), 300)),
    ]);
    assert.equal(conPlazo, 200, "la página cacheada tiene que salir sin preguntarle a Postgres");
  });

  it("🔴 enumerar paths inexistentes deja de golpear el origen (10ª review, #3)", async () => {
    // `/a-1`, `/a-2`, `/a-3`… cada uno provocaba una llamada a la CDA. Es un bucle con curl, no un
    // ataque ingenioso, y lo paga nuestra cuenta de Storyblok.
    const { app, cda } = montar();

    await pedir(app, "/no-existe", "bellanapoli.es");
    await pedir(app, "/no-existe", "bellanapoli.es");
    await pedir(app, "/no-existe", "bellanapoli.es");

    assert.equal(cda.pedidos.length, 1, "el 404 se recuerda un rato corto");
  });

  it("🔴 N visitas simultáneas al mismo slug frío son UNA llamada al origen", async () => {
    // Cache stampede: cien visitas a una portada recién invalidada eran cien llamadas a la CDA. Y
    // un webhook de invalidación lo vuelve fácil de provocar a propósito.
    let llamadas = 0;
    const cda = {
      async traerStory() {
        llamadas++;
        await new Promise((r) => setTimeout(r, 20));
        return story("La carta");
      },
    };
    const app = createApp({ sitios: new MemSitios([sitioA]), cda, cache: new CacheRender() });

    const todas = await Promise.all(
      Array.from({ length: 10 }, () => pedir(app, "/menu", "bellanapoli.es")),
    );

    assert.ok(todas.every((r) => r.status === 200), "las diez tienen que salir bien");
    assert.equal(llamadas, 1, "y con una sola llamada a Storyblok");
  });

  it("🔴 un pico se rechaza con 503 en vez de acumular trabajo sin techo", async () => {
    // Una cola infinita no protege: convierte un pico en latencia creciente hasta quedarse sin
    // memoria. Un 503 rápido deja el proceso vivo para las páginas que ya están en cache.
    const cda = {
      traerStory: () => new Promise<never>(() => {}), // se queda en vuelo
    };
    const app = createApp({
      sitios: new MemSitios([sitioA]),
      cda,
      cache: new CacheRender(),
      maxConcurrencia: 2,
    });

    // Dos ocupan el semáforo (y no resuelven); la tercera, con OTRO slug para saltear el coalescing.
    void pedir(app, "/menu", "bellanapoli.es");
    void pedir(app, "/otra", "bellanapoli.es");
    await new Promise((r) => setTimeout(r, 20));

    const tercera = await pedir(app, "/tercera", "bellanapoli.es");
    assert.equal(tercera.status, 503);
    assert.equal(tercera.headers.get("retry-after"), "2");
  });

  it("🔴 el webhook rechaza un cuerpo enorme ANTES de leerlo (10ª review, #3)", async () => {
    // Verificar la firma exige el cuerpo entero, así que sin corte previo un anónimo SIN el secreto
    // nos hace bufferear lo que quiera: la firma lo rechazaría después de comernos la memoria.
    const { app } = montar();
    const enorme = "x".repeat(300 * 1024);

    const res = await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body: enorme,
      headers: { "content-length": `${enorme.length}` },
    });

    assert.equal(res.status, 413);
  });

  it("🔴 un webhook firmado REPETIDO no invalida dos veces (10ª review, #7)", async () => {
    // La firma autentica el cuerpo y nada más: sin timestamp ni id de entrega, una petición
    // legítima capturada se repite para siempre. Repetirla en bucle es cache busting gratis.
    const { app, cda } = montar();
    await pedir(app, "/menu", "bellanapoli.es");

    const body = JSON.stringify({ action: "published", space_id: 111 });
    const firma = createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex");
    const enviar = () =>
      app.request("http://x/_webhook/storyblok", {
        method: "POST",
        body,
        headers: { [HEADER_FIRMA]: firma },
      });

    assert.deepEqual(await (await enviar()).json(), { ok: true, invalidadas: 1 });

    const repetido = await enviar();
    assert.equal(repetido.status, 200);
    assert.deepEqual(await repetido.json(), { ok: true, invalidadas: 0, repetido: true });

    // Y no se re-renderizó de más: una invalidación, un re-render.
    await pedir(app, "/menu", "bellanapoli.es");
    assert.equal(cda.pedidos.length, 2);
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

// ------------------------------------------------------------------ navegación y home

describe("renderizador — navegación entre páginas", () => {
  it("una página normal sale con la barra de navegación del sitio", async () => {
    const { app, cda } = montar();
    cda.ponerNav("pub-111", "published", [
      { slug: "menu", name: "La carta" },
      { slug: "reservas", name: "Reservas" },
    ]);
    const html = await (await pedir(app, "/menu", "bellanapoli.es")).text();

    assert.match(html, /<nav class="nav"/, "la página lleva la barra del sitio");
    assert.match(html, /href="\/reservas"[^>]*>Reservas<\/a>/, "enlaza a las otras páginas");
  });

  it("🔴 si la nav falla, la página se sirve igual — sin barra, no 503", async () => {
    // La barra es una mejora: un fallo de la Links API no puede tumbar la web. Sería regalarle al
    // origen un modo de tirar todas las páginas de todos los clientes a la vez (el riesgo de ADR-19).
    const cda = {
      async traerStory() {
        return story("La carta");
      },
      async traerNav(): Promise<never> {
        throw new ErrorCda("links caído", 500);
      },
    };
    const app = createApp({ sitios: new MemSitios([sitioA]), cda, cache: new CacheRender() });
    const res = await pedir(app, "/menu", "bellanapoli.es");

    assert.equal(res.status, 200, "la página sale aunque la nav no");
    assert.doesNotMatch(await res.text(), /<nav class="nav"/, "sin barra, pero servida");
  });

  it("la nav pública se cachea por space y el webhook la invalida", async () => {
    const { app, cda } = montar();

    await pedir(app, "/menu", "bellanapoli.es"); // miss: 1 llamada a la Links API
    await pedir(app, "/menu", "bellanapoli.es"); // hit de página: no vuelve a pedir nav
    assert.equal(cda.pedidosNav.length, 1, "la nav no se re-pide en cada visita");

    const body = JSON.stringify({ action: "published", space_id: 111 });
    await app.request("http://x/_webhook/storyblok", {
      method: "POST",
      body,
      headers: { [HEADER_FIRMA]: createHmac("sha1", WEBHOOK_SECRET).update(body).digest("hex") },
    });

    await pedir(app, "/menu", "bellanapoli.es"); // el webhook vació ambas caches → re-pide nav
    assert.equal(cda.pedidosNav.length, 2, "publicar una página nueva refresca la barra");
  });

  it("🔴 la nav del preview usa borradores y NO se cachea", async () => {
    const { firma, vence } = firmarPreview(PREVIEW_SECRET, "bellanapoli.es");
    const q = `${PARAM_FIRMA}=${firma}&${PARAM_VENCE}=${vence}`;
    const { app, cda } = montar();

    await pedir(app, `/menu?${q}`, "bellanapoli.es");
    await pedir(app, `/menu?${q}`, "bellanapoli.es");

    const draft = cda.pedidosNav.filter((p) => p.version === "draft");
    assert.equal(draft.length, 2, "cada preview re-pide la nav en draft: nunca se cachea el borrador");
  });
});

// ------------------------------------------------------------------ la raíz del dominio (home)

describe("renderizador — la home", () => {
  it("con story `home` publicada, la raíz sirve esa story", async () => {
    const { app, cda } = montar();
    const res = await pedir(app, "/", "bellanapoli.es");

    assert.equal(res.status, 200);
    assert.equal(cda.pedidos.at(-1)?.slug, "home");
    assert.match(await res.text(), /<h1>Trattoria Bella Napoli<\/h1>/);
  });

  it("🔴 sin story `home`, la raíz sintetiza un índice — no da 404", async () => {
    // Las páginas del pipeline son landings aisladas: sin esto, la raíz de un dominio recién
    // publicado da 404. La home sintetizada cubre ese hueco con el índice de las páginas.
    const { app, cda } = montar();
    cda.ponerNav("pub-222", "published", [{ slug: "menu", name: "La carta" }]);
    const res = await pedir(app, "/", "sushizen.es"); // sitioB no tiene story `home`

    assert.equal(res.status, 200, "la raíz de un dominio válido nunca es 404");
    const html = await res.text();
    assert.match(html, /^<!doctype html>/, "es una página completa");
    assert.match(html, /class="card" href="\/menu"/, "con el índice de las páginas publicadas");
  });

  it("la home sintetizada se sirve desde cache en la segunda visita", async () => {
    const { app, cda } = montar();
    await pedir(app, "/", "sushizen.es");
    const dos = await pedir(app, "/", "sushizen.es");

    assert.equal(dos.headers.get("x-amg-cache"), "hit");
    // Solo la primera visita pegó al origen buscando la story `home` (que no existe).
    assert.equal(cda.pedidos.filter((p) => p.token === "pub-222").length, 1);
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
    assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  });

  it("🔴 el preview se marca NO CACHEABLE, no solo no indexable (10ª review, #5)", async () => {
    // `noindex` evita que Google lo liste; **no** evita que una CDN lo guarde. ADR-19 exige una CDN
    // delante, y el default frecuente es cachear HTML por host+path ignorando la query — o sea,
    // ignorando la firma. Una visita firmada llenaría el borde con el borrador y un anónimo lo
    // recibiría. El servicio tiene que decirlo él, no confiar en configuración externa perfecta.
    const { app } = montar();
    const res = await pedir(app, `/menu?${conFirma("bellanapoli.es")}`, "bellanapoli.es");

    const cc = res.headers.get("cache-control") ?? "";
    assert.match(cc, /no-store/, `el borrador no puede guardarse en ningún lado: ${cc}`);
    assert.match(cc, /private/);
  });

  it("una página pública SÍ declara que se puede cachear", async () => {
    // La otra mitad: sin `Cache-Control`, cada CDN inventa su heurística. Se declara una vez.
    const { app } = montar();
    const res = await pedir(app, "/menu", "bellanapoli.es");

    assert.match(res.headers.get("cache-control") ?? "", /public/);
  });

  it("🔴 SIN firma sirve lo publicado, no el borrador", async () => {
    // Es el punto entero: publicado es público por definición, el borrador es lo contrario.
    const { app } = montar();
    const html = await (await pedir(app, "/menu", "bellanapoli.es")).text();

    assert.doesNotMatch(html, /BORRADOR/);
    assert.doesNotMatch(html, /storyblok-v2-latest/);
  });

  it("la firma vale para TODO el dominio, a propósito (10ª review, #6)", async () => {
    // Decisión, no descuido: el Visual Editor es un editor donde se NAVEGA entre las páginas del
    // space. Un enlace por-path obligaría a re-firmar en cada clic. Lo que acota el riesgo es que
    // está atado al dominio, que vence, y que solo lo emite la agencia. Ver `preview.ts`.
    const { app, cda } = montar();
    await pedir(app, `/otra-pagina?${conFirma("bellanapoli.es")}`, "bellanapoli.es");

    assert.equal(cda.pedidos.at(-1)?.version, "draft", "el mismo enlace sirve para otro slug");
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

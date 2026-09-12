import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { MemSitios, PgSitios, PglitePool, aplicarMigraciones, type Sitio } from "db";
import type { Story } from "web-builder";
import { createApp } from "./app.js";
import { ErrorCda, MockCda, type FetchLike } from "./cda.js";
import {
  ARCHIVO_INFORME,
  DIR_FUENTES,
  DIR_IMG,
  USO,
  activosDe,
  codigoDeSalida,
  correrSnapshot,
  generarSnapshot,
  motivoDeRechazo,
  MAX_REDIRECCIONES,
  PLAZO_DESCARGA_MS,
  referenciasDe,
  nombreLocal,
  rutaDePagina,
  type DepsSnapshot,
  type ResultadoSnapshot,
  type Salida,
} from "./snapshot.js";

/**
 * **El snapshot estático de salida** (ADR-11): el entregable de un cliente que se da de baja.
 *
 * El gate de aceptación no es "el comando corre": es **cero terceros, comprobado**. Un snapshot que
 * sigue pidiéndole una foto a `a.storyblok.com` no cumple la cláusula que se firma —«sin dependencia
 * de AMG OS ni de Storyblok»— y el modo de fallo es silencioso: se ve perfecto mientras haya red
 * hacia nosotros. Por eso los dos tests que importan acá recorren **los archivos escritos en disco**,
 * no el valor de retorno de una función.
 *
 * ⚠️ Los dos llevan **control de no-vacuidad**, y no es ceremonia: un barrido que recorre cero
 * referencias pasa feliz sin probar nada. Es exactamente la trampa que el test de cero terceros del
 * `<style>` (`web-builder/src/render/shell.test.ts`) ya tuvo que cerrar con un test hermano.
 *
 * Todo corre **sin credenciales**: PGlite en memoria, un `MockCda` y un `fetch` de mentira.
 */

// ─────────────────────────────────────────────────────────────────────── andamiaje

const DOMINIO = "bellanapoli.es";
const TOKEN = "pub-111";

/** Las fotos de contenido: host de la allowlist (`a.storyblok.com`), que es lo único que el render emite. */
const FOTO = {
  logo: "https://a.storyblok.com/f/1/250x250/aaaaaaaaaa/logo.png",
  portada: "https://a.storyblok.com/f/1/2560x1440/bbbbbbbbbb/portada.jpg",
  galeria1: "https://a.storyblok.com/f/1/1600x1200/cccccccccc/galeria-1.jpg",
  galeria2: "https://a.storyblok.com/f/1/1600x1200/dddddddddd/galeria-2.jpg",
  plato: "https://a.storyblok.com/f/1/800x800/eeeeeeeeee/plato.jpg",
  categoria: "https://a.storyblok.com/f/1/1200x800/ffffffffff/categoria.jpg",
} as const;

/**
 * La **imagen social** (`og:image` + el `image` del JSON-LD) vive en el dominio del PROPIO cliente.
 *
 * No es un capricho de la fixture: es el caso normal y la razón de que `imagenPublicable` no aplique
 * la allowlist de hosts (ver su docstring). Si el snapshot solo supiera bajar de `a.storyblok.com`,
 * todo cliente con su foto social en su web se llevaría un `og:image` externo — o sea, un tercero.
 */
const OG_SOCIAL = "https://bellanapoli.es/img/fachada.jpg";

const PERFIL = {
  name: "Trattoria Bella Napoli",
  image: OG_SOCIAL,
  telephone: "+34 910 000 000",
  address: { streetAddress: "Calle Mayor 1", postalCode: "28013", addressLocality: "Madrid" },
  opening_hours: "Mar-Dom 13:00-16:00",
  brand: {
    plantilla: "base",
    logo: FOTO.logo,
    colores: { primario: "#0a7d34", secundario: "#c8102e", titulo: "#14210f", texto: "#3d3d3d", fondo: "#ffffff", fondoAlt: "#f4f6f2" },
    // Dos familias self-hosted: es lo que hace que el `<style>` traiga `@font-face` de verdad y el
    // test de "las fuentes que el CSS pide existen" tenga trabajo.
    fuentes: { titulo: "condensada", texto: "humanista" },
  },
  portada: { src: FOTO.portada, alt: "La sala del comedor" },
  fotos: [{ src: FOTO.galeria1, alt: "Horno de leña" }, { src: FOTO.galeria2 }],
  menu_categorias: [{ nombre: "Pizzas", foto: { src: FOTO.categoria }, orden: 0 }],
  menu: [
    { category: "Pizzas", name: "Margherita", price: "9,00 €", foto: { src: FOTO.plato } },
    { category: "Pizzas", name: "Diavola", price: "12,00 €" },
  ],
};

function story(titular: string, slug: string): Story {
  return {
    name: titular,
    slug,
    content: {
      component: "page",
      seo: {
        title: `${titular} | AMG`,
        description: "Cocina napolitana en Madrid",
        canonical: `https://${DOMINIO}/${slug}`,
        og_title: titular,
        og_description: "Cocina napolitana en Madrid",
      },
      schema_type: "LocalBusiness",
      page_type: "servicio",
      intent: "local",
      is_local: true,
      body: [{ component: "hero", headline: titular, subhead: "Masa de 48 horas" }],
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
  };
}

function sitioDe(perfil: unknown): Sitio {
  return {
    clientId: "c-a",
    domain: DOMINIO,
    vertical: "restauracion",
    spaceId: "111",
    publicToken: TOKEN,
    previewToken: "prv-111",
    businessProfile: perfil,
    languageCode: "es",
  };
}

function cdaSembrado(): MockCda {
  const cda = new MockCda();
  cda.poner(TOKEN, "published", "pizzas-madrid-centro", story("Pizzas en Madrid Centro", "pizzas-madrid-centro"));
  cda.poner(TOKEN, "published", "blog/masa-de-48-horas", story("Masa de 48 horas", "blog/masa-de-48-horas"));
  cda.ponerBlog(TOKEN, "published", [{ slug: "blog/masa-de-48-horas", name: "Masa de 48 horas" }]);
  return cda;
}

/** Unos bytes cualesquiera: nada de esto decodifica la imagen, solo la copia. */
const BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

type Regla = () => Promise<Response>;

/** Un "origen de assets" de mentira, con reglas por URL. Devuelve también qué se le pidió. */
function origen(reglas: Record<string, Regla> = {}): { fetch: FetchLike; pedidos: string[] } {
  const pedidos: string[] = [];
  const fetch: FetchLike = async (url) => {
    pedidos.push(url);
    if (Object.hasOwn(reglas, url)) return reglas[url]!();
    return new Response(BYTES, { status: 200, headers: { "content-type": "image/jpeg" } });
  };
  return { fetch, pedidos };
}

async function enCarpeta<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "amg-snapshot-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Todos los `.html` del snapshot, por su ruta relativa (con `/`). */
async function htmlsDe(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const entradas = await readdir(dir, { recursive: true, withFileTypes: true });
  for (const e of entradas) {
    if (!e.isFile() || !e.name.endsWith(".html")) continue;
    const abs = path.join(e.parentPath ?? e.path, e.name);
    out.set(path.relative(dir, abs).split(path.sep).join("/"), await readFile(abs, "utf8"));
  }
  return out;
}

/**
 * **Las referencias que el navegador va a SALIR A BUSCAR**, escritas a mano y no reusando
 * `activosDe()`.
 *
 * Que sea una segunda implementación es deliberado: un test que llame a la función que está
 * probando comprueba que el código es igual a sí mismo. Si `activosDe` se olvida de un emisor —ya
 * pasó dos veces con los `<img>`, que "eran uno" y después "eran dos"— este barrido lo encuentra,
 * porque parte de las etiquetas del HTML y no de la lista de sitios donde alguien recordó mirar.
 *
 * ⚠️ **No es "toda URL del HTML".** `canonical` y `og:url` son externos y legítimos: identifican la
 * página, nadie los descarga. El test ingenuo daría falsos positivos y se terminaría relajando hasta
 * no probar nada.
 */
function referenciasFetchables(html: string): string[] {
  const out: string[] = [];
  const atributos = (texto: string, nombre: string): string[] =>
    [...texto.matchAll(new RegExp(`\\s${nombre}="([^"]*)"`, "g"))].map((m) => m[1] ?? "");

  for (const tag of html.matchAll(/<(img|video|source|audio|iframe|embed|script|link|meta)\b[^>]*>/gi)) {
    const nombre = (tag[1] ?? "").toLowerCase();
    const texto = tag[0] ?? "";
    if (nombre === "link") {
      const rel = atributos(texto, "rel")[0] ?? "";
      if (/preload|stylesheet|icon/i.test(rel)) out.push(...atributos(texto, "href"));
      continue;
    }
    if (nombre === "meta") {
      if (/property="og:image"/.test(texto)) out.push(...atributos(texto, "content"));
      continue;
    }
    out.push(...atributos(texto, "src"), ...atributos(texto, "poster"));
  }

  for (const m of html.matchAll(/url\(([^)]*)\)/g)) out.push((m[1] ?? "").replace(/^['"]|['"]$/g, ""));

  for (const b of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    for (const m of (b[1] ?? "").matchAll(/"image":\s*"([^"]*)"/g)) out.push(m[1] ?? "");
  }

  return out.filter((u) => u.length > 0);
}

const esExterna = (u: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//");

/** El HTML con el valor de cada activo borrado: lo que queda tiene que ser idéntico al sitio vivo. */
function sinActivos(html: string): string {
  return html
    .replace(/(\s(?:src|poster)=")[^"]*(")/g, "$1‹activo›$2")
    .replace(/(<meta property="og:image" content=")[^"]*(")/g, "$1‹activo›$2")
    .replace(/("image":\s*")[^"]*(")/g, "$1‹activo›$2");
}

// ─────────────────────────────────────────────────── el snapshot completo, sobre PGlite

describe("el snapshot estático, de punta a punta (PGlite + CDA de mentira)", () => {
  let db: PGlite;
  let dir: string;
  let resultado: ResultadoSnapshot;
  let htmls: Map<string, string>;
  let pedidos: string[];

  before(async () => {
    db = new PGlite();
    await aplicarMigraciones(db);
    await db.exec(
      `insert into tenants (id, nombre, slug) values ('11111111-1111-1111-1111-111111111111','Agencia','agencia')`,
    );
    // El perfil entra por `business_profile` y el renderizador **solo** puede leer la columna
    // generada `business_profile_publico`: el snapshot recorre el mismo camino que la web viva, con
    // la allowlist de la `0014`/`0030` de por medio. Un snapshot que leyera la columna cruda sería
    // otro producto, y encima publicaría el CRM.
    await db.query(
      `insert into clients (tenant_id, nombre, domain, storyblok_space_id, storyblok_public_token,
                            storyblok_preview_token, business_profile, vertical)
       values ('11111111-1111-1111-1111-111111111111','Trattoria Bella Napoli',$1,'111',$2,'prv-111',$3::jsonb,'restauracion')`,
      [DOMINIO, TOKEN, JSON.stringify(PERFIL)],
    );

    dir = await mkdtemp(path.join(tmpdir(), "amg-snapshot-e2e-"));
    const o = origen();
    pedidos = o.pedidos;
    resultado = await generarSnapshot(DOMINIO, dir, {
      sitios: new PgSitios(new PglitePool(db)),
      cda: cdaSembrado(),
      fetch: o.fetch,
    });
    htmls = await htmlsDe(dir);
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
    await db.close();
  });

  it("escribe la home en la raíz y cada página en su propio directorio (URLs preservadas)", () => {
    assert.deepEqual(
      [...htmls.keys()].sort(),
      ["blog/index.html", "blog/masa-de-48-horas/index.html", "index.html", "menu/index.html", "pizzas-madrid-centro/index.html"],
      "la home, las dos stories, el catálogo sintetizado y el índice del blog",
    );
    assert.equal(resultado.fallos.length, 0, `no debería fallar nada: ${JSON.stringify(resultado.fallos)}`);
    assert.equal(codigoDeSalida(resultado), 0);
  });

  it("🔴 CERO terceros: ni una referencia fetchable sale de nuestro propio directorio", () => {
    let revisadas = 0;

    for (const [pagina, html] of htmls) {
      const refs = referenciasFetchables(html);
      revisadas += refs.length;

      for (const u of refs) {
        assert.ok(!esExterna(u), `${pagina}: el navegador saldría a buscar «${u}»`);
        assert.ok(u.startsWith("/_assets/"), `${pagina}: «${u}» no está bajo /_assets/`);
      }

      // Y los dos terceros con nombre propio, por si un día alguien emite uno sin `src`.
      for (const host of ["a.storyblok.com", "fonts.googleapis.com", "fonts.gstatic.com"]) {
        assert.ok(!html.includes(host), `${pagina}: aparece ${host}`);
      }
      assert.ok(!html.includes("@import"), `${pagina}: hay un @import`);
      assert.ok(!/rel="stylesheet"/.test(html), `${pagina}: hay una hoja de estilo externa`);
    }

    // ⚠️ **Control de no-vacuidad.** Sin esto, un snapshot sin ninguna foto y sin `@font-face` pasa
    // el bucle de arriba sin revisar una sola referencia — verde feliz, cero garantía.
    assert.ok(revisadas >= 12, `el barrido solo revisó ${revisadas} referencias: no está probando nada`);
  });

  it("🔴 los archivos de fuente que el CSS pide EXISTEN en el directorio de salida", () => {
    const pedidas = new Set<string>();
    for (const html of htmls.values()) {
      for (const m of html.matchAll(/\/_assets\/fonts\/([^)'"\s]+)/g)) pedidas.add(m[1] ?? "");
    }

    // No-vacuidad: la ficha usa `condensada` + `humanista`, que son cuatro archivos de `@font-face`
    // más el `preload` de titulares. Cero `url()` pasaría el bucle sin comprobar nada, y el modo de
    // fallo real es justo ése: el CSS pide una familia que no se copió y la web sale con la
    // tipografía del sistema sin que nada avise.
    assert.ok(pedidas.size >= 3, `el CSS solo pide ${pedidas.size} archivos de fuente; se esperaban las @font-face`);

    for (const archivo of pedidas) {
      assert.ok(
        existsSync(path.join(dir, DIR_FUENTES, archivo)),
        `el CSS pide ${archivo} y no está en ${DIR_FUENTES}/`,
      );
    }
  });

  it("cada imagen referenciada está descargada en disco, y se pidió UNA vez por URL", async () => {
    const locales = new Set<string>();
    for (const html of htmls.values()) {
      for (const m of html.matchAll(/\/_assets\/img\/([^)'"\s]+)/g)) locales.add(m[1] ?? "");
    }
    // Las seis fotos de `a.storyblok.com` (logo, portada, dos de galería, el plato y la categoría)
    // más la imagen social del dominio del cliente.
    assert.equal(locales.size, 7, `se esperaban 7 activos distintos, hay ${locales.size}`);

    for (const archivo of locales) {
      assert.ok(existsSync(path.join(dir, DIR_IMG, archivo)), `falta ${archivo} en ${DIR_IMG}/`);
    }
    assert.equal(resultado.activos, 7);

    // El logo aparece en las CINCO páginas y se pide una sola vez: la descarga se hace sobre el
    // conjunto de URLs únicas, no por página.
    assert.equal(pedidos.filter((u) => u === FOTO.logo).length, 1);
    assert.equal(new Set(pedidos).size, pedidos.length, "no se pidió ninguna URL dos veces");
  });

  it("🔴 el og:image y el `image` del JSON-LD también se bajan — son el TERCER emisor, no un adorno", () => {
    const home = htmls.get("index.html") ?? "";
    assert.ok(!home.includes(OG_SOCIAL), "la URL social original no puede quedar en el HTML");
    assert.match(home, /<meta property="og:image" content="\/_assets\/img\/[^"]+">/);
    assert.match(home, /"image": "\/_assets\/img\/[^"]+"/, "el JSON-LD apunta a la copia local");
    assert.ok(pedidos.includes(OG_SOCIAL), "la imagen social se descargó de verdad");
  });

  it("🔴 el snapshot es la MISMA página que sirve el sitio vivo, no una versión suya", async () => {
    const app = createApp({ sitios: new MemSitios([sitioDe(PERFIL)]), cda: cdaSembrado() });
    const pares: [string, string][] = [
      ["index.html", "/"],
      ["pizzas-madrid-centro/index.html", "/pizzas-madrid-centro"],
      ["menu/index.html", "/menu"],
      ["blog/index.html", "/blog"],
    ];

    for (const [archivo, ruta] of pares) {
      const res = await app.request(`http://${DOMINIO}${ruta}`, { headers: { host: DOMINIO } });
      assert.equal(res.status, 200, `${ruta} debería servirse viva`);
      // Se comparan los documentos con el VALOR de cada activo borrado: lo único que el snapshot
      // puede cambiar es adónde apunta una foto. Cualquier otra diferencia —una sección de menos,
      // un enlace distinto, otro JSON-LD— cae acá, que es el punto: «tu web», no «una versión».
      assert.equal(
        sinActivos(htmls.get(archivo) ?? ""),
        sinActivos(await res.text()),
        `${archivo} no coincide con lo que sirve el renderizador en ${ruta}`,
      );
    }
  });

  it("🔴 el índice de la home no lista ni el catálogo, ni /blog, ni los artículos", async () => {
    // La regla vivía dentro del handler de `app.ts` y **no la fijaba ningún test** — lo destapó la
    // verificación por mutación al mudarla a `pagina.ts`: borrar el filtro entero no rompía nada.
    // Sin ella, cada artículo aparece dos veces (en el índice y en /blog) y la carta se lista como
    // si fuera una landing de research.
    await enCarpeta(async (dir) => {
      const cda = cdaSembrado();
      cda.ponerNav(TOKEN, "published", [
        { slug: "pizzas-madrid-centro", name: "Pizzas en Madrid Centro" },
        { slug: "menu", name: "La carta" },
        { slug: "blog", name: "Blog" },
        { slug: "blog/masa-de-48-horas", name: "Masa de 48 horas" },
      ]);
      await generarSnapshot(DOMINIO, dir, {
        sitios: new MemSitios([sitioDe(PERFIL)]),
        cda,
        fetch: origen().fetch,
      });

      const home = await readFile(path.join(dir, "index.html"), "utf8");
      // Se mira la LISTA (`<a class="card">`), no el documento entero: `/menu` y `/blog` salen
      // también en la barra y en el pie, y ahí sí corresponden.
      const enElIndice = [...home.matchAll(/<a class="card" href="([^"]*)"/g)].map((m) => m[1]);
      assert.deepEqual(enElIndice, ["/pizzas-madrid-centro"]);
    });
  });

  it("no escribe informe cuando no falló nada: la sola presencia del archivo ya es una señal", () => {
    assert.ok(!existsSync(path.join(dir, ARCHIVO_INFORME)));
  });
});

// ─────────────────────────────────────────────────────────────── el camino de fallo

describe("una descarga que falla: el snapshot sale igual, pero NO parece completo", () => {
  const deps = (fetch: FetchLike): DepsSnapshot => ({
    sitios: new MemSitios([sitioDe(PERFIL)]),
    cda: cdaSembrado(),
    fetch,
  });

  it("🔴 escribe el informe con la URL y el motivo, y el resto del snapshot queda ENTERO", async () => {
    await enCarpeta(async (dir) => {
      const o = origen({ [FOTO.plato]: async () => new Response("no", { status: 404 }) });
      const r = await generarSnapshot(DOMINIO, dir, deps(o.fetch));

      assert.equal(r.fallos.length, 1);
      assert.equal(r.fallos[0]?.que, FOTO.plato);
      assert.match(r.fallos[0]?.motivo ?? "", /404/);

      const informe = await readFile(path.join(dir, ARCHIVO_INFORME), "utf8");
      assert.ok(informe.includes(FOTO.plato), "el informe dice EXACTAMENTE qué imagen no bajó");
      assert.match(informe, /404/, "y por qué");

      // El resto está completo: las cinco páginas y las otras seis imágenes.
      assert.equal((await htmlsDe(dir)).size, 5);
      assert.equal(r.activos, 6);
      assert.equal((await readdir(path.join(dir, DIR_IMG))).length, 6);
    });
  });

  it("🔴 el código de salida es distinto de cero: una entrega incompleta no puede salir en silencio", () => {
    assert.notEqual(codigoDeSalida({ dominio: "x", destino: "y", paginas: [], activos: 0, fuentes: 0, fallos: [{ que: "u", motivo: "m" }] }), 0);
    assert.equal(codigoDeSalida({ dominio: "x", destino: "y", paginas: [], activos: 0, fuentes: 0, fallos: [] }), 0);
  });

  it("🔴 la URL fallida se reescribe igual a la ruta local: NUNCA queda un host externo en el HTML", async () => {
    await enCarpeta(async (dir) => {
      const o = origen({ [FOTO.plato]: async () => new Response("no", { status: 500 }) });
      await generarSnapshot(DOMINIO, dir, deps(o.fetch));

      for (const [pagina, html] of await htmlsDe(dir)) {
        assert.ok(!html.includes(FOTO.plato), `${pagina}: quedó la URL de Storyblok de la foto que no bajó`);
        for (const u of referenciasFetchables(html)) {
          assert.ok(!esExterna(u), `${pagina}: quedó la referencia externa «${u}»`);
        }
      }
    });
  });

  it("un informe de una corrida anterior se borra: no puede sobrevivir a un snapshot que salió bien", async () => {
    await enCarpeta(async (dir) => {
      const malo = origen({ [FOTO.plato]: async () => new Response("no", { status: 500 }) });
      await generarSnapshot(DOMINIO, dir, deps(malo.fetch));
      assert.ok(existsSync(path.join(dir, ARCHIVO_INFORME)));

      const bueno = origen();
      const r = await generarSnapshot(DOMINIO, dir, deps(bueno.fetch));
      assert.equal(r.fallos.length, 0);
      assert.ok(!existsSync(path.join(dir, ARCHIVO_INFORME)), "el informe viejo mentiría en la dirección peligrosa");
    });
  });

  it("🔴 si la lista de páginas del space falla, el snapshot ABORTA — no entrega la home sola", async () => {
    // Diferencia deliberada con el sitio vivo: ahí la nav es una mejora y jamás puede dar 503
    // (`navDe` degrada a `[]` y la página sale sin barra). Acá la nav **decide qué páginas
    // existen**: degradar produciría un snapshot con la home y nada más, entregado como si fuera el
    // sitio entero. Incompleto y con aspecto de completo es justo lo que no puede pasar.
    await enCarpeta(async (dir) => {
      const cda = cdaSembrado();
      cda.traerNav = async () => {
        throw new ErrorCda("Storyblok respondió 500 para /links", 500);
      };
      await assert.rejects(
        generarSnapshot(DOMINIO, dir, { sitios: new MemSitios([sitioDe(PERFIL)]), cda, fetch: origen().fetch }),
        /500/,
      );
      assert.equal((await htmlsDe(dir)).size, 0, "no queda media web escrita");
    });
  });

  it("una story que la nav lista y el space no devuelve se reporta: no se inventa la página", async () => {
    await enCarpeta(async (dir) => {
      const cda = cdaSembrado();
      // La nav (derivada de las stories) la lista, pero `traerStory` devuelve null para ese slug.
      cda.ponerNav(TOKEN, "published", [{ slug: "fantasma", name: "Fantasma" }]);
      const o = origen();
      const r = await generarSnapshot(DOMINIO, dir, {
        sitios: new MemSitios([sitioDe(PERFIL)]),
        cda,
        fetch: o.fetch,
      });

      assert.ok(r.fallos.some((f) => f.que === "página /fantasma"));
      assert.notEqual(codigoDeSalida(r), 0);
      assert.ok(!existsSync(path.join(dir, "fantasma")));
    });
  });
});

// ──────────────────────────────────────────── los emisores, uno por uno

/**
 * **Los cuatro emisores de una URL fetchable, cada uno con su propia aserción.**
 *
 * Esto lo pidió la verificación por mutación: quitar el escaneo de `og:image` **no rompía nada**,
 * porque en las páginas que hoy lo emiten el JSON-LD trae la MISMA URL y la reescritura la alcanzaba
 * por el otro camino. O sea que el test de punta a punta pasaba por una coincidencia del contenido,
 * no por la garantía — y el día que una página lleve `og:image` sin JSON-LD (`renderCatalogo` sin
 * ítems ya no emite `ld+json`) la fuga aparecería sin que cayera un test.
 *
 * Es la tercera vez que este proyecto descubre que los emisores «eran uno», después «eran dos» y
 * después eran tres. Por eso se enumeran acá, sueltos, sobre HTML mínimo.
 */
describe("de dónde sale una URL fetchable: los cuatro emisores, por separado", () => {
  const soloUrls = (html: string) => activosDe(html).map((a) => a.url);

  it("🔴 `renderImagen` — un <img> de contenido", () => {
    assert.deepEqual(soloUrls(`<img class="foto" src="${FOTO.galeria1}" alt="x">`), [FOTO.galeria1]);
  });

  it("🔴 el logo de la cabecera — el mismo <img>, en TODAS las páginas", () => {
    assert.deepEqual(soloUrls(`<img class="logo" src="${FOTO.logo}" alt="N" height="56">`), [FOTO.logo]);
  });

  it("🔴 `og:image` SOLO, sin JSON-LD que lo repita", () => {
    // El caso que la mutación destapó: sin bloque `ld+json`, este es el único camino.
    assert.deepEqual(soloUrls(`<meta property="og:image" content="${OG_SOCIAL}">`), [OG_SOCIAL]);
  });

  it("🔴 el `image` del JSON-LD — que es un quinto sitio, no el mismo <meta>", () => {
    const ld = `<script type="application/ld+json">\n{\n  "image": "${OG_SOCIAL}"\n}\n</script>`;
    assert.deepEqual(soloUrls(ld), [OG_SOCIAL]);
  });

  it("🔴 `<video src>` y su `poster` — el emisor que no está en ninguna lista de tres", () => {
    const video = `<video class="plato-foto" src="https://a.storyblok.com/f/1/v.mp4" poster="${FOTO.plato}" controls></video>`;
    assert.deepEqual(soloUrls(video).sort(), ["https://a.storyblok.com/f/1/v.mp4", FOTO.plato].sort());
  });

  it("🔴 lo que NO se toca: `canonical` y `og:url` son externos y legítimos", () => {
    // El test ingenuo —"ningún host externo en el HTML"— los cazaría y a la larga se relajaría hasta
    // no probar nada. Nadie los descarga: identifican la página.
    const cabeza =
      `<link rel="canonical" href="https://bellanapoli.es/menu">` +
      `<meta property="og:url" content="https://bellanapoli.es/menu">` +
      `<a href="https://bellanapoli.es/otra">enlace</a>`;
    assert.deepEqual(soloUrls(cabeza), []);
  });
});

// ────────────────────────────────────────────────── la puerta de las descargas

describe("qué se puede pedir: la allowlist del render, reusada", () => {
  it("🔴 el host se compara EXACTO: ni endsWith ni includes", () => {
    assert.equal(motivoDeRechazo("https://a.storyblok.com/f/1/x.jpg", "contenido"), null);
    for (const malo of [
      "https://a.storyblok.com.evil.tld/x.jpg", // endsWith("storyblok.com") lo aceptaría
      "https://evil-storyblok.com/x.jpg", // includes("storyblok.com") lo aceptaría
      "https://storyblok.com/x.jpg", // el apex no es el host de assets
      "https://a.storyblok.com@evil.com/x.jpg", // lo que parece el host es userinfo: va a evil.com
    ]) {
      assert.ok(motivoDeRechazo(malo, "contenido"), `${malo} NO debería poder pedirse`);
    }
  });

  it("🔴 https obligatorio, en las dos clases", () => {
    assert.ok(motivoDeRechazo("http://a.storyblok.com/x.jpg", "contenido"));
    assert.ok(motivoDeRechazo("http://bellanapoli.es/og.jpg", "social"));
    assert.equal(motivoDeRechazo("https://bellanapoli.es/og.jpg", "social"), null);
  });

  it("🔴 la imagen social acepta cualquier host https —es el dominio del cliente— pero NO la red interna", () => {
    // La asimetría se hereda de `imagenPublicable` a propósito; lo que NO se hereda es el permiso
    // para pedirle algo a la red de quien corre el comando. El render solo emitía el string.
    for (const interno of [
      "https://localhost/og.jpg",
      "https://127.0.0.1/og.jpg",
      "https://[::1]/og.jpg",
      "https://169.254.169.254/latest/meta-data",
      "https://nas.local/og.jpg",
      "https://registro.internal/og.jpg",
    ]) {
      assert.ok(motivoDeRechazo(interno, "social"), `${interno} NO debería poder pedirse`);
    }
  });

  it("🔴 una redirección a un host de fuera NO se sigue", async () => {
    await enCarpeta(async (dir) => {
      const o = origen({
        [FOTO.portada]: async () =>
          new Response(null, { status: 302, headers: { location: "https://evil.tld/x.jpg" } }),
      });
      const r = await generarSnapshot(DOMINIO, dir, {
        sitios: new MemSitios([sitioDe(PERFIL)]),
        cda: cdaSembrado(),
        fetch: o.fetch,
      });

      assert.ok(r.fallos.some((f) => f.que === FOTO.portada && /evil\.tld/.test(f.motivo)));
      assert.ok(!o.pedidos.includes("https://evil.tld/x.jpg"), "no se llegó a pedir el destino de la redirección");
    });
  });

  it("🔴 el tope de bytes corta por lo DECLARADO y por lo que llega de verdad", async () => {
    await enCarpeta(async (dir) => {
      const o = origen({
        // Declara 50 MB con `content-length`: se corta sin leer el cuerpo.
        [FOTO.portada]: async () =>
          new Response(BYTES, { status: 200, headers: { "content-length": `${50 * 1024 * 1024}` } }),
        // Y uno que NO declara nada y va soltando bytes: lo corta la lectura acotada.
        [FOTO.galeria1]: async () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(c) {
                for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(64));
                c.close();
              },
            }),
            { status: 200 },
          ),
      });

      const r = await generarSnapshot(DOMINIO, dir, {
        sitios: new MemSitios([sitioDe(PERFIL)]),
        cda: cdaSembrado(),
        fetch: o.fetch,
        maxBytes: 1024,
      });

      assert.match(r.fallos.find((f) => f.que === FOTO.portada)?.motivo ?? "", /declara 52428800/);
      assert.match(r.fallos.find((f) => f.que === FOTO.galeria1)?.motivo ?? "", /supera el tope/);
      assert.ok(!existsSync(path.join(dir, DIR_IMG, nombreLocal(FOTO.portada, null))));
    });
  });

  it("🔴 una descarga que se cuelga vence por plazo en vez de colgar la entrega", async () => {
    await enCarpeta(async (dir) => {
      const o = origen({ [FOTO.portada]: () => new Promise<Response>(() => {}) });
      const r = await generarSnapshot(DOMINIO, dir, {
        sitios: new MemSitios([sitioDe(PERFIL)]),
        cda: cdaSembrado(),
        fetch: o.fetch,
        plazoMs: 30,
      });

      assert.match(r.fallos.find((f) => f.que === FOTO.portada)?.motivo ?? "", /no completó la descarga en 30 ms/);
      assert.equal(r.paginas.length, 5, "las páginas se escriben igual");
    });
  });
});

// ──────────────────────────────────────────────────────────── rutas y nombres

describe("rutas de salida y nombres de archivo", () => {
  it("preserva la URL: `home` en la raíz, el resto en su directorio", () => {
    assert.equal(rutaDePagina("home"), "index.html");
    assert.equal(rutaDePagina("menu"), path.join("menu", "index.html"));
    assert.equal(rutaDePagina("blog/post-1"), path.join("blog", "post-1", "index.html"));
  });

  it("🔴 un slug que no produce una ruta segura devuelve null, no una ruta 'arreglada'", () => {
    // El slug viene de Storyblok. Escribir `../../x/index.html` sería escribir fuera del destino, y
    // "limpiarlo" en silencio dejaría la página en una URL distinta de la que sirve la web viva.
    for (const malo of ["../fuera", "a/../../b", "", "/", "c:/windows", 'con"comilla', "con\\barra"]) {
      assert.equal(rutaDePagina(malo), null, `${malo} debería rechazarse`);
    }
  });

  it("🔴 el nombre local sale de un HASH: no hay path de la URL que atravesar", () => {
    const n = nombreLocal("https://a.storyblok.com/f/1/../../etc/passwd.jpg", null);
    assert.match(n, /^[0-9a-f]{16}\.jpg$/);
    assert.ok(!n.includes("/") && !n.includes(".."));
    // Determinista: regenerar el snapshot no renombra los archivos.
    assert.equal(n, nombreLocal("https://a.storyblok.com/f/1/../../etc/passwd.jpg", null));
    assert.notEqual(n, nombreLocal("https://a.storyblok.com/f/1/otra.jpg", null));
  });

  it("la extensión sale de la URL, y si no se reconoce, del content-type", () => {
    assert.match(nombreLocal("https://a.storyblok.com/x.webp", null), /\.webp$/);
    assert.match(nombreLocal("https://a.storyblok.com/x", "image/png"), /\.png$/);
    assert.match(nombreLocal("https://a.storyblok.com/x", "application/octet-stream"), /\.bin$/);
    // Clave heredada del prototipo: `constructor` no es un content-type conocido.
    assert.match(nombreLocal("https://a.storyblok.com/x", "constructor"), /\.bin$/);
  });
});

// ────────────────────────────────────────────────────────────────── el comando

describe("el comando", () => {
  function capturar(): { salida: Salida; out: string[]; err: string[] } {
    const out: string[] = [];
    const err: string[] = [];
    return { salida: { log: (m) => out.push(m), error: (m) => err.push(m) }, out, err };
  }

  const deps = (fetch: FetchLike): DepsSnapshot => ({
    sitios: new MemSitios([sitioDe(PERFIL)]),
    cda: cdaSembrado(),
    fetch,
  });

  it("🔴 sin argumentos: imprime el uso y sale con 1", async () => {
    const { salida, err } = capturar();
    assert.equal(await correrSnapshot([], deps(origen().fetch), salida), 1);
    assert.equal(err.join("\n"), USO);
  });

  it("🔴 sin directorio de destino: también, en vez de inventarse uno", async () => {
    const { salida, err } = capturar();
    assert.equal(await correrSnapshot([DOMINIO], deps(origen().fetch), salida), 1);
    assert.match(err.join("\n"), /Uso: npm run snapshot/);
  });

  it("🔴 un dominio que no es de ningún cliente: sale con 1 y no escribe nada", async () => {
    await enCarpeta(async (dir) => {
      const { salida, err } = capturar();
      assert.equal(await correrSnapshot(["noexiste.es", dir], deps(origen().fetch), salida), 1);
      assert.match(err.join("\n"), /No hay ningún sitio publicado/);
      assert.equal((await readdir(dir)).length, 0);
    });
  });

  it("🔴 un host que no normaliza (una IP, `localhost`) ni siquiera llega a la base", async () => {
    await enCarpeta(async (dir) => {
      for (const malo of ["127.0.0.1", "localhost", "no es un dominio"]) {
        const { salida, err } = capturar();
        assert.equal(await correrSnapshot([malo, dir], deps(origen().fetch), salida), 1);
        assert.match(err.join("\n"), /no es un dominio canónico/);
      }
    });
  });

  it("sale con 0 y lo dice cuando el snapshot quedó completo", async () => {
    await enCarpeta(async (dir) => {
      const { salida, out } = capturar();
      assert.equal(await correrSnapshot([DOMINIO, dir], deps(origen().fetch), salida), 0);
      assert.match(out.join("\n"), /5 páginas · 7 imágenes/);
      assert.match(out.join("\n"), /no referencia ni un host externo/);
    });
  });

  it("🔴 sale con 2 —ni 0 ni 1— cuando el snapshot está escrito pero incompleto", async () => {
    await enCarpeta(async (dir) => {
      const { salida, err } = capturar();
      const o = origen({ [FOTO.plato]: async () => new Response("no", { status: 404 }) });
      assert.equal(await correrSnapshot([DOMINIO, dir], deps(o.fetch), salida), 2);
      assert.match(err.join("\n"), /NO entraron en el snapshot/);
      assert.match(err.join("\n"), /no lo entregues así/);
    });
  });
});

/**
 * **Los defaults de PRODUCCIÓN, fijados por valor.**
 *
 * El `revisor` (2026-09-12) mutó `PLAZO_DESCARGA_MS = 15_000 → 1`, `MAX_REDIRECCIONES = 3 → 0` y
 * `ARCHIVO_INFORME → "otro-nombre.txt"` y **no cayó ni un test** en las tres. La causa es la que
 * `CHECKPOINTS.md` nombra literalmente: los tests que cubren esos caminos **eligen el parámetro**
 * (`plazoMs: 30`, un solo salto de redirección), así que ejercitan la mecánica y no el valor que
 * corre en producción; y el del informe **importaba la constante y la componía**, o sea que se
 * comparaba consigo mismo — el mismo patrón que el docstring de las tipografías ya denuncia en este
 * archivo.
 *
 * Mismo molde que `MAX_IMAGENES_POR_DOCUMENTO` en `web-builder/src/render/imagenes.ts`, que lleva
 * escrito «Es un default de PRODUCCIÓN: lo fija un test».
 */
describe("los defaults de producción del snapshot", () => {
  it("🔴 PLAZO_DESCARGA_MS son 15 s: con un valor ínfimo, TODO snapshot real saldría con las fotos rotas", () => {
    // Sin este test, `= 1` deja los 219 en verde y cada snapshot de producción sale con código 2 y
    // sin una sola imagen. El rango también importa: un plazo generoso cuelga el comando de salida.
    assert.equal(PLAZO_DESCARGA_MS, 15_000);
    assert.ok(PLAZO_DESCARGA_MS >= 5_000 && PLAZO_DESCARGA_MS <= 60_000);
  });

  it("🔴 MAX_REDIRECCIONES son 3: con 0 no se seguiría NINGUNA, y un origen de assets redirige", () => {
    // `= 0` no rompía ningún test porque el único caso de redirección que existía probaba un salto
    // RECHAZADO — o sea, el camino en el que el tope da igual.
    assert.equal(MAX_REDIRECCIONES, 3);
    assert.ok(MAX_REDIRECCIONES >= 1, "sin al menos un salto, un CDN que redirige rompe el entregable");
  });

  it("🔴 el informe se llama _snapshot-informe.txt — el nombre lo PROMETE ADR-11, por escrito", () => {
    // Comparar contra la constante importada sería compararla consigo misma. Acá va el literal, que
    // es lo que el ADR le promete a un cliente que abre el ZIP.
    assert.equal(ARCHIVO_INFORME, "_snapshot-informe.txt");
  });
});

/**
 * La precedencia de clase, que hasta el 2026-09-12 no ejercitaba nada: en las fixturas las URLs de
 * `<img>` y de `og:image` son siempre distintas, así que la colisión no ocurría nunca.
 */
describe("referenciasDe: cuando una URL aparece con las dos clases", () => {
  const AJENA = "https://cdn.ajeno.example/foto.jpg";

  it("🔴 manda la clase ESTRICTA: un og:image no puede 'ascender' una URL a activo de contenido", () => {
    // La misma URL, en las dos posiciones y en páginas distintas — que es como llegaría de verdad.
    const comoSocial = `<meta property="og:image" content="${AJENA}">`;
    const comoContenido = `<img src="${AJENA}">`;

    // El orden no puede cambiar el resultado: se prueban las dos direcciones.
    for (const htmls of [
      [comoSocial, comoContenido],
      [comoContenido, comoSocial],
    ]) {
      const refs = referenciasDe(htmls);
      assert.equal(refs.get(AJENA), "contenido", `orden ${JSON.stringify(htmls)}`);
    }
  });

  it("una URL que SOLO aparece como og:image se queda en 'social' — la asimetría es deliberada", () => {
    // Control positivo: sin él, "todo es contenido" pasaría el test de arriba y rompería la foto
    // social de todo cliente que la tenga en su propio dominio, que es el caso normal.
    assert.equal(referenciasDe([`<meta property="og:image" content="${AJENA}">`]).get(AJENA), "social");
  });

  it("🔴 y la consecuencia real: con la clase estricta, un host de fuera se RECHAZA", () => {
    // Que la precedencia importe se demuestra acá: las dos clases dan veredictos opuestos sobre la
    // MISMA URL, así que elegir mal la clase es elegir mal la política de seguridad.
    assert.equal(motivoDeRechazo(AJENA, "social"), null, "como social pasa: https y cualquier host");
    assert.ok(motivoDeRechazo(AJENA, "contenido"), "como contenido NO pasa: no está en la allowlist");
  });
});

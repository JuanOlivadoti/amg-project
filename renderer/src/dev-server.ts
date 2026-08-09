/**
 * ARRANQUE DE DESARROLLO — el renderizador real, sobre PGlite y una CDA de mentira.
 *
 * ⚠️ **Nunca en producción.** No hay Storyblok del otro lado: las stories salen de un mock. Existe
 * para verificar EN UN NAVEGADOR lo que los tests no alcanzan — que el HTML se ve, que el JSON-LD
 * está, que el webhook invalida de verdad, que el preview mete el Bridge.
 *
 * Es posible porque `createApp` recibe todo inyectado. El mismo diseño que hace testeable al
 * servicio sin red es el que permite este harness (igual que `api/src/dev-server.ts`).
 *
 * Los dominios de cliente se sirven por la cabecera `Host`, así que para probarlos:
 *
 *     curl -H "Host: bellanapoli.es" http://localhost:8080/menu
 *
 * En el navegador, `localhost` no es ninguno de esos dominios — por eso este harness levanta con
 * `TRUST_PROXY` y acepta `?_host=`, que **solo existe acá** (ver abajo).
 *
 * Correr:  npm run dev:server -w renderer
 */
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { aplicarMigraciones, PgSitios, PglitePool } from "db";
import type { Story } from "web-builder";
import { createApp } from "./app.js";
import { CacheRender } from "./cache.js";
import { MockCda } from "./cda.js";
import { firmarPreview, PARAM_FIRMA, PARAM_VENCE } from "./preview.js";

if (process.env["NODE_ENV"] === "production") {
  throw new Error("dev-server.ts NO se corre en producción: no hay Storyblok detrás, es un mock.");
}

const WEBHOOK_SECRET = "dev-webhook";
const PREVIEW_SECRET = "dev-preview";

const pg = new PGlite();
await aplicarMigraciones(pg);
const sql = async <T = Record<string, unknown>>(q: string, p: unknown[] = []): Promise<T[]> =>
  (await pg.query<T>(q, p)).rows;

// ---------------------------------------------------------------- seed
const [tenant] = (
  await sql<{ id: string }>("insert into tenants (nombre, slug) values ('Agencia AMG','amg') returning id")
).map((r) => r.id) as [string];

async function cliente(
  nombre: string,
  dominio: string,
  space: string,
  perfil: unknown,
): Promise<void> {
  await sql(
    `insert into clients (tenant_id, nombre, domain, storyblok_space_id,
                          storyblok_public_token, storyblok_preview_token, business_profile)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [tenant, nombre, dominio, space, `pub-${space}`, `prv-${space}`, JSON.stringify(perfil)],
  );
}

// El cliente COMPLETO: manual de marca, fotos y carta con categorías y precios. Es el perfil con el
// que se comprueba en el navegador que un campo nuevo llegó hasta el HTML.
//
// Los `src` apuntan a `a.storyblok.com` —el host de la allowlist— pero a rutas que NO existen, así que
// en el navegador salen rotas. Es deliberado y sigue haciendo falta: éste es el perfil que enseña
// **cómo se comporta el render cuando una foto no carga**. Un host que sirviera imágenes de verdad
// pero fuera de la allowlist enseñaría algo que en producción se descartaría, y eso sí sería mentir.
//
// Para ver las fotos cargando de verdad está `borcelle.es`, más abajo, con los assets reales del space.
await cliente("Trattoria Bella Napoli", "bellanapoli.es", "111", {
  name: "Trattoria Bella Napoli",
  // La **imagen social** (`og:image` + `image` del JSON-LD), en el DOMINIO DEL PROPIO CLIENTE, que es
  // donde suele vivir. Está acá para que ese caso sea observable en el navegador: la primera versión
  // de `imagenPublicable` le aplicaba la allowlist de Storyblok y se la habría quitado a todo cliente
  // que no hubiera subido su foto a nuestro space. Un `og:image` no lo carga el visitante —lo pide el
  // crawler de la red social al compartir—, así que ahí la allowlist no defiende de nada y solo rompe.
  image: "https://trattoriabellanapoli.es/img/fachada.jpg",
  telephone: "+34 910 000 000",
  address: { streetAddress: "Calle Mayor 1", postalCode: "28013", addressLocality: "Madrid" },
  opening_hours: "Mar-Dom 13:00-16:00, 20:00-23:30",
  brand: {
    plantilla: "base",
    colores: {
      primario: "#0a7d34",
      secundario: "#c8102e",
      titulo: "#14210f",
      texto: "#3d3d3d",
      fondo: "#ffffff",
      fondoAlt: "#f4f6f2",
    },
    fuentes: { titulo: "condensada", texto: "humanista", decorativa: "script" },
  },
  portada: { src: "https://a.storyblok.com/f/dev/bellanapoli-portada.jpg", alt: "La sala del comedor" },
  fotos: [
    { src: "https://a.storyblok.com/f/dev/bellanapoli-horno.jpg", alt: "Horno de leña" },
    { src: "https://a.storyblok.com/f/dev/bellanapoli-terraza.jpg" },
  ],
  menu_categorias: [
    { nombre: "Pizzas", foto: { src: "https://a.storyblok.com/f/dev/cat-pizzas.jpg" }, orden: 0 },
    { nombre: "Pastas", orden: 1 },
  ],
  menu: [
    {
      category: "Pizzas",
      name: "Margherita",
      description: "Tomate San Marzano, mozzarella fior di latte, albahaca.",
      precios: [
        { etiqueta: "Media", importe: "9,00 €" },
        { etiqueta: "Ración", importe: "14,50 €" },
      ],
      nota: "Disponible sin gluten",
      foto: { src: "https://a.storyblok.com/f/dev/margherita.jpg" },
    },
    { category: "Pastas", name: "Cacio e pepe", description: "Pecorino romano y pimienta negra.", price: "13,00 €" },
  ],
});

// El cliente de **assets reales**: las siete fotos de `docs/plantillas/template1/`, subidas al space
// de Storyblok el 2026-08-08 y servidas por `a.storyblok.com`, que es el host de la allowlist. Es el
// único perfil del dev-server cuyas imágenes cargan de verdad en el navegador.
//
// ⚠️ **Hoy se ve UNA de las seis: el logo.** `portada`, `fotos`, `menu_categorias[].foto`,
// `menu[].foto` y `locations[].foto` están sembradas y cruzan las cuatro fronteras, pero **ninguna
// pieza las dibuja todavía** — las dibujan `heroPortada`, `galeria`, `cartaCategorias`,
// `platosDestacados` y `locales`, que son la segunda parte de la mitad B. Este comentario decía "es
// donde se comprueba con los ojos que una foto llegó hasta el HTML" y lo cazó una revisión: era una
// promesa a futuro escrita en presente. Cuando existan las piezas, lo será.
//
// ⚠️ **Es un negocio FICTICIO y sus fotos son de stock**, con la marca «Borcelle Burger» que traen
// incrustada. Por eso NO se siembran en la ficha de La Birra Bar, que es un restaurante real: poner la
// foto y el logo de otro negocio en la web de uno real es el mismo problema que un precio inventado, y
// más visible. Misma regla que ya se aplicó a los precios: **antes ausente que inventado.**
//
// La paleta y los roles salen tal cual de `docs/plantillas/template1/marca.json`.
//
// Una foto por destino, no una por elemento: la galería repite la misma imagen cuatro veces y las dos
// categorías comparten cabecera. Sirve para ver la rejilla y el recorte; para enseñárselo a alguien
// hacen falta fotos distintas (anotado en el README de `template1`).
const FOTO = {
  portada: "https://a.storyblok.com/f/293831091573700/2560x1440/30ad3813d6/axe-os-portada.jpg",
  galeria: "https://a.storyblok.com/f/293831091573700/1600x1200/d82ece3683/axe-os-fotos-galeria.jpg",
  categoria: "https://a.storyblok.com/f/293831091573700/1200x800/8fbaedf133/axe-og-categories.jpg",
  plato: "https://a.storyblok.com/f/293831091573700/800x800/e0f8442ce6/axe-og-menu-item.jpg",
  local: "https://a.storyblok.com/f/293831091573700/1600x1200/46847c4d05/axe-os-locations.jpg",
  logo: "https://a.storyblok.com/f/293831091573700/250x250/ec3d723b80/axe-os-logo-color.png",
} as const;

await cliente("Borcelle Burger", "borcelle.es", "444", {
  name: "Borcelle Burger",
  telephone: "+34 915 55 44 33",
  address: { streetAddress: "Calle de Fuencarral 88", postalCode: "28004", addressLocality: "Madrid" },
  opening_hours: "Lun-Dom 12:30-16:30, 20:00-00:00",
  brand: {
    plantilla: "base",
    colores: {
      primario: "#8c1c13",
      secundario: "#c8963e",
      titulo: "#1c1917",
      texto: "#44403c",
      fondo: "#fffdf9",
      fondoAlt: "#f5f1ea",
    },
    fuentes: { titulo: "condensada", texto: "humanista", decorativa: "script" },
    logo: FOTO.logo,
  },
  portada: { src: FOTO.portada, alt: "El local de Borcelle Burger" },
  fotos: [
    { src: FOTO.galeria, alt: "La barra" },
    { src: FOTO.galeria, alt: "La sala" },
    { src: FOTO.galeria },
    { src: FOTO.galeria, alt: "La terraza" },
  ],
  menu_categorias: [
    { nombre: "Hamburguesas", foto: { src: FOTO.categoria }, orden: 0 },
    { nombre: "Entrantes", foto: { src: FOTO.categoria }, orden: 1 },
  ],
  menu: [
    {
      category: "Hamburguesas",
      name: "Golden Burger",
      description: "Doble de vacuno, cheddar curado, cebolla caramelizada y pan brioche.",
      precios: [
        { etiqueta: "Sencilla", importe: "12,50 €" },
        { etiqueta: "Doble", importe: "15,90 €" },
      ],
      nota: "Punto al gusto",
      foto: { src: FOTO.plato },
    },
    {
      category: "Entrantes",
      name: "Patatas bravas",
      description: "Salsa brava de la casa.",
      price: "6,50 €",
      foto: { src: FOTO.plato },
    },
  ],
  locations: [
    {
      name: "Fuencarral",
      address: { streetAddress: "Calle de Fuencarral 88", postalCode: "28004", addressLocality: "Madrid" },
      telephone: "+34 915 55 44 33",
      opening_hours: "Lun-Dom 12:30-16:30, 20:00-00:00",
      foto: { src: FOTO.local },
    },
    {
      name: "Chamberí",
      address: { streetAddress: "Calle de Trafalgar 12", postalCode: "28010", addressLocality: "Madrid" },
      telephone: "+34 915 55 44 34",
      opening_hours: "Mar-Dom 13:00-16:30, 20:00-23:30",
      foto: { src: FOTO.local },
    },
  ],
});

// A propósito MAL CARGADO: `address` como texto plano, que es como lo escribiría una persona.
// Con esto, `sushizen.es` demuestra en el navegador que la página sale igual (sin bloque de
// contacto) en vez de devolver un 503. Antes de `perfil.ts`, esta fila tiraba la web entera.
await cliente("Sushi Zen", "sushizen.es", "222", {
  name: "Sushi Zen",
  address: "Calle Zurbano 40, Madrid",
});

// La marca LEGACY `{color, font}`, que es la forma que tienen todas las fichas sembradas hasta hoy.
// Existe para poder ver con los ojos —no solo en un test— que el manual de marca no le cambió el
// aspecto a ninguna web ya publicada. Es la única regresión que esta entrega puede causar.
await cliente("Bar Pepe", "barpepe.es", "333", {
  name: "Bar Pepe",
  telephone: "+34 913 00 00 00",
  address: { streetAddress: "Calle de la Cava Baja 20", postalCode: "28005", addressLocality: "Madrid" },
  opening_hours: "Mar-Dom 12:00-16:00, 19:00-00:00",
  brand: { color: "#a3122b", font: "serif" },
  menu: [
    { category: "Tapas", name: "Croquetas de jamón", price: "3,20 €" },
    { category: "Tapas", name: "Tortilla de patata", price: "2,80 €" },
  ],
});

// ---------------------------------------------------------------- stories de mentira
function story(titular: string, slug: string, texto: string): Story {
  return {
    name: titular,
    slug,
    content: {
      component: "page",
      seo: {
        title: `${titular} | AMG`,
        description: texto,
        canonical: `https://ejemplo.es/${slug}`,
        og_title: titular,
        og_description: texto,
      },
      schema_type: "LocalBusiness",
      page_type: "servicio",
      intent: "local",
      is_local: true,
      body: [
        { component: "hero", headline: titular, subhead: texto, cta_label: "Reservar" },
        // Texto PLANO, sin `<p>`: el render hace `esc(s.body)` (`web-builder/src/render/html.ts`) y
        // la prosa del LLM se pide en frases, no en HTML. El mock traía `<p>…</p>` y salía impreso
        // literal en pantalla — o sea que la única forma de ver el sitio sin credenciales enseñaba
        // etiquetas crudas, e invitaba a "arreglar" el escape, que es la puerta de la inyección.
        { component: "section", heading: "Nuestra cocina", body: "Producto de temporada." },
        {
          component: "faq",
          items: [{ question: "¿Hacen reservas?", answer: "Sí, por teléfono y por web." }],
        },
      ],
      meta: {
        contract_version: "web.v0.1",
        source_keyword: "restaurante madrid",
        secondary_keywords: [],
        internal_links: [],
        word_count_objetivo: 800,
        opportunity_score: 72,
        volumen: 1300,
        dificultad: 28,
        evidencia: "datos_mercado",
        score_confidence: 0.82,
      },
    },
  };
}

const cda = new MockCda();
cda.poner("pub-111", "published", "home", story("Trattoria Bella Napoli", "home", "Cocina napolitana en Madrid"));
cda.poner("pub-111", "published", "menu", story("La carta", "menu", "Pizzas y pastas de temporada"));
cda.poner("prv-111", "draft", "menu", story("La carta (BORRADOR)", "menu", "Carta de invierno, sin publicar"));
cda.poner("pub-222", "published", "home", story("Sushi Zen", "home", "Omakase en Chamberí"));
// `borcelle.es` es el space 444. Sin estas dos, el único perfil con fotos reales solo servía páginas
// SINTETIZADAS (la home de fallback y `/menu`) y no había ninguna **landing** que mirar — que es
// justamente el documento donde van a vivir `heroPortada` y la galería. Lo señaló una revisión.
cda.poner("pub-444", "published", "home", story("Borcelle Burger", "home", "Hamburguesas de barrio en Madrid"));
cda.poner(
  "pub-444",
  "published",
  "hamburguesas-madrid-centro",
  story("Hamburguesas en Madrid Centro", "hamburguesas-madrid-centro", "Carne maderada y pan brioche"),
);

// ---------------------------------------------------------------- app
const cache = new CacheRender();
const app = createApp({
  sitios: new PgSitios(new PglitePool(pg)),
  cda,
  cache,
  webhookSecret: WEBHOOK_SECRET,
  previewSecret: PREVIEW_SECRET,
  // Con esto, `?_host=` (abajo) puede fijar el dominio desde el navegador.
  confiarEnProxy: true,
});

const port = Number(process.env["PORT"] ?? 8080);

serve(
  {
    port,
    /**
     * `?_host=bellanapoli.es` reescribe la cabecera `X-Forwarded-Host`.
     *
     * **Vive acá y solo acá, envolviendo la app desde afuera.** Es una tentación evidente meterlo
     * en `app.ts` detrás de un `if (dev)` — y sería un parámetro de query que elige qué web de
     * cliente se sirve. Exactamente el fallback que el 404 sin explicación existe para impedir, con
     * una bandera de entorno como única defensa. El servicio real no tiene ni la línea de código.
     */
    fetch: (req: Request) => {
      const url = new URL(req.url);
      const host = url.searchParams.get("_host");
      if (!host) return app.fetch(req);

      const headers = new Headers(req.headers);
      headers.set("x-forwarded-host", host);
      url.searchParams.delete("_host");
      return app.fetch(new Request(url.toString(), { method: req.method, headers, body: req.body }));
    },
  },
  (info) => {
    const { firma, vence } = firmarPreview(PREVIEW_SECRET, "bellanapoli.es");
    const base = `http://localhost:${info.port}`;

    console.log(`\n▶ Renderizador (DEV, mock de Storyblok) en ${base}\n`);
    console.log("  Web de cliente:");
    console.log(`    ${base}/?_host=bellanapoli.es`);
    console.log(`    ${base}/menu?_host=bellanapoli.es`);
    console.log(`    ${base}/?_host=sushizen.es          ← otro cliente, otro space`);
    console.log(`    ${base}/?_host=barpepe.es           ← marca LEGACY {color, font}: no debe cambiar de aspecto`);
    console.log(`    ${base}/?_host=noexiste.es          ← 404, sin fallback`);
    console.log("\n  Preview del Visual Editor (firmado, 1 h):");
    console.log(`    ${base}/menu?_host=bellanapoli.es&${PARAM_FIRMA}=${firma}&${PARAM_VENCE}=${vence}`);
    console.log("\n  Webhook de invalidación (firmado):");
    console.log(
      `    node -e "const c=require('crypto');const b=JSON.stringify({space_id:111});` +
        `fetch('${base}/_webhook/storyblok',{method:'POST',body:b,headers:{'webhook-signature':` +
        `c.createHmac('sha1','${WEBHOOK_SECRET}').update(b).digest('hex')}}).then(r=>r.json()).then(console.log)"\n`,
    );
  },
);

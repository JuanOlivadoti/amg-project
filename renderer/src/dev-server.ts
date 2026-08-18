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
import { PERFIL_BORCELLE } from "./perfil-demo.js";
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
    { nombre: "Antipasti", foto: { src: "https://a.storyblok.com/f/dev/cat-antipasti.jpg" }, orden: 0 },
    { nombre: "Pizzas", foto: { src: "https://a.storyblok.com/f/dev/cat-pizzas.jpg" }, orden: 1 },
    { nombre: "Pastas", orden: 2 },
    { nombre: "Postres", foto: { src: "https://a.storyblok.com/f/dev/cat-postres.jpg" }, orden: 3 },
    { nombre: "Bebidas", foto: { src: "https://a.storyblok.com/f/dev/cat-bebidas.jpg" }, orden: 4 },
  ],
  // La carta COMPLETA: cubre los 14 alérgenos del Reglamento UE 1169/2011 y las 7 etiquetas dietéticas
  // entre los distintos platos (ninguno los lleva todos — un plato con 14 alérgenos no es creíble), más
  // nutrición, `precios` con `comensales` y el único plato con video. Es el perfil que se le enseña a
  // alguien para ver el feature completo, no el que ejercita un caso puntual — para eso están los
  // perfiles chicos de arriba y los fixtures de `web-builder`.
  menu: [
    // ---- Antipasti — gluten, sulfitos, lácteos, frutos de cáscara, mostaza, cacahuetes, apio, crustáceos
    {
      category: "Antipasti",
      name: "Burrata pugliese",
      description: "Burrata cremosa con tomates cherry, albahaca y pesto de piñones.",
      price: "11,50 €",
      foto: { src: "https://a.storyblok.com/f/dev/burrata.jpg" },
      alergenos: ["lacteos", "frutos_cascara"],
      etiquetas: ["vegetariano", "sin_gluten"],
      nutricion: { calorias: 320, proteinas_g: 14, carbohidratos_g: 8, grasas_g: 26 },
    },
    {
      category: "Antipasti",
      name: "Tabla de embutidos y quesos",
      description: "Selección de curados italianos, quesos DOP y pan casero.",
      // Sin `nutricion` a propósito: es un plato para compartir, no hay "la ración de referencia" de la
      // que habla el tipo — mismo criterio que un plato sin foto, es un caso soportado y conviene que
      // este perfil lo enseñe.
      precios: [
        { etiqueta: "Individual", importe: "14,00 €", comensales: "1 persona" },
        { etiqueta: "Para compartir", importe: "24,00 €", comensales: "2-3 personas" },
      ],
      nota: "Con frutos secos y miel",
      alergenos: ["lacteos", "gluten", "sulfitos", "frutos_cascara"],
    },
    {
      category: "Antipasti",
      name: "Ensalada de la huerta",
      description: "Hojas de temporada, vinagreta de mostaza y cacahuetes garrapiñados.",
      price: "9,50 €",
      alergenos: ["mostaza", "cacahuetes", "apio"],
      etiquetas: ["vegano", "sin_gluten", "sin_lactosa"],
      nutricion: { calorias: 180, proteinas_g: 5, carbohidratos_g: 14, grasas_g: 12 },
    },
    {
      category: "Antipasti",
      name: "Gambas al ajillo",
      description: "Gambón salvaje, guindilla y pan para mojar.",
      price: "13,50 €",
      alergenos: ["crustaceos", "gluten"],
      etiquetas: ["picante"],
      nutricion: { calorias: 260, proteinas_g: 22, carbohidratos_g: 4, grasas_g: 17 },
    },

    // ---- Pizzas — Margherita es el único plato con video
    {
      category: "Pizzas",
      name: "Margherita",
      description: "Tomate San Marzano, mozzarella fior di latte, albahaca.",
      precios: [
        { etiqueta: "Media", importe: "9,00 €", comensales: "1 persona" },
        { etiqueta: "Ración", importe: "14,50 €", comensales: "1-2 personas" },
      ],
      nota: "Disponible sin gluten",
      foto: { src: "https://a.storyblok.com/f/dev/margherita.jpg" },
      // ⚠️ VIDEO PENDIENTE DE ASSET REAL — `renderVideo` (web-builder/src/render/lib.ts) exige que TANTO
      // el video como el poster pasen la allowlist de host (`a.storyblok.com`, `render/videos.ts`) Y que
      // el poster cargue de verdad; si no, no emite el `<video>` y no hay error ni log que lo avise (la
      // misma trampa silenciosa que motiva las cuatro fronteras). Los dos valores de abajo pasan el
      // host pero el archivo no existe: subí el `.mp4` y una imagen fija a Storyblok (Assets → subir),
      // pegá acá las dos URL públicas que devuelve, y borrá este comentario.
      video: {
        src: "https://a.storyblok.com/f/dev/PENDIENTE-margherita.mp4",
        poster: {
          src: "https://a.storyblok.com/f/dev/PENDIENTE-margherita-poster.jpg",
          alt: "Margherita recién horneada",
        },
      },
      alergenos: ["gluten", "lacteos"],
      etiquetas: ["vegetariano"],
      nutricion: { calorias: 620, proteinas_g: 26, carbohidratos_g: 74, grasas_g: 22 },
    },
    {
      category: "Pizzas",
      name: "Diavola piccante",
      description: "Salami picante, mozzarella y guindilla fresca.",
      price: "13,00 €",
      alergenos: ["gluten", "lacteos"],
      etiquetas: ["picante"],
      nutricion: { calorias: 850, proteinas_g: 34, carbohidratos_g: 90, grasas_g: 36 },
    },
    {
      category: "Pizzas",
      name: "Vegana ai funghi",
      description: "Base de masa madre con harina de altramuces, setas variadas y queso vegetal.",
      price: "13,50 €",
      alergenos: ["gluten", "altramuces", "soja"],
      etiquetas: ["vegano", "sin_lactosa"],
      nutricion: { calorias: 640, proteinas_g: 18, carbohidratos_g: 88, grasas_g: 24 },
    },

    // ---- Pastas — «Cacio e pepe» queda A PROPÓSITO sin ningún campo nuevo: es el caso de
    // compatibilidad hacia atrás, mismo criterio que `web-builder/src/fixtures.ts` con este plato.
    { category: "Pastas", name: "Cacio e pepe", description: "Pecorino romano y pimienta negra.", price: "13,00 €" },
    {
      category: "Pastas",
      name: "Spaghetti alle vongole",
      description: "Almeja fresca, ajo, perejil y un toque de vino blanco.",
      price: "16,00 €",
      alergenos: ["moluscos", "gluten", "sulfitos"],
      nutricion: { calorias: 520, proteinas_g: 24, carbohidratos_g: 68, grasas_g: 14 },
    },
    {
      category: "Pastas",
      name: "Tonnarelli al tonno e sesamo",
      description: "Tonnarelli fresco, atún rojo, salsa de soja y sésamo tostado.",
      price: "15,50 €",
      alergenos: ["pescado", "gluten", "sesamo", "soja"],
      nutricion: { calorias: 560, proteinas_g: 30, carbohidratos_g: 64, grasas_g: 18 },
    },

    // ---- Postres
    {
      category: "Postres",
      name: "Tiramisù della casa",
      description: "Receta clásica con mascarpone y café espresso.",
      price: "6,50 €",
      alergenos: ["gluten", "huevos", "lacteos"],
      etiquetas: ["vegetariano"],
      nutricion: { calorias: 420, proteinas_g: 7, carbohidratos_g: 38, grasas_g: 26 },
    },
    {
      category: "Postres",
      name: "Sorbete al limón",
      description: "Limones de Amalfi, sin lácteos ni gluten.",
      price: "5,00 €",
      // Las cinco etiquetas a la vez, a propósito: es el plato que enseña `MAX_ETIQUETAS_RENDER` con
      // varias marcadas sin llegar al tope (7) — halal y kosher no salen en ningún otro ítem.
      etiquetas: ["vegano", "sin_gluten", "sin_lactosa", "halal", "kosher"],
      nutricion: { calorias: 140, proteinas_g: 0, carbohidratos_g: 34, grasas_g: 0 },
    },

    // ---- Bebidas
    {
      category: "Bebidas",
      name: "Vino de la casa",
      description: "Chianti DOCG, cosecha de la bodega asociada.",
      precios: [
        { etiqueta: "Copa", importe: "4,50 €" },
        { etiqueta: "Botella", importe: "19,00 €", comensales: "2-3 personas" },
      ],
      alergenos: ["sulfitos"],
    },
    {
      category: "Bebidas",
      name: "Limonata artesanal",
      description: "Limón exprimido, agua con gas y menta fresca.",
      price: "3,50 €",
      etiquetas: ["vegano", "sin_gluten", "sin_lactosa"],
    },
  ],
  // ⚠️ **A propósito sin `bienvenida`, sin `destacados` y sin `testimonios`.** Es el estado de TODA
  // ficha de producción hoy, y es lo que hay que poder mirar en el navegador: las dos primeras
  // secciones se rellenan con su default y la de reseñas **no se dibuja**. Si alguien le pone un
  // default a `testimonios`, este cliente es donde se va a ver.
});

// El cliente de **assets reales**: las siete fotos de `docs/plantillas/template1/`, subidas al space
// de Storyblok el 2026-08-08 y servidas por `a.storyblok.com`, que es el host de la allowlist. Es el
// único perfil del dev-server cuyas imágenes cargan de verdad en el navegador.
//
// ⚠️ **Es un negocio FICTICIO y sus fotos son de stock.** Por eso NO se siembran en la ficha de La
// Birra Bar, que es un restaurante real: poner la foto y el logo de otro negocio en la web de uno real
// es el mismo problema que un precio inventado, y más visible. Misma regla que ya se aplicó a los
// precios: **antes ausente que inventado.**
//
// La paleta y los roles salen tal cual de `docs/plantillas/template1/marca.json`.
//
// **Actualización del 2026-08-09.** Se subieron fotos distintas para lo que antes repetía una sola:
// **seis** de galería y **una por categoría**. Deja de ser "sirve para ver la rejilla" y pasa a ser el
// caso que se le puede enseñar a alguien — con seis imágenes distintas se ve si el recorte 4:3 aguanta
// encuadres distintos, que con la misma repetida seis veces no se ve. `plato` y `local` siguen
// repitiendo, y ahí sigue valiendo la salvedad de antes.
//
// ⚠️ **Reemplazar un asset en Storyblok CAMBIA la URL.** La portada original llevaba la marca
// «Borcelle Burger» incrustada —salía dos veces, una en la cabecera y otra quemada en el JPG—; al
// subir la limpia, la URL vieja pasó a devolver **`403 AccessDenied`** desde el S3 de Storyblok
// (verificado con `curl`, no supuesto). O sea que sustituir una foto **no es** editar el archivo: es
// un asset nuevo, y toda ficha que guarde la URL anterior se queda con un `<img>` roto sin que nada
// avise. Cuando esto pase con un cliente de verdad, el síntoma va a ser una portada colapsada a 26 px
// y ningún log.
// Las URL de los assets y el perfil entero viven en `perfil-demo.ts`: lo comparten este servidor
// y el generador del SQL de la demo. Ver ahí por qué el negocio es ficticio.

await cliente("Borcelle Burger", "borcelle.es", "444", PERFIL_BORCELLE);

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

// Las dos landings **sin las fotos cargando**, que son la otra mitad del gate de la entrega 3 («el
// sitio manejado en un navegador, con fotos y sin fotos»). Sin ellas solo se podía mirar el caso
// bonito, que es justamente el que hoy no tiene ningún cliente real. Son **dos casos distintos**, y de
// ahí que sean dos y no una:
//
//  - `bellanapoli.es` **sí** declara `portada`, pero su URL no existe → el `<img>` se emite (pasa la
//    allowlist: el host es correcto) y **el navegador no lo puede pintar**. Es lo que se ve cuando la
//    agencia borra un asset del space y nadie revisa las fichas.
//  - `barpepe.es` no declara ninguna foto → `heroPortada` degrada al **hero tipográfico**, y
//    `galeria`/`platosDestacados` no emiten nada. Es el estado de TODAS las fichas de producción hoy,
//    así que es la versión del sitio que más se está sirviendo.
cda.poner(
  "pub-111",
  "published",
  "restaurante-italiano-madrid-centro",
  story("Restaurante italiano en Madrid Centro", "restaurante-italiano-madrid-centro", "Masa de 48 horas"),
);
cda.poner("pub-333", "published", "tapas-la-latina", story("Tapas en La Latina", "tapas-la-latina", "De toda la vida"));

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
    // Las landings van PRIMERO y con su etiqueta: son el documento donde viven las piezas con foto, y
    // sin listarlas aquí había que leer el código para saber qué URL abrir. El checkpoint dice que la
    // app se **maneja**, no que se lea.
    console.log("  Landings — las tres caras de la §Política de imágenes:");
    console.log(`    ${base}/hamburguesas-madrid-centro?_host=borcelle.es          ← FOTOS REALES del space`);
    console.log(`    ${base}/tapas-la-latina?_host=barpepe.es                      ← SIN fotos: hero tipográfico`);
    console.log(`    ${base}/restaurante-italiano-madrid-centro?_host=bellanapoli.es  ← foto declarada y ROTA`);
    console.log("\n  Web de cliente:");
    console.log(`    ${base}/?_host=borcelle.es           ← home y /menu con la carta por categorías`);
    console.log(`    ${base}/menu?_host=borcelle.es`);
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

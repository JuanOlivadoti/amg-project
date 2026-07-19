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

await cliente("Trattoria Bella Napoli", "bellanapoli.es", "111", {
  name: "Trattoria Bella Napoli",
  telephone: "+34 910 000 000",
  address: { streetAddress: "Calle Mayor 1", postalCode: "28013", addressLocality: "Madrid" },
  opening_hours: "Mar-Dom 13:00-16:00, 20:00-23:30",
});

// A propósito MAL CARGADO: `address` como texto plano, que es como lo escribiría una persona.
// Con esto, `sushizen.es` demuestra en el navegador que la página sale igual (sin bloque de
// contacto) en vez de devolver un 503. Antes de `perfil.ts`, esta fila tiraba la web entera.
await cliente("Sushi Zen", "sushizen.es", "222", {
  name: "Sushi Zen",
  address: "Calle Zurbano 40, Madrid",
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
        { component: "section", heading: "Nuestra cocina", body: "<p>Producto de temporada.</p>" },
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

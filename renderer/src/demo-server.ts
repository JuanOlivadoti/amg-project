/**
 * DEMO LOCAL — el renderizador real, contra tu Storyblok REAL, sin desplegar nada.
 *
 * La diferencia con `dev-server.ts` es una sola y es la que importa: aquel usa un mock de Storyblok
 * para verificar el comportamiento; **este lee tu space de verdad** por la Content Delivery API. Es
 * lo que convierte "contenido en un CMS" en "la web del cliente, viva, en un dominio" — que es la
 * diferencia entre una demo técnica y un producto (ADR-19).
 *
 * Lo que hace posible que esto NO necesite una base desplegada: el mapa dominio→space vive en UNA
 * fila, y esa fila se siembra en PGlite en memoria. Cero credenciales de base de datos. La única
 * credencial real es el token de LECTURA de la CDA, que ponés en `renderer/.env` (ver `.env.example`).
 *
 * Correr:  npm run demo -w renderer      (tras completar renderer/.env)
 *
 * En el navegador `localhost` no es tu dominio, así que —igual que dev-server— se navega con
 * `?_host=tudominio`. Ese truco vive SOLO acá, envolviendo la app desde afuera: el servicio real no
 * tiene ni la línea (sería un parámetro de query que elige qué web servir).
 */
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { serve } from "@hono/node-server";
import { aplicarMigraciones, PgSitios, PglitePool } from "db";
import { createApp } from "./app.js";
import { CacheRender } from "./cache.js";
import { StoryblokCda } from "./cda.js";
import { normalizarHost } from "./dominio.js";
import { firmarPreview, PARAM_FIRMA, PARAM_VENCE } from "./preview.js";

// ---------------------------------------------------------------- config desde renderer/.env
try {
  process.loadEnvFile(".env");
} catch {
  abortar(
    "No encontré renderer/.env. Copiá renderer/.env.example a renderer/.env y completá los tokens.",
  );
}

const publicToken = req("STORYBLOK_PUBLIC_TOKEN");
const spaceId = req("STORYBLOK_SPACE_ID").trim();
const dominio = normalizarHost(req("DEMO_DOMAIN"));
const previewToken = process.env["STORYBLOK_PREVIEW_TOKEN"]?.trim() || null;
const region = (process.env["STORYBLOK_REGION"] ?? "eu").toLowerCase();
const briefPath = process.env["BRIEF_PATH"] ?? "../kr-service/out/brief.approved.json";

if (!dominio) abortar(`DEMO_DOMAIN inválido: tiene que ser un dominio (minúsculas, sin http:// ni puerto).`);
if (/\s/.test(spaceId) || spaceId.length === 0) abortar("STORYBLOK_SPACE_ID no puede estar vacío ni tener espacios.");

// Endpoint de la Content DELIVERY API por región (NO es el de Management).
const CDN: Record<string, string> = {
  eu: "https://api.storyblok.com/v2/cdn",
  us: "https://api-us.storyblok.com/v2/cdn",
  ap: "https://api-ap.storyblok.com/v2/cdn",
  ca: "https://api-ca.storyblok.com/v2/cdn",
};
const cdaBase = CDN[region];
if (!cdaBase) abortar(`STORYBLOK_REGION desconocida: "${region}". Usá eu | us | ap | ca.`);

const perfil = leerPerfil();
const slugs = leerSlugs();

// Secretos de la demo. El webhook y el preview firman con esto; se generan si no se fijan, porque
// en una demo local no protegen nada de valor y no vale la pena pedirlos.
const WEBHOOK_SECRET = process.env["STORYBLOK_WEBHOOK_SECRET"] || "demo-webhook";
const PREVIEW_SECRET = process.env["PREVIEW_SECRET"] || "demo-preview";

// ---------------------------------------------------------------- una fila real en PGlite
const pg = new PGlite();
await aplicarMigraciones(pg);

const [{ id: tenant }] = (
  await pg.query<{ id: string }>(
    "insert into tenants (nombre, slug) values ('Agencia AMG (demo)','amg-demo') returning id",
  )
).rows as [{ id: string }];

await pg.query(
  `insert into clients (tenant_id, nombre, domain, storyblok_space_id,
                        storyblok_public_token, storyblok_preview_token, business_profile)
   values ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
  [tenant, dominio, dominio, spaceId, publicToken, previewToken, perfil ? JSON.stringify(perfil) : null],
);

// ---------------------------------------------------------------- la app real
const app = createApp({
  sitios: new PgSitios(new PglitePool(pg)),
  cda: new StoryblokCda({ base: cdaBase }), // ← Storyblok DE VERDAD
  cache: new CacheRender(),
  webhookSecret: WEBHOOK_SECRET,
  previewSecret: PREVIEW_SECRET,
  confiarEnProxy: true, // para que ?_host= (abajo) pueda fijar el dominio desde el navegador
});

const port = Number(process.env["PORT"] ?? 8080);

serve(
  {
    port,
    fetch: (r: Request) => {
      const url = new URL(r.url);
      const host = url.searchParams.get("_host");
      if (!host) return app.fetch(r);
      const headers = new Headers(r.headers);
      headers.set("x-forwarded-host", host);
      url.searchParams.delete("_host");
      return app.fetch(new Request(url.toString(), { method: r.method, headers, body: r.body }));
    },
  },
  (info) => imprimirGuia(info.port),
);

// ---------------------------------------------------------------- helpers

function req(nombre: string): string {
  const v = process.env[nombre]?.trim();
  if (!v) abortar(`Falta ${nombre} en renderer/.env (ver renderer/.env.example).`);
  return v as string;
}

function abortar(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function leerPerfil(): unknown {
  const p = process.env["BUSINESS_PROFILE_PATH"]?.trim();
  if (!p) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    console.warn(`⚠️  No pude leer BUSINESS_PROFILE_PATH (${p}); la web sale sin NAP en el JSON-LD.`);
    return null;
  }
}

/** Los slugs a anunciar salen del brief publicado: es la lista de páginas que están en el space. */
function leerSlugs(): string[] {
  try {
    const brief = JSON.parse(readFileSync(briefPath, "utf8")) as {
      paginas_propuestas?: { url_slug?: string; approved?: boolean }[];
    };
    return (brief.paginas_propuestas ?? [])
      .filter((p) => p.approved !== false && p.url_slug)
      .map((p) => p.url_slug!.replace(/^\/+|\/+$/g, ""))
      .filter(Boolean);
  } catch {
    console.warn(`⚠️  No leí un brief en ${briefPath}; no puedo anunciar slugs. Corré la acción 06 primero.`);
    return [];
  }
}

function imprimirGuia(puerto: number): void {
  const base = `http://localhost:${puerto}`;
  const url = (slug: string) => `${base}/${slug}?_host=${dominio}`;

  console.log(`\n▶ Renderizador (DEMO, Storyblok REAL · space ${spaceId} · región ${region}) en ${base}\n`);
  console.log(`  Dominio de la demo: ${dominio}\n`);

  if (slugs.length === 0) {
    console.log("  ⚠️  Sin slugs para anunciar. Corré la acción 06 (research + publicar) y reiniciá.");
  } else {
    console.log("  La web del cliente, en vivo (cada una es una página real de tu space):");
    for (const s of slugs) console.log(`    ${url(s)}`);
    console.log(`\n    ${base}/?_host=noexiste.es          ← 404, sin fallback (así debe ser)`);
  }

  // El research produce páginas temáticas, no una portada. Antes la raíz daba 404; ahora el
  // renderizador SINTETIZA una home (el nombre del negocio + el índice de las páginas) cuando no hay
  // una story `home` publicada. Así la raíz de un dominio válido nunca es un 404.
  console.log(`\n  Portada: ${base}/?_host=${dominio} (la raíz) sirve una home sintetizada — el nombre`);
  console.log("           del negocio + el índice de las páginas. Si el cliente crea su propia `home`");
  console.log("           en Storyblok, esa gana.");

  if (previewToken && slugs[0]) {
    const { firma, vence } = firmarPreview(PREVIEW_SECRET, dominio!);
    console.log("\n  Visual Editor — URL de preview firmada (1 h), sirve el BORRADOR + el Bridge:");
    console.log(`    ${url(slugs[0])}&${PARAM_FIRMA}=${firma}&${PARAM_VENCE}=${vence}`);
    console.log("\n    En Storyblok, configurá esta URL como 'Location (default environment)' del space");
    console.log("    para editar en vivo. (Reemplazá localhost por tu host si lo exponés con un túnel.)");
  } else if (!previewToken) {
    console.log("\n  (Sin STORYBLOK_PREVIEW_TOKEN: la web pública anda, pero no el Visual Editor.)");
  }
  console.log("");
}

import type { BrandTheme, BusinessProfile, Location, MenuItem } from "web-builder";

const FUENTES = new Set(["sistema", "serif", "moderna"]);

/**
 * La marca, validada. Es doble frontera: `renderStory` también revalida, pero acá se recorta ANTES
 * de que el objeto entre a `renderStory` — y sobre todo, si no estuviera, `perfilValido` tiraría
 * `brand` con su allowlist y el tema no llegaría nunca (lo que pasó en la demo). Cada campo se valida
 * como lo que va a ser: hex (va a `<style>`), fuente de allowlist, logo http(s) (va a `<img src>`).
 */
function marca(v: unknown): BrandTheme | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const b = v as Record<string, unknown>;

  const color = typeof b["color"] === "string" && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(b["color"]) ? b["color"] : undefined;
  const font = typeof b["font"] === "string" && FUENTES.has(b["font"]) ? (b["font"] as BrandTheme["font"]) : undefined;
  const logo = typeof b["logo"] === "string" && /^https?:\/\//i.test(b["logo"]) ? b["logo"] : undefined;

  if (!color && !font && !logo) return undefined;
  return { ...(color ? { color } : {}), ...(font ? { font } : {}), ...(logo ? { logo } : {}) };
}

/**
 * Valida el `business_profile` que sale de la base ANTES de dárselo a `renderStory()`.
 *
 * ## Por qué esto existe (lo encontró el navegador, no los tests)
 *
 * `clients.business_profile` es una columna `jsonb`: Postgres garantiza que es JSON válido y **nada
 * más**. Nadie valida su forma al escribirlo. `renderStory()`, en cambio, confía en el tipo
 * `BusinessProfile` — y con razón, porque dentro del pipeline ese objeto lo construye código
 * tipado.
 *
 * En el renderizador esa cadena se rompe: el objeto viene de una fila que pudo cargar una persona.
 * Con `address` como texto plano en vez de un `PostalAddress`, `renderContact()` hace
 * `esc(p.address.streetAddress)` → `esc(undefined)` → `.replace` sobre `undefined` → **excepción** →
 * 503. Es decir: **un NAP mal cargado tira la web entera de ese cliente**, y el fallo aparece al
 * publicar, no al guardar la ficha.
 *
 * Yo había escrito en `app.ts` que un perfil mal formado "degrada la página en vez de romperla".
 * Era mentira: el `typeof p === "object"` que tenía deja pasar `{address: "Calle Mayor 1"}` sin
 * pestañear. La afirmación estaba en un comentario, que es donde las afirmaciones no se ejecutan.
 *
 * ## La regla
 *
 * Perfil incompleto → se usa lo que sirva y se descarta lo que no. Perfil irreconocible → `null`, y
 * la página sale sin bloque de contacto ni NAP en el JSON-LD. **Una página sin dirección es mucho
 * mejor que ninguna página.** Es la misma decisión que el `null` de las métricas en kr.v0.4: se
 * degrada explícito, no se rompe ni se inventa.
 */

function texto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

/**
 * `undefined` salvo que sea un objeto con lo que el render da por hecho.
 *
 * Calle y ciudad siguen siendo obligatorias: media dirección renderizada es peor que ninguna. El
 * **código postal ya no**, porque el render lo imprime condicionalmente y muchos negocios publican
 * calle y ciudad nada más — exigirlo tiraba la dirección entera de un local legítimo.
 */
function direccion(v: unknown): BusinessProfile["address"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;

  const streetAddress = texto(a["streetAddress"]);
  const addressLocality = texto(a["addressLocality"]);
  if (!streetAddress || !addressLocality) return undefined;

  return {
    streetAddress,
    addressLocality,
    ...(texto(a["postalCode"]) ? { postalCode: texto(a["postalCode"])! } : {}),
    ...(texto(a["addressRegion"]) ? { addressRegion: texto(a["addressRegion"])! } : {}),
    ...(texto(a["addressCountry"]) ? { addressCountry: texto(a["addressCountry"])! } : {}),
  };
}

/**
 * Topes de las listas del perfil.
 *
 * `business_profile` es una columna `jsonb`: Postgres garantiza JSON válido y **nada más**. Sin tope,
 * una ficha con 50.000 ítems se renderiza entera en cada visita fría — no hace falta mala intención,
 * alcanza un import mal hecho. Es el mismo criterio que `MAX_NAV_ITEMS` en la CDA.
 */
const MAX_LOCALES = 20;
const MAX_ITEMS_CARTA = 200;

/** Los locales, validados uno por uno. Un local sin NINGÚN dato usable no es un local: se descarta. */
function locales(v: unknown): Location[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Location[] = [];
  for (const item of v.slice(0, MAX_LOCALES)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const l = item as Record<string, unknown>;
    const addr = direccion(l["address"]);
    const nombre = texto(l["name"]);
    const tel = texto(l["telephone"]);
    const horas = texto(l["opening_hours"]);
    // Un objeto que solo trae `name` no aporta nada al footer: sería un título vacío.
    if (!addr && !tel && !horas) continue;
    out.push({
      ...(nombre ? { name: nombre } : {}),
      ...(addr ? { address: addr } : {}),
      ...(tel ? { telephone: tel } : {}),
      ...(horas ? { opening_hours: horas } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** La carta, validada. Sin `name` no hay ítem que mostrar. */
function carta(v: unknown): MenuItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MenuItem[] = [];
  for (const item of v.slice(0, MAX_ITEMS_CARTA)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    const nombre = texto(m["name"]);
    if (!nombre) continue;
    out.push({
      name: nombre,
      ...(texto(m["category"]) ? { category: texto(m["category"])! } : {}),
      ...(texto(m["description"]) ? { description: texto(m["description"])! } : {}),
      ...(texto(m["price"]) ? { price: texto(m["price"])! } : {}),
    });
  }
  return out.length ? out : undefined;
}

/** `null` = no hay perfil usable. La página se renderiza igual, sin contacto. */
export function perfilValido(bruto: unknown): BusinessProfile | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const p = bruto as Record<string, unknown>;

  // `name` es el único obligatorio: `renderContact()` lo imprime siempre y el JSON-LD lo usa de
  // `name` de la entidad. Sin él no hay perfil que valga.
  const name = texto(p["name"]);
  if (!name) return null;

  const addr = direccion(p["address"]);

  return {
    name,
    ...(texto(p["telephone"]) ? { telephone: texto(p["telephone"])! } : {}),
    ...(texto(p["priceRange"]) ? { priceRange: texto(p["priceRange"])! } : {}),
    ...(texto(p["url"]) ? { url: texto(p["url"])! } : {}),
    ...(texto(p["image"]) ? { image: texto(p["image"])! } : {}),
    ...(addr ? { address: addr } : {}),
    ...(texto(p["opening_hours"]) ? { opening_hours: texto(p["opening_hours"])! } : {}),
    ...(locales(p["locations"]) ? { locations: locales(p["locations"]) } : {}),
    ...(carta(p["menu"]) ? { menu: carta(p["menu"]) } : {}),
    ...(marca(p["brand"]) ? { brand: marca(p["brand"]) } : {}),
  };
}

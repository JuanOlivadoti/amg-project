import type { BrandTheme, BusinessProfile } from "web-builder";

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

/** `undefined` salvo que sea un objeto con las tres partes que `renderStory` da por hechas. */
function direccion(v: unknown): BusinessProfile["address"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const a = v as Record<string, unknown>;

  // Estas tres se leen SIN comprobar en `renderContact()`. Si falta una, no hay dirección: media
  // dirección renderizada es peor que ninguna, y una que lance es peor que las dos.
  const streetAddress = texto(a["streetAddress"]);
  const postalCode = texto(a["postalCode"]);
  const addressLocality = texto(a["addressLocality"]);
  if (!streetAddress || !postalCode || !addressLocality) return undefined;

  return {
    streetAddress,
    postalCode,
    addressLocality,
    ...(texto(a["addressRegion"]) ? { addressRegion: texto(a["addressRegion"])! } : {}),
    ...(texto(a["addressCountry"]) ? { addressCountry: texto(a["addressCountry"])! } : {}),
  };
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
    ...(marca(p["brand"]) ? { brand: marca(p["brand"]) } : {}),
  };
}

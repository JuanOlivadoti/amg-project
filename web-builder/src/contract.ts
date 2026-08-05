import { z } from "zod";
import type { BusinessProfile } from "./types.js";

/*
 * El contrato del brief vive en el paquete `contrato` desde KR-2a: el M1 valida con `parseBrief`, que
 * usa el derivado LAXO (`consumoM1`) — cuatro `schema_version`, `evidencia` y `score_confidence`
 * opcionales. Esa laxitud es deliberada: acepta briefs viejos que siguen siendo publicables.
 *
 * Sigue siendo una frontera validada en runtime (ADR-06/07): el brief puede venir de otra versión del
 * pipeline, de edición humana o de JSON corrupto. Lo que cambió es DÓNDE se define, no que se valide.
 * Antes vivía copiado a mano acá y en `kr-service`, así que cambiar uno dejaba el otro mintiendo.
 *
 * Lo que sigue acá es el perfil de negocio, que NO es parte del contrato del brief.
 */
export { parseBrief, SUPPORTED_SCHEMA_VERSIONS } from "contrato";

const postalAddressSchema = z.object({
  streetAddress: z.string(),
  addressLocality: z.string(),
  // Opcional: ver el comentario en `PostalAddress`. Un código postal inventado es peor que ninguno.
  postalCode: z.string().optional(),
  addressRegion: z.string().optional(),
  addressCountry: z.string().optional(),
});

const locationSchema = z.object({
  name: z.string().optional(),
  address: postalAddressSchema.optional(),
  telephone: z.string().optional(),
  opening_hours: z.string().optional(),
});

/** `name` es lo único obligatorio: un ítem de carta sin nombre no se puede mostrar. */
const menuItemSchema = z.object({
  category: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().optional(),
});

/**
 * Tema de marca. La validación acá es DEFENSA, no cosmética: `color` y `font` terminan dentro de un
 * `<style>` y el `logo` en un `<img src>`. Un `color` con `red;}` o un `font` con `</style>` serían
 * inyección de CSS/markup. Se valida en la puerta; el renderizador vuelve a validar (defensa en
 * profundidad, porque en PROD el perfil puede venir de Storyblok sin pasar por acá).
 */
const brandSchema = z.object({
  // Solo hex (#rgb o #rrggbb). Nada más puede colarse a la hoja de estilo.
  color: z
    .string()
    .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "color debe ser un hex (#0a7d34)")
    .optional(),
  // Allowlist cerrada → el renderizador la mapea a un stack seguro. No es texto libre.
  font: z.enum(["sistema", "serif", "moderna"]).optional(),
  // `.url()` de Zod acepta `javascript:` (tiene esquema): hay que exigir http(s) explícitamente,
  // porque el logo termina en un `<img src>`.
  logo: z
    .string()
    .url()
    .refine((u) => /^https?:\/\//i.test(u), "el logo debe ser una URL http(s)")
    .optional(),
});

// Mismo tope que MAX_LOCALES/MAX_ITEMS_CARTA en renderer/src/perfil.ts y en la migración 0010 —
// tienen que coincidir en las tres capas (Zod en la puerta, Postgres, el validador del renderer),
// si uno se cambia hay que cambiar los tres.
const MAX_LOCALES = 20;
const MAX_ITEMS_CARTA = 200;

const businessProfileSchema = z.object({
  name: z.string().min(1),
  telephone: z.string().optional(),
  priceRange: z.string().optional(),
  url: z.string().url().optional(),
  image: z.string().url().optional(),
  address: postalAddressSchema.optional(),
  opening_hours: z.string().optional(),
  locations: z.array(locationSchema).max(MAX_LOCALES).optional(),
  menu: z.array(menuItemSchema).max(MAX_ITEMS_CARTA).optional(),
  brand: brandSchema.optional(),
});

/** Valida el perfil de negocio. Lanza si el JSON existe pero está mal formado. */
export function parseProfile(raw: unknown): BusinessProfile {
  const parsed = businessProfileSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`business-profile.json inválido: ${formatIssues(parsed.error)}`);
  }
  return parsed.data as BusinessProfile;
}

function formatIssues(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`)
    .join("; ");
}

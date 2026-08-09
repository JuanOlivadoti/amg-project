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

/*
 * Los topes de las listas del perfil. Tienen que coincidir en las CUATRO fronteras que cruza un campo
 * —este Zod, `app.nap_publico` (migración 0014), `perfilValido` del renderizador y el render—: si uno
 * se cambia, se cambian los cuatro. Sin tope, una ficha con 50.000 entradas se renderiza entera en
 * cada visita fría, y no hace falta mala intención: alcanza un import mal hecho.
 *
 * Acá el tope **rechaza el archivo** en vez de cortarlo, al revés que en las otras tres fronteras. Es
 * deliberado y no es una discrepancia: esta frontera valida un `business-profile.json` escrito a mano
 * y leído por un CLI, donde fallar fuerte le dice a quien lo escribió que sobran entradas. Las otras
 * tres reciben datos ya guardados, donde tirar la página entera por un exceso sería peor que recortar.
 */
const MAX_LOCALES = 20;
const MAX_ITEMS_CARTA = 200;
const MAX_FOTOS = 30;
const MAX_PRECIOS = 3;
const MAX_CATEGORIAS = 20;

/** `#rgb` o `#rrggbb`. Lo único que puede entrar a la hoja de estilo. */
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const postalAddressSchema = z.object({
  streetAddress: z.string(),
  addressLocality: z.string(),
  // Opcional: ver el comentario en `PostalAddress`. Un código postal inventado es peor que ninguno.
  postalCode: z.string().optional(),
  addressRegion: z.string().optional(),
  addressCountry: z.string().optional(),
});

/**
 * Una foto. `src` **https obligatorio**, no `http:` — además de que el navegador lo bloquearía como
 * contenido mixto, cada `<img src>` filtra IP y user-agent del visitante al host del asset.
 *
 * `.url()` de Zod acepta `javascript:` (tiene esquema), así que el `refine` no es redundante: es lo
 * único que exige el esquema. Misma trampa que ya documenta `logo`, con https en vez de http(s).
 *
 * La **allowlist de hosts** no se aplica acá: vive en el renderizador (frontera 4), porque es él quien
 * emite el `<img>` y quien tiene que fallar cerrado aunque el dato no haya pasado nunca por este Zod.
 */
const fotoSchema = z.object({
  src: z
    .string()
    .url()
    .refine((u) => /^https:\/\//i.test(u), "la foto debe ser una URL https"),
  // Opcional a propósito: el formulario del portal captura una URL y nada más. Ver `Foto` en types.ts.
  alt: z.string().optional(),
});

const locationSchema = z.object({
  name: z.string().optional(),
  address: postalAddressSchema.optional(),
  telephone: z.string().optional(),
  opening_hours: z.string().optional(),
  foto: fotoSchema.optional(),
});

/** `name` es lo único obligatorio: un ítem de carta sin nombre no se puede mostrar. */
const menuItemSchema = z.object({
  category: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().optional(),
  // Las dos claves obligatorias: una entrada sin etiqueta o sin importe no es un precio a medias, es
  // basura que el render no podría dibujar.
  //
  // **Acá eso RECHAZA el archivo entero**, por la misma razón que los topes de arriba: quien escribe
  // el JSON a mano tiene que enterarse de que le falta un campo. Son las fronteras 2 y 3 las que
  // descartan la entrada sola y dejan vivo el plato, porque ahí el dato ya está guardado y tirar la
  // carta por un precio mal cargado sería peor.
  precios: z
    .array(z.object({ etiqueta: z.string().min(1), importe: z.string().min(1) }))
    .max(MAX_PRECIOS)
    .optional(),
  nota: z.string().optional(),
  foto: fotoSchema.optional(),
});

/** `nombre` es lo que se compara contra `MenuItem.category`: sin él la categoría no agrupa nada. */
const menuCategoriaSchema = z.object({
  nombre: z.string().min(1),
  foto: fotoSchema.optional(),
  orden: z.number().int().min(0).optional(),
});

/**
 * Tema de marca. La validación acá es DEFENSA, no cosmética: `color` y `font` terminan dentro de un
 * `<style>` y el `logo` en un `<img src>`. Un `color` con `red;}` o un `font` con `</style>` serían
 * inyección de CSS/markup. Se valida en la puerta; el renderizador vuelve a validar (defensa en
 * profundidad, porque en PROD el perfil puede venir de Storyblok sin pasar por acá).
 */
const hexOpcional = z.string().regex(HEX, "debe ser un hex (#0a7d34 o #0a7)").optional();

/** Los siete nombres de ROL. Nunca una familia ni un stack CSS: ver `FuenteNombre` en types.ts. */
const fuenteSchema = z
  .enum(["sistema", "serif", "moderna", "condensada", "geometrica", "humanista", "script"])
  .optional();

const brandSchema = z.object({
  // `.url()` de Zod acepta `javascript:` (tiene esquema): hay que exigir el protocolo explícitamente,
  // porque el logo termina en un `<img src>`.
  //
  // **https, no http(s)** — se alineó con `fotoSchema` cuando el logo entró en la §Política de
  // imágenes. Aceptarlo acá y descartarlo en el render (frontera 4, que ya exige https) es la peor de
  // las dos conductas: el CLI diría que el perfil está bien y la web saldría sin logo, sin que nada
  // explicara por qué. Que falle en la puerta es ruidoso y accionable.
  logo: z
    .string()
    .url()
    .refine((u) => /^https:\/\//i.test(u), "el logo debe ser una URL https")
    .optional(),
  // Texto libre a propósito: un nombre desconocido cae a `base` en vez de dar error, así que una
  // ficha que pide una plantilla que todavía no existe produce una web correcta, no un 500.
  plantilla: z.string().optional(),
  colores: z
    .object({
      primario: hexOpcional,
      secundario: hexOpcional,
      titulo: hexOpcional,
      texto: hexOpcional,
      fondo: hexOpcional,
      fondoAlt: hexOpcional,
    })
    .optional(),
  fuentes: z
    .object({ titulo: fuenteSchema, texto: fuenteSchema, decorativa: fuenteSchema })
    .optional(),
  // Legacy. Se sigue aceptando: quitarlo invalidaría todas las fichas sembradas de golpe.
  color: hexOpcional,
  font: z.enum(["sistema", "serif", "moderna"]).optional(),
});

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
  menu_categorias: z.array(menuCategoriaSchema).max(MAX_CATEGORIAS).optional(),
  brand: brandSchema.optional(),
  portada: fotoSchema.optional(),
  fotos: z.array(fotoSchema).max(MAX_FOTOS).optional(),
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

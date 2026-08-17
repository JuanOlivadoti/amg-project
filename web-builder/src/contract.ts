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
/**
 * Exportado para el editor del portal (`api/src/app.ts`, `PATCH /clients/:id/menu`): valida el
 * tamaño del array ANTES de construir el `update`, con el mismo tope que esta frontera. No es una de
 * las tres que ya exportaba el comentario de abajo ("la frontera 4 también aplica") — ésta la
 * necesita una frontera de ESCRITURA, no de render, y es honesto decirlo así.
 */
export const MAX_ITEMS_CARTA = 200;
/*
 * Los tres que la **frontera 4 (el render) también aplica** se exportan, y ese es todo el motivo de
 * que estén exportados y los otros dos no: `render/lib.ts` declara los suyos y un test exige que
 * coincidan (`piezas/piezas-foto.test.ts`). "Tienen que coincidir en las cuatro fronteras" era prosa
 * de este comentario; entre las dos fronteras que viven en este paquete, ahora es un test.
 */
export const MAX_FOTOS = 30;
export const MAX_PRECIOS = 3;
export const MAX_CATEGORIAS = 20;
/**
 * Las dos listas de las secciones de plantilla (bloque K, etapa 3).
 *
 * **Seis motivos** porque la rejilla los pone de tres en tres y siete dejan una fila coja; **doce
 * reseñas** porque la sección las apila y a partir de ahí nadie las lee — el tope no está para
 * proteger la memoria sino para que la página no se convierta en un muro de citas.
 */
export const MAX_DESTACADOS = 6;
export const MAX_TESTIMONIOS = 12;

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

/** Los 14 alérgenos del Reglamento UE 1169/2011. Tiene que coincidir EXACTAMENTE con `Alergeno` de
 *  `types.ts` y con el `Set` de `renderer/src/perfil.ts` — un valor en dos de las tres listas y no en
 *  la tercera es la misma clase de fuga silenciosa que ya documentan las otras fronteras. */
const ALERGENOS = [
  "gluten",
  "crustaceos",
  "huevos",
  "pescado",
  "cacahuetes",
  "soja",
  "lacteos",
  "frutos_cascara",
  "apio",
  "mostaza",
  "sesamo",
  "sulfitos",
  "altramuces",
  "moluscos",
] as const;
const alergenoSchema = z.enum(ALERGENOS);
/** El tope es el TAMAÑO de la taxonomía: un plato nunca declara un alérgeno dos veces con sentido. */
const MAX_ALERGENOS = ALERGENOS.length;

const ETIQUETAS_DIETETICAS = [
  "vegano",
  "vegetariano",
  "sin_gluten",
  "sin_lactosa",
  "picante",
  "halal",
  "kosher",
] as const;
const etiquetaDieteticaSchema = z.enum(ETIQUETAS_DIETETICAS);
const MAX_ETIQUETAS = ETIQUETAS_DIETETICAS.length;

/** De la ración de referencia. Cada clave es independiente: un plato puede declarar solo calorías. */
const infoNutricionalSchema = z.object({
  calorias: z.number().optional(),
  proteinas_g: z.number().optional(),
  carbohidratos_g: z.number().optional(),
  grasas_g: z.number().optional(),
});

/**
 * Un video. Mismo criterio de `fotoSchema`: https obligatorio, la allowlist de hosts vive en el
 * render (frontera 4), no acá.
 *
 * `poster` es OPCIONAL en el modelo a propósito: exigirlo acá sería una regla de RENDER (sin poster
 * no se emite el `<video>`) colada en el modelo de datos. Un video sin poster todavía es un dato
 * válido — el render decide qué hacer con él.
 */
const videoSchema = z.object({
  src: z
    .string()
    .url()
    .refine((u) => /^https:\/\//i.test(u), "el video debe ser una URL https"),
  poster: fotoSchema.optional(),
});

/** `name` es lo único obligatorio: un ítem de carta sin nombre no se puede mostrar. */
export const menuItemSchema = z.object({
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
    .array(
      z.object({
        etiqueta: z.string().min(1),
        importe: z.string().min(1),
        // "1-2 personas" — libre, por el mismo motivo que `etiqueta`/`importe`.
        comensales: z.string().optional(),
      }),
    )
    .max(MAX_PRECIOS)
    .optional(),
  nota: z.string().optional(),
  foto: fotoSchema.optional(),
  video: videoSchema.optional(),
  alergenos: z.array(alergenoSchema).max(MAX_ALERGENOS).optional(),
  etiquetas: z.array(etiquetaDieteticaSchema).max(MAX_ETIQUETAS).optional(),
  nutricion: infoNutricionalSchema.optional(),
});

/**
 * Un motivo de la sección de destacados y una reseña. Las dos claves obligatorias son la que da el
 * contenido: un motivo sin `titulo` no se puede rotular y una reseña sin `texto` no es una reseña.
 *
 * **No hay campo de puntuación, y su ausencia es el contrato**: agregar `estrellas` acá sería
 * habilitar que la web de un negocio publique su propia valoración numérica sin plataforma que la
 * respalde. Ver `Testimonio` en `types.ts`.
 */
const destacadoSchema = z.object({ titulo: z.string().min(1), texto: z.string().optional() });
const testimonioSchema = z.object({ texto: z.string().min(1), autor: z.string().optional() });

/** `nombre` es lo que se compara contra `MenuItem.category`: sin él la categoría no agrupa nada. */
export const menuCategoriaSchema = z.object({
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
  bienvenida: z.string().optional(),
  destacados: z.array(destacadoSchema).max(MAX_DESTACADOS).optional(),
  testimonios: z.array(testimonioSchema).max(MAX_TESTIMONIOS).optional(),
});

/**
 * El contrato de `PATCH /clients/:id/menu` (editor del portal): las DOS claves obligatorias, nunca
 * opcionales — el portal manda siempre su copia completa de ambos arrays (`[]` si no hay
 * categorías). Reutiliza `menuItemSchema`/`menuCategoriaSchema` tal cual: es el mismo plato que
 * valida `businessProfileSchema.menu`, no una copia con reglas propias.
 */
export const menuPatchSchema = z.object({
  menu: z.array(menuItemSchema).max(MAX_ITEMS_CARTA),
  menu_categorias: z.array(menuCategoriaSchema).max(MAX_CATEGORIAS),
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

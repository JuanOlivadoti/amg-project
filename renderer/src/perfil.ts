import type {
  BrandTheme,
  BusinessProfile,
  Destacado,
  Foto,
  FuenteNombre,
  Location,
  MenuCategoria,
  MenuItem,
  Testimonio,
} from "web-builder";

/** Las tres del legacy `font`. Es un subconjunto de `FUENTES`, no una lista paralela. */
const FUENTES_LEGACY = new Set(["sistema", "serif", "moderna"]);
/** Los siete nombres de ROL de `FuenteNombre`. Nunca un stack CSS: eso sería texto libre en `<style>`. */
const FUENTES = new Set([
  ...FUENTES_LEGACY,
  "condensada",
  "geometrica",
  "humanista",
  "script",
]);

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Un hex, o nada. Lo que no valida **cae al default del CSS base**: la web sale sobria, nunca rota. */
function hex(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v : undefined;
}

function fuente(v: unknown): FuenteNombre | undefined {
  return typeof v === "string" && FUENTES.has(v) ? (v as FuenteNombre) : undefined;
}

/**
 * Una foto, validada. **https obligatorio**, no `http:` como el logo: además de que el navegador lo
 * bloquearía como contenido mixto, un `<img src>` en claro filtra al host del asset la IP y el
 * user-agent de cada visitante del cliente.
 *
 * La **allowlist de hosts** no se aplica acá sino en el render (frontera 4), que es quien emite el
 * `<img>`. Eso es a propósito: el render tiene que fallar cerrado aunque el dato no haya pasado por
 * esta función, porque en producción el perfil llega de una fila de la base.
 *
 * Un `src` que no valida tira la foto **entera**, no solo el `src`: una `Foto` sin `src` es un `<img>`
 * sin imagen. Y `alt` ausente es el caso NORMAL —el formulario del portal captura una URL y nada
 * más—, así que se emite `alt=""` (decorativa) y nunca un texto inventado del nombre del negocio.
 */
function foto(v: unknown): Foto | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const f = v as Record<string, unknown>;
  const src = texto(f["src"]);
  if (!src || !/^https:\/\//i.test(src)) return undefined;
  return { src, ...(texto(f["alt"]) ? { alt: texto(f["alt"])! } : {}) };
}

/**
 * La marca, validada. Es doble frontera: `renderStory` también revalida, pero acá se recorta ANTES
 * de que el objeto entre a `renderStory` — y sobre todo, si no estuviera, `perfilValido` tiraría
 * `brand` con su allowlist y el tema no llegaría nunca (lo que pasó en la demo). Cada campo se valida
 * como lo que va a ser: hex (va a `<style>`), fuente de allowlist, logo http(s) (va a `<img src>`).
 *
 * **El legacy `{color, font}` se conserva junto al manual nuevo, no se traduce acá.** Quién gana
 * cuando están los dos (`colores.primario` sobre `color`) lo decide la emisión del CSS, que es donde
 * el dato se usa; resolverlo en el validador escondería el dato original y dejaría dos sitios
 * decidiendo lo mismo.
 */
function marca(v: unknown): BrandTheme | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const b = v as Record<string, unknown>;

  const color = hex(b["color"]);
  const font =
    typeof b["font"] === "string" && FUENTES_LEGACY.has(b["font"])
      ? (b["font"] as BrandTheme["font"])
      : undefined;
  const logo = typeof b["logo"] === "string" && /^https?:\/\//i.test(b["logo"]) ? b["logo"] : undefined;
  const plantilla = texto(b["plantilla"]);

  const colores = objetoDe(b["colores"], ["primario", "secundario", "titulo", "texto", "fondo", "fondoAlt"], hex);
  const fuentes = objetoDe(b["fuentes"], ["titulo", "texto", "decorativa"], fuente);

  if (!color && !font && !logo && !plantilla && !colores && !fuentes) return undefined;
  return {
    ...(color ? { color } : {}),
    ...(font ? { font } : {}),
    ...(logo ? { logo } : {}),
    ...(plantilla ? { plantilla } : {}),
    ...(colores ? { colores } : {}),
    ...(fuentes ? { fuentes } : {}),
  };
}

/**
 * Reconstruye un sub-objeto clave por clave con un validador por valor, y devuelve `undefined` si no
 * sobrevive ninguna. Existe para que `colores` (6 claves) y `fuentes` (3) no sean nueve líneas
 * copiadas donde una falta de ortografía pasaría desapercibida — que es exactamente cómo se escribe
 * mal una allowlist.
 */
function objetoDe<T>(
  v: unknown,
  claves: readonly string[],
  valida: (x: unknown) => T | undefined,
): Record<string, T> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const src = v as Record<string, unknown>;
  const out: Record<string, T> = {};
  for (const k of claves) {
    const val = valida(src[k]);
    if (val !== undefined) out[k] = val;
  }
  return Object.keys(out).length ? out : undefined;
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
const MAX_FOTOS = 30;
const MAX_PRECIOS = 3;
const MAX_CATEGORIAS = 20;
const MAX_DESTACADOS = 6;
const MAX_TESTIMONIOS = 12;

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
    // Un objeto que solo trae `name` no aporta nada al footer: sería un título vacío. Una foto
    // tampoco lo salva: un local es una dirección, un teléfono o un horario — la foto lo acompaña.
    if (!addr && !tel && !horas) continue;
    const f = foto(l["foto"]);
    out.push({
      ...(nombre ? { name: nombre } : {}),
      ...(addr ? { address: addr } : {}),
      ...(tel ? { telephone: tel } : {}),
      ...(horas ? { opening_hours: horas } : {}),
      ...(f ? { foto: f } : {}),
    });
  }
  return out.length ? out : undefined;
}

/**
 * Los importes de un plato. Una entrada a la que le falta `etiqueta` o `importe` **se descarta sola**,
 * no tira el plato: media fila de precio no se puede dibujar, pero el plato sigue existiendo. Si no
 * sobrevive ninguna, el plato cae a `price`, que es el atajo del caso de un solo importe.
 */
function precios(v: unknown): MenuItem["precios"] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<MenuItem["precios"]> = [];
  for (const item of v.slice(0, MAX_PRECIOS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const etiqueta = texto(p["etiqueta"]);
    const importe = texto(p["importe"]);
    if (!etiqueta || !importe) continue;
    out.push({ etiqueta, importe });
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
    const lista = precios(m["precios"]);
    const f = foto(m["foto"]);
    out.push({
      name: nombre,
      ...(texto(m["category"]) ? { category: texto(m["category"])! } : {}),
      ...(texto(m["description"]) ? { description: texto(m["description"])! } : {}),
      ...(texto(m["price"]) ? { price: texto(m["price"])! } : {}),
      ...(lista ? { precios: lista } : {}),
      ...(texto(m["nota"]) ? { nota: texto(m["nota"])! } : {}),
      ...(f ? { foto: f } : {}),
    });
  }
  return out.length ? out : undefined;
}

/**
 * Las categorías de la carta. Sin `nombre` no hay nada contra qué agrupar los platos, así que la
 * entrada se descarta. `orden` solo sobrevive si es un entero >= 0: un `orden` de `"2"` o `-1`
 * ordenaría de forma impredecible, y no tenerlo tiene un significado definido (orden de aparición).
 */
function categorias(v: unknown): MenuCategoria[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MenuCategoria[] = [];
  for (const item of v.slice(0, MAX_CATEGORIAS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const c = item as Record<string, unknown>;
    const nombre = texto(c["nombre"]);
    if (!nombre) continue;
    const f = foto(c["foto"]);
    const orden = c["orden"];
    out.push({
      nombre,
      ...(f ? { foto: f } : {}),
      ...(typeof orden === "number" && Number.isInteger(orden) && orden >= 0 ? { orden } : {}),
    });
  }
  return out.length ? out : undefined;
}

/**
 * Los motivos de la sección de destacados. Sin `titulo` no hay tarjeta que rotular: la entrada se
 * descarta **ella sola**, no la sección — mismo criterio que un precio mal cargado, que no borra el
 * plato.
 */
function destacados(v: unknown): Destacado[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Destacado[] = [];
  for (const item of v.slice(0, MAX_DESTACADOS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const d = item as Record<string, unknown>;
    const titulo = texto(d["titulo"]);
    if (!titulo) continue;
    out.push({ titulo, ...(texto(d["texto"]) ? { texto: texto(d["texto"])! } : {}) });
  }
  return out.length ? out : undefined;
}

/**
 * Las reseñas. Sin `texto` no hay reseña.
 *
 * ⚠️ **`autor` es la única clave que sobrevive junto al texto, y esa es la garantía.** Este validador
 * reconstruye el objeto clave por clave, así que un `estrellas` o un `puntuacion` que hubiera
 * sobrevivido a las dos capas anteriores muere acá: la web de un negocio no publica su propia
 * valoración numérica. Ver `Testimonio` en `types.ts`.
 */
function testimonios(v: unknown): Testimonio[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Testimonio[] = [];
  for (const item of v.slice(0, MAX_TESTIMONIOS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const t = item as Record<string, unknown>;
    const cuerpo = texto(t["texto"]);
    if (!cuerpo) continue;
    out.push({ texto: cuerpo, ...(texto(t["autor"]) ? { autor: texto(t["autor"])! } : {}) });
  }
  return out.length ? out : undefined;
}

/** La galería. Las fotos que no validan se caen una a una; las demás se dibujan. */
function galeria(v: unknown): Foto[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Foto[] = [];
  for (const item of v.slice(0, MAX_FOTOS)) {
    const f = foto(item);
    if (f) out.push(f);
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
    ...(categorias(p["menu_categorias"]) ? { menu_categorias: categorias(p["menu_categorias"]) } : {}),
    ...(marca(p["brand"]) ? { brand: marca(p["brand"]) } : {}),
    ...(foto(p["portada"]) ? { portada: foto(p["portada"]) } : {}),
    ...(galeria(p["fotos"]) ? { fotos: galeria(p["fotos"]) } : {}),
    ...(texto(p["bienvenida"]) ? { bienvenida: texto(p["bienvenida"])! } : {}),
    ...(destacados(p["destacados"]) ? { destacados: destacados(p["destacados"]) } : {}),
    ...(testimonios(p["testimonios"]) ? { testimonios: testimonios(p["testimonios"]) } : {}),
  };
}

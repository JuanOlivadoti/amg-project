import type { BusinessProfile, Imagen, Location, MenuItem, NavItem } from "../types.js";

/**
 * Las utilidades que comparten el shell, las piezas y el JSON-LD.
 *
 * Todo lo de acá salió tal cual de `html.ts` al partirlo en piezas (entrega 2 de la spec de
 * plantillas de landing): son **traslados**, no reescrituras. Los comentarios de cada función
 * explican la trampa que evita, que es la parte que no se puede reconstruir leyendo el código.
 */

/** Los slugs de las páginas que sintetiza el renderizador (no viven en Storyblok salvo que el cliente las cree). */
export const SLUG_HOME = "home";
export const SLUG_MENU = "menu";
export const SLUG_BLOG = "blog";

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Serializa a JSON seguro para incrustar en <script>: neutraliza `<`, `>`, `&`, que
 * `JSON.stringify` NO escapa y que permitirían cerrar el <script> (`</script>`) e
 * inyectar markup. El JSON resultante sigue siendo válido (usa escapes \\uXXXX).
 */
export function safeJson(obj: unknown): string {
  return JSON.stringify(obj, null, 2)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

/**
 * Un slug de Storyblok → un `href` seguro. Mismo criterio que la CDA con el slug de la petición: los
 * segmentos de navegación (`.`, `..`) se descartan y cada segmento se escapa. Un `slug` como
 * `javascript:alert(1)` sale como `/javascript:alert(1)` codificado — una ruta, nunca un esquema.
 */
export function hrefDeSlug(slug: string): string {
  const ruta = slug
    .split("/")
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .map(encodeURIComponent)
    .join("/");
  return `/${ruta}`;
}

/**
 * Una `<img>` de contenido, lista para Core Web Vitals: `loading="lazy"`, `decoding="async"`, y
 * `width`/`height` cuando se pueden inferir del asset de Storyblok (evita el salto de layout, CLS).
 * Sin src válido no se renderiza nada — una imagen rota es peor que ninguna.
 */
export function renderImagen(img: Imagen | undefined, clase: string): string {
  if (!img || typeof img.src !== "string" || !/^https?:\/\//i.test(img.src)) return "";
  const dim = dimsDeStoryblok(img.src);
  const wh = dim ? ` width="${dim.w}" height="${dim.h}"` : "";
  return `<img class="${clase}" src="${esc(img.src)}" alt="${esc(img.alt ?? "")}" loading="lazy" decoding="async"${wh}>`;
}

/**
 * Las URLs de assets de Storyblok llevan las dimensiones en la ruta: `.../f/<space>/1200x800/<hash>/…`.
 * Extraerlas deja fijar `width`/`height` sin descargar la imagen. Si no matchea, se omite (mejor sin
 * dimensiones que con dimensiones inventadas).
 *
 * ⚠️ Esto **solo parsea el string**. El renderizador nunca descarga, inspecciona ni proxifica una URL
 * de asset: es lo que impide que un futuro "leé las dimensiones reales" abra un SSRF sin querer.
 */
export function dimsDeStoryblok(src: string): { w: number; h: number } | null {
  const m = src.match(/\/(\d{1,5})x(\d{1,5})\//);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  return w > 0 && h > 0 ? { w, h } : null;
}

/**
 * Los locales del negocio, normalizados.
 *
 * Con `locations` explícito manda esa lista. Sin ella se sintetiza UNO con los campos clásicos
 * (`address`/`telephone`/`opening_hours`), que es como se describía un negocio de un solo local antes
 * de que existiera `locations` — así un perfil viejo no pierde su dirección cuando el footer pasa a
 * ser multi-local.
 */
export function localesDe(p: BusinessProfile): Location[] {
  if (p.locations && p.locations.length > 0) return p.locations;
  if (!p.address && !p.telephone && !p.opening_hours) return [];
  return [
    {
      ...(p.address ? { address: p.address } : {}),
      ...(p.telephone ? { telephone: p.telephone } : {}),
      ...(p.opening_hours ? { opening_hours: p.opening_hours } : {}),
    },
  ];
}

/** ¿Hay algo que mostrar en "Ubicaciones"? Locales explícitos, o los campos sueltos del perfil clásico. */
export function hayUbicaciones(p: BusinessProfile): boolean {
  if (p.locations && p.locations.length > 0) return true;
  return Boolean(p.address || p.telephone || p.opening_hours);
}

/** Agrupa la carta por categoría conservando el orden de aparición. Los sin categoría, al final. */
export function agruparCarta(items: MenuItem[]): Array<{ categoria: string | null; items: MenuItem[] }> {
  const grupos = new Map<string, MenuItem[]>();
  const sueltos: MenuItem[] = [];
  for (const it of items) {
    const cat = it.category?.trim();
    if (!cat) {
      sueltos.push(it);
      continue;
    }
    const g = grupos.get(cat);
    if (g) g.push(it);
    else grupos.set(cat, [it]);
  }
  const salida: Array<{ categoria: string | null; items: MenuItem[] }> = [...grupos.entries()].map(
    ([categoria, items]) => ({ categoria, items }),
  );
  if (sueltos.length) salida.push({ categoria: null, items: sueltos });
  return salida;
}

/**
 * Resuelve el canonical: una sola fuente de verdad = el `canonical` del brief (#16 review Codex).
 * Antes se re-derivaba de `story.slug` ignorando el canonical aprobado. Reglas:
 *  - si el canonical ya es absoluto (http/https), se respeta tal cual;
 *  - si es una ruta, se resuelve contra el dominio del perfil (validado por Zod);
 *  - sin dominio, queda relativo (el frontend Next.js le antepondrá su base en PROD).
 */
export function resolveCanonical(canonical: string, profile?: BusinessProfile | null): string {
  if (/^https?:\/\//i.test(canonical)) return canonical;
  const path = canonical.startsWith("/") ? canonical : `/${canonical}`;
  if (profile?.url) return `${profile.url.replace(/\/+$/, "")}${path}`;
  return path;
}

/** La URL absoluta de una página sintetizada, o su ruta si el perfil no declara dominio. */
export function urlDeSeccion(profile: BusinessProfile | null | undefined, slug: string): string {
  return profile?.url ? `${profile.url.replace(/\/+$/, "")}/${slug}` : `/${slug}`;
}

/**
 * Una tarjeta del índice: enlace a una página publicada.
 *
 * Vive acá y no dentro de una pieza porque la usan **dos** (`indice` y `blogIndice`), igual que su
 * CSS (`.cards`/`.card`), que por §3.6 subió al base. Una pieza no hereda de otra: comparten la
 * primitiva, no la propiedad.
 *
 * ⚠️ `name` y `slug` vienen del space de Storyblok y en PROD **no pasan por Zod**: el nombre se
 * escapa y el slug se convierte en ruta con segmentos codificados, nunca en un esquema.
 */
export function tarjetaIndice(item: NavItem): string {
  return `  <a class="card" href="${esc(hrefDeSlug(item.slug))}"><h3>${esc(item.name)}</h3></a>`;
}

/**
 * Envuelve el HTML de una pieza en su clase raíz.
 *
 * El envoltorio es un `<div>` y no la propia etiqueta de contenido **a propósito**: así el markup
 * trasladado conserva sus clases originales byte a byte (`class="sitebar"`, `class="card"`) y el
 * traslado se puede leer como lo que es. La spec lo permite explícitamente: los envoltorios y las
 * clases raíz son lo único que la entrega 2 cambia del markup.
 */
export function envolver(raiz: string, html: string): string {
  return `<div class="${raiz}">\n${html}\n</div>`;
}

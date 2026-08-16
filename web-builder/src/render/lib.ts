import type { BusinessProfile, Foto, Imagen, Location, MenuItem, NavItem, Video } from "../types.js";
import type { CtxPieza } from "./piezas/tipos.js";
import { type PresupuestoImagenes, consumirCupo, fuentePermitida } from "./imagenes.js";
import { type PresupuestoVideos, consumirCupoVideo, fuenteVideoPermitida } from "./videos.js";

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

/*
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 * Los topes de la FRONTERA 4 (el render).
 *
 * Las otras tres fronteras —el Zod de `contract.ts`, la allowlist `app.nap_publico` de la `0014` y
 * `perfilValido` del renderizador— ya cortan estas listas. Éstas son las mismas cifras aplicadas
 * donde se emite el HTML, y **no son redundancia**: en PROD el perfil llega de
 * `clients.business_profile_publico` sin pasar por el Zod de este paquete, así que la última capa
 * tiene que cortar por su cuenta. Es la misma razón por la que el render revalida cada `<img src>`.
 *
 * Que coincidan con los de `contract.ts` lo exige un test (`piezas/piezas-foto.test.ts`): cambiar uno
 * sin el otro deja la ficha guardada entera y media carta servida, sin error y sin log.
 * ────────────────────────────────────────────────────────────────────────────────────────────────
 */
export const MAX_FOTOS_GALERIA = 30;
export const MAX_PRECIOS_RENDER = 3;
export const MAX_CATEGORIAS_RENDER = 20;
export const MAX_DESTACADOS_RENDER = 6;
export const MAX_TESTIMONIOS_RENDER = 12;

/**
 * **Cuántos platos entran en el extracto de la home y de una landing.**
 *
 * Es un default de PRODUCCIÓN y vive acá con su nombre y su test, no incrustado en un `.slice(0, 6)`:
 * gobierna cuántas fotos descarga el visitante de cualquier cliente antes de llegar a la carta. Seis
 * es lo que la spec pide («hasta 6 ítems») y lo que llena dos filas de la rejilla en escritorio sin
 * dejar una tercera fila coja.
 */
export const MAX_PLATOS_DESTACADOS = 6;

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
 *
 * **Es el punto por el que pasa toda foto de contenido, y por eso es donde vive la §Política de
 * imágenes** (ver `imagenes.ts` para el porqué de cada regla):
 *
 *  - la `src` tiene que ser **https** y de un host de la **allowlist del código** (`fuentePermitida`);
 *  - sale con **`referrerpolicy="no-referrer"`**, para que el host del asset no reciba la URL de la
 *    página del cliente junto con la IP del visitante;
 *  - consume un hueco del **presupuesto del documento**, que llega por `ctx` y no por un contador de
 *    módulo.
 *
 * ⚠️ **El orden de los dos primeros `if` es la política, no un detalle.** Primero se descarta lo que no
 * pasa la allowlist y **después** se gasta el cupo: una URL rechazada no puede consumir presupuesto, o
 * una ficha comprometida apagaría las fotos legítimas de la página sin servir ninguna suya.
 *
 * `presupuesto` es un parámetro **obligatorio** a propósito: así una pieza nueva no puede olvidarlo
 * —falla el typecheck—, y no hay un default "sin límite" esperando a que alguien lo use sin querer.
 *
 * ## `prioridad: "alta"` — para la imagen que ES el LCP
 *
 * `loading="lazy"` es correcto para **casi** toda imagen y catastrófico para una: la que el navegador
 * va a medir como **Largest Contentful Paint**. Diferir el elemento que define la métrica retrasa
 * exactamente lo que la métrica mide — el navegador tiene que terminar el layout para saber que esa
 * imagen está en el viewport, y solo entonces empieza a descargarla.
 *
 * Hasta la mitad B de la entrega 3 daba igual: `handoff/adapter.ts` nunca rellena `image` y ninguna
 * ficha tenía `portada`, así que ninguna landing tenía una foto arriba. **Desde que la portada dibuja
 * `profile.portada`, esa foto es el LCP de todas las landings de todos los clientes**, y sería la
 * única regresión de rendimiento de una entrega cuyo objetivo es que el sitio se vea mejor.
 *
 * Con `alta`: sin `loading` (o sea `eager`, el default del navegador) y con `fetchpriority="high"`,
 * que le dice al preload scanner que la pida antes que el resto de la cola. Lo mismo que ya hacía la
 * cabecera con el logo a mano, ahora con nombre.
 *
 * **Es opt-in y solo `heroSlider` la usa, y dentro de ella solo en su PRIMERA diapositiva.** Marcar
 * dos imágenes como prioritarias es no marcar ninguna: compiten entre sí por el mismo ancho de banda,
 * que es justo lo que se quiere evitar. Con un carrusel el error es más fácil de cometer —el bucle que
 * dibuja las cinco diapositivas invita a pasarle `"alta"` a todas—, y por eso lo fija un test que mide
 * el DOCUMENTO entero (`piezas-foto.test.ts`) y no una pieza suelta.
 */
export function renderImagen(
  img: Imagen | undefined,
  clase: string,
  presupuesto: PresupuestoImagenes,
  prioridad: "normal" | "alta" = "normal",
): string {
  if (!img || typeof img.src !== "string" || !fuentePermitida(img.src)) return "";
  if (!consumirCupo(presupuesto)) return "";
  const dim = dimsDeStoryblok(img.src);
  const wh = dim ? ` width="${dim.w}" height="${dim.h}"` : "";
  const carga = prioridad === "alta" ? ` fetchpriority="high"` : ` loading="lazy"`;
  return `<img class="${clase}" src="${esc(img.src)}" alt="${esc(img.alt ?? "")}"${carga} decoding="async" referrerpolicy="no-referrer"${wh}>`;
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

/**
 * El `href` de un teléfono: `tel:` sin espacios y escapado.
 *
 * Lo emiten **cuatro** piezas (`contacto`, `locales`, `barraDatos`, `ctaFinal`) y hasta la entrega 3
 * eran dos copias del mismo `esc(tel.replace(…))`. Un escape duplicado es un escape que un día se
 * arregla en un sitio: el teléfono viene de la base y en PROD no pasa por Zod.
 */
export function hrefTelefono(telefono: string): string {
  return `tel:${esc(telefono.replace(/\s/g, ""))}`;
}

/** Un importe de la carta, ya normalizado. `etiqueta` vacía = el importe único de `price`. */
export interface Precio {
  etiqueta: string;
  importe: string;
  /** "1-2 personas" — ver `MenuItem.precios[].comensales`. */
  comensales?: string;
}

/**
 * Los precios de un plato, con `precios` mandando sobre `price`.
 *
 * `precios` es el modelo nuevo (enmienda 2026-08-02: "Media" 9 € / "Ración" 15 €) y `price` el atajo
 * del caso de un solo importe. Los dos son **texto libre** a propósito (`"12,50 €"`, `"s/ mercado"`):
 * tipificarlos obligaría a decidir moneda y formato en el modelo, y lo único que hace falta es
 * imprimir lo que escribió el cliente.
 *
 * **Frontera 4**: se revalida entrada por entrada aunque Zod ya lo haya hecho, porque en PROD el
 * perfil llega de la base sin pasar por él. Y se descarta **la entrada, no el plato** —al revés que
 * en la puerta del CLI, donde el archivo se rechaza entero—: acá el dato ya está guardado, y tirar un
 * plato de la carta porque un precio vino a medias sería peor que mostrarlo con el importe que sí
 * está. Si no queda ninguna entrada válida, cae a `price`, que es lo que la spec pide con esas
 * palabras.
 */
export function preciosDe(item: MenuItem): Precio[] {
  const brutos = Array.isArray(item.precios) ? item.precios : [];
  const validos = brutos
    .filter(
      (p): p is { etiqueta: string; importe: string; comensales?: string } =>
        typeof p?.etiqueta === "string" &&
        p.etiqueta.length > 0 &&
        typeof p.importe === "string" &&
        p.importe.length > 0,
    )
    .slice(0, MAX_PRECIOS_RENDER)
    .map((p) => ({
      etiqueta: p.etiqueta,
      importe: p.importe,
      ...(typeof p.comensales === "string" && p.comensales.length > 0 ? { comensales: p.comensales } : {}),
    }));
  if (validos.length > 0) return validos;
  return typeof item.price === "string" && item.price.length > 0
    ? [{ etiqueta: "", importe: item.price }]
    : [];
}

/**
 * La foto de un plato/categoría/galería tal como llega de la ficha, o `undefined`.
 *
 * `Foto` (del perfil) e `Imagen` (del blok de Storyblok) se distinguen en **un** campo: `alt` es
 * opcional en la primera y obligatorio en la segunda — ver el comentario de `Foto` en `types.ts`.
 * `renderImagen` habla `Imagen`, así que esto es la conversión, con el default `alt=""` (decorativa)
 * en un solo sitio en vez de repetido en cinco piezas. **Nunca un `alt` derivado del nombre del
 * negocio**: un texto alternativo inventado es peor que ninguno.
 */
export function comoImagen(foto: Foto | undefined): Imagen | undefined {
  if (!foto || typeof foto.src !== "string") return undefined;
  return { src: foto.src, alt: typeof foto.alt === "string" ? foto.alt : "" };
}

/** Un video listo para el render: `src` + `poster` ya convertido a `Imagen`. */
export interface VideoRenderable {
  src: string;
  poster?: Imagen;
}

/** Mismo criterio que `comoImagen`: la conversión del tipo del perfil (`Video`) al que habla el
 *  render, en un solo sitio. */
export function comoVideo(video: Video | undefined): VideoRenderable | undefined {
  if (!video || typeof video.src !== "string") return undefined;
  return { src: video.src, poster: comoImagen(video.poster) };
}

/**
 * Un `<video>`, listo para la §Política de video (`videos.ts`). **Sin `poster` válido no se emite
 * nada** — un video sin fotograma de portada forzaría al navegador a descargarlo entero solo para
 * mostrar la carta, y eso es peor que no mostrar video.
 *
 * Mismo orden que `renderImagen`: primero la allowlist de host, después el presupuesto — una URL
 * rechazada no puede consumir cupo.
 *
 * **Nunca autoplay.** `controls preload="none"`: el visitante decide si lo reproduce, y el navegador
 * no descarga nada hasta que lo haga.
 */
export function renderVideo(
  video: VideoRenderable | undefined,
  clase: string,
  presupuesto: PresupuestoVideos,
): string {
  if (!video || !fuenteVideoPermitida(video.src)) return "";
  if (!video.poster || !fuentePermitida(video.poster.src)) return "";
  if (!consumirCupoVideo(presupuesto)) return "";
  return `<video class="${clase}" src="${esc(video.src)}" poster="${esc(video.poster.src)}" controls preload="none"></video>`;
}

/**
 * **Cuántos caracteres entran en un botón.**
 *
 * Es un default de PRODUCCIÓN y por eso vive acá con su nombre y sus tests, no incrustado en un `if`:
 * a 28 caracteres el botón sigue cabiendo en una línea en un móvil de 360 px con el padding del CTA.
 * Bajarlo o subirlo es una decisión de diseño que tiene que doler en un test.
 */
export const LIMITE_CTA = 28;

export interface CtaResuelto {
  /** La frase larga, degradada a bajada. `""` si el CTA cabía en el botón. */
  bajada: string;
  /** Lo que dice el botón. `""` si no hay CTA. */
  etiqueta: string;
  /** Adónde lleva. `null` cuando no hay ningún destino y entonces no se dibuja el botón. */
  href: string | null;
}

/**
 * El CTA del hero, resuelto **en el render y no en el contrato del brief**.
 *
 * El M2 escribe `cta_label` sin saber con qué ancho se va a dibujar, y a veces escribe una frase
 * ("Reserva tu mesa y disfruta de la auténtica cocina italiana"): dentro de un botón se desborda o se
 * parte en tres líneas. Arreglarlo en `kr-service` sería pedirle al research que decida tipografía.
 *
 * Cuando no cabe, **el texto no se pierde**: baja a bajada y el botón toma una etiqueta derivada del
 * dato que la página realmente tiene. "Llamar" en una ficha sin teléfono sería una promesa que la
 * página no puede cumplir, así que cada etiqueta va con el ancla donde ese dato vive.
 *
 * Vive en `lib.ts` desde la entrega 3 porque lo usan **dos** piezas: `hero` (`/menu` y `/blog`) y
 * `heroSlider` (la landing y la home). Dos copias de `LIMITE_CTA` son dos umbrales que se separan el
 * día que alguien ajusta uno.
 */
export function resolverCta(
  label: string | undefined,
  ctx: CtxPieza,
  hayFaq: boolean,
): CtaResuelto {
  const vacio: CtaResuelto = { bajada: "", etiqueta: "", href: null };
  if (!label) return vacio;

  // Destino por defecto: contacto si hay perfil, si no las FAQs; si no hay ninguno, sin ancla.
  const hrefBase = ctx.profile ? "#contacto" : hayFaq ? "#faq" : null;
  if (label.length <= LIMITE_CTA) return { bajada: "", etiqueta: label, href: hrefBase };

  const profile = ctx.profile;
  if (profile) {
    // Mismo orden de precedencia que `contacto`/JSON-LD: manda `locations`, después el campo suelto.
    const tel = localesDe(profile)[0]?.telephone ?? profile.telephone;
    if (tel) return { bajada: label, etiqueta: "Llamar", href: "#contacto" };
    // "Cómo llegar" apunta a `#ubicaciones`, que existe exactamente cuando `hayUbicaciones` es cierto
    // — el mismo dato decide la etiqueta y que el ancla esté dibujada. Nunca un enlace a la nada.
    if (hayUbicaciones(profile)) return { bajada: label, etiqueta: "Cómo llegar", href: "#ubicaciones" };
    return { bajada: label, etiqueta: "Contactar", href: "#contacto" };
  }
  // Sin perfil no hay dato del que derivar nada; queda el ancla a las FAQ, si las hay.
  return hrefBase
    ? { bajada: label, etiqueta: "Saber más", href: hrefBase }
    : { bajada: label, etiqueta: "", href: null };
}

/**
 * Los tres datos accionables del negocio, con la misma precedencia que el pie y el JSON-LD:
 * **`locations[0]` manda** sobre los campos sueltos del perfil clásico.
 *
 * Lo comparten `barraDatos` (la franja de arriba) y `ctaFinal` (el cierre). Que salgan del mismo sitio
 * es lo que impide que la franja diga un teléfono y el botón del cierre marque otro.
 */
export function datosAccionables(profile: BusinessProfile): {
  telefono?: string;
  horario?: string;
  hayDireccion: boolean;
} {
  const principal = localesDe(profile)[0];
  const telefono = principal?.telephone ?? profile.telephone;
  const horario = principal?.opening_hours ?? profile.opening_hours;
  // "Cómo llegar" exige una DIRECCIÓN, no `hayUbicaciones`: un perfil que solo trae horario dibuja el
  // bloque `#ubicaciones` igual, y mandar ahí a alguien que quiere llegar es mandarlo a un horario.
  const hayDireccion = Boolean(principal?.address ?? profile.address);
  return {
    ...(telefono ? { telefono } : {}),
    ...(horario ? { horario } : {}),
    hayDireccion,
  };
}

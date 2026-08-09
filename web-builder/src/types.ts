// Módulo 1 — Creador de Webs · contratos de datos (PoC).
//
// Dos contratos viven acá:
//  1) KR_* : el subconjunto del brief del Módulo 2 que este módulo consume. Es el "contrato de
//     handoff" (ADR-06/07): el brief JSON es la frontera entre módulos. Desde KR-2a **no se define
//     acá**: se importa del paquete `contrato`, que no es `kr-service` — la frontera M2↔M1 sigue en
//     pie, lo que desapareció es la SEGUNDA copia del contrato.
//  2) Story / *Blok : el contrato de bloks de Storyblok (ADR-04) que este módulo produce. Este sí es
//     propio del M1 y se sigue definiendo acá.

export const CONTRACT_VERSION = "web.v0.1";

// ---------------------------------------------------------------- 1) Entrada (brief M2)
export type SchemaType = "LocalBusiness" | "Article" | "FAQPage" | "WebPage";
export type PageType = "servicio" | "landing_local" | "blog" | "institucional";
export type SearchIntent =
  | "transactional"
  | "commercial"
  | "local"
  | "informational"
  | "navigational";

// El M1 consume un SUBCONJUNTO del brief del M2. Los nombres `Kr*` se conservan porque los usan ~15
// archivos de este paquete, pero ya no son una definición paralela: son el tipo del contrato, derivado
// del validador del M1 (`consumoM1`) con `z.infer`.
//
// El alias apunta al tipo de CONSUMO y no a `KeywordResearchBrief`/`ProposedPage` (los de EMISIÓN) a
// propósito: los de emisión exigen `run_id`, `generated_at`, `backlog`, `meta_run` y `page_strategy`,
// que `consumoM1` no valida y Zod descarta al parsear. Apuntar ahí prometía cinco campos que el dato no
// trae —y el brief que el orquestador reconstruye desde la base no los trae de verdad—, así que
// cualquier lectura confiada compilaba limpio y reventaba en runtime. Es un tipo, no un comentario: si
// alguien lo vuelve a apuntar a la emisión, el typecheck cae.
export type { ConsumoM1Brief as KrBrief, ConsumoM1Pagina as KrProposedPage } from "contrato";

// ---------------------------------------------------------------- 2) Salida (bloks Storyblok)
/** SEO nativo de la página (mapea a los campos SEO de Storyblok / meta tags). */
export interface SeoFields {
  title: string;
  description: string;
  canonical: string;
  og_title: string;
  og_description: string;
}

/** Una imagen editable desde el Visual Editor (campo `asset` de Storyblok). */
export interface Imagen {
  /**
   * URL del asset. Se escapa al renderizar **y tiene que pasar la §Política de imágenes**: https y un
   * host de la allowlist del código (`render/imagenes.ts`). Ya no vale "cualquier CDN" — cada `<img>`
   * es una petición que filtra la IP del visitante al host que la sirve.
   */
  src: string;
  /** Texto alternativo. Vacío = imagen decorativa (`alt=""`). */
  alt: string;
}

export interface HeroBlok {
  component: "hero";
  headline: string;
  subhead: string;
  cta_label?: string;
  /** Foto de portada. La sube el cliente en el Visual Editor; el handoff la deja vacía. */
  image?: Imagen;
}

export interface SectionBlok {
  component: "section";
  heading: string;
  /** Prose final. Vacío en el handoff estructural; lo completa la generación por LLM. */
  body: string;
  /** Imagen de la sección, opcional. */
  image?: Imagen;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface FaqBlok {
  component: "faq";
  items: FaqItem[];
}

export type Blok = HeroBlok | SectionBlok | FaqBlok;

/** Contenido de la story: el blok raíz `page` con su body de bloks anidados. */
export interface PageContent {
  component: "page";
  seo: SeoFields;
  schema_type: SchemaType;
  page_type: PageType;
  intent: SearchIntent;
  is_local: boolean;
  body: Blok[];
  /** Metadatos de trazabilidad hacia el research (no se renderizan). */
  meta: {
    contract_version: string;
    source_keyword: string;
    secondary_keywords: string[];
    internal_links: string[];
    word_count_objetivo: number;
    tono?: string;
    claims_permitidos?: string[];
    claims_prohibidos?: string[];
    opportunity_score: number;
    volumen: number | null;
    dificultad: number | null;
    /** kr.v0.5 — ver `KrProposedPage.evidencia`. */
    evidencia?: "datos_mercado" | "sin_validar";
    score_confidence?: number;
  };
}

/** Story de Storyblok (unidad publicable). */
export interface Story {
  name: string;
  slug: string;
  content: PageContent;
}

/**
 * Un ítem de navegación: una página publicada del sitio, tal como la lista la Links API de Storyblok.
 *
 * ⚠️ **`name` y `slug` vienen del space y terminan en el HTML** — `name` como texto de un enlace,
 * `slug` dentro de un `href`. Son superficie de inyección: el renderizador escapa el `name` y arma el
 * `href` con segmentos escapados (igual que la CDA con el slug de la petición). Nunca se confía en que
 * el dato venga limpio: en PROD llega de Storyblok sin pasar por Zod.
 */
export interface NavItem {
  /** Slug de la story (ruta relativa a la raíz del dominio). */
  slug: string;
  /** Nombre visible de la página. */
  name: string;
}

// ---------------------------------------------------------------- 3) Perfil de negocio (NAP)
/** Dirección postal (schema.org PostalAddress). */
export interface PostalAddress {
  streetAddress: string;
  addressLocality: string;
  /**
   * Opcional a propósito: muchos negocios publican calle y ciudad, y nada más. Exigirlo obligaba a
   * inventarse un código postal para poder cargar el local — y un dato inventado en el JSON-LD es
   * peor que un dato ausente (misma decisión que el `null` de las métricas en kr.v0.4).
   */
  postalCode?: string;
  addressRegion?: string;
  addressCountry?: string; // ISO-3166-1 alpha-2
}

/**
 * Una foto del negocio, cargada en la ficha del cliente.
 *
 * **No es `Imagen`, y la diferencia es `alt`.** `Imagen` es el campo `asset` de un blok de Storyblok,
 * donde el Visual Editor siempre entrega la clave (vacía si nadie la llenó) y por eso `alt` es
 * obligatorio. Acá el dato lo produce el formulario del portal, que captura una URL y nada más: si
 * `alt` fuera obligatorio el campo estaría inválido siempre. Sin `alt` se emite `alt=""` —decorativa,
 * que es lo correcto para una portada cuyo contenido ya está en el `<h1>`— y **nunca** un `alt`
 * inventado a partir del nombre del negocio, por la misma razón que no se inventa un `postalCode`.
 *
 * `src` termina en un `<img src>` del proceso anónimo: es superficie de inyección y de fuga (cada
 * visita pega contra ese host). Se valida https en las cuatro fronteras, y la allowlist de hosts vive
 * en el renderizador — nunca en la ficha del cliente, o una ficha comprometida se ampliaría sola.
 */
export interface Foto {
  /** URL **https** de un host de la allowlist del renderizador. */
  src: string;
  alt?: string;
}

/**
 * Un local del negocio. Un restaurante puede tener varios y cada uno tiene su dirección y su horario.
 *
 * El perfil "clásico" (`address`/`telephone`/`opening_hours` sueltos en el `BusinessProfile`)
 * describe UN local y se sigue soportando: si no hay `locations`, el footer sintetiza uno con esos
 * campos. Por eso todo acá es opcional — un local que solo aporta horario sigue siendo útil.
 */
export interface Location {
  /** Nombre del local ("Centro", "Salamanca"). Es lo que distingue uno de otro cuando hay varios. */
  name?: string;
  address?: PostalAddress;
  telephone?: string;
  opening_hours?: string;
  /** Foto del local. */
  foto?: Foto;
}

/**
 * Un ítem de la carta.
 *
 * `price` es **texto libre** a propósito ("12,50 €", "s/ mercado"): tipificarlo como número obligaría
 * a decidir moneda y formato acá, y lo único que hace falta es imprimir lo que escribió el cliente.
 */
export interface MenuItem {
  /** Agrupador ("Hamburguesas", "Cervezas"). Los ítems sin categoría se muestran juntos, al final. */
  category?: string;
  name: string;
  description?: string;
  price?: string;
  /**
   * Varios importes del mismo plato ("Media" 9 €, "Ración" 15 €). **Manda sobre `price`**, que queda
   * como el atajo del caso de un solo importe. `importe` sigue siendo texto libre por la misma razón
   * que `price`. Máx 3: una carta con seis columnas de precio deja de ser legible.
   */
  precios?: Array<{ etiqueta: string; importe: string }>;
  /** Aviso corto del plato ("Sin gluten", "Picante"). */
  nota?: string;
  /** Miniatura del plato. */
  foto?: Foto;
}

/**
 * Una categoría de la carta, con su foto. **Opcional**: sin `menu_categorias` la carta se agrupa por
 * el `category` de cada plato como hasta ahora, sin fotos — un cliente que solo tiene la lista de
 * platos conserva su carta entera.
 *
 * `nombre` es lo que se compara contra `MenuItem.category`; una categoría sin platos no se dibuja
 * (un bloque con foto y sin carta es un hueco).
 */
export interface MenuCategoria {
  nombre: string;
  foto?: Foto;
  /** Posición. Sin él, orden de aparición en `menu`. */
  orden?: number;
}

/**
 * Datos del negocio real (NAP + precio + imagen). NO vienen del research: los aporta
 * el cliente una vez por sitio. Enriquecen el JSON-LD (LocalBusiness) y la página.
 *
 * **De dónde sale en producción.** No de un datasource de Storyblok —eso decía este comentario y
 * dejó de ser cierto en la `0008`—, sino de `clients.business_profile`, y el renderizador **no lee
 * esa columna**: lee `clients.business_profile_publico`, la columna generada con **allowlist** que
 * enumera campo por campo lo que puede salir a internet anónimo. En el CLI del M1 sigue siendo un
 * JSON en disco.
 *
 * Por eso **agregar un campo acá no basta**: tiene que cruzar las cuatro fronteras —el Zod de
 * `contract.ts`, la allowlist `app.nap_publico` (migración `0014`), `perfilValido` del renderizador
 * y el render—, y si falta en una desaparece **sin error y sin log**. Lo ata
 * `renderer/src/tres-fronteras.test.ts`.
 */
export interface BusinessProfile {
  name: string;
  telephone?: string;
  priceRange?: string;
  /** Dominio del sitio (para canonical/og:url absolutas). */
  url?: string;
  image?: string;
  address?: PostalAddress;
  /** Horario en texto libre (ej. "Lun-Dom 13:00-16:00, 20:00-23:30"). */
  opening_hours?: string;
  /**
   * Los locales del negocio. Si está presente, MANDA sobre `address`/`telephone`/`opening_hours`
   * para el footer: un negocio multi-local no puede describirse con una sola dirección suelta.
   */
  locations?: Location[];
  /** La carta. Si tiene ítems, el nav muestra "Menú" y `/menu` se sirve. */
  menu?: MenuItem[];
  /** Las categorías de la carta, con foto. Sin esto, la carta se agrupa como hoy. */
  menu_categorias?: MenuCategoria[];
  /** Marca del negocio: lo que hace que su web se vea PROPIA y no idéntica a la del vecino. */
  brand?: BrandTheme;
  /** La foto del hero. Sin ella, el hero es tipográfico — nunca un hueco ni una imagen rota. */
  portada?: Foto;
  /** La galería. Máx 30: sin tope, un import mal hecho renderiza 50.000 imágenes en cada visita fría. */
  fotos?: Foto[];
}

/**
 * Nombres de **ROL**, no familias tipográficas.
 *
 * La ficha del cliente elige `condensada`, nunca `"Oswald, sans-serif"`. El código mapea cada nombre a
 * una familia self-hosted o a un stack del sistema, así que cambiar qué hay detrás de `condensada` es
 * un cambio de código revisado y no una edición masiva de fichas de clientes. Y un stack CSS en la
 * ficha sería texto libre entrando a un `<style>`, que es justo lo que la allowlist evita.
 */
export type FuenteNombre =
  | "sistema"
  | "serif"
  | "moderna"
  | "condensada"
  | "geometrica"
  | "humanista"
  | "script";

/**
 * Tema de marca por tenant (ADR-11: "tema por tenant, no hardcodeado").
 *
 * ⚠️ **Estos valores se inyectan en un `<style>` y en `<img src>`.** Son una superficie de
 * inyección: un `color` con `;}` o un `font` con `</style>` romperían la página o algo peor. Por eso
 * el renderizador **valida cada uno** (hex para el color, allowlist para la fuente, escape para el
 * logo) y descarta lo que no pase — nunca confía en que el dato venga limpio.
 */
export interface BrandTheme {
  /** URL del logo. Se muestra en la cabecera del sitio. */
  logo?: string;
  /**
   * Qué juego de recetas usa el sitio (una por tipo de documento: story, home, menu, blog). Hoy el
   * único juego que existe es `base`, y un valor desconocido o ausente cae a `base` — nunca un error.
   */
  plantilla?: string;
  /**
   * La paleta. **Cada token se emite como custom property dentro del `<style>` del documento**, así
   * que cada uno es la superficie de inyección más directa del sistema: se valida como hex (`#rgb` o
   * `#rrggbb`) en las cuatro fronteras y **lo que no valida se descarta y cae al default del CSS
   * base** — la página sale sobria, nunca rota.
   *
   * Nada de derivar colores en TypeScript (un hover 12% más oscuro, un contraste automático): las
   * variantes se calculan en CSS con `color-mix`, donde no hay una segunda copia de la paleta que se
   * desincronice.
   */
  colores?: {
    primario?: string;
    secundario?: string;
    titulo?: string;
    texto?: string;
    fondo?: string;
    fondoAlt?: string;
  };
  /** Los tres roles tipográficos. Nombres de la allowlist, nunca un stack CSS. */
  fuentes?: {
    titulo?: FuenteNombre;
    texto?: FuenteNombre;
    decorativa?: FuenteNombre;
  };
  /**
   * ⚠️ **Legacy.** Color de acento, hex. Mapea a `colores.primario`; si la ficha trae las dos formas
   * **gana la específica**, porque la nueva es una decisión explícita y la vieja es herencia.
   *
   * No se borra: todas las fichas sembradas hasta el 2026-08-08 tienen esta forma, y quitarla les
   * cambiaría el aspecto de golpe. Esa —y solo esa— es la regresión que el manual de marca puede
   * causar, así que tiene fixture y test propios.
   */
  color?: string;
  /** ⚠️ **Legacy.** Mapea a `fuentes.texto`. Ver `color`. */
  font?: "sistema" | "serif" | "moderna";
}

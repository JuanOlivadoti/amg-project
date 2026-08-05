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
// archivos de este paquete, pero ya no son una definición paralela: son el tipo del contrato.
//
// ⚠️ El tipo afirma más de lo que `consumoM1` valida, y eso es heredado de `parseBrief` (ver su
// docstring en `contrato/src/esquema.ts`): `page_strategy` no se valida acá, y `evidencia` /
// `score_confidence` son opcionales en el esquema aunque el tipo los declare obligatorios. Quien los
// lea desde el M1 tiene que tolerar `undefined` — que es lo que ya hace `cli/build.ts` con
// `p.score_confidence != null`.
export type { KeywordResearchBrief as KrBrief, ProposedPage as KrProposedPage } from "contrato";

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
  /** URL del asset (Storyblok o cualquier CDN). Se escapa al renderizar. */
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
}

/**
 * Datos del negocio real (NAP + precio + imagen). NO vienen del research: los aporta
 * el cliente una vez por sitio. Enriquecen el JSON-LD (LocalBusiness) y la página.
 * En PROD esto es un datasource global del space de Storyblok; en la PoC, un JSON.
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
  /** Marca del negocio: lo que hace que su web se vea PROPIA y no idéntica a la del vecino. */
  brand?: BrandTheme;
}

/**
 * Tema de marca por tenant (ADR-11: "tema por tenant, no hardcodeado").
 *
 * ⚠️ **Estos valores se inyectan en un `<style>` y en `<img src>`.** Son una superficie de
 * inyección: un `color` con `;}` o un `font` con `</style>` romperían la página o algo peor. Por eso
 * el renderizador **valida cada uno** (hex para el color, allowlist para la fuente, escape para el
 * logo) y descarta lo que no pase — nunca confía en que el dato venga limpio.
 */
export interface BrandTheme {
  /** Color de acento, hex (`#0a7d34` o `#0a7`). Se ignora si no es un hex válido. */
  color?: string;
  /** Familia tipográfica, por nombre. El renderizador la mapea a un stack seguro. */
  font?: "sistema" | "serif" | "moderna";
  /** URL del logo. Se muestra en la cabecera del sitio. */
  logo?: string;
}

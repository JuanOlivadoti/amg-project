// Módulo 1 — Creador de Webs · contratos de datos (PoC).
//
// Dos contratos viven acá:
//  1) KR_* : el subconjunto del brief del Módulo 2 que este módulo consume.
//     Es el "contrato de handoff" (ADR-06/07): el brief JSON es la frontera entre módulos.
//     Se define acá (no se importa de kr-service) para mantener el límite del módulo limpio.
//  2) Story / *Blok : el contrato de bloks de Storyblok (ADR-04) que este módulo produce.

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

/** Página propuesta tal como la emite el brief del Módulo 2. */
export interface KrProposedPage {
  cluster_id: string;
  tipo: PageType;
  url_slug: string;
  keyword_principal: string;
  keywords_secundarias: string[];
  intencion: SearchIntent;
  local: boolean;
  /** `null` = el research no obtuvo la métrica (≠ 0). Ver kr.v0.4. */
  volumen: number | null;
  /** `null` = el research no obtuvo la métrica (≠ 0). Ver kr.v0.4. */
  dificultad: number | null;
  /** kr.v0.5. `sin_validar` = ninguna keyword del cluster tiene volumen conocido. */
  evidencia?: "datos_mercado" | "sin_validar";
  /** kr.v0.5. 0..1 — baja cuando faltan datos. `< 0.5` = la página se apoya en poco o nada. */
  score_confidence?: number;
  opportunity_score: number;
  seo: {
    meta_title: string;
    meta_description: string;
    schema_type: SchemaType;
    canonical: string;
  };
  content_brief: {
    h1: string;
    secciones_sugeridas: string[];
    word_count_objetivo: number;
    enlazado_interno: string[];
    cta?: string;
    tono?: string;
    claims_permitidos?: string[];
    claims_prohibidos?: string[];
    competidores_serp?: string[];
  };
  preguntas_frecuentes: string[];
  /** Aprobación por página (ADR-06): la publicación en vivo exige esto en true. */
  approved: boolean;
}

/** Brief completo del Módulo 2 (solo los campos que consume el Módulo 1). */
export interface KrBrief {
  schema_version: string;
  cliente: string;
  market: { country: string; language_code: string; location_code: number };
  status: "pending_approval" | "approved" | "rejected";
  paginas_propuestas: KrProposedPage[];
}

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

// ---------------------------------------------------------------- 3) Perfil de negocio (NAP)
/** Dirección postal (schema.org PostalAddress). */
export interface PostalAddress {
  streetAddress: string;
  addressLocality: string;
  postalCode: string;
  addressRegion?: string;
  addressCountry?: string; // ISO-3166-1 alpha-2
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

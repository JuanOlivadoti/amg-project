import type { BusinessProfile, KrBrief, KrProposedPage } from "./types.js";

/**
 * Página propuesta válida (kr.v0.2) para tests; overridable por campo.
 *
 * Es EXACTAMENTE lo que el M1 consume, ni un campo más: desde KR-2a el tipo se deriva de `consumoM1`,
 * así que la fixture no necesita `page_strategy`, `evidencia` ni `score_confidence` — que el M1 no
 * exige. Cuando el alias apuntaba al tipo de emisión, esta fixture tenía que inventárselos, y ese
 * engorde era el síntoma de que el tipo prometía de más.
 */
export function validPage(over: Partial<KrProposedPage> = {}): KrProposedPage {
  return {
    cluster_id: "c1",
    tipo: "landing_local",
    url_slug: "/restaurante-italiano-madrid-centro",
    keyword_principal: "restaurante italiano madrid centro",
    keywords_secundarias: ["pizza napolitana madrid", "pasta fresca madrid"],
    intencion: "local",
    local: true,
    volumen: 1200,
    dificultad: 25,
    opportunity_score: 78,
    seo: {
      meta_title: "Restaurante Italiano en Madrid Centro",
      meta_description: "Auténtica cocina italiana en el corazón de Madrid.",
      schema_type: "LocalBusiness",
      canonical: "/restaurante-italiano-madrid-centro",
    },
    content_brief: {
      h1: "Restaurante Italiano en Madrid Centro",
      secciones_sugeridas: ["Sobre Nosotros", "Especialidades"],
      word_count_objetivo: 1100,
      enlazado_interno: ["/menu", "/reservas"],
      cta: "Reserva tu mesa",
      tono: "Cercano y profesional",
      claims_permitidos: ["ingredientes frescos"],
      claims_prohibidos: ["el mejor de Madrid"],
    },
    preguntas_frecuentes: ["¿Tienen opciones sin gluten?", "¿Cómo reservo?"],
    approved: false,
    ...over,
  };
}

/**
 * Brief válido con una página; overridable.
 *
 * Sin `run_id`, `generated_at`, `backlog` ni `meta_run`: el M1 no los consume y `consumoM1` los
 * descarta al parsear, así que ponerlos acá sería fabricar datos de una corrida que nunca existió.
 */
export function validBrief(over: Partial<KrBrief> = {}): KrBrief {
  return {
    schema_version: "kr.v0.2",
    cliente: "restaurante italiano madrid centro",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    status: "pending_approval",
    paginas_propuestas: [validPage()],
    ...over,
  };
}

export function validProfile(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return {
    name: "Trattoria Bella Napoli",
    telephone: "+34 911 23 45 67",
    priceRange: "€€",
    url: "https://trattoriabellanapoli.es",
    image: "https://trattoriabellanapoli.es/img/fachada.jpg",
    address: {
      streetAddress: "Calle Mayor 12",
      addressLocality: "Madrid",
      postalCode: "28013",
      addressRegion: "Madrid",
      addressCountry: "ES",
    },
    opening_hours: "Lun-Dom 13:00-16:00 y 20:00-23:30",
    ...over,
  };
}

/**
 * Perfil con **el manual de marca completo**, fotos y la carta con categorías: todo lo que la spec de
 * plantillas de landing añadió al perfil, en su forma nueva.
 *
 * Los `src` son de `a.storyblok.com` a propósito: es el host que la allowlist del renderizador acepta,
 * así que una fixture con otro dominio probaría el camino de descarte sin querer.
 */
export function perfilConManual(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return validProfile({
    brand: {
      logo: "https://a.storyblok.com/f/1/logo.svg",
      plantilla: "base",
      colores: {
        primario: "#0a7d34",
        secundario: "#c8102e",
        titulo: "#1a1a1a",
        texto: "#333333",
        fondo: "#ffffff",
        fondoAlt: "#f4f4f2",
      },
      fuentes: { titulo: "condensada", texto: "humanista", decorativa: "script" },
    },
    portada: { src: "https://a.storyblok.com/f/1/portada.jpg", alt: "Sala del restaurante" },
    fotos: [
      { src: "https://a.storyblok.com/f/1/galeria-1.jpg" },
      { src: "https://a.storyblok.com/f/1/galeria-2.jpg", alt: "Horno de leña" },
    ],
    menu_categorias: [
      { nombre: "Pizzas", foto: { src: "https://a.storyblok.com/f/1/pizzas.jpg" }, orden: 0 },
      { nombre: "Pastas", orden: 1 },
    ],
    menu: [
      {
        category: "Pizzas",
        name: "Margherita",
        description: "Tomate San Marzano, mozzarella fior di latte, albahaca",
        precios: [
          { etiqueta: "Media", importe: "9,00 €", comensales: "1 persona" },
          { etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" },
        ],
        nota: "Disponible sin gluten",
        foto: { src: "https://a.storyblok.com/f/1/margherita.jpg" },
        video: {
          src: "https://a.storyblok.com/f/1/margherita.mp4",
          poster: {
            src: "https://a.storyblok.com/f/1/margherita-poster.jpg",
            alt: "Pizza Margherita recién horneada",
          },
        },
        alergenos: ["gluten", "lacteos"],
        etiquetas: ["vegetariano"],
        nutricion: { calorias: 820, proteinas_g: 34, carbohidratos_g: 96, grasas_g: 28 },
      },
      { category: "Pastas", name: "Cacio e pepe", price: "13,00 €" },
    ],
    // Las tres secciones de plantilla (bloque K, etapa 3). Están acá porque este perfil es el que
    // recorre las TRES FRONTERAS encadenadas en `renderer/src/tres-fronteras.test.ts`: un campo que no
    // esté en esta fixture puede faltar en la allowlist de Postgres y el test seguiría verde.
    bienvenida: "Un comedor pequeño en el centro, con horno de leña a la vista.",
    destacados: [
      { titulo: "Horno de leña", texto: "La masa fermenta 48 horas." },
      { titulo: "Dos locales", texto: "Centro y Chamberí." },
    ],
    testimonios: [
      { texto: "La mejor napolitana que he comido fuera de Nápoles.", autor: "Cliente habitual" },
      { texto: "Se come muy bien y sin esperar." },
    ],
    ...over,
  });
}

/**
 * Perfil con la marca **legacy** `{color, font}`, la forma que tienen TODAS las fichas sembradas hasta
 * el 2026-08-08.
 *
 * Existe porque es la única regresión que el manual de marca puede causar: sin esta fixture, nada
 * probaría que las webs ya publicadas siguen viéndose igual. La spec la pide con esas palabras — "dos
 * perfiles de fixture, no uno".
 */
export function perfilLegacy(over: Partial<BusinessProfile> = {}): BusinessProfile {
  return validProfile({
    brand: { color: "#0a7d34", font: "serif", logo: "https://a.storyblok.com/f/1/logo.svg" },
    ...over,
  });
}

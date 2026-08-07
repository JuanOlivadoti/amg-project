import { randomUUID } from "node:crypto";
import { renderReport, SCHEMA_VERSION } from "contrato";
import type {
  DataQuality,
  KeywordResearchBrief,
  PageEvidence,
  PageSeo,
  PageStrategy,
  PageType,
  ProposedPage,
  SearchIntent,
} from "contrato";
import type { ConexionReservada } from "./deploy.js";

/**
 * Seed de la demo de Fase 1: el caso de **La Birra Bar** pre-cargado para que el portal de Frank
 * tenga qué mostrar SIN el orquestador (que es Fase 2).
 *
 * Reproduce la corrida de la acción 06 (`docs/acciones/06-corrida-final-demo.md`): un run en
 * `pending_approval` con 14 páginas, **8 respaldadas por datos de mercado** y **6 `sin_validar`**. Ese
 * split es el argumento de venta del sistema —dice lo que NO sabe—, y es lo que el portal muestra en
 * ✅/⚠️. Las páginas nacen `approved = false`: la compuerta (ADR-06) la cruza Frank en vivo.
 *
 * ## Por qué La Birra Bar y no "Bella Napoli"
 *
 * La acción 06 republicó el space real con **La Birra Bar** (cliente real de la agencia) y este seed
 * se quedó con el italiano de ejemplo. Resultado: el portal contaba un caso y la web servía otro, y
 * la demo se contradecía a sí misma en el salto de la pantalla al sitio. El perfil de acá está atado
 * por test a `web-builder/business-profile.json` —la misma fuente que se publica— para que la deriva
 * no pueda volver a pasar en silencio.
 *
 * ## Se corre como superusuario (salta RLS), a propósito
 *
 * Sembrar es una operación de administración: crea tenants, membresías y datos de varios "dueños". No
 * es una petición de usuario, así que no pasa por `app_user`/RLS —igual que las migraciones, usa la
 * conexión de admin—. Lo que se siembra SÍ se lee después bajo RLS (lo prueban los tests).
 *
 * ## Los UUID de Frank y Juan son PARÁMETROS
 *
 * En producción, esos IDs son los `sub` de sus usuarios de Supabase Auth, que se crean aparte
 * (`SEED_FRANK_USER_ID` / `SEED_JUAN_USER_ID`). La membresía es lo único que ata ese ID a un tenant y
 * un rol: sin ella, el usuario existe pero no ve nada. Por eso el seed es idempotente en la parte de
 * membresías —se puede re-correr una vez que los usuarios existan— sin recrear el resto.
 */

export interface OpcionesSeed {
  /** `sub` del usuario de Supabase de Frank. Se le da rol `maestro`. */
  frankUserId: string;
  /** `sub` del usuario de Supabase de Juan. Se le da rol `equipo`. */
  juanUserId: string;
}

export interface ResultadoSeed {
  tenantId: string;
  clientId: string;
  runId: string;
}

/**
 * EL VOCABULARIO DEL SEED → EL DEL CONTRATO. Dos traducciones, y las dos son una divergencia real que
 * este mapa hace visible en vez de taparla con un `as`.
 *
 * `PAGINAS_DEMO` guarda la intención en español (`comercial`) y la estrategia como el PAPEL de la
 * página en el hub (`hub`/`spoke`), que es lo que muestra el portal. El contrato usa el vocabulario que
 * el pipeline EMITE: `SearchIntent` en inglés (`kr-service/src/pipeline/cluster-map.ts` escribe
 * `intencion: intent`, y el clasificador produce `commercial`/`navigational`/`informational`) y
 * `PageStrategy` sin `hub`/`spoke` sueltos (`single | hub_spoke | merge | backlog`).
 *
 * **Dónde se aplica la traducción, y por qué eso cambió.** Hasta el 2026-08-07 se aplicaba SOLO para
 * armar el brief del informe: el `insert` de `sembrarDemo` escribía `p.intencion` y `p.estrategia` en
 * crudo, así que `kr_pages` guardaba `comercial` y `hub`. Este comentario decía que era "una
 * divergencia PREEXISTENTE que la base acepta porque la columna es `text` sin check" y que corregirla
 * era de otra tarea — y esa frase es exactamente la que dejó el bug vivo. No era una divergencia
 * inocua: el brief que el orquestador reconstruye desde la base (`briefDesdeLaBase`) lo RECHAZA
 * `parseBrief` en el M1. Hoy la base tampoco lo acepta (cuatro `check`, migración 0017) y la traducción
 * se aplica una sola vez, en `aPaginaPropuesta`, de donde lee el insert.
 *
 * `PAGINAS_DEMO` sigue guardando el español: es la fuente que el dashboard del portal espeja campo por
 * campo (`db/src/cartera-portal.test.ts`), y traducirla ahí movería el problema en vez de resolverlo.
 * Lo que se traduce es lo que SALE hacia el contrato — la fila y el brief, que ahora son lo mismo.
 *
 * `keyof typeof` es lo que sostiene el mapeo: agregar un valor nuevo a `PAGINAS_DEMO` sin traducirlo NO
 * compila, que es exactamente el papel que un `as` habría anulado.
 */
const INTENCION_DEL_CONTRATO = {
  comercial: "commercial",
  navegacional: "navigational",
  informacional: "informational",
} as const satisfies Record<string, SearchIntent>;

/** `hub` y `spoke` son los dos papeles de UNA estrategia hub-and-spoke: las dos colapsan a `hub_spoke`. */
const ESTRATEGIA_DEL_CONTRATO = {
  hub: "hub_spoke",
  spoke: "hub_spoke",
  single: "single",
} as const satisfies Record<string, PageStrategy>;

/** Una página del brief, tal como la sembramos. Espeja las columnas de `kr_pages`. */
interface PaginaSeed {
  slug: string;
  keyword: string;
  secundarias: string[];
  /*
   * Los campos de vocabulario cerrado —`tipo`, `estrategia`, `intencion`, `evidencia` y el
   * `schema_type` de `brief`— llevan el tipo DEL CONTRATO (o la clave de su traducción) y no `string`.
   * Es lo que convierte el mapeo a `ProposedPage` en algo que `tsc` comprueba: con `string`, cada uno
   * habría necesitado un cast, y un cast acá es la puerta por la que entra un `tipo` que el M1 no sabe
   * publicar o un `schema_type` que le miente a Google.
   */
  tipo: PageType;
  estrategia: keyof typeof ESTRATEGIA_DEL_CONTRATO;
  intencion: keyof typeof INTENCION_DEL_CONTRATO;
  local: boolean;
  /** `null` = el proveedor no dio el dato (≠ 0). Solo las respaldadas tienen volumen. */
  volumen: number | null;
  dificultad: number | null;
  evidencia: PageEvidence;
  score: number;
  confianza: number;
  seo: { title: string; description: string };
  brief: { schema_type: PageSeo["schema_type"] };
  faqs: string[];
}

/**
 * Las 14 páginas de la corrida de la acción 06, con el split de honestidad que cuenta la demo: 8 con
 * demanda demostrable arriba, 6 sin validar debajo.
 *
 * **Slug, keyword, título, descripción, tipo, intención y FAQs salen de Storyblok** — se leyeron por
 * la Content Delivery API del space real (2026-08-01), así que el brief que Frank aprueba en el
 * portal lista **exactamente** las páginas que están vivas en la web, con sus mismos textos.
 *
 * **Lo único reconstruido son las métricas** (volumen, dificultad, score, confianza): vivían en
 * `out/brief.json`, que se perdió con el directorio `out/` (ver KR-1 en el roadmap). Están asignadas
 * por demanda plausible y **respetan el split real 8/6**; cuando se regenere el dataset crudo, se
 * reemplazan por las medidas. Ninguna otra parte del seed es inventada.
 */
export const PAGINAS_DEMO: PaginaSeed[] = [
  {
    slug: "/mejor-hamburguesa-del-mundo-madrid",
    keyword: "mejor hamburguesa del mundo Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "hub",
    intencion: "comercial",
    local: true,
    volumen: 2400,
    dificultad: 34,
    evidencia: "datos_mercado",
    score: 94.5,
    confianza: 0.9,
    seo: {
      title: "La Mejor Hamburguesa del Mundo en Madrid | La Birra Bar",
      description: "Disfruta de la mejor hamburguesa del mundo en La Birra Bar, ubicados en el corazón de Madrid. Degusta nuestra especialidad gourmet argentina y cervezas artesanales.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Dónde puedo encontrar La Birra Bar en Madrid?", "¿Qué hace especial a la hamburguesa de La Birra Bar?", "¿Qué tipos de cervezas artesanales ofrecen?", "¿Cuál es la historia detrás de la hamburguesa premiada?", "¿Cuáles son los horarios de apertura de los locales?"],
  },
  {
    slug: "/la-birra-bar-madrid",
    keyword: "La Birra Bar Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "navegacional",
    local: true,
    volumen: 1900,
    dificultad: 8,
    evidencia: "datos_mercado",
    score: 92,
    confianza: 0.88,
    seo: {
      title: "La Birra Bar Madrid | Hamburguesas Gourmet y Cervezas Artesanales",
      description: "Descubre La Birra Bar en Madrid, la hamburguesería gourmet premiada internacionalmente. Visítanos en nuestros locales de Centro y Salamanca.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Cómo puedo hacer una reserva en La Birra Bar Madrid?", "¿Dónde se encuentra La Birra Bar en Madrid?", "¿Cuál es el precio promedio de las hamburguesas en La Birra Bar Madrid?", "¿Qué cervezas ofrecen en La Birra Bar Madrid?"],
  },
  {
    slug: "/hamburgueseria-gourmet-madrid",
    keyword: "hamburguesería gourmet Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 1300,
    dificultad: 28,
    evidencia: "datos_mercado",
    score: 86.4,
    confianza: 0.85,
    seo: {
      title: "Hamburguesería Gourmet en Madrid | La Birra Bar",
      description: "Descubre la mejor hamburguesería gourmet en Madrid, La Birra Bar. Disfruta de hamburguesas premiadas, pan artesanal y cervezas exclusivas en el corazón de la ciudad.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Qué hace especiales a las hamburguesas gourmet de La Birra Bar?", "¿Dónde están ubicados los locales de La Birra Bar en Madrid?", "¿Qué tipo de cervezas artesanales ofrece La Birra Bar?", "¿Cómo puedo hacer una reserva en La Birra Bar?", "¿Qué premios ha ganado La Birra Bar por sus hamburguesas?"],
  },
  {
    slug: "/restaurante-argentino-en-madrid",
    keyword: "restaurante argentino en Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 880,
    dificultad: 31,
    evidencia: "datos_mercado",
    score: 79.8,
    confianza: 0.81,
    seo: {
      title: "La Birra Bar: Hamburguesería Gourmet en el Centro de Madrid",
      description: "Descubre La Birra Bar, restaurante argentino en Madrid. Disfruta de hamburguesas gourmet premiadas y cervezas artesanales en nuestros locales en el Centro y Salamanca.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Dónde se encuentran los locales de La Birra Bar en Madrid?", "¿Qué tipo de hamburguesas ofrece La Birra Bar?", "¿Qué cervezas artesanales se pueden encontrar en La Birra Bar?", "¿Cuál es la especialidad de La Birra Bar?", "¿La Birra Bar tiene opciones vegetarianas?"],
  },
  {
    slug: "/cervezas-artesanales-madrid",
    keyword: "cervezas artesanales Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 720,
    dificultad: 22,
    evidencia: "datos_mercado",
    score: 77.2,
    confianza: 0.8,
    seo: {
      title: "Cervezas Artesanales en Madrid - La Birra Bar",
      description: "Disfruta las mejores cervezas artesanales de Madrid en La Birra Bar, con locales en Centro y Salamanca. Acompaña con hamburguesas gourmet premiadas.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Qué tipos de cervezas artesanales ofrecen en La Birra Bar?", "¿Dónde están ubicados los locales de La Birra Bar en Madrid?", "¿Se pueden pedir cervezas artesanales a domicilio desde La Birra Bar?", "¿Cuál es la especialidad de hamburguesas de La Birra Bar?"],
  },
  {
    slug: "/cerveza-ale-ogham-madrid",
    keyword: "cerveza Ale Ogham Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 390,
    dificultad: 18,
    evidencia: "datos_mercado",
    score: 74,
    confianza: 0.78,
    seo: {
      title: "Cerveza Ale Ogham y Hamburguesas Gourmet en Madrid | La Birra Bar",
      description: "Descubre nuestras hamburguesas gourmet argentinas y disfruta de la cerveza Ale Ogham en La Birra Bar Madrid, con locales en Puerta del Sol y Salamanca.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Dónde están ubicados los locales de La Birra Bar en Madrid?", "¿Qué hace especial a la cerveza Ale Ogham?", "¿Cuáles son las especialidades de La Birra Bar?", "¿Qué garantías ofrecen sobre la calidad de los ingredientes?", "¿Cómo fue premiada la hamburguesa de La Birra Bar?"],
  },
  {
    slug: "/tienda-de-cervezas-artesanales-madrid",
    keyword: "tienda de cervezas artesanales madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 260,
    dificultad: 15,
    evidencia: "datos_mercado",
    score: 71.5,
    confianza: 0.76,
    seo: {
      title: "La Birra Bar Madrid: Hamburguesas y Cervezas Artesanales Premiadas",
      description: "Descubre La Birra Bar en Madrid. Disfruta de hamburguesas gourmet y una exclusiva selección de cervezas artesanales. Dos locales para la mejor experiencia.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Dónde se encuentran los locales de La Birra Bar en Madrid?", "¿Qué cervezas artesanales ofrecen en La Birra Bar?", "¿Qué hace únicas a las hamburguesas de La Birra Bar?", "¿Puedo reservar una cata de cervezas artesanales?", "¿Qué premios ha ganado La Birra Bar?"],
  },
  {
    slug: "/patatas-fritas-especiales-madrid",
    keyword: "patatas fritas especiales Madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 210,
    dificultad: 20,
    evidencia: "datos_mercado",
    score: 68.3,
    confianza: 0.74,
    seo: {
      title: "Las Mejores Patatas Fritas Especiales en Madrid | La Birra Bar",
      description: "Disfruta de nuestras patatas fritas especiales en La Birra Bar, Madrid. Acompañadas por salsas de la casa y cervezas artesanales. Visítanos en Puerta del Sol o Salamanca.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Dónde están ubicados los locales de La Birra Bar en Madrid?", "¿Qué hace especiales a las patatas fritas de La Birra Bar?", "¿Cuáles son las cervezas artesanales disponibles?", "¿Qué premios ha ganado La Birra Bar?", "¿Cómo puedo reservar una mesa en La Birra Bar Madrid?"],
  },
  {
    slug: "/opiniones-de-la-birra-bar-hamburguesas-artesanales-madrid",
    keyword: "opiniones de la birra bar hamburguesas artesanales madrid",
    secundarias: [],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 57,
    confianza: 0.25,
    seo: {
      title: "Opiniones de La Birra Bar: Hamburguesas Artesanales en Madrid",
      description: "Descubre por qué La Birra Bar es el favorito en Madrid para los amantes de las hamburguesas artesanales. Ubicados en Centro y Salamanca, nuestras hamburguesas gourmet te esperan.",
    },
    brief: { schema_type: "LocalBusiness" },
    faqs: ["¿Dónde están ubicados los locales de La Birra Bar en Madrid?", "¿Qué tipo de carne se utiliza en las hamburguesas de La Birra Bar?", "¿Cuáles son las especialidades de La Birra Bar?", "¿Cómo son las cervezas artesanales que ofrece La Birra Bar?", "¿Qué premios ha ganado La Birra Bar por sus hamburguesas?"],
  },
  {
    slug: "/hamburguesas-con-salsas-de-la-casa",
    keyword: "hamburguesas con salsas de la casa",
    secundarias: [],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 53.5,
    confianza: 0.25,
    seo: {
      title: "Hamburguesas Gourmet con Salsas Exclusivas en La Birra Bar Madrid",
      description: "Descubre nuestras hamburguesas gourmet con salsas de la casa en La Birra Bar, ubicadas en el centro de Madrid y Salamanca. Disfruta de sabores únicos premiados internacionalmente.",
    },
    brief: { schema_type: "WebPage" },
    faqs: ["¿Cuáles son las especialidades de La Birra Bar?", "¿Dónde están ubicados los locales en Madrid?", "¿Qué tipo de carne se utiliza en las hamburguesas?", "¿Qué salsas de la casa ofrecen?", "¿Qué premios ha ganado La Birra Bar?"],
  },
  {
    slug: "/hamburguesas-de-carne-vacuna-espanola",
    keyword: "hamburguesas de carne vacuna española",
    secundarias: [],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 49,
    confianza: 0.25,
    seo: {
      title: "Hamburguesas Gourmet en Madrid - La Birra Bar",
      description: "Disfruta las mejores hamburguesas de carne vacuna española en La Birra Bar, ubicados en Centro y Salamanca. Premiada en Dubai y Miami. ¡Visítanos!",
    },
    brief: { schema_type: "WebPage" },
    faqs: ["¿Qué tipo de carne utilizan en sus hamburguesas?", "¿Dónde están ubicados sus locales en Madrid?", "¿Tienen opciones vegetarianas en el menú?", "¿Aceptan reservas en La Birra Bar?", "¿Qué cervezas artesanales ofrecen?"],
  },
  {
    slug: "/hamburguesas-con-pan-artesanal",
    keyword: "hamburguesas con pan artesanal",
    secundarias: [],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 46.5,
    confianza: 0.25,
    seo: {
      title: "Hamburguesas Gourmet con Pan Artesanal en Madrid | La Birra Bar",
      description: "Disfruta de auténticas hamburguesas gourmet con pan artesanal en La Birra Bar, presentes en Centro y Salamanca. Premiada internacionalmente por sus sabores únicos.",
    },
    brief: { schema_type: "WebPage" },
    faqs: ["¿Dónde están ubicados los locales de La Birra Bar en Madrid?", "¿Qué caracteriza a las hamburguesas de La Birra Bar?", "¿Qué cervezas artesanales ofrecen?", "¿Cuáles son los premios que ha recibido La Birra Bar?", "¿Cómo puedo hacer una reserva?"],
  },
  {
    slug: "/mejor-hamburguesa-dubai-burger-championship",
    keyword: "mejor hamburguesa Dubai Burger Championship",
    secundarias: [],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 43,
    confianza: 0.25,
    seo: {
      title: "La Mejor Hamburguesa del Mundo: Descubre el Sabor de La Birra Bar",
      description: "Descubre la excelencia de la mejor hamburguesa del Dubai Burger Championship en La Birra Bar, Madrid. Un sabor gourmet que no puedes perderte.",
    },
    brief: { schema_type: "Article" },
    faqs: ["¿Dónde se encuentran los locales de La Birra Bar en Madrid?", "¿Qué hace que las hamburguesas de La Birra Bar sean únicas?", "¿Qué premios ha ganado La Birra Bar a nivel internacional?", "¿Qué cervezas artesanales ofrece La Birra Bar?", "¿Cuál es la especialidad de La Birra Bar en Madrid?"],
  },
  {
    slug: "/people-s-choice-award-burger-bash-miami",
    keyword: "People's Choice Award Burger Bash Miami",
    secundarias: [],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 40,
    confianza: 0.25,
    seo: {
      title: "La Birra Bar: Premiada en el People's Choice Award del Burger Bash de Miami",
      description: "Descubre las hamburguesas gourmet de La Birra Bar, premiadas en el Burger Bash de Miami. Disfruta de nuestras especialidades en el corazón de Madrid.",
    },
    brief: { schema_type: "Article" },
    faqs: ["¿Qué hace únicas a las hamburguesas de La Birra Bar?", "¿Dónde se encuentran los locales de La Birra Bar en Madrid?", "¿Qué cervezas artesanales se ofrecen en La Birra Bar?", "¿Qué premios ha ganado La Birra Bar por sus hamburguesas?", "¿Qué tipo de carne se utiliza en las hamburguesas de La Birra Bar?"],
  },
];

/**
 * El perfil del negocio. **Atado por test a `web-builder/business-profile.json`** (ver
 * `seed-demo.test.ts`): `name`, `locations` y `menu` tienen que ser idénticos a los que se publican,
 * porque el portal y la web tienen que hablar del mismo negocio.
 *
 * Todo lo que está acá pasa por la allowlist `business_profile_publico` (0008/0009/0010) antes de
 * llegar al renderizador: un campo que no esté en esa lista **se filtra en silencio**. `locations`
 * alimenta el footer NAP multi-local y la sección Ubicaciones; `menu` alimenta `/menu` con su JSON-LD.
 *
 * **`brand.font` no es texto libre**: el renderizador solo acepta `sistema | serif | moderna`
 * (`renderer/src/perfil.ts`). El perfil anterior ponía `"Fraunces"` y se descartaba sin avisar.
 *
 * **Sin `telephone` ni `postalCode`**: no los confirmó el cliente y no se inventan (misma decisión que
 * en `business-profile.json`). Sin `address` de nivel raíz a propósito: con dos locales, la dirección
 * canónica sale de `locations`, que es lo que manda en el JSON-LD y en el footer.
 */
export const PERFIL_DEMO = {
  name: "La Birra Bar",
  priceRange: "€€",
  brand: { color: "#b45309", font: "moderna" },
  locations: [
    {
      name: "Centro (Puerta del Sol)",
      address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
      opening_hours: "Lun-Dom 11:00-01:00 · Vie-Sáb hasta las 02:00",
    },
    {
      name: "Salamanca",
      address: { streetAddress: "Calle de José Ortega y Gasset 79", addressLocality: "Madrid" },
      opening_hours: "Dom-Mié hasta 00:30 · Vie-Sáb hasta la 01:00",
    },
  ],
  menu: [
    {
      category: "Hamburguesas",
      name: "Golden Burger",
      description: "La hamburguesa insignia de la casa, la que los lanzó a la fama mundial.",
    },
    { category: "Cervezas artesanales", name: "Ale de Ogham", description: "De barril, bien fría." },
    { category: "Cervezas artesanales", name: "Honey de Ogham", description: "De barril, bien fría." },
    {
      category: "Acompañamientos",
      name: "Patatas fritas especiales",
      description: "Con un toque crocante único y salsas de la casa.",
    },
  ],
};

/**
 * IDs FIJOS del cliente y del run de demo. Son la clave estable que hace el seed idempotente **sin
 * ser destructivo**: se upserta el cliente por su `id` y se reemplaza SOLO el run de demo por el
 * suyo. La versión anterior resolvía el cliente por nombre (dos seeds concurrentes lo duplicaban) y
 * borraba runs con `delete ... where client_id` —que en Fase 2 se llevaría puesta la investigación
 * real del cliente—. Con un id fijo, re-sembrar toca exactamente estas dos filas y ninguna más.
 * (10ª review externa, #3 y #10.)
 *
 * Se mantienen los MISMOS UUID que tenía el seed del italiano de ejemplo: en la instalación ya
 * desplegada, re-sembrar reemplaza ese cliente y ese run en su lugar en vez de dejar los dos.
 */
export const DEMO_CLIENT_ID = "d3305eba-11a5-4e0e-9c1f-000000000001";
export const DEMO_RUN_ID = "d3305eba-11a5-4e0e-9c1f-000000000002";

/**
 * $0.3097 — lo que costó de verdad la corrida de la acción 06 (2026-07-30).
 *
 * Es una constante y no un literal en el `insert` porque el dashboard del portal muestra ese mismo
 * número, y `cartera-portal.test.ts` ata las dos copias: un literal suelto en el SQL no se puede
 * comparar contra nada.
 */
export const COSTE_MICROS_DEMO = 309_700;

const PROMPT_DEMO =
  "Hamburguesería gourmet argentina en Madrid, con dos locales (Puerta del Sol y barrio de Salamanca). Especialidades: hamburguesas de autor, cerveza artesanal de barril y patatas fritas especiales.";

/** El nombre del cliente. Constante y no literal porque lo escriben dos lugares: `clients` y el informe. */
const NOMBRE_CLIENTE_DEMO = "La Birra Bar";

/**
 * El objetivo del `satisfies` de `CALIDAD_DATOS_DEMO`, y por qué nombra los tres huecos como `null` en
 * vez de conformarse con `DataQuality`.
 *
 * `DataQuality` los declara `number | null` y `string[] | null`, que es lo correcto **en el contrato**:
 * una corrida real mide coberturas de verdad y puede reportar un array de endpoints caídos de verdad.
 * Pero eso deja pasar `endpoints_degradados: []` **acá**, y en esta constante `[]` sería una mentira
 * (afirma "ninguno falló", y la corrida no registró nada sobre endpoints).
 *
 * Medido con `tsc --strict`, porque la primera versión de esto afirmaba lo contrario: con `DataQuality`
 * a secas el `satisfies` acepta `[]` **y** `["serp"]` sin una queja. Fijando los tres al literal `null`,
 * un `[]` falla con `TS2322: Type 'readonly []' is not assignable to type 'null'`, y una
 * `cobertura_volumen: 0.571` inventada falla igual. O sea que la honestidad de estos tres campos la
 * impone **el compilador**, y el test de `seed-demo.test.ts` es la segunda línea, no la única.
 *
 * La fijación vive acá y **NO en `DataQuality`**: estrechar el contrato rompería a quien emite un array
 * legítimo (el pipeline en una corrida con endpoints caídos, y los fixtures de `contrato`). Lo que es
 * mentira es este `[]` concreto, no el tipo.
 *
 * Sigue intersecando `DataQuality` a propósito: si el contrato agrega un campo de calidad obligatorio,
 * esta constante deja de compilar hasta que alguien decida qué dice la demo sobre él — que es
 * exactamente cuándo hay que pensarlo.
 */
type HuecosDeLaCorridaReal = DataQuality & {
  cobertura_volumen: null;
  cobertura_kd: null;
  endpoints_degradados: null;
  keywords_analizadas: number;
};

/**
 * La calidad de datos de la corrida real, con sus huecos DECLARADOS.
 *
 * Se exporta porque el mock del portal tiene que decir lo mismo y hay un test que los ata
 * (`cartera-portal.test.ts`). Tres de los cuatro campos son `null` **a propósito**: el dato se perdió
 * con `out/` en KR-1 (ver `PAGINAS_DEMO`), y sembrar un número plausible sería inventarlo.
 *
 * - `cobertura_volumen`: acá había `0.571`, que es 8 de 14 **páginas** con volumen. Como cobertura de
 *   KEYWORDS —lo que `DataQuality` define— ese número miente: la corrida analizó 55 keywords y nunca
 *   registró cuántas traían volumen.
 * - `cobertura_kd`: no quedó registrado en ninguna parte.
 * - `endpoints_degradados`: `null` y **NO `[]`**. `[]` significa "ninguno falló", que es una afirmación
 *   con contenido, y esta corrida no registró NADA sobre endpoints. Con `null` el informe omite la
 *   advertencia de fallo **y dice que la omite**.
 *
 * Se van `keywords_con_volumen: 8` y `keywords_totales: 14`: `DataQuality` no los define y su nombre
 * miente (son páginas, no keywords).
 *
 * `keywords_analizadas: 55` sí está medido (`docs/proyecto/09-estado-y-roadmap.md`) y es el cuarto
 * campo, fuera de `DataQuality` — por eso el objetivo del `satisfies` lo nombra aparte. Viaja DENTRO de
 * esta columna porque `kr_runs` no tiene una para él, y `meta_run.keywords_analizadas` lo lee de acá:
 * dos copias que no pueden divergir.
 *
 * Los tres `null` no son solo una convención de este archivo: los fija el tipo
 * `HuecosDeLaCorridaReal` de arriba, así que rellenar cualquiera de ellos **no compila**.
 */
export const CALIDAD_DATOS_DEMO = {
  cobertura_volumen: null,
  cobertura_kd: null,
  endpoints_degradados: null,
  keywords_analizadas: 55,
} as const satisfies HuecosDeLaCorridaReal;

/**
 * El `h1` de las 14 páginas lo generó el LLM y se perdió con `out/`: el pipeline lo pone por defecto
 * como la keyword capitalizada y **`enrich-content.ts` lo sobrescribe** con el del LLM, así que lo que
 * está publicado no se puede reconstruir desde acá. El h1 de las páginas vivas existe, pero en
 * Storyblok, y este paquete no habla con Storyblok.
 *
 * Se declara en vez de reciclar el meta title: en la página publicada son campos distintos y cada uno
 * viaja por su propio carril. Comprobado siguiendo los dos: `pageToStory`
 * (`web-builder/src/handoff/adapter.ts`) manda `content_brief.h1` al `headline` del blok `hero` y
 * `seo.meta_title` al `seo.title` de la story; después `renderHero` pinta el `<h1>` desde ese
 * `headline` y la plantilla de página el `<title>` desde ese `seo.title`
 * (`web-builder/src/render/html.ts`). O sea que igualarlos acá afirmaría algo falso sobre la web que
 * Frank va a abrir. Los nombres importan: para cuando los dos campos llegan a `html.ts` ya vienen
 * renombrados por el adaptador, así que buscar `content_brief.h1` ahí no encuentra nada.
 *
 * No dice `n/d` a secas y eso es deliberado: el informe define `n/d` como "el proveedor de datos no
 * devolvió la métrica para esa keyword", que no es este caso. Un hueco explicado por la nota
 * equivocada es peor que un hueco con nombre propio.
 */
const H1_SIN_REGISTRAR = "(h1 sin registrar)";

/**
 * `PaginaSeed` → `ProposedPage`. Es la inversa de `aFilaDePagina` (`orchestrator/src/workflow.ts`).
 *
 * **Es LA fuente de la fila y del brief, y hasta el 2026-08-07 solo era la del brief.** Nació para que
 * el informe de la demo lo generase el MISMO `renderReport` que el del orquestador; el `insert` de
 * `sembrarDemo`, mientras tanto, escribía sus propios valores tomados de `PaginaSeed` en crudo. O sea:
 * dos verdades del mismo dato, a 130 líneas de distancia, en el mismo archivo. Ganaba la equivocada —
 * la base terminaba con `page_strategy = 'hub'`, `intencion = 'comercial'`, `seo = {title, description}`
 * y `content_brief = {schema_type}`, y el brief que el orquestador reconstruye desde ahí
 * (`briefDesdeLaBase`) lo rechazaba `parseBrief` en el M1. Ver la migración 0017.
 *
 * Ahora el insert lee **de este objeto**, así que la traducción ocurre una vez o no ocurre.
 *
 * ### Lo que se DERIVA, y de qué
 *
 * - `cluster_id`: se genera en TypeScript (`randomUUID`) y se le PASA a la fila, en vez de dejar que lo
 *   genere Postgres y devolverlo con `returning`. Los cluster_id de la corrida real se perdieron, así
 *   que cualquiera de los dos sirve; lo que decide es la dirección: con el uuid en la mano, la página
 *   del contrato se puede construir ANTES del insert y ser su única fuente. Con `returning` había que
 *   insertar primero, y por eso el insert tenía que inventarse sus propios valores.
 * - `intencion` / `page_strategy`: traducidos (ver los dos mapas de arriba).
 * - `seo.canonical`: el slug, y no es una conjetura — el pipeline construye los dos con la MISMA
 *   expresión (`slugify(head.keyword)` en `cluster-map.ts`), así que `canonical === url_slug` es su
 *   regla, y el slug de la demo se leyó de Storyblok.
 * - `approved: false`: lo mismo que escribe el insert de `kr_pages`. La compuerta la cruza Frank.
 *
 * ### Lo que la corrida NO registró
 *
 * - `content_brief.h1` → `H1_SIN_REGISTRAR` (ver ahí). `renderReport` lo pinta como encabezado de cada
 *   página del detalle, así que **este hueco se ve**, y es correcto que se vea.
 * - `secciones_sugeridas`: `[]` — el informe no pinta la línea cuando está vacía, así que no afirma nada.
 * - `enlazado_interno`: `[]` — el informe nunca lo imprime.
 * - `word_count_objetivo`: `0`, el único sin buena salida: `ContentBrief` no tiene forma de decir "no sé"
 *   para un número (a diferencia de `volumen`, nullable desde kr.v0.4). El informe nunca lo imprime, y es
 *   el mismo `0` que usa el M1 cuando relee una story de Storyblok, que tampoco lo trae
 *   (`web-builder/src/storyblok/content.ts`).
 */
function aPaginaPropuesta(p: PaginaSeed, clusterId: string): ProposedPage {
  return {
    cluster_id: clusterId,
    tipo: p.tipo,
    page_strategy: ESTRATEGIA_DEL_CONTRATO[p.estrategia],
    url_slug: p.slug,
    keyword_principal: p.keyword,
    keywords_secundarias: p.secundarias,
    intencion: INTENCION_DEL_CONTRATO[p.intencion],
    local: p.local,
    volumen: p.volumen,
    dificultad: p.dificultad,
    evidencia: p.evidencia,
    opportunity_score: p.score,
    score_confidence: p.confianza,
    seo: {
      meta_title: p.seo.title,
      meta_description: p.seo.description,
      schema_type: p.brief.schema_type,
      canonical: p.slug,
    },
    content_brief: {
      h1: H1_SIN_REGISTRAR,
      secciones_sugeridas: [],
      word_count_objetivo: 0,
      enlazado_interno: [],
    },
    preguntas_frecuentes: p.faqs,
    approved: false,
  };
}

/**
 * Siembra (o re-siembra) el caso de demo. Idempotente **y no destructivo**: el tenant se upserta por
 * slug, el cliente por su id fijo, las membresías por (tenant, usuario), y **solo el run de demo**
 * (id fijo) se reemplaza. Un run distinto del mismo cliente NO se toca.
 *
 * Todo dentro de UNA transacción: si algo falla, la base queda como estaba (no a medio sembrar).
 */
export async function sembrarDemo(
  con: ConexionReservada,
  opts: OpcionesSeed,
): Promise<ResultadoSeed> {
  await con.exec("begin");
  try {
    // --- Tenant (upsert por slug) ---
    const { rows: t } = await con.query<{ id: string }>(
      `insert into tenants (nombre, slug) values ('AMG Madrid', 'amg')
       on conflict (slug) do update set nombre = excluded.nombre
       returning id`,
    );
    const tenantId = t[0]!.id;

    // --- Cliente (upsert por id FIJO: sin resolución por nombre, sin carreras) ---
    await con.query(
      `insert into clients (id, tenant_id, nombre, prompt_negocio, business_profile)
       values ($1, $2, $3, $4, $5::jsonb)
       on conflict (id) do update
         set nombre = excluded.nombre,
             prompt_negocio = excluded.prompt_negocio,
             business_profile = excluded.business_profile`,
      [DEMO_CLIENT_ID, tenantId, NOMBRE_CLIENTE_DEMO, PROMPT_DEMO, JSON.stringify(PERFIL_DEMO)],
    );
    const clientId = DEMO_CLIENT_ID;

    // --- Membresías (upsert por (tenant_id, user_id)). maestro/equipo => client_id NULL (la
    // constraint cliente_exige_client_id lo exige). El rol se DERIVA de acá, no se declara. ---
    for (const [userId, rol] of [
      [opts.frankUserId, "maestro"],
      [opts.juanUserId, "equipo"],
    ] as const) {
      await con.query(
        `insert into memberships (tenant_id, user_id, rol, client_id)
         values ($1, $2, $3::user_role, null)
         on conflict (tenant_id, user_id) do update set rol = excluded.rol, client_id = null`,
        [tenantId, userId, rol],
      );
    }

    // --- El run de demo: reemplazar SOLO el run de id fijo (cascada a sus páginas). Los demás runs
    // del cliente —investigación real en Fase 2— quedan intactos. ---
    await con.query("delete from kr_runs where id = $1", [DEMO_RUN_ID]);

    const { rows: run } = await con.query<{ id: string }>(
      `insert into kr_runs (id, tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code,
                            coste_micros_usd, calidad_datos, config)
       values ($1, $2, $3, 'kr.v0.5', 'pending_approval', $4, 'ES', 'es', 2724, $5,
               $6::jsonb, $7::jsonb)
       returning id`,
      [
        DEMO_RUN_ID,
        tenantId,
        clientId,
        PROMPT_DEMO,
        COSTE_MICROS_DEMO,
        // Los huecos van declarados, no rellenados. El por qué de cada uno, en `CALIDAD_DATOS_DEMO`.
        JSON.stringify(CALIDAD_DATOS_DEMO),
        JSON.stringify({ max_cost_usd: 1.0, max_pages: 14 }),
      ],
    );
    const runId = run[0]!.id;

    /*
     * --- Las 14 páginas del brief ---
     *
     * `orden_brief` = la posición en `PAGINAS_DEMO` (0 = primera), que es el mismo contrato que aplica
     * `PgStore.savePages`: **el orden ES la posición en el array** (KR-3, migración 0015). Este insert
     * no pasa por el store —siembra con la conexión de infraestructura, saltando RLS a propósito—, así
     * que la posición hay que escribirla acá o el brief de la demo quedaría con `orden_brief` NULL y se
     * ordenaría por score, que es justo lo que KR-3 vino a arreglar.
     *
     * Hoy los dos órdenes coinciden (el array está por score descendente y el split 8/6 cae junto), así
     * que la demo se ve igual que antes. Lo que cambia es que **deja de depender de esa coincidencia**:
     * si el array se reordena por evidencia y confianza, el portal lo muestra en ese orden.
     *
     * ## Una sola verdad: la fila se escribe DESDE la página del contrato
     *
     * El insert lee de `aPaginaPropuesta(p, …)` y no de `p`. La versión anterior hacía lo contrario
     * —insertaba `p.estrategia`, `p.intencion`, `p.seo` y `p.brief` en crudo y recién después construía
     * la página del contrato para el informe— y por eso la base guardaba `hub`, `comercial`,
     * `{title, description}` y `{schema_type}`, todo fuera del contrato, mientras el informe del mismo
     * seed decía lo correcto. Ver la migración 0017, que además lo impone con cuatro `check`.
     *
     * De `p` no se lee ya NINGÚN campo de la fila: los 19 salen de `pagina`. Lo único que el insert
     * toma de fuera es la POSICIÓN `i`, y es correcto que así sea — `orden_brief` es el puesto de la
     * página EN EL BRIEF, no un atributo de la página, y por eso `ProposedPage` no lo tiene.
     */
    const paginasDelBrief: ProposedPage[] = [];
    for (const [i, p] of PAGINAS_DEMO.entries()) {
      // El uuid se genera acá y se le PASA a la fila (antes lo ponía `gen_random_uuid()` y volvía por
      // `returning`). Invertir esa dirección es lo que permite construir la página ANTES del insert, y
      // que el insert deje de tener que inventarse sus propios valores. Sigue habiendo una sola copia.
      const pagina = aPaginaPropuesta(p, randomUUID());
      await con.query(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy,
                               url_slug, keyword_principal, keywords_secundarias, intencion, local,
                               volumen, dificultad, evidencia, opportunity_score, score_confidence,
                               seo, content_brief, preguntas_frecuentes, approved, retirada,
                               orden_brief)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17::jsonb, $18::jsonb, $19, $20, false, $21)`,
        [
          tenantId,
          runId,
          clientId,
          pagina.cluster_id,
          pagina.tipo,
          pagina.page_strategy,
          pagina.url_slug,
          pagina.keyword_principal,
          pagina.keywords_secundarias,
          pagina.intencion,
          pagina.local,
          pagina.volumen,
          pagina.dificultad,
          pagina.evidencia,
          pagina.opportunity_score,
          pagina.score_confidence,
          JSON.stringify(pagina.seo),
          JSON.stringify(pagina.content_brief),
          pagina.preguntas_frecuentes,
          // La compuerta (ADR-06) la cruza Frank: la página del contrato ya nace `approved: false`, así
          // que el `false` tampoco se escribe dos veces.
          pagina.approved,
          i,
        ],
      );
      paginasDelBrief.push(pagina);
    }

    /*
     * --- El informe de la demo ---
     *
     * Se renderiza con `renderReport` (el MISMO render que usa el orquestador: la lógica del informe
     * tiene un solo dueño) y se inserta con `con.query`, dentro de esta transacción. **No** usa
     * `PgStore.guardarInforme` porque ese abre su propia transacción en otra conexión, que no vería este
     * run todavía sin confirmar: llamarlo desde acá fallaría por FK y llamarlo después del `commit`
     * rompería la atomicidad. Es el mismo motivo por el que el seed inserta a mano las otras cinco
     * tablas. Lo que no puede tener dos versiones es el RENDER, no el `insert`.
     *
     * Que la demo tenga informe sin correr DataForSEO es la mitad del valor. La otra mitad es que el
     * informe sale con sus HUECOS declarados (`n/d` en las dos coberturas, sin tabla de desglose, y sin
     * afirmar nada sobre endpoints), así que la pantalla de la demo ejercita el camino de datos
     * incompletos: si el endurecimiento de KR-2a estuviera mal, se ve acá y no en producción.
     *
     * El `insert` va PELADO, sin `on conflict`: `kr_informes.run_id` referencia `kr_runs(id) on delete
     * cascade` (0016), así que el `delete from kr_runs where id = <demo>` de más arriba ya se llevó el
     * informe anterior. Si un día no lo hiciera, un choque de PK es el fallo correcto y ruidoso —
     * taparlo con un upsert escondería que la cascada dejó de funcionar. Lo cubre el test de idempotencia.
     */
    const briefDemo: KeywordResearchBrief = {
      // La versión del OBJETO que se está armando, que `tsc` ata al contrato de hoy. La columna
      // `kr_runs.schema_version` sigue diciendo `kr.v0.5`, que es la de la corrida real: son dos
      // preguntas distintas, y `renderReport` no imprime ninguna de las dos.
      schema_version: SCHEMA_VERSION,
      run_id: runId,
      cliente: NOMBRE_CLIENTE_DEMO,
      /*
       * El mismo instante que el `finished_at` del mock del portal. De la corrida real está registrada
       * la FECHA (2026-07-30) y la DURACIÓN (16 min 15 s), no la hora del día: el mock ya codificó la
       * duración como hora sobre la medianoche, y esto usa ese instante para que el encabezado del
       * informe y la ficha del run no cuenten dos cosas. La hora es una convención heredada, no un dato.
       */
      generated_at: new Date(Date.UTC(2026, 6, 30, 0, 16, 15)).toISOString(),
      market: { country: "ES", language_code: "es", location_code: 2724 },
      // Igual que la columna `status` del run: espera en la compuerta (ADR-06).
      status: "pending_approval",
      paginas_propuestas: paginasDelBrief,
      // Qué clusters quedaron fuera no se registró. Con `[]` la sección no se pinta, que es lo correcto:
      // no se inventa un backlog plausible. (El tipo no admite `null`, así que `[]` es lo único que hay.)
      backlog: [],
      meta_run: {
        keywords_analizadas: CALIDAD_DATOS_DEMO.keywords_analizadas,
        paginas_propuestas: PAGINAS_DEMO.length,
        coste_micros_usd: COSTE_MICROS_DEMO,
        // El desglose por proveedor no quedó registrado: sin los tres números `renderReport` no pinta la
        // tabla y muestra el total con una nota. `{}` es además lo que trae la columna, cuyo default es
        // `'{}'::jsonb` — el mismo caso que `Partial<CostBreakdown>` existe para describir.
        coste_breakdown: {},
        calidad_datos: CALIDAD_DATOS_DEMO,
        // `modelos_sin_precio` se OMITE, y no va `[]`: el campo es opcional en el contrato, así que la
        // ausencia es decible y significa "no se registró". `[]` afirmaría "ningún modelo quedó sin
        // tarifa" —el mismo error que `endpoints_degradados: []`, que la 14ª review ya cazó una vez—.
        // `renderReport` no pinta el aviso en ninguno de los dos casos, así que el informe sale igual;
        // lo que cambia es si el dato miente.
      },
    };

    await con.query(
      `insert into kr_informes (run_id, tenant_id, client_id, informe_md)
       values ($1, $2, $3, $4)`,
      [runId, tenantId, clientId, renderReport(briefDemo, { audiencia: "agencia" })],
    );

    await con.exec("commit");
    return { tenantId, clientId, runId };
  } catch (e) {
    await con.exec("rollback");
    throw e;
  }
}

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

/** Una página del brief, tal como la sembramos. Espeja las columnas de `kr_pages`. */
interface PaginaSeed {
  slug: string;
  keyword: string;
  secundarias: string[];
  tipo: string;
  estrategia: string;
  intencion: string;
  local: boolean;
  /** `null` = el proveedor no dio el dato (≠ 0). Solo las respaldadas tienen volumen. */
  volumen: number | null;
  dificultad: number | null;
  evidencia: "datos_mercado" | "sin_validar";
  score: number;
  confianza: number;
  seo: { title: string; description: string };
  brief: Record<string, unknown>;
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
      [DEMO_CLIENT_ID, tenantId, "La Birra Bar", PROMPT_DEMO, JSON.stringify(PERFIL_DEMO)],
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
        // 8 de 14 páginas con volumen ⇒ cobertura 0.571. Es cobertura por PÁGINA, no por keyword: la
        // corrida real analizó 55 keywords y ese desglose no quedó registrado en la acción 06.
        JSON.stringify({ cobertura_volumen: 0.571, keywords_con_volumen: 8, keywords_totales: 14 }),
        JSON.stringify({ max_cost_usd: 1.0, max_pages: 14 }),
      ],
    );
    const runId = run[0]!.id;

    // --- Las 14 páginas del brief ---
    for (const p of PAGINAS_DEMO) {
      await con.query(
        `insert into kr_pages (tenant_id, run_id, client_id, cluster_id, tipo, page_strategy,
                               url_slug, keyword_principal, keywords_secundarias, intencion, local,
                               volumen, dificultad, evidencia, opportunity_score, score_confidence,
                               seo, content_brief, preguntas_frecuentes, approved, retirada)
         values ($1, $2, $3, gen_random_uuid(), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                 $15, $16::jsonb, $17::jsonb, $18, false, false)`,
        [
          tenantId,
          runId,
          clientId,
          p.tipo,
          p.estrategia,
          p.slug,
          p.keyword,
          p.secundarias,
          p.intencion,
          p.local,
          p.volumen,
          p.dificultad,
          p.evidencia,
          p.score,
          p.confianza,
          JSON.stringify(p.seo),
          JSON.stringify(p.brief),
          p.faqs,
        ],
      );
    }

    await con.exec("commit");
    return { tenantId, clientId, runId };
  } catch (e) {
    await con.exec("rollback");
    throw e;
  }
}

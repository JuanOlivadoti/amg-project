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
 * Las 14 páginas de la corrida de la acción 06. El orden y los números están elegidos para que la
 * demo cuente la historia honesta: 8 con demanda demostrable arriba, 6 sin validar debajo.
 *
 * **Los slugs son representativos, no un volcado del space.** Este clon no tiene la credencial de
 * lectura de la CDA, así que no se pudieron leer los slugs exactos que quedaron publicados en
 * Storyblok; lo que está atado por test es el NEGOCIO (perfil, locales, carta, split de evidencia y
 * coste). Si algún día hace falta que coincidan uno a uno, se leen con `npm run demo -w renderer`.
 */
const PAGINAS: PaginaSeed[] = [
  // --- Respaldadas por datos de mercado (tienen volumen real) ---
  {
    slug: "/mejor-hamburguesa-madrid",
    keyword: "mejor hamburguesa madrid",
    secundarias: ["mejores hamburguesas madrid", "donde comer la mejor hamburguesa madrid"],
    tipo: "landing_local",
    estrategia: "hub",
    intencion: "transaccional",
    local: true,
    volumen: 2400,
    dificultad: 34,
    evidencia: "datos_mercado",
    score: 94.5,
    confianza: 0.9,
    seo: {
      title: "La mejor hamburguesa de Madrid | La Birra Bar",
      description:
        "La Golden Burger que hizo famosa a La Birra Bar, ahora en Madrid. Dos locales: Puerta del Sol y Salamanca.",
    },
    brief: {
      objetivo: "Página principal (hub) que capta la búsqueda genérica y reparte hacia los dos locales.",
      tono: "porteño, directo, orgulloso del producto",
      secciones: ["La Golden Burger", "Nuestros dos locales en Madrid", "Cómo llegar"],
    },
    faqs: ["¿Hace falta reservar?", "¿Dónde están los locales?", "¿Cuál es la hamburguesa insignia?"],
  },
  {
    slug: "/la-birra-bar-madrid",
    keyword: "la birra bar madrid",
    secundarias: ["la birra bar españa", "la birra bar sol"],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "navegacional",
    local: true,
    volumen: 1900,
    dificultad: 8,
    evidencia: "datos_mercado",
    score: 92.0,
    confianza: 0.88,
    seo: {
      title: "La Birra Bar Madrid | horarios, direcciones y carta",
      description:
        "La Birra Bar en Madrid: horarios, direcciones de los dos locales y la carta completa. De Buenos Aires a Madrid.",
    },
    brief: {
      objetivo: "Captar la búsqueda de MARCA: quien ya nos conoce y busca horario, dirección o carta.",
      tono: "informativo, sin vender lo que ya está vendido",
      secciones: ["Horarios de los dos locales", "Direcciones", "La carta"],
    },
    faqs: ["¿En qué horario abren?", "¿Tienen delivery?"],
  },
  {
    slug: "/hamburgueseria-madrid-centro",
    keyword: "hamburgueseria madrid centro",
    secundarias: ["hamburguesas centro madrid", "hamburgueseria sol madrid"],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: 1300,
    dificultad: 28,
    evidencia: "datos_mercado",
    score: 86.4,
    confianza: 0.85,
    seo: {
      title: "Hamburguesería en Madrid centro | La Birra Bar Puerta del Sol",
      description:
        "A un paso de la Puerta del Sol: hamburguesas de autor y cerveza artesanal de barril. Abierto todos los días.",
    },
    brief: {
      objetivo: "Captar la intención local del centro y llevarla al local de Carrera de San Jerónimo.",
      tono: "cercano, urbano",
      secciones: ["Dónde estamos", "Qué pedir la primera vez", "Horario"],
    },
    faqs: ["¿Están cerca del metro Sol?", "¿Hasta qué hora abren los fines de semana?"],
  },
  {
    slug: "/cerveza-artesanal-madrid",
    keyword: "cerveza artesanal madrid",
    secundarias: ["cerveza de barril madrid", "cervecería artesanal madrid centro"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 880,
    dificultad: 31,
    evidencia: "datos_mercado",
    score: 79.8,
    confianza: 0.81,
    seo: {
      title: "Cerveza artesanal de barril en Madrid | La Birra Bar",
      description:
        "Ale y Honey de Ogham, de barril y bien frías. La cerveza que acompaña a la Golden Burger.",
    },
    brief: {
      objetivo: "Aprovechar que la marca es 'la birra': la cerveza es producto, no acompañamiento.",
      tono: "cervecero, sin snobismo",
      secciones: ["Nuestras cervezas de barril", "Maridaje con la carta"],
    },
    faqs: ["¿Qué cervezas tienen de barril?", "¿Tienen cerveza sin alcohol?"],
  },
  {
    slug: "/hamburguesa-gourmet-madrid",
    keyword: "hamburguesa gourmet madrid",
    secundarias: ["hamburguesa de autor madrid", "hamburguesa premium madrid"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 720,
    dificultad: 22,
    evidencia: "datos_mercado",
    score: 77.2,
    confianza: 0.8,
    seo: {
      title: "Hamburguesa gourmet en Madrid | La Birra Bar",
      description:
        "Hamburguesas de autor con producto de temporada y salsas de la casa. La receta que ganó premios en Buenos Aires.",
    },
    brief: {
      objetivo: "Diferenciar por producto frente a la hamburguesa de cadena.",
      tono: "artesanal, con criterio",
      secciones: ["Qué hace gourmet a una hamburguesa", "Nuestra carta", "El pan y la carne"],
    },
    faqs: ["¿Qué carne usan?", "¿Tienen opción vegetariana?"],
  },
  {
    slug: "/hamburgueseria-barrio-salamanca",
    keyword: "hamburgueseria barrio salamanca",
    secundarias: ["hamburguesas salamanca madrid", "hamburgueseria ortega y gasset"],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: 390,
    dificultad: 18,
    evidencia: "datos_mercado",
    score: 74.0,
    confianza: 0.78,
    seo: {
      title: "Hamburguesería en el barrio de Salamanca | La Birra Bar",
      description:
        "En José Ortega y Gasset 79: la misma Golden Burger, en Salamanca. Cocina hasta tarde.",
    },
    brief: {
      objetivo: "Segunda landing local: el barrio de Salamanca busca por su propio nombre.",
      tono: "cercano, de barrio",
      secciones: ["Dónde estamos", "Horario del local", "Cómo llegar"],
    },
    faqs: ["¿Es el mismo menú que en el centro?", "¿Hasta qué hora sirven cocina?"],
  },
  {
    slug: "/hamburguesa-argentina-madrid",
    keyword: "hamburguesa argentina madrid",
    secundarias: ["hamburgueseria argentina madrid", "comida argentina madrid centro"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 260,
    dificultad: 15,
    evidencia: "datos_mercado",
    score: 71.5,
    confianza: 0.76,
    seo: {
      title: "Hamburguesa argentina en Madrid | La Birra Bar",
      description:
        "La hamburguesería porteña que cruzó el Atlántico. La receta de Buenos Aires, sin cambiarle nada.",
    },
    brief: {
      objetivo: "Captar la búsqueda por origen: el público argentino en Madrid y el curioso local.",
      tono: "porteño, con historia",
      secciones: ["De Buenos Aires a Madrid", "Qué mantiene la receta original"],
    },
    faqs: ["¿Es la misma de Buenos Aires?", "¿Tienen alfajores o postres argentinos?"],
  },
  {
    slug: "/hamburgueseria-puerta-del-sol",
    keyword: "hamburgueseria puerta del sol",
    secundarias: ["comer hamburguesa puerta del sol", "hamburgueseria san jeronimo"],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: 210,
    dificultad: 20,
    evidencia: "datos_mercado",
    score: 68.3,
    confianza: 0.74,
    seo: {
      title: "Hamburguesería en Puerta del Sol | La Birra Bar",
      description:
        "Carrera de San Jerónimo 3, a 200 metros de la Puerta del Sol. Abierto de 11:00 a 01:00.",
    },
    brief: {
      objetivo: "Long tail hiperlocal del centro: quien ya está en Sol y busca dónde comer.",
      tono: "práctico, resolutivo",
      secciones: ["Cómo llegar desde Sol", "Horario", "Qué pedir"],
    },
    faqs: ["¿Cuánto se tarda andando desde Sol?", "¿Hay que hacer cola?"],
  },
  // --- Sin validar (propuestas, pero sin datos de mercado que las respalden) ---
  {
    slug: "/patatas-fritas-especiales-madrid",
    keyword: "patatas fritas especiales madrid",
    secundarias: ["mejores patatas fritas madrid", "patatas con salsas madrid"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 57.0,
    confianza: 0.3,
    seo: {
      title: "Patatas fritas especiales | La Birra Bar Madrid",
      description: "Crocantes por fuera, con las salsas de la casa. El acompañamiento que nadie deja.",
    },
    brief: {
      objetivo: "Producto secundario con potencial de captación. SIN volumen de búsqueda que lo confirme.",
      tono: "apetitoso, directo",
      secciones: ["Cómo las hacemos", "Las salsas de la casa"],
    },
    faqs: ["¿Qué salsas tienen?", "¿Se pueden pedir para llevar?"],
  },
  {
    slug: "/hamburguesas-para-llevar-madrid",
    keyword: "hamburguesas para llevar madrid",
    secundarias: ["hamburguesa take away madrid centro", "pedir hamburguesa para llevar madrid"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 53.5,
    confianza: 0.28,
    seo: {
      title: "Hamburguesas para llevar en Madrid | La Birra Bar",
      description: "Pedí y llevate la Golden Burger. Take away en los dos locales de Madrid.",
    },
    brief: {
      objetivo: "Canal take away. Hipótesis comercial: no hay dato de volumen que la respalde.",
      tono: "funcional",
      secciones: ["Cómo pedir", "Tiempos de espera"],
    },
    faqs: ["¿Se puede pedir por teléfono?", "¿Cuánto tarda un pedido para llevar?"],
  },
  {
    slug: "/cenas-de-grupo-hamburgueseria-madrid",
    keyword: "cenas de grupo hamburgueseria madrid",
    secundarias: ["cena de empresa hamburguesas madrid", "restaurante para grupos madrid centro"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 49.0,
    confianza: 0.26,
    seo: {
      title: "Cenas de grupo en Madrid | La Birra Bar",
      description: "Mesas largas para grupos y cenas de empresa en el centro de Madrid y en Salamanca.",
    },
    brief: {
      objetivo: "Reservas de grupo (ticket alto). Sin volumen validado: es una apuesta comercial.",
      tono: "atento, orientado a eventos",
      secciones: ["Grupos y mesas largas", "Cómo reservar"],
    },
    faqs: ["¿A partir de cuántas personas?", "¿Se puede reservar el local completo?"],
  },
  {
    slug: "/como-se-hace-la-golden-burger",
    keyword: "como se hace la golden burger",
    secundarias: ["receta golden burger", "golden burger la birra bar"],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 46.5,
    confianza: 0.24,
    seo: {
      title: "Cómo se hace la Golden Burger (y por qué se hizo famosa)",
      description: "La hamburguesa que nos puso en el mapa: el pan, la carne, el orden de los ingredientes.",
    },
    brief: {
      objetivo: "Contenido de marca / autoridad. No apunta a una transacción directa ni tiene demanda medida.",
      tono: "editorial, con detalle de cocina",
      secciones: ["El origen", "Los ingredientes", "El montaje"],
    },
    faqs: ["¿Se puede hacer en casa?", "¿Qué lleva exactamente?"],
  },
  {
    slug: "/maridaje-cerveza-artesanal-hamburguesa",
    keyword: "maridaje cerveza artesanal hamburguesa",
    secundarias: ["qué cerveza va con hamburguesa", "maridar cerveza y hamburguesa"],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 43.0,
    confianza: 0.22,
    seo: {
      title: "Qué cerveza artesanal va con cada hamburguesa",
      description: "Guía corta de maridaje: Ale o Honey según lo que estés comiendo.",
    },
    brief: {
      objetivo: "Contenido de captación (blog) alrededor de la cerveza. Sin volumen validado.",
      tono: "didáctico, breve",
      secciones: ["Ale vs Honey", "Qué pedir según el plato"],
    },
    faqs: ["¿Cuál recomiendan para la Golden Burger?"],
  },
  {
    slug: "/historia-la-birra-bar-buenos-aires-madrid",
    keyword: "historia la birra bar",
    secundarias: ["la birra bar buenos aires", "origen la birra bar"],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 40.0,
    confianza: 0.2,
    seo: {
      title: "De Buenos Aires a Madrid: la historia de La Birra Bar",
      description: "Cómo una hamburguesería de barrio porteña terminó abriendo dos locales en Madrid.",
    },
    brief: {
      objetivo: "Contenido de marca. Refuerza la autenticidad, sin demanda de búsqueda medida.",
      tono: "narrativo, personal",
      secciones: ["El barrio", "El premio", "El salto a Madrid"],
    },
    faqs: ["¿Cuándo abrieron en Madrid?", "¿Siguen en Buenos Aires?"],
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
const DEMO_CLIENT_ID = "d3305eba-11a5-4e0e-9c1f-000000000001";
const DEMO_RUN_ID = "d3305eba-11a5-4e0e-9c1f-000000000002";

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
       values ($1, $2, $3, 'kr.v0.5', 'pending_approval', $4, 'ES', 'es', 2724, 309700,
               $5::jsonb, $6::jsonb)
       returning id`,
      [
        DEMO_RUN_ID,
        tenantId,
        clientId,
        PROMPT_DEMO,
        // 8 de 14 páginas con volumen ⇒ cobertura 0.571. Es cobertura por PÁGINA, no por keyword: la
        // corrida real analizó 55 keywords y ese desglose no quedó registrado en la acción 06.
        JSON.stringify({ cobertura_volumen: 0.571, keywords_con_volumen: 8, keywords_totales: 14 }),
        JSON.stringify({ max_cost_usd: 1.0, max_pages: 14 }),
      ],
    );
    const runId = run[0]!.id;

    // --- Las 14 páginas del brief ---
    for (const p of PAGINAS) {
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

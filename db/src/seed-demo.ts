import type { Ejecutor } from "./deploy.js";

/**
 * Seed de la demo de Fase 1: el caso de **Bella Napoli** pre-cargado para que el portal de Frank
 * tenga qué mostrar SIN el orquestador (que es Fase 2).
 *
 * Reproduce la corrida de la acción 06 (`docs/acciones/06-corrida-final-demo.md`): un run en
 * `pending_approval` con 8 páginas, **3 respaldadas por datos de mercado** y **5 `sin_validar`**. Ese
 * split es el argumento de venta del sistema —dice lo que NO sabe—, y es lo que el portal muestra en
 * ✅/⚠️. Las páginas nacen `approved = false`: la compuerta (ADR-06) la cruza Frank en vivo.
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
 * Las 8 páginas de la corrida de la acción 06. El orden y los números están elegidos para que la
 * demo cuente la historia honesta: 3 con demanda demostrable arriba, 5 sin validar debajo.
 */
const PAGINAS: PaginaSeed[] = [
  // --- Respaldadas por datos de mercado (tienen volumen real) ---
  {
    slug: "/restaurante-italiano-madrid-centro",
    keyword: "restaurante italiano madrid centro",
    secundarias: ["restaurante italiano centro madrid", "italiano madrid centro"],
    tipo: "landing_local",
    estrategia: "hub",
    intencion: "transaccional",
    local: true,
    volumen: 480,
    dificultad: 12,
    evidencia: "datos_mercado",
    score: 91.2,
    confianza: 0.86,
    seo: {
      title: "Restaurante italiano en Madrid centro | Trattoria Bella Napoli",
      description:
        "Cocina napolitana en el corazón de Madrid: pizza al horno de leña, pasta fresca y menú del día. Reservá tu mesa.",
    },
    brief: {
      objetivo: "Página principal (hub) que capta la búsqueda genérica y reparte hacia los servicios.",
      tono: "cercano, auténtico, napolitano",
      secciones: ["Quiénes somos", "La carta en 3 platos estrella", "Ubicación y reservas"],
    },
    faqs: ["¿Hacen falta reservas?", "¿Dónde están exactamente?", "¿Tienen menú del día?"],
  },
  {
    slug: "/pizza-napolitana-madrid",
    keyword: "pizza napolitana madrid",
    secundarias: ["pizza al horno de leña madrid", "auténtica pizza napolitana"],
    tipo: "landing_local",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: 390,
    dificultad: 18,
    evidencia: "datos_mercado",
    score: 84.5,
    confianza: 0.82,
    seo: {
      title: "Pizza napolitana en Madrid | horno de leña | Bella Napoli",
      description:
        "La verdadera pizza napolitana en Madrid: masa de fermentación lenta y horno de leña a 450°. Certificación STG.",
    },
    brief: {
      objetivo: "Captar la intención transaccional de quien busca pizza napolitana específicamente.",
      tono: "orgulloso del producto",
      secciones: ["El horno de leña", "La masa de 48h", "Nuestras pizzas"],
    },
    faqs: ["¿Es masa madre?", "¿Tienen opción sin gluten?", "¿Hacen delivery?"],
  },
  {
    slug: "/pasta-fresca-madrid",
    keyword: "pasta fresca madrid",
    secundarias: ["pasta artesanal madrid", "pasta casera italiana"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: 210,
    dificultad: 14,
    evidencia: "datos_mercado",
    score: 76.0,
    confianza: 0.79,
    seo: {
      title: "Pasta fresca artesanal en Madrid | Trattoria Bella Napoli",
      description:
        "Pasta fresca hecha cada día en casa: tagliatelle, ravioli y ñoquis. La receta de la nonna, en Madrid.",
    },
    brief: {
      objetivo: "Diferenciar por producto artesanal frente a la pasta industrial de la competencia.",
      tono: "artesanal, de tradición familiar",
      secciones: ["Hecha a diario", "Nuestras pastas", "Maridajes"],
    },
    faqs: ["¿La hacen ustedes?", "¿Tienen platos veganos?"],
  },
  // --- Sin validar (propuestas, pero sin datos de mercado que las respalden) ---
  {
    slug: "/menu-del-dia-italiano-madrid",
    keyword: "menú del día italiano madrid",
    secundarias: ["menú mediodía italiano", "almuerzo italiano madrid"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "comercial",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 58.0,
    confianza: 0.3,
    seo: {
      title: "Menú del día italiano en Madrid centro | Bella Napoli",
      description: "Menú del día casero de lunes a viernes: entrante, principal, postre y bebida.",
    },
    brief: {
      objetivo: "Captar el público de oficina del mediodía. SIN datos de volumen que lo confirmen.",
      tono: "práctico, cotidiano",
      secciones: ["El menú de esta semana", "Horario y precio"],
    },
    faqs: ["¿Qué incluye el menú?", "¿Hasta qué hora sirven el menú del día?"],
  },
  {
    slug: "/cenas-para-grupos-madrid",
    keyword: "cenas para grupos madrid",
    secundarias: ["restaurante para grupos madrid centro", "cena de empresa italiano"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 52.0,
    confianza: 0.28,
    seo: {
      title: "Cenas para grupos en Madrid | menús cerrados | Bella Napoli",
      description: "Menús cerrados para grupos, cenas de empresa y celebraciones en el centro de Madrid.",
    },
    brief: {
      objetivo: "Reservas de grupo (ticket alto). Hipótesis comercial sin volumen de búsqueda validado.",
      tono: "atento, orientado a eventos",
      secciones: ["Menús de grupo", "Salón privado", "Reservá tu evento"],
    },
    faqs: ["¿A partir de cuántas personas?", "¿Tienen salón privado?"],
  },
  {
    slug: "/brunch-fin-de-semana-madrid",
    keyword: "brunch fin de semana madrid",
    secundarias: ["brunch italiano madrid", "brunch domingo madrid centro"],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 47.5,
    confianza: 0.25,
    seo: {
      title: "Brunch de fin de semana en Madrid: nuestra propuesta italiana",
      description: "Un brunch con acento italiano los sábados y domingos. Ideas, horarios y qué esperar.",
    },
    brief: {
      objetivo: "Contenido de captación (blog). No apunta a una transacción directa ni tiene demanda medida.",
      tono: "editorial, inspiracional",
      secciones: ["Qué es un brunch italiano", "Nuestra propuesta"],
    },
    faqs: ["¿Qué días hay brunch?", "¿Hace falta reservar para el brunch?"],
  },
  {
    slug: "/mejores-trattorias-madrid",
    keyword: "mejores trattorias madrid",
    secundarias: ["trattoria auténtica madrid", "dónde comer italiano madrid"],
    tipo: "blog",
    estrategia: "single",
    intencion: "informacional",
    local: false,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 44.0,
    confianza: 0.22,
    seo: {
      title: "Qué hace auténtica a una trattoria (y cómo reconocerla en Madrid)",
      description: "Guía honesta para distinguir una trattoria auténtica de una italiana de cadena.",
    },
    brief: {
      objetivo: "Contenido de marca / autoridad. Sin volumen validado: es una apuesta de posicionamiento.",
      tono: "didáctico, con criterio",
      secciones: ["Qué es una trattoria", "5 señales de autenticidad"],
    },
    faqs: ["¿Qué diferencia una trattoria de un ristorante?"],
  },
  {
    slug: "/reservar-mesa-restaurante-italiano",
    keyword: "reservar mesa restaurante italiano",
    secundarias: ["reservar italiano madrid", "reserva online restaurante italiano"],
    tipo: "servicio",
    estrategia: "spoke",
    intencion: "transaccional",
    local: true,
    volumen: null,
    dificultad: null,
    evidencia: "sin_validar",
    score: 40.0,
    confianza: 0.2,
    seo: {
      title: "Reservá tu mesa | Trattoria Bella Napoli, Madrid centro",
      description: "Reservá online tu mesa en Bella Napoli. Confirmación inmediata.",
    },
    brief: {
      objetivo: "Página de conversión. La keyword genérica no muestra volumen local demostrable.",
      tono: "directo, funcional",
      secciones: ["Formulario de reserva", "Horarios"],
    },
    faqs: ["¿Puedo reservar para hoy mismo?", "¿Puedo cancelar la reserva?"],
  },
];

/**
 * El perfil del negocio. La `brand` (color/fuente/logo) es lo que hace que la web salga con marca
 * propia y no con el rojo por defecto (0009): entra en la allowlist `business_profile_publico` que
 * lee el renderizador en Fase 2. El NAP alimenta el JSON-LD público.
 */
const PERFIL_BELLA_NAPOLI = {
  name: "Trattoria Bella Napoli",
  telephone: "+34 910 000 000",
  priceRange: "€€",
  url: "https://bellanapoli.example",
  opening_hours: "Ma-Do 13:00-16:00, 20:00-23:30",
  address: {
    streetAddress: "Calle de la Cava Baja, 20",
    addressLocality: "Madrid",
    postalCode: "28005",
    addressRegion: "Madrid",
    addressCountry: "ES",
  },
  brand: { color: "#1f7a3d", font: "Fraunces", logo: "https://bellanapoli.example/logo.svg" },
};

/**
 * Siembra (o re-siembra) el caso de Bella Napoli. Idempotente: el tenant se upserta por slug, el
 * cliente y las membresías por sus claves naturales, y el run de demo se **borra y recrea** para que
 * re-correr el seed refresque el contenido sin acumular duplicados.
 *
 * Todo dentro de UNA transacción: si algo falla, la base queda como estaba (no a medio sembrar).
 */
export async function sembrarBellaNapoli(
  ej: Ejecutor,
  opts: OpcionesSeed,
): Promise<ResultadoSeed> {
  await ej.exec("begin");
  try {
    // --- Tenant (upsert por slug) ---
    const { rows: t } = await ej.query<{ id: string }>(
      `insert into tenants (nombre, slug) values ('AMG Madrid', 'amg')
       on conflict (slug) do update set nombre = excluded.nombre
       returning id`,
    );
    const tenantId = t[0]!.id;

    // --- Cliente (find-or-create por nombre dentro del tenant; no hay unique natural) ---
    const { rows: existente } = await ej.query<{ id: string }>(
      "select id from clients where tenant_id = $1 and nombre = $2",
      [tenantId, "Trattoria Bella Napoli"],
    );
    let clientId: string;
    if (existente[0]) {
      clientId = existente[0].id;
      await ej.query("update clients set business_profile = $2 where id = $1", [
        clientId,
        JSON.stringify(PERFIL_BELLA_NAPOLI),
      ]);
    } else {
      const { rows: c } = await ej.query<{ id: string }>(
        `insert into clients (tenant_id, nombre, prompt_negocio, business_profile)
         values ($1, $2, $3, $4) returning id`,
        [
          tenantId,
          "Trattoria Bella Napoli",
          "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, menú del día, cenas para grupos y brunch de fin de semana.",
          JSON.stringify(PERFIL_BELLA_NAPOLI),
        ],
      );
      clientId = c[0]!.id;
    }

    // --- Membresías (upsert por (tenant_id, user_id)). maestro/equipo => client_id NULL (la
    // constraint cliente_exige_client_id lo exige). El rol se DERIVA de acá, no se declara. ---
    for (const [userId, rol] of [
      [opts.frankUserId, "maestro"],
      [opts.juanUserId, "equipo"],
    ] as const) {
      await ej.query(
        `insert into memberships (tenant_id, user_id, rol, client_id)
         values ($1, $2, $3::user_role, null)
         on conflict (tenant_id, user_id) do update set rol = excluded.rol, client_id = null`,
        [tenantId, userId, rol],
      );
    }

    // --- El run de demo: borrar el anterior (cascada a páginas) y recrear ---
    await ej.query("delete from kr_runs where client_id = $1", [clientId]);

    const { rows: run } = await ej.query<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, status, prompt,
                            market_country, market_language, market_location_code,
                            coste_micros_usd, calidad_datos, config)
       values ($1, $2, 'kr.v0.5', 'pending_approval', $3, 'ES', 'es', 2724, 310800,
               $4::jsonb, $5::jsonb)
       returning id`,
      [
        tenantId,
        clientId,
        "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, menú del día, cenas para grupos y brunch de fin de semana.",
        // 3 de 8 páginas con volumen ⇒ cobertura 0.375, coherente con "cobertura volumen > 0" de la acción 06.
        JSON.stringify({ cobertura_volumen: 0.375, keywords_con_volumen: 3, keywords_totales: 8 }),
        JSON.stringify({ max_cost_usd: 1.0, max_pages: 8 }),
      ],
    );
    const runId = run[0]!.id;

    // --- Las 8 páginas del brief ---
    for (const p of PAGINAS) {
      await ej.query(
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

    await ej.exec("commit");
    return { tenantId, clientId, runId };
  } catch (e) {
    await ej.exec("rollback");
    throw e;
  }
}

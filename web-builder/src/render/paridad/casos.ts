import type { BusinessProfile, NavItem, Story } from "../../types.js";
import { perfilConManual, perfilLegacy, validProfile } from "../../fixtures.js";
import { renderBlogIndex, renderHome, renderMenu, renderStory } from "../html.js";

/**
 * Los casos del **gate de paridad** de la entrega 2 de la spec de plantillas de landing.
 *
 * ## Para qué existe este archivo
 *
 * La entrega 2 reorganiza el render entero —cuatro funciones que hoy repiten su propio `<!doctype>`,
 * `<head>`, `<style>` y footer pasan a ser cuatro recetas del mismo ensamblador— y su gate es que
 * **el sitio no cambie**. Eso solo se puede comprobar contra una foto del HTML de ANTES, y una foto
 * sacada después del refactor no prueba nada: mediría el resultado contra sí mismo.
 *
 * Por eso el orden importa y está fijado por proceso: primero se capturan las fixtures
 * (`npm run capturar:paridad -w web-builder`), se commitean, y recién entonces se toca `html.ts`.
 *
 * ## Qué se compara, y qué no
 *
 * **No** es paridad byte a byte del HTML: el objetivo del refactor es reorganizar clases y
 * envoltorios, así que exigir bytes idénticos sería exigir que no se haga el trabajo. Se comparan las
 * cuatro cosas que un cambio de presentación NO puede alterar —el texto visible, los `href`, los `id`
 * de ancla— y el **JSON-LD sí byte a byte**, porque no tiene ningún motivo para cambiar: es un
 * contrato con Google, no markup.
 *
 * ## Por qué estos casos
 *
 * Los cuatro puntos de entrada × las tres formas de ficha que existen hoy en producción. La ficha
 * legacy `{color, font}` está porque es la que tienen TODAS las webs sembradas y es la única
 * regresión que el manual de marca puede causar; la ausencia de perfil está porque el renderizador
 * sirve dominios cuya fila puede no tener ficha, y ahí el documento tiene que salir válido igual.
 */

export interface CasoParidad {
  /** Nombre del archivo de fixture, sin extensión. Estable: es la identidad del caso. */
  nombre: string;
  /** Qué comprueba este caso y por qué está en la lista. Sale en el informe cuando falla. */
  porQue: string;
  render(): string;
}

/** Una story de landing con las tres clases de blok, para que el traslado de cada pieza se note. */
function storyLanding(): Story {
  return {
    name: "Restaurante italiano en Madrid Centro",
    slug: "restaurante-italiano-madrid-centro",
    content: {
      component: "page",
      seo: {
        title: "Restaurante Italiano en Madrid Centro",
        description: "Auténtica cocina napolitana en el corazón de Madrid.",
        canonical: "/restaurante-italiano-madrid-centro",
        og_title: "Restaurante Italiano en Madrid Centro",
        og_description: "Auténtica cocina napolitana en el corazón de Madrid.",
      },
      schema_type: "LocalBusiness",
      page_type: "landing_local",
      intent: "local",
      is_local: true,
      // `meta` es obligatorio y va entero: alimenta el `<script id="research-trace">`, que es parte
      // del HTML emitido y por tanto del gate. Con métricas presentes y no `null`, porque el caso
      // "sin datos de mercado" ya tiene su propio test en la suite de render.
      meta: {
        contract_version: "web.v0.1",
        source_keyword: "restaurante italiano madrid centro",
        secondary_keywords: ["pizza napolitana madrid", "pasta fresca madrid"],
        internal_links: ["/menu", "/reservas"],
        word_count_objetivo: 1100,
        tono: "Cercano y profesional",
        claims_permitidos: ["ingredientes frescos"],
        claims_prohibidos: ["el mejor de Madrid"],
        opportunity_score: 78,
        volumen: 1200,
        dificultad: 25,
        evidencia: "datos_mercado",
        score_confidence: 0.82,
      },
      body: [
        {
          component: "hero",
          headline: "Restaurante italiano en Madrid Centro",
          subhead: "Masa de fermentación lenta y producto de temporada.",
          cta_label: "Reserva tu mesa",
        },
        {
          component: "section",
          heading: "Nuestra cocina",
          body: "Trabajamos con harinas ecológicas y una fermentación de 48 horas.",
        },
        {
          component: "section",
          heading: "El comedor",
          body: "Treinta cubiertos, cocina a la vista y horno de leña.",
        },
        {
          component: "faq",
          items: [
            { question: "¿Hacen reservas?", answer: "Sí, por teléfono y en la web." },
            { question: "¿Tienen opciones sin gluten?", answer: "Sí, la masa sin gluten se pide con un día." },
          ],
        },
      ],
    },
  };
}

const NAV: NavItem[] = [
  { name: "Restaurante italiano en Madrid Centro", slug: "restaurante-italiano-madrid-centro" },
  { name: "Pizzería en Chamberí", slug: "pizzeria-chamberi" },
];

const POSTS: NavItem[] = [
  { name: "Cómo elegimos la harina", slug: "blog/como-elegimos-la-harina" },
  { name: "Qué es la fermentación lenta", slug: "blog/fermentacion-lenta" },
];

/** El perfil "de siempre": sin fotos ni manual de marca. Es lo que hay hoy en producción. */
function perfilBase(): BusinessProfile {
  return validProfile({
    menu: [
      { category: "Pizzas", name: "Margherita", description: "Tomate, mozzarella y albahaca.", price: "12,50 €" },
      { category: "Pizzas", name: "Diavola", description: "Salami picante.", price: "14,00 €" },
      { category: "Pastas", name: "Cacio e pepe", description: "Pecorino y pimienta.", price: "13,00 €" },
    ],
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Calle Mayor 12", addressLocality: "Madrid", postalCode: "28013" },
        telephone: "+34 911 23 45 67",
        opening_hours: "Mar-Dom 13:00-16:00, 20:00-23:30",
      },
      {
        name: "Chamberí",
        address: { streetAddress: "Calle Zurbano 40", addressLocality: "Madrid" },
        opening_hours: "Mar-Sáb 20:00-23:30",
      },
    ],
  });
}

export const CASOS: CasoParidad[] = [
  {
    nombre: "landing-perfil-base",
    porQue: "El caso central: una landing publicada con hero, dos secciones y FAQ, y la ficha que hay hoy en producción.",
    render: () => renderStory(storyLanding(), perfilBase(), "es", true),
  },
  {
    nombre: "landing-sin-perfil",
    porQue: "El renderizador sirve dominios cuya fila puede no tener ficha. El documento tiene que salir válido igual, sin contacto ni NAP.",
    render: () => renderStory(storyLanding(), null, "es", false),
  },
  {
    nombre: "landing-perfil-legacy",
    porQue: "La marca `{color, font}` que tienen TODAS las webs sembradas: la única regresión que el manual de marca puede causar.",
    render: () => renderStory(storyLanding(), perfilLegacy(), "es", true),
  },
  {
    nombre: "landing-perfil-con-manual",
    // ⚠️ **La única fixture retocada a mano desde que se capturó, y esto es lo que se retocó.**
    //
    // La mitad C de la entrega 3 añade `<link rel="preload" as="font" … crossorigin>` en el `<head>`
    // cuando la ficha pide una familia self-hosted, y esta es la única ficha del gate que lo hace
    // (`fuentes.titulo: "condensada"` → Oswald). El `href` del preload cae dentro de `hrefsDe`, así que
    // esa cara de la huella cambió **por un cambio deliberado**, no por un refactor descuidado.
    //
    // Se añadió ESA LÍNEA a la fixture y nada más — no se re-capturó: re-capturar habría sobrescrito
    // las diez con la foto de "después" y el gate pasaría a compararse contra sí mismo. Las otras
    // cuatro caras (texto visible, `id`, JSON-LD y traza de research) siguen siendo las de antes del
    // refactor, byte a byte, y las nueve fixturas restantes están intactas.
    //
    // Que el preload apunte a la familia y al peso correctos, que lleve `crossorigin` y que sea uno
    // solo lo fijan sus propios tests en `shell.test.ts`; el gate solo comprueba que no aparezca ni
    // desaparezca por accidente.
    porQue: "Ficha con el manual de marca y fotos de la entrega 1. Desde la entrega 3 el render SÍ los consume: lo que el gate sigue exigiendo es que el texto, las anclas y el JSON-LD no se muevan por ello.",
    render: () => renderStory(storyLanding(), perfilConManual(), "es", true),
  },
  {
    nombre: "home-sintetizada",
    porQue: "La raíz del sitio, que no es una story: se sintetiza del perfil más el índice de páginas publicadas.",
    render: () => renderHome(perfilBase(), NAV, "es", true),
  },
  {
    nombre: "home-sin-paginas",
    porQue: "Un cliente recién dado de alta: la home existe y anuncia que todavía no hay páginas, en vez de dar 404.",
    render: () => renderHome(perfilBase(), [], "es", false),
  },
  {
    nombre: "menu-agrupado",
    porQue: "`/menu` sintetizado del perfil, con su JSON-LD `Menu` y las categorías agrupadas.",
    render: () => renderMenu(perfilBase(), "es", true),
  },
  {
    nombre: "menu-sin-categorias",
    porQue: "Platos sin `category`: van juntos al final, y el agrupador no puede inventar un encabezado.",
    render: () =>
      renderMenu(
        validProfile({ menu: [{ name: "Plato del día", price: "s/ mercado" }, { name: "Postre de la casa" }] }),
        "es",
        false,
      ),
  },
  {
    nombre: "blog-con-posts",
    porQue: "El índice del blog con sus tarjetas enlazadas.",
    render: () => renderBlogIndex(perfilBase(), POSTS, "es"),
  },
  {
    nombre: "blog-vacio",
    porQue: "El blog sin artículos: no se autoenlaza en el pie y no queda una tarjeta fantasma.",
    render: () => renderBlogIndex(perfilBase(), [], "es"),
  },
];

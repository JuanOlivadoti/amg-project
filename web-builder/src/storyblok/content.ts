import { stableUid } from "../lib/uid.js";
import type {
  Blok,
  FaqBlok,
  HeroBlok,
  Imagen,
  PageContent,
  PageType,
  SchemaType,
  SearchIntent,
  SectionBlok,
  Story,
} from "../types.js";

/** El campo `asset` de Storyblok que corresponde a una imagen: `{filename, alt}` (o vacío). */
function assetDe(img: Imagen | undefined): Record<string, unknown> | undefined {
  return img && img.src ? { filename: img.src, alt: img.alt ?? "" } : undefined;
}

/** El inverso: un asset de Storyblok → `Imagen`, o `undefined` si está vacío/mal formado. */
function imagenDe(raw: unknown): Imagen | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const src = typeof a["filename"] === "string" ? a["filename"] : "";
  if (!src) return undefined; // un asset vacío (`{filename:null}`) no es una imagen
  return { src, alt: typeof a["alt"] === "string" ? a["alt"] : "" };
}

/**
 * Transforma el contenido canónico (limpio, agnóstico) al formato que espera Storyblok:
 *  - cada blok lleva `_uid` (requerido por el Visual Editor),
 *  - el `seo` (objeto) se aplana a `seo_title` / `seo_description` (campos del componente `page`),
 *  - los items de FAQ pasan a ser bloks `faq_item` anidados.
 *
 * Así el contrato de bloks (types.ts) queda limpio y toda la "storyblok-idad" vive acá.
 */
export function toStoryblokContent(story: Story): Record<string, unknown> {
  const c = story.content;
  // Los _uid son deterministas (#12): se derivan del slug + la identidad natural de cada blok,
  // así una republicación del mismo contenido produce exactamente los mismos _uid.
  const slug = story.slug;
  return {
    component: "page",
    _uid: stableUid(slug, "page"),
    seo_title: c.seo.title,
    seo_description: c.seo.description,
    // #13: preservar canonical, OG, contrato editorial y traza; antes se perdían en Storyblok.
    seo_canonical: c.seo.canonical,
    og_title: c.seo.og_title,
    og_description: c.seo.og_description,
    schema_type: c.schema_type,
    page_type: c.page_type,
    intent: c.intent,
    is_local: c.is_local,
    internal_links: (c.meta.internal_links ?? []).join("\n"),
    claims_permitidos: (c.meta.claims_permitidos ?? []).join("\n"),
    claims_prohibidos: (c.meta.claims_prohibidos ?? []).join("\n"),
    source_keyword: c.meta.source_keyword,
    body: c.body.map((b) => shapeBlok(b, slug)),
  };
}

/**
 * Identidad natural de cada blok (lo que lo hace "ese" blok y no otro):
 *  - hero: hay uno solo por página,
 *  - section: su heading,
 *  - faq: hay una sola; cada item, su pregunta.
 */
function shapeBlok(blok: HeroBlok | SectionBlok | FaqBlok, slug: string): Record<string, unknown> {
  switch (blok.component) {
    case "hero":
      return {
        component: "hero",
        _uid: stableUid(slug, "hero"),
        headline: blok.headline,
        subhead: blok.subhead,
        cta_label: blok.cta_label ?? "",
        ...(assetDe(blok.image) ? { image: assetDe(blok.image) } : {}),
      };
    case "section":
      return {
        component: "section",
        _uid: stableUid(slug, "section", blok.heading),
        heading: blok.heading,
        body: blok.body,
        ...(assetDe(blok.image) ? { image: assetDe(blok.image) } : {}),
      };
    case "faq":
      return {
        component: "faq",
        _uid: stableUid(slug, "faq"),
        items: blok.items.map((it) => ({
          component: "faq_item",
          _uid: stableUid(slug, "faq_item", it.question),
          question: it.question,
          answer: it.answer,
        })),
      };
  }
}

/**
 * Fusiona una story recién generada con la que ya existe en Storyblok, **preservando las imágenes**
 * que el nuevo contenido no trae.
 *
 * ## Por qué existe
 *
 * El handoff (`briefToStories`) nunca pone `image` en un `hero`/`section`: el comentario de
 * `HeroBlok.image` ya lo decía — "la sube el cliente en el Visual Editor; el handoff la deja vacía".
 * Y `updateStory` hace un `PUT /stories/:id` con `content` **completo**: Storyblok no fusiona el JSON,
 * lo reemplaza entero. Sin este paso, republicar la misma página (un research nuevo, un reintento del
 * orquestador) mandaba un body sin `image` y Storyblok se quedaba sin la foto que el cliente acababa
 * de subir — sin error, sin log, hasta que alguien la buscaba y no estaba.
 *
 * ## La regla
 *
 * **Lo nuevo manda.** Si `nuevo` ya trae una imagen (hoy el pipeline nunca lo hace, pero el contrato no
 * lo prohíbe), esa es la que queda — nunca se resucita una vieja por encima de una decisión explícita.
 * Solo se copia la imagen de `existente` cuando `nuevo` la dejó vacía.
 *
 * La identidad de cada blok es la misma que usan los `_uid` deterministas (`lib/uid.ts`): el hero es
 * único por página, una sección se identifica por su `heading`. Si el heading cambió, es
 * conceptualmente OTRO blok — no hereda la imagen del que ya no está.
 */
export function preservarImagenes(nuevo: Story, existente: Story): Story {
  const heroExistente = existente.content.body.find(
    (b): b is HeroBlok => b.component === "hero",
  );
  const seccionesExistentes = new Map(
    existente.content.body
      .filter((b): b is SectionBlok => b.component === "section")
      .map((b) => [b.heading, b] as const),
  );

  const body = nuevo.content.body.map((b): Blok => {
    if (b.component === "hero") {
      if (b.image || !heroExistente?.image) return b;
      return { ...b, image: heroExistente.image };
    }
    if (b.component === "section") {
      if (b.image) return b;
      const previa = seccionesExistentes.get(b.heading);
      if (!previa?.image) return b;
      return { ...b, image: previa.image };
    }
    return b;
  });

  return { ...nuevo, content: { ...nuevo.content, body } };
}

// ---------------------------------------------------------------- el viaje de vuelta

/**
 * El INVERSO de `toStoryblokContent`: del contenido tal como lo guarda Storyblok, de vuelta a la
 * `Story` que consume `renderStory`.
 *
 * ## Por qué esto existe (y por qué no existía)
 *
 * `toStoryblokContent` **aplana** el contenido para Storyblok: `seo` (objeto) se parte en `seo_title`
 * / `seo_description` / etc., y las FAQs pasan a bloks `faq_item`. `renderStory`, en cambio, espera la
 * forma canónica anidada (`content.seo.title`, `content.body` con `hero`/`section`/`faq`).
 *
 * Mientras **nadie leyó de vuelta** lo publicado (OBS-03: no había renderizador), la asimetría no
 * molestaba. En cuanto el renderizador (ADR-19) lee la Content Delivery API y le pasa el contenido a
 * `renderStory`, la forma **no calza**: `c.seo` es `undefined` → `c.seo.title` explota. Lo cazó la
 * demo contra el space real, no los tests — porque los tests armaban `Story` a mano y salteaban el
 * ida-y-vuelta `toStoryblokContent → Storyblok → renderStory`. La lección de siempre: el bug vive en
 * la costura que ningún test cruzaba.
 *
 * ## Lo que se puede reconstruir y lo que no
 *
 * El aplanado es **con pérdida**: Storyblok no guarda casi nada de `meta` (volumen, dificultad,
 * opportunity_score, word_count…). Eso está bien — `renderStory` los usa solo para el bloque de
 * traza (un `<script>` oculto). Se rellenan con valores neutros; la página sale igual.
 */
export function fromStoryblokContent(raw: {
  name?: unknown;
  slug?: unknown;
  content?: Record<string, unknown>;
}): Story {
  const c = raw.content ?? {};
  const s = (k: string): string => (typeof c[k] === "string" ? (c[k] as string) : "");
  const lista = (k: string): string[] =>
    typeof c[k] === "string" && c[k] ? (c[k] as string).split("\n").filter(Boolean) : [];

  const content: PageContent = {
    component: "page",
    seo: {
      title: s("seo_title"),
      description: s("seo_description"),
      canonical: s("seo_canonical"),
      og_title: s("og_title"),
      og_description: s("og_description"),
    },
    schema_type: (s("schema_type") || "WebPage") as SchemaType,
    page_type: (s("page_type") || "servicio") as PageType,
    intent: (s("intent") || "informational") as SearchIntent,
    is_local: c["is_local"] === true,
    body: Array.isArray(c["body"]) ? (c["body"] as unknown[]).map(desShapeBlok).filter((b): b is Blok => b !== null) : [],
    meta: {
      contract_version: "web.v0.1",
      source_keyword: s("source_keyword"),
      secondary_keywords: [],
      internal_links: lista("internal_links"),
      word_count_objetivo: 0,
      claims_permitidos: lista("claims_permitidos"),
      claims_prohibidos: lista("claims_prohibidos"),
      opportunity_score: 0,
      volumen: null,
      dificultad: null,
    },
  };

  return {
    name: typeof raw.name === "string" ? raw.name : content.seo.title,
    slug: typeof raw.slug === "string" ? raw.slug : "",
    content,
  };
}

/** Un blok guardado (con `_uid`, `_editable`, componentes anidados) → el blok canónico, o `null`. */
function desShapeBlok(raw: unknown): Blok | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const str = (k: string): string => (typeof b[k] === "string" ? (b[k] as string) : "");

  switch (b["component"]) {
    case "hero": {
      const hero: HeroBlok = { component: "hero", headline: str("headline"), subhead: str("subhead") };
      if (str("cta_label")) hero.cta_label = str("cta_label");
      const img = imagenDe(b["image"]);
      if (img) hero.image = img;
      return hero;
    }
    case "section": {
      const sec: SectionBlok = { component: "section", heading: str("heading"), body: str("body") };
      const img = imagenDe(b["image"]);
      if (img) sec.image = img;
      return sec;
    }
    case "faq": {
      const items = Array.isArray(b["items"]) ? (b["items"] as unknown[]) : [];
      return {
        component: "faq",
        items: items
          .map((it) => (it && typeof it === "object" ? (it as Record<string, unknown>) : null))
          .filter((it): it is Record<string, unknown> => it !== null)
          .map((it) => ({
            question: typeof it["question"] === "string" ? it["question"] : "",
            answer: typeof it["answer"] === "string" ? it["answer"] : "",
          })),
      };
    }
    default:
      return null; // un blok desconocido no rompe la página: se ignora
  }
}

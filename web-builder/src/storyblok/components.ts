// Esquemas de los componentes de Storyblok que representan el contrato de bloks.
// Se provisionan una sola vez por space (setup-storyblok) para que el Visual Editor
// sepa renderizar/editar page > hero/section/faq > faq_item.

export interface StoryblokComponent {
  name: string;
  display_name: string;
  is_root: boolean;
  is_nestable: boolean;
  schema: Record<string, unknown>;
}

const INTENT_OPTIONS = ["transactional", "commercial", "local", "informational", "navigational"].map(
  (v) => ({ name: v, value: v }),
);
const SCHEMA_TYPE_OPTIONS = ["LocalBusiness", "Article", "FAQPage", "WebPage"].map((v) => ({
  name: v,
  value: v,
}));
const PAGE_TYPE_OPTIONS = ["servicio", "landing_local", "blog", "institucional"].map((v) => ({
  name: v,
  value: v,
}));

export const COMPONENT_SCHEMAS: StoryblokComponent[] = [
  {
    name: "page",
    display_name: "Página",
    is_root: true,
    is_nestable: false,
    schema: {
      body: {
        type: "bloks",
        pos: 0,
        restrict_components: true,
        component_whitelist: ["hero", "section", "faq"],
      },
      seo_title: { type: "text", pos: 1 },
      seo_description: { type: "textarea", pos: 2 },
      seo_canonical: { type: "text", pos: 3 },
      og_title: { type: "text", pos: 4 },
      og_description: { type: "textarea", pos: 5 },
      schema_type: { type: "option", pos: 6, use_uuid: false, options: SCHEMA_TYPE_OPTIONS },
      page_type: { type: "option", pos: 7, options: PAGE_TYPE_OPTIONS },
      intent: { type: "option", pos: 8, options: INTENT_OPTIONS },
      is_local: { type: "boolean", pos: 9 },
      // Contrato editorial + enlazado interno (una línea por valor). Preserva lo aprobado.
      internal_links: { type: "textarea", pos: 10 },
      claims_permitidos: { type: "textarea", pos: 11 },
      claims_prohibidos: { type: "textarea", pos: 12 },
      // Trazabilidad hacia el research (no editable en la práctica).
      source_keyword: { type: "text", pos: 13 },
    },
  },
  {
    name: "hero",
    display_name: "Hero",
    is_root: false,
    is_nestable: true,
    schema: {
      headline: { type: "text", pos: 0 },
      subhead: { type: "textarea", pos: 1 },
      cta_label: { type: "text", pos: 2 },
    },
  },
  {
    name: "section",
    display_name: "Sección",
    is_root: false,
    is_nestable: true,
    schema: {
      heading: { type: "text", pos: 0 },
      body: { type: "textarea", pos: 1 },
    },
  },
  {
    name: "faq",
    display_name: "FAQ",
    is_root: false,
    is_nestable: true,
    schema: {
      items: {
        type: "bloks",
        pos: 0,
        restrict_components: true,
        component_whitelist: ["faq_item"],
      },
    },
  },
  {
    name: "faq_item",
    display_name: "Pregunta FAQ",
    is_root: false,
    is_nestable: true,
    schema: {
      question: { type: "text", pos: 0 },
      answer: { type: "textarea", pos: 1 },
    },
  },
];

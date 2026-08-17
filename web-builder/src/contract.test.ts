import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseBrief,
  parseProfile,
  menuItemSchema,
  menuCategoriaSchema,
  MAX_ITEMS_CARTA,
  menuPatchSchema,
} from "./contract.js";
import { perfilConManual, perfilLegacy, validBrief, validPage, validProfile } from "./fixtures.js";

test("#3 parseBrief: acepta un brief válido kr.v0.2", () => {
  const b = parseBrief(validBrief());
  assert.equal(b.paginas_propuestas.length, 1);
});

test("#3 parseBrief: rechaza schema_version no soportada", () => {
  assert.throws(() => parseBrief(validBrief({ schema_version: "kr.v9" })), /no soportada/);
});

test("#3 parseBrief: rechaza página malformada (content_brief null)", () => {
  const bad = validBrief({ paginas_propuestas: [{ content_brief: null } as never] });
  assert.throws(() => parseBrief(bad), /Brief inválido/);
});

test("#3 parseBrief: rechaza intención fuera del enum", () => {
  const bad = validBrief({ paginas_propuestas: [validPage({ intencion: "xxx" as never })] });
  assert.throws(() => parseBrief(bad), /Brief inválido/);
});

test("#14 parseProfile: acepta un perfil válido", () => {
  assert.equal(parseProfile(validProfile()).name, "Trattoria Bella Napoli");
});

test("#14 parseProfile: rechaza url inválida (no disfraza corrupción)", () => {
  assert.throws(() => parseProfile(validProfile({ url: "no-es-una-url" })), /inválido/);
});

test("#14 parseProfile: rechaza name faltante", () => {
  assert.throws(() => parseProfile({ telephone: "+34 900" } as never), /inválido/);
});

test("parseProfile: acepta una marca válida (hex + fuente allowlist + logo)", () => {
  const p = parseProfile(validProfile({ brand: { color: "#0a7d34", font: "serif", logo: "https://cdn.ej/l.png" } }));
  assert.equal(p.brand?.color, "#0a7d34");
  assert.equal(p.brand?.font, "serif");
});

test("🔴 parseProfile: rechaza un color que no es hex (superficie de inyección CSS)", () => {
  assert.throws(() => parseProfile(validProfile({ brand: { color: "red;}body{}" } as never })), /inválido/);
});

test("🔴 parseProfile: rechaza una fuente fuera de la allowlist", () => {
  assert.throws(() => parseProfile(validProfile({ brand: { font: "Comic Sans" } as never })), /inválido/);
});

test("🔴 parseProfile: rechaza un logo que no es URL", () => {
  assert.throws(() => parseProfile(validProfile({ brand: { logo: "javascript:alert(1)" } as never })), /inválido/);
});

test("perfil: acepta varios locales y una carta", () => {
  const p = parseProfile({
    name: "La Birra Bar",
    locations: [
      {
        name: "Centro",
        address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
        opening_hours: "Lun-Dom 11:00-01:00",
      },
    ],
    menu: [{ category: "Hamburguesas", name: "Golden Burger", price: "12,50 €" }],
  });
  assert.equal(p.locations?.length, 1);
  assert.equal(p.locations?.[0]?.name, "Centro");
  assert.equal(p.menu?.[0]?.name, "Golden Burger");
});

test("perfil: una dirección sin código postal es válida (no se inventa el dato)", () => {
  const p = parseProfile({
    name: "La Birra Bar",
    address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
  });
  assert.equal(p.address?.postalCode, undefined);
  assert.equal(p.address?.streetAddress, "Carrera de San Jerónimo 3");
});

test("🔴 perfil: un ítem de la carta sin nombre no pasa la puerta", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ price: "10 €" }] }),
    /business-profile\.json inválido/,
  );
});

test("🔴 revisión externa #3 — más de 20 locations se rechaza EN LA PUERTA (no llega nunca a Postgres)", () => {
  const locations = Array.from({ length: 21 }, (_, i) => ({ name: `Local ${i}` }));
  assert.throws(
    () => parseProfile({ name: "X", locations }),
    /business-profile\.json inválido/,
  );
});

test("🔴 revisión externa #3 — más de 200 items de menu se rechaza EN LA PUERTA", () => {
  const menu = Array.from({ length: 201 }, (_, i) => ({ name: `Item ${i}` }));
  assert.throws(
    () => parseProfile({ name: "X", menu }),
    /business-profile\.json inválido/,
  );
});

test("perfil: exactamente 20 locations / 200 items de menu SÍ pasa (el límite es el tope, no menos)", () => {
  const locations = Array.from({ length: 20 }, (_, i) => ({ name: `Local ${i}` }));
  const menu = Array.from({ length: 200 }, (_, i) => ({ name: `Item ${i}` }));
  const p = parseProfile({ name: "X", locations, menu });
  assert.equal(p.locations?.length, 20);
  assert.equal(p.menu?.length, 200);
});

// ─────────────────────────────────────────────────────────────────────────────
// FRONTERA 1 de 4 — Zod, la puerta de `web-builder`.
//
// `businessProfileSchema` es un `z.object`, que **descarta claves desconocidas**, y `parseProfile`
// devuelve `parsed.data`. Por eso un campo nuevo que no se enumere acá desaparece en silencio aunque
// esté en el JSON — el modo de fallo que la spec de plantillas de landing enumera primero, y el mismo
// que causó la migración 0010.
// ─────────────────────────────────────────────────────────────────────────────

test("frontera 1 — el perfil con manual de marca completo pasa entero", () => {
  const p = parseProfile(perfilConManual());

  assert.equal(p.portada?.src, "https://a.storyblok.com/f/1/portada.jpg");
  assert.equal(p.portada?.alt, "Sala del restaurante");
  assert.equal(p.fotos?.length, 2);
  assert.equal(p.brand?.plantilla, "base");
  assert.equal(p.brand?.colores?.primario, "#0a7d34");
  assert.equal(p.brand?.colores?.fondoAlt, "#f4f4f2");
  assert.equal(p.brand?.fuentes?.titulo, "condensada");
  assert.equal(p.brand?.fuentes?.decorativa, "script");
  assert.equal(p.menu_categorias?.length, 2);
  assert.equal(p.menu_categorias?.[0]?.foto?.src, "https://a.storyblok.com/f/1/pizzas.jpg");
  assert.equal(p.menu_categorias?.[1]?.orden, 1);
  assert.equal(p.menu?.[0]?.precios?.length, 2);
  assert.equal(p.menu?.[0]?.precios?.[0]?.etiqueta, "Media");
  assert.equal(p.menu?.[0]?.nota, "Disponible sin gluten");
  assert.equal(p.menu?.[0]?.foto?.src, "https://a.storyblok.com/f/1/margherita.jpg");
});

test("frontera 1 — el perfil legacy {color, font} sigue pasando: ninguna ficha sembrada se invalida", () => {
  const p = parseProfile(perfilLegacy());
  assert.equal(p.brand?.color, "#0a7d34");
  assert.equal(p.brand?.font, "serif");
  assert.equal(p.brand?.colores, undefined);
});

test("frontera 1 — con las dos formas presentes, las dos sobreviven: quién gana lo decide la emisión", () => {
  const p = parseProfile(perfilConManual({ brand: { color: "#111111", colores: { primario: "#0a7d34" } } }));
  assert.equal(p.brand?.color, "#111111");
  assert.equal(p.brand?.colores?.primario, "#0a7d34");
});

test("frontera 1 — una clave que el esquema no enumera DESAPARECE (esto es lo que hace a esta una frontera)", () => {
  const p = parseProfile({ name: "X", portada_grande: { src: "https://a.storyblok.com/f/1/x.jpg" } });
  assert.equal((p as unknown as Record<string, unknown>)["portada_grande"], undefined);
});

test("frontera 1 — una foto `http:` se rechaza: filtraría IP y user-agent, y el navegador la bloquea", () => {
  assert.throws(() => parseProfile({ name: "X", portada: { src: "http://a.storyblok.com/f/1/x.jpg" } }), /https/);
});

test("frontera 1 — `javascript:` se rechaza aunque `.url()` de Zod lo acepte por tener esquema", () => {
  assert.throws(() => parseProfile({ name: "X", portada: { src: "javascript:alert(1)" } }), /inválido/);
});

test("frontera 1 — un color que no es hex se rechaza: iría literal dentro de un <style>", () => {
  assert.throws(() => parseProfile({ name: "X", brand: { colores: { primario: "red;}" } } }), /hex/);
  assert.throws(() => parseProfile({ name: "X", brand: { colores: { fondo: "#fff</style>" } } }), /hex/);
});

test("frontera 1 — una fuente fuera de los siete nombres de rol se rechaza (nunca un stack CSS)", () => {
  assert.throws(() => parseProfile({ name: "X", brand: { fuentes: { titulo: "Oswald, sans-serif" } } }), /inválido/);
});

test("frontera 1 — los topes nuevos: 30 fotos, 3 precios, 20 categorías", () => {
  const foto = { src: "https://a.storyblok.com/f/1/x.jpg" };
  assert.throws(() => parseProfile({ name: "X", fotos: Array.from({ length: 31 }, () => foto) }), /inválido/);
  assert.equal(parseProfile({ name: "X", fotos: Array.from({ length: 30 }, () => foto) }).fotos?.length, 30);

  const precio = { etiqueta: "Ración", importe: "9 €" };
  const conPrecios = (n: number) => ({ name: "X", menu: [{ name: "P", precios: Array.from({ length: n }, () => precio) }] });
  assert.throws(() => parseProfile(conPrecios(4)), /inválido/);
  assert.equal(parseProfile(conPrecios(3)).menu?.[0]?.precios?.length, 3);

  const cat = { nombre: "C" };
  assert.throws(() => parseProfile({ name: "X", menu_categorias: Array.from({ length: 21 }, () => cat) }), /inválido/);
  assert.equal(parseProfile({ name: "X", menu_categorias: Array.from({ length: 20 }, () => cat) }).menu_categorias?.length, 20);
});

test("frontera 1 — una entrada de `precios` a medias se rechaza: media fila de precio no se dibuja", () => {
  assert.throws(() => parseProfile({ name: "X", menu: [{ name: "P", precios: [{ etiqueta: "Media" }] }] }), /inválido/);
  assert.throws(() => parseProfile({ name: "X", menu: [{ name: "P", precios: [{ etiqueta: "", importe: "9 €" }] }] }), /inválido/);
});

test("frontera 1 — el menú enriquecido (video, alérgenos, etiquetas, nutrición, comensales) pasa entero", () => {
  const p = parseProfile({
    name: "X",
    menu: [
      {
        name: "Margherita",
        precios: [{ etiqueta: "Media", importe: "9 €", comensales: "1 persona" }],
        video: {
          src: "https://a.storyblok.com/f/1/margherita.mp4",
          poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza recién horneada" },
        },
        alergenos: ["gluten", "lacteos"],
        etiquetas: ["vegetariano"],
        nutricion: { calorias: 820, proteinas_g: 34, carbohidratos_g: 96, grasas_g: 28 },
      },
    ],
  });

  const item = p.menu?.[0];
  assert.equal(item?.precios?.[0]?.comensales, "1 persona");
  assert.equal(item?.video?.src, "https://a.storyblok.com/f/1/margherita.mp4");
  assert.equal(item?.video?.poster?.alt, "Pizza recién horneada");
  assert.deepEqual(item?.alergenos, ["gluten", "lacteos"]);
  assert.deepEqual(item?.etiquetas, ["vegetariano"]);
  assert.equal(item?.nutricion?.calorias, 820);
  assert.equal(item?.nutricion?.proteinas_g, 34);
});

test("frontera 1 — un alérgeno o etiqueta fuera de la taxonomía fija se rechaza (nunca texto libre)", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ name: "P", alergenos: ["gluten-free"] }] }),
    /inválido/,
  );
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ name: "P", etiquetas: ["sin gluten"] }] }),
    /inválido/,
  );
});

test("frontera 1 — un video sin https se rechaza, igual que una foto", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ name: "P", video: { src: "http://a.storyblok.com/f/1/x.mp4" } }] }),
    /https/,
  );
});

test("frontera 1 — un video sin `poster` es válido: el poster lo exige el RENDER, no el modelo", () => {
  const p = parseProfile({
    name: "X",
    menu: [{ name: "P", video: { src: "https://a.storyblok.com/f/1/x.mp4" } }],
  });
  assert.equal(p.menu?.[0]?.video?.src, "https://a.storyblok.com/f/1/x.mp4");
  assert.equal(p.menu?.[0]?.video?.poster, undefined);
});

test("frontera 1 — 15 alérgenos o 8 etiquetas se rechazan (los topes son 14 y 7, el tamaño de cada taxonomía)", () => {
  const alergeno15 = Array(15).fill("gluten");
  assert.throws(() => parseProfile({ name: "X", menu: [{ name: "P", alergenos: alergeno15 }] }), /inválido/);

  const etiqueta8 = Array(8).fill("vegano");
  assert.throws(() => parseProfile({ name: "X", menu: [{ name: "P", etiquetas: etiqueta8 }] }), /inválido/);
});

test("menuItemSchema exportado acepta el mismo plato válido que parseProfile()", () => {
  const plato = { name: "Margherita", precios: [{ etiqueta: "Media", importe: "9,00 €" }] };
  assert.equal(menuItemSchema.safeParse(plato).success, true);
  assert.equal(
    parseProfile({ name: "X", menu: [plato] }).menu?.[0]?.name,
    "Margherita",
  );
});

test("menuCategoriaSchema exportado rechaza una categoría sin nombre, igual que parseProfile()", () => {
  const categoria = { orden: 0 };
  assert.equal(menuCategoriaSchema.safeParse(categoria).success, false);
  assert.throws(() => parseProfile({ name: "X", menu_categorias: [categoria] }));
});

test("MAX_ITEMS_CARTA exportado es el mismo tope que aplica businessProfileSchema (200)", () => {
  assert.equal(MAX_ITEMS_CARTA, 200);
  const menu201 = Array.from({ length: 201 }, (_, i) => ({ name: `Plato ${i}` }));
  assert.throws(() => parseProfile({ name: "X", menu: menu201 }));
});

test("menuPatchSchema exige las DOS claves — menu_categorias ausente es inválido, no 'se conserva'", () => {
  const soloMenu = { menu: [{ name: "Margherita" }] };
  assert.equal(menuPatchSchema.safeParse(soloMenu).success, false);
});

test("menuPatchSchema acepta el caso sin categorías con un array vacío explícito", () => {
  const sinCategorias = { menu: [{ name: "Margherita" }], menu_categorias: [] };
  assert.equal(menuPatchSchema.safeParse(sinCategorias).success, true);
});

test("menuPatchSchema rechaza más de MAX_ITEMS_CARTA platos", () => {
  const menu201 = Array.from({ length: 201 }, (_, i) => ({ name: `Plato ${i}` }));
  assert.equal(menuPatchSchema.safeParse({ menu: menu201, menu_categorias: [] }).success, false);
});

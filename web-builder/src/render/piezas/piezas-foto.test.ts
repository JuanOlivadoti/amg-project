import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CATEGORIAS, MAX_FOTOS, MAX_PRECIOS } from "../../contract.js";
import { pageToStory } from "../../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../../fixtures.js";
import type { BusinessProfile, Story } from "../../types.js";
import { ctxCompleto, ctxDe, perfilCompleto } from "../ctx-de-prueba.js";
import { renderStory } from "../html.js";
import { MAX_CATEGORIAS_RENDER, MAX_DESTACADOS, MAX_FOTOS_GALERIA, MAX_PRECIOS_RENDER } from "../lib.js";
import { barraDatos } from "./barra-datos.js";
import { cartaCategorias } from "./carta-categorias.js";
import { ctaFinal } from "./cta-final.js";
import { galeria } from "./galeria.js";
import { heroPortada } from "./hero-portada.js";
import { platosDestacados } from "./platos-destacados.js";

/**
 * **Las seis piezas con imagen** (entrega 3, mitad B de la spec de plantillas de landing).
 *
 * Mismo contrato por pieza que `piezas.test.ts`: **con datos → renderiza; sin datos → `""`; con datos
 * hostiles → escapado o descartado.** Y una columna más que estas seis estrenan: **con una foto que no
 * pasa la §Política de imágenes, la pieza sigue saliendo bien, sin el `<img>`** — porque en PROD el
 * perfil llega de la base sin pasar por Zod y una foto mal cargada no puede tumbar una sección entera.
 */

const VENENO = '</p><script>alert(1)</script>';
/** Un host que la allowlist del código NO acepta. Ver `imagenes.ts`. */
const HOST_PROHIBIDO = "https://cdn.evil.tld/x.jpg";
const FOTO_OK = "https://a.storyblok.com/f/1/800x600/abc/foto.jpg";

/** Una story a la que se le pueden quitar bloks. */
function storySin(componente: "hero" | "section" | "faq"): Story {
  const s = pageToStory(validPage(), validBrief());
  s.content.body = s.content.body.filter((b) => b.component !== componente);
  return s;
}

function storyConImagenDeHero(src: string): Story {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { image: { src, alt: "Del blok" } });
  return s;
}

function imgsDe(html: string): string[] {
  return html.match(/<img\b[^>]*>/g) ?? [];
}

// ═══════════════════════════════════════════════════════════════════ heroPortada

test("heroPortada: con foto de portada dibuja titular, bajada, CTA y la foto", () => {
  const html = heroPortada.render(
    ctxDe({
      story: pageToStory(validPage(), validBrief()),
      profile: perfilCompleto({ portada: { src: FOTO_OK, alt: "La sala" } }),
    }),
  );
  assert.match(html, /<h1>Restaurante Italiano en Madrid Centro<\/h1>/);
  assert.match(html, /class="lede">/);
  assert.match(html, /class="cta" href="#contacto"/);
  assert.match(html, /<img class="hero-img"[^>]*src="https:\/\/a\.storyblok\.com/);
  assert.match(html, /class="portada con-img"/);
});

test("🔴 heroPortada: SIN portada degrada a hero TIPOGRÁFICO, no a un hueco", () => {
  // El caso que la spec nombra: «Sin foto degrada a hero tipográfico, no a un hueco». Un hueco sería
  // emitir el envoltorio de la imagen vacío, o dejar el titular con el tamaño que solo tiene sentido
  // cuando compite con una foto. La clase `sin-img` es lo que el CSS usa para agrandarlo.
  const html = heroPortada.render(
    ctxDe({ story: pageToStory(validPage(), validBrief()), profile: validProfile() }),
  );
  assert.match(html, /<h1>Restaurante Italiano en Madrid Centro<\/h1>/, "el titular sigue estando");
  assert.match(html, /class="portada sin-img"/, "y se anuncia como lo que es: un hero sin foto");
  assert.equal(imgsDe(html).length, 0, "ni una <img> vacía ni un envoltorio esperando una imagen");
});

test("heroPortada: la imagen del BLOK manda sobre `profile.portada` (es la foto DE esa página)", () => {
  const html = heroPortada.render(
    ctxDe({
      story: storyConImagenDeHero("https://a.storyblok.com/f/1/1600x900/blok/de-la-pagina.jpg"),
      profile: validProfile({ portada: { src: "https://a.storyblok.com/f/1/800x600/ficha/de-la-ficha.jpg" } }),
    }),
  );
  assert.match(html, /de-la-pagina\.jpg/, "la foto del blok es la específica de la página");
  assert.ok(!html.includes("de-la-ficha.jpg"), "la portada de la ficha es el respaldo, no la que gana");
});

test("heroPortada: sin blok `hero` devuelve '' (no hay titular que anunciar)", () => {
  assert.equal(heroPortada.render(ctxDe({ story: storySin("hero"), profile: perfilCompleto() })), "");
  assert.equal(heroPortada.render(ctxDe({ profile: perfilCompleto() })), "");
});

test("🔴 heroPortada: una portada de host NO permitido no sale, y la página sale igual", () => {
  const html = heroPortada.render(
    ctxDe({
      story: pageToStory(validPage(), validBrief()),
      profile: validProfile({ portada: { src: HOST_PROHIBIDO, alt: "x" } }),
    }),
  );
  assert.equal(imgsDe(html).length, 0, "el host de fuera de la allowlist no llega a un <img>");
  assert.ok(!html.includes("evil"), "ni deja rastro del host en el documento");
  assert.match(html, /<h1>/, "y el titular sigue ahí: una foto mala no tumba la portada");
  assert.match(html, /class="portada sin-img"/, "degrada al mismo caso que 'no hay foto'");
});

test("🔴 heroPortada: el titular se escapa y una portada `javascript:` no se dibuja", () => {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { headline: VENENO });
  const html = heroPortada.render(
    ctxDe({ story: s, profile: validProfile({ portada: { src: "javascript:alert(1)" } }) }),
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img"));
});

test("heroPortada: el `cta_label` largo degrada igual que en `hero` (la regla es una sola)", () => {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { cta_label: "Reserva tu mesa y disfruta de la cocina." });
  const html = heroPortada.render(ctxDe({ story: s, profile: perfilCompleto() }));
  assert.match(html, /class="cta-lede">Reserva tu mesa y disfruta de la cocina\.</);
  assert.match(html, /class="cta" href="#contacto">Llamar</);
});

// ═══════════════════════════════════════════════════════════════════ barraDatos

test("barraDatos: teléfono clicable, horario y 'Cómo llegar'", () => {
  const html = barraDatos.render(ctxDe({ profile: perfilCompleto() }));
  assert.match(html, /href="tel:\+34911234567"/);
  assert.match(html, /Mar-Dom 13:00-16:00/);
  assert.match(html, /<a href="#ubicaciones">Cómo llegar<\/a>/);
});

test("barraDatos: `locations[0]` manda sobre los campos sueltos, igual que el pie y el JSON-LD", () => {
  const html = barraDatos.render(
    ctxDe({
      profile: validProfile({
        telephone: "+34 000",
        opening_hours: "viejo",
        locations: [{ telephone: "+34 111", opening_hours: "Mar-Dom 20:00-23:30" }],
      }),
    }),
  );
  assert.match(html, /\+34 111/);
  assert.ok(!html.includes("+34 000"), "el teléfono clásico quedó viejo: no puede ganar");
  assert.ok(!html.includes("viejo"));
});

test("🔴 barraDatos: sin DIRECCIÓN no hay 'Cómo llegar' (nunca un ancla a la nada)", () => {
  // `#ubicaciones` lo dibuja `locales`, y sin una dirección ese bloque no tiene adónde llevar. El
  // criterio es el mismo que el del nav y el del CTA del hero: la etiqueta sale del dato que existe.
  const html = barraDatos.render(
    ctxDe({ profile: validProfile({ address: undefined, locations: [{ telephone: "+34 111" }] }) }),
  );
  assert.match(html, /\+34 111/, "el teléfono sí, que sí está");
  assert.ok(!html.includes("#ubicaciones"), "el enlace a las ubicaciones no");
  assert.ok(!html.includes("Cómo llegar"));
});

test("barraDatos: sin teléfono, sin horario y sin dirección devuelve ''", () => {
  const pelado = validProfile({ telephone: undefined, opening_hours: undefined, address: undefined });
  assert.equal(barraDatos.render(ctxDe({ profile: pelado })), "");
  assert.equal(barraDatos.render(ctxDe({})), "", "y sin perfil tampoco hay franja");
});

test("🔴 barraDatos: el teléfono y el horario se escapan (vienen de la base, sin Zod)", () => {
  const html = barraDatos.render(ctxDe({ profile: validProfile({ telephone: VENENO, opening_hours: VENENO }) }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

// ═══════════════════════════════════════════════════════════════════ platosDestacados

/** `n` platos con foto, descripción y precio. */
function menuDe(n: number): BusinessProfile["menu"] {
  return Array.from({ length: n }, (_, i) => ({
    name: `Plato ${i + 1}`,
    description: `Descripción ${i + 1}`,
    price: `${i + 1},00 €`,
    foto: { src: `https://a.storyblok.com/f/1/400x300/p${i}/plato-${i}.jpg` },
  }));
}

test("platosDestacados: dibuja foto, nombre, descripción y precio, y enlaza a /menu", () => {
  const html = platosDestacados.render(ctxDe({ profile: validProfile({ menu: menuDe(3) }) }));
  assert.match(html, /<h3>Plato 1<\/h3>/);
  assert.match(html, /class="desc">Descripción 1</);
  assert.match(html, /class="precio">1,00 €/);
  assert.equal(imgsDe(html).length, 3, "una foto por plato");
  assert.match(html, /<a href="\/menu">/, "el extracto solo tiene sentido si lleva a la carta");
});

test("🔴 platosDestacados: SOLO el primer precio y SIN etiqueta (es un gancho, no la carta)", () => {
  // Contrato de la enmienda 2026-08-02: «repetir ahí "Media 9 € / Ración 15 €" convierte un extracto
  // en una tabla y le quita la razón de existir al enlace». `cartaCategorias` sí los muestra todos.
  const html = platosDestacados.render(
    ctxDe({
      profile: validProfile({
        menu: [
          {
            name: "Margherita",
            precios: [
              { etiqueta: "Media", importe: "9,00 €" },
              { etiqueta: "Ración", importe: "14,50 €" },
            ],
          },
        ],
      }),
    }),
  );
  assert.match(html, /class="precio">9,00 €/, "el primero, tal cual");
  assert.ok(!html.includes("Media"), "sin la etiqueta: el extracto no es una tabla de precios");
  assert.ok(!html.includes("14,50"), "y sin el segundo importe");
});

test("🔴 platosDestacados: `precios` manda sobre `price`", () => {
  const html = platosDestacados.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", price: "99,00 €", precios: [{ etiqueta: "Ración", importe: "14,50 €" }] }],
      }),
    }),
  );
  assert.match(html, /class="precio">14,50 €/);
  assert.ok(!html.includes("99,00"), "`price` es el atajo del caso de un solo importe, no el que gana");
});

test("🔴 platosDestacados: el tope son 6 platos, fijado en su borde", () => {
  // Un default de producción sin test es una decisión sin dueño: gobierna cuántas fotos paga la home
  // de cualquier cliente. Se fija el BORDE, no un rango — con 6 salen 6, con 7 siguen saliendo 6.
  assert.equal(MAX_DESTACADOS, 6);
  const seis = platosDestacados.render(ctxDe({ profile: validProfile({ menu: menuDe(6) }) }));
  assert.match(seis, /Plato 6/);
  const siete = platosDestacados.render(ctxDe({ profile: validProfile({ menu: menuDe(7) }) }));
  assert.match(siete, /Plato 6/, "los seis primeros siguen saliendo");
  assert.ok(!siete.includes("Plato 7"), "el séptimo no");
});

test("platosDestacados: sin carta devuelve '' (y con ella, su CSS tampoco viaja)", () => {
  assert.equal(platosDestacados.render(ctxDe({ profile: validProfile() })), "");
  assert.equal(platosDestacados.render(ctxDe({ profile: validProfile({ menu: [] }) })), "");
  assert.equal(platosDestacados.render(ctxDe({})), "");
});

test("🔴 platosDestacados: una foto de host prohibido no sale, y el plato se dibuja igual", () => {
  const html = platosDestacados.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "Margherita", foto: { src: HOST_PROHIBIDO } }] }) }),
  );
  assert.equal(imgsDe(html).length, 0);
  assert.match(html, /<h3>Margherita<\/h3>/, "nunca una foto genérica de otro restaurante, pero el plato está");
});

test("🔴 platosDestacados: nombre, descripción y precio se escapan", () => {
  const html = platosDestacados.render(
    ctxDe({ profile: validProfile({ menu: [{ name: VENENO, description: VENENO, price: '"><b>' }] }) }),
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes('"><b>'));
});

// ═══════════════════════════════════════════════════════════════════ cartaCategorias

const CARTA: BusinessProfile["menu"] = [
  { category: "Pizzas", name: "Margherita", description: "Tomate y mozzarella.", price: "12,50 €" },
  { category: "Pastas", name: "Cacio e pepe", price: "13,00 €" },
];

test("cartaCategorias: con `menu_categorias` dibuja un bloque por categoría, con su foto", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: CARTA,
        menu_categorias: [{ nombre: "Pizzas", foto: { src: FOTO_OK } }, { nombre: "Pastas" }],
      }),
    }),
  );
  assert.match(html, /<h2>Pizzas<\/h2>/);
  assert.match(html, /<h2>Pastas<\/h2>/);
  assert.match(html, /<img class="categoria-img"/, "la categoría con foto la dibuja");
  assert.equal(imgsDe(html).length, 1, "y la que no tiene foto NO deja un hueco esperando una imagen");
  assert.match(html, /Margherita/);
  assert.match(html, /Cacio e pepe/);
});

test("cartaCategorias: SIN `menu_categorias` la carta se agrupa por `category`, como hasta ahora", () => {
  // «Un cliente que solo tiene la lista de platos conserva su carta entera» (enmienda 2026-08-02).
  const html = cartaCategorias.render(ctxDe({ profile: validProfile({ menu: CARTA }) }));
  assert.match(html, /<h2>Pizzas<\/h2>/);
  assert.match(html, /<h2>Pastas<\/h2>/);
  assert.equal(imgsDe(html).length, 0, "sin categorías declaradas no hay foto de categoría que dibujar");
  assert.ok(html.indexOf("Margherita") < html.indexOf("Cacio e pepe"), "y el orden es el de aparición");
});

test("cartaCategorias: los platos SIN categoría van juntos al final, sin encabezado inventado", () => {
  const html = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "Suelto" }, { category: "Pizzas", name: "Margherita" }] }) }),
  );
  assert.ok(html.indexOf("Margherita") < html.indexOf("Suelto"));
  assert.equal((html.match(/<h2>/g) ?? []).length, 1, "el grupo sin categoría no puede tener título");
});

test("🔴 cartaCategorias: una categoría declarada SIN platos no se dibuja (sería un hueco con foto)", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ category: "Pizzas", name: "Margherita" }],
        menu_categorias: [{ nombre: "Pizzas" }, { nombre: "Postres", foto: { src: FOTO_OK } }],
      }),
    }),
  );
  assert.match(html, /<h2>Pizzas<\/h2>/);
  assert.ok(!html.includes("Postres"), "una categoría con foto y sin carta es un hueco");
  assert.equal(imgsDe(html).length, 0, "y su foto tampoco puede colarse");
});

test("cartaCategorias: un plato cuya `category` no está declarada se dibuja igual, sin foto de categoría", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ category: "Pizzas", name: "Margherita" }, { category: "Bebidas", name: "Agua" }],
        menu_categorias: [{ nombre: "Pizzas", foto: { src: FOTO_OK } }],
      }),
    }),
  );
  assert.match(html, /<h2>Bebidas<\/h2>/, "la carta del cliente no se pierde por no haber declarado la categoría");
  assert.match(html, /Agua/);
  assert.equal(imgsDe(html).length, 1, "solo la declarada tiene foto");
});

test("🔴 cartaCategorias: `orden` manda; sin `orden`, orden de aparición en `menu`", () => {
  const conOrden = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: CARTA, // Pizzas aparece primero
        menu_categorias: [{ nombre: "Pizzas", orden: 1 }, { nombre: "Pastas", orden: 0 }],
      }),
    }),
  );
  assert.ok(conOrden.indexOf("Pastas") < conOrden.indexOf("Pizzas"), "`orden` decide, no la aparición");

  const sinOrden = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: CARTA, menu_categorias: [{ nombre: "Pastas" }, { nombre: "Pizzas" }] }) }),
  );
  assert.ok(sinOrden.indexOf("Pizzas") < sinOrden.indexOf("Pastas"), "sin `orden`, manda el orden de `menu`");
});

test("🔴 cartaCategorias: muestra TODOS los precios CON su etiqueta (al revés que el extracto)", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [
          {
            name: "Margherita",
            nota: "Sin gluten",
            precios: [
              { etiqueta: "Media", importe: "9,00 €" },
              { etiqueta: "Ración", importe: "14,50 €" },
            ],
          },
        ],
      }),
    }),
  );
  assert.match(html, /Media/);
  assert.match(html, /9,00 €/);
  assert.match(html, /Ración/);
  assert.match(html, /14,50 €/);
  assert.match(html, /class="nota">Sin gluten/, "la nota corta del plato también");
});

test("🔴 cartaCategorias: `precios` manda sobre `price`, y una entrada rota se descarta sola", () => {
  // Fronteras 2, 3 y 4: acá el dato ya está guardado, así que se descarta la ENTRADA, no el plato.
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [
          { name: "Con precios", price: "99,00 €", precios: [{ etiqueta: "Ración", importe: "14,50 €" }] },
          { name: "Rota", price: "7,00 €", precios: [{ etiqueta: "", importe: "" }] },
        ],
      }),
    }),
  );
  assert.match(html, /14,50 €/);
  assert.ok(!html.includes("99,00"), "`precios` manda");
  assert.match(html, /Rota/, "el plato con el precio roto sigue en la carta");
  assert.match(html, /7,00 €/, "y cae a `price`, que es lo que la spec pide");
});

test("cartaCategorias: sin carta devuelve '' (sin `menu` no hay pieza)", () => {
  assert.equal(cartaCategorias.render(ctxDe({ profile: validProfile() })), "");
  assert.equal(cartaCategorias.render(ctxDe({ profile: validProfile({ menu: [] }) })), "");
  assert.equal(cartaCategorias.render(ctxDe({})), "");
});

test("🔴 cartaCategorias: una foto de categoría de host prohibido no sale, y la categoría se dibuja", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ category: "Pizzas", name: "Margherita", foto: { src: HOST_PROHIBIDO } }],
        menu_categorias: [{ nombre: "Pizzas", foto: { src: HOST_PROHIBIDO } }],
      }),
    }),
  );
  assert.equal(imgsDe(html).length, 0);
  assert.ok(!html.includes("evil"));
  assert.match(html, /<h2>Pizzas<\/h2>/);
  assert.match(html, /Margherita/);
});

test("🔴 cartaCategorias: nombre, precio, descripción, nota y categoría se escapan", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ category: VENENO, name: VENENO, description: VENENO, price: '"><b>', nota: VENENO }],
        menu_categorias: [{ nombre: VENENO }],
      }),
    }),
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes('"><b>'));
});

// ═══════════════════════════════════════════════════════════════════ galeria

function fotos(n: number): Array<{ src: string; alt?: string }> {
  return Array.from({ length: n }, (_, i) => ({ src: `https://a.storyblok.com/f/1/400x300/g${i}/f-${i}.jpg` }));
}

test("galeria: con fotos dibuja una rejilla con una <img> por foto", () => {
  const html = galeria.render(ctxDe({ profile: validProfile({ fotos: fotos(4) }) }));
  assert.match(html, /class="rejilla"/);
  assert.equal(imgsDe(html).length, 4);
});

test("🔴 galeria: un perfil SIN `fotos` devuelve '' — ni un hueco ni un título de sección vacío", () => {
  // La spec lo nombra: «Perfil sin `fotos` → `galeria` devuelve `""` y **su CSS no viaja**». Que el CSS
  // no viaje lo comprueba `ensamblado.test.ts`; que el HTML sea vacío, esto.
  assert.equal(galeria.render(ctxDe({ profile: validProfile() })), "");
  assert.equal(galeria.render(ctxDe({ profile: validProfile({ fotos: [] }) })), "");
  assert.equal(galeria.render(ctxDe({})), "");
});

test("🔴 galeria: si NINGUNA foto pasa la política, tampoco queda una sección vacía", () => {
  // El caso que un `if (!fotos.length) return ""` a secas no cubre: hay fotos en la ficha y ninguna se
  // puede servir. Emitir el `<h2>` y una rejilla sin imágenes sería exactamente el hueco que la spec
  // prohíbe, con la diferencia de que este se llega a servir.
  const html = galeria.render(
    ctxDe({ profile: validProfile({ fotos: [{ src: HOST_PROHIBIDO }, { src: "javascript:alert(1)" }] }) }),
  );
  assert.equal(html, "");
});

test("galeria: una foto prohibida se descarta y las demás se dibujan", () => {
  const html = galeria.render(
    ctxDe({ profile: validProfile({ fotos: [{ src: HOST_PROHIBIDO }, { src: FOTO_OK }] }) }),
  );
  assert.equal(imgsDe(html).length, 1);
  assert.ok(!html.includes("evil"));
});

test("🔴 galeria: el tope de 30 se aplica TAMBIÉN en el render (frontera 4)", () => {
  // Zod corta en la puerta del CLI, pero en PROD el perfil llega de la base sin pasar por Zod. La spec
  // dice «se cortan en 30 en las fronteras 2, 3 y 4»; ésta es la 4.
  assert.equal(MAX_FOTOS_GALERIA, 30);
  const html = galeria.render(ctxDe({ profile: validProfile({ fotos: fotos(45) }) }));
  assert.equal(imgsDe(html).length, MAX_FOTOS_GALERIA);
});

test("🔴 galeria: el `alt` ausente sale como `alt=\"\"` (decorativa), nunca inventado", () => {
  const html = galeria.render(ctxDe({ profile: validProfile({ fotos: [{ src: FOTO_OK }] }) }));
  assert.match(html, /alt=""/);
  assert.ok(!html.includes("Trattoria"), "un alt derivado del nombre del negocio es un alt inventado");
});

// ═══════════════════════════════════════════════════════════════════ ctaFinal

test("ctaFinal: cierra con las acciones que el dato permite", () => {
  const html = ctaFinal.render(ctxDe({ profile: perfilCompleto() }));
  assert.match(html, /<a class="cta" href="tel:\+34911234567">Llamar<\/a>/);
  assert.match(html, /href="#ubicaciones">Cómo llegar</);
  assert.match(html, /Trattoria Bella Napoli/);
});

test("🔴 ctaFinal: sin teléfono no promete 'Llamar'; sin dirección no promete 'Cómo llegar'", () => {
  // Un botón que la página no puede cumplir es peor que un botón menos. Mismo criterio que el CTA del
  // hero y que el nav: la etiqueta sale del dato que existe.
  const sinTel = ctaFinal.render(ctxDe({ profile: validProfile({ telephone: undefined, locations: [] }) }));
  assert.ok(!sinTel.includes("Llamar"));
  assert.match(sinTel, /Cómo llegar/, "la dirección sigue estando");

  const sinDir = ctaFinal.render(ctxDe({ profile: validProfile({ address: undefined, locations: [] }) }));
  assert.match(sinDir, /Llamar/);
  assert.ok(!sinDir.includes("Cómo llegar"));
});

test("ctaFinal: sin ninguna acción posible devuelve '' (un cierre sin acción es un título repetido)", () => {
  const pelado = validProfile({ telephone: undefined, address: undefined, opening_hours: undefined });
  assert.equal(ctaFinal.render(ctxDe({ profile: pelado })), "");
  assert.equal(ctaFinal.render(ctxDe({})), "");
});

test("🔴 ctaFinal: el nombre del negocio y el horario se escapan", () => {
  const html = ctaFinal.render(ctxDe({ profile: validProfile({ name: VENENO, opening_hours: VENENO }) }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

// ═══════════════════════════════════════════════════════════════════ transversal

test("🔴 una foto de host prohibido no saca ni un `<img>` de NINGUNA de las seis, y todas siguen saliendo", () => {
  // El caso borde que la spec pide por su nombre, aplicado a las seis a la vez: la política se aplica
  // en `renderImagen`, pero un `<img>` escrito a mano en una pieza nueva la esquivaría sin que nada
  // avisara. Esto lo caza aunque la pieza no tenga su caso propio escrito.
  const hostil: BusinessProfile = validProfile({
    portada: { src: HOST_PROHIBIDO },
    fotos: [{ src: HOST_PROHIBIDO }, { src: FOTO_OK }],
    menu: [{ category: "Pizzas", name: "Margherita", price: "12 €", foto: { src: HOST_PROHIBIDO } }],
    menu_categorias: [{ nombre: "Pizzas", foto: { src: HOST_PROHIBIDO } }],
  });

  for (const pieza of [heroPortada, barraDatos, platosDestacados, cartaCategorias, galeria, ctaFinal]) {
    const html = pieza.render(ctxDe({ story: pageToStory(validPage(), validBrief()), profile: hostil }));
    assert.ok(html.length > 0, `la pieza "${pieza.id}" se cayó entera por una foto mala`);
    assert.ok(!html.includes("cdn.evil.tld"), `la pieza "${pieza.id}" dejó pasar un host prohibido`);
  }
});

test("🔴 los topes del render coinciden con los de Zod: cambiar uno es cambiar los dos", () => {
  // «Los topes tienen que coincidir en las CUATRO fronteras» (`contract.ts`). Las dos que viven en este
  // paquete son Zod y el render, y hasta ahora nada las ataba: se podía subir el de Zod y dejar el del
  // render cortando por lo bajo, con la ficha entera guardada y media carta servida.
  assert.equal(MAX_FOTOS_GALERIA, MAX_FOTOS);
  assert.equal(MAX_PRECIOS_RENDER, MAX_PRECIOS);
  assert.equal(MAX_CATEGORIAS_RENDER, MAX_CATEGORIAS);
});

// ---------------------------------------------------------------- el LCP de la landing

test("🔴 la foto de portada NO lleva `loading=\"lazy\"`: es el elemento LCP de toda landing", () => {
  // `loading="lazy"` es correcto para casi toda imagen y catastrófico para una sola: la que el
  // navegador mide como Largest Contentful Paint. Diferirla obliga al navegador a terminar el layout
  // para descubrir que está en el viewport, y solo entonces pedirla — retrasa exactamente lo que la
  // métrica mide.
  //
  // Hasta esta entrega daba igual: ninguna ficha tenía `portada` y `handoff/adapter.ts` nunca rellena
  // `image`, así que ninguna landing tenía foto arriba. Desde que `heroPortada` la dibuja, esa foto es
  // el LCP de todas las landings de todos los clientes, y habría sido la única regresión de
  // rendimiento de una entrega cuyo objetivo es que el sitio se vea MEJOR.
  const html = heroPortada.render(
    ctxDe({
      story: pageToStory(validPage(), validBrief()),
      profile: perfilCompleto({ portada: { src: FOTO_OK, alt: "La sala" } }),
    }),
  );
  const portada = html.match(/<img class="hero-img"[^>]*>/)?.[0];
  assert.ok(portada, "la landing tiene que llevar su foto de portada");
  assert.doesNotMatch(portada, /loading="lazy"/, "la portada NO puede diferirse: es el LCP");
  assert.match(portada, /fetchpriority="high"/, "y se pide con prioridad alta");
});

test("🔴 …y es la ÚNICA prioritaria del documento: marcar dos imágenes es no marcar ninguna", () => {
  // Compiten por el mismo ancho de banda. El resto —galería, platos, categorías, locales— sigue con
  // `loading="lazy"`, que es lo correcto para todo lo que está bajo el pliegue. Se mide sobre el
  // DOCUMENTO entero y no sobre una pieza, porque es una propiedad del documento: dos piezas podrían
  // marcarse prioritarias cada una por su cuenta sin que ningún test de pieza lo viera.
  // `ctxCompleto()` es el único fixture que trae portada Y galería Y fotos de categoría, que es lo
  // que hace falta para que "la única prioritaria" signifique algo: con una sola foto en el documento
  // el test pasaría por vacío.
  const html = renderStory(pageToStory(validPage(), validBrief()), ctxCompleto().profile);
  const prioritarias = html.match(/<img[^>]*fetchpriority="high"[^>]*>/g) ?? [];
  assert.equal(prioritarias.length, 1, "solo la portada puede ser prioritaria");
  assert.match(prioritarias[0]!, /class="hero-img"/);

  const diferidas = html.match(/<img[^>]*loading="lazy"[^>]*>/g) ?? [];
  assert.ok(diferidas.length > 0, "el resto de las fotos SÍ se difiere");
  for (const img of diferidas) {
    assert.doesNotMatch(img, /class="hero-img"/, "ninguna diferida puede ser la portada");
  }
});

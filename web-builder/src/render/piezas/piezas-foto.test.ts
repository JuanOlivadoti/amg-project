import { test } from "node:test";
import assert from "node:assert/strict";
import { MAX_CATEGORIAS, MAX_DESTACADOS, MAX_FOTOS, MAX_PRECIOS, MAX_TESTIMONIOS } from "../../contract.js";
import { pageToStory } from "../../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../../fixtures.js";
import type { BusinessProfile, Story } from "../../types.js";
import { ctxCompleto, ctxDe, perfilCompleto } from "../ctx-de-prueba.js";
import { renderStory } from "../html.js";
import {
  MAX_CATEGORIAS_RENDER,
  MAX_DESTACADOS_RENDER,
  MAX_FOTOS_GALERIA,
  MAX_PLATOS_DESTACADOS,
  MAX_PRECIOS_RENDER,
  MAX_TESTIMONIOS_RENDER,
} from "../lib.js";
import { barraDatos } from "./barra-datos.js";
import { cartaCategorias } from "./carta-categorias.js";
import { ctaFinal } from "./cta-final.js";
import { galeria } from "./galeria.js";
import { heroSlider } from "./hero-slider.js";
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

/**
 * La `<img>` de la diapositiva `n` del carrusel (1-indexada), o `undefined`.
 *
 * ⚠️ Se ancla en el `id="hs-N"` y **no en la clase `foto`** aunque sea más corto: `galeria` emite sus
 * imágenes con esa misma clase, así que un `class="foto"` a secas dejaría de identificar la portada en
 * cuanto la página tenga galería — que es justo el documento donde el orden de prioridades importa.
 */
/**
 * La `<img>` de la diapositiva `n` (1-indexada).
 *
 * ⚠️ Se ancla en `class="diapo"` **posicionalmente** y no en un `id`: los `id` del carrusel pasaron a
 * los radios que lo controlan cuando los puntos-ancla se sustituyeron por `:checked` (las anclas
 * arrastraban la página 203 px al pulsarlas). Y no se ancla en `class="foto"` a secas porque
 * `galeria` emite sus imágenes con esa misma clase: en el documento donde el orden de prioridades
 * importa —el que tiene galería— dejaría de identificar la portada.
 */
function diapo(html: string, n: number): string | undefined {
  const diapos = [...html.matchAll(/<li class="diapo">(<img\b[^>]*>)<\/li>/g)];
  return diapos[n - 1]?.[1];
}

// ═══════════════════════════════════════════════════════════════════ heroSlider
//
// ⚠️ **Esta sección era de `heroPortada`, que el rediseño de la plantilla base retiró del catálogo**
// (mismo criterio que retiró a `carta`: se quedó sin ninguna receta que la nombrara). Los casos son
// los suyos, trasladados uno a uno, porque las garantías no eran de la pieza sino de la portada: sin
// foto válida se degrada al hero TIPOGRÁFICO y nunca a un hueco, un host de fuera de la allowlist no
// llega a un `<img>` y la portada sale igual, el titular se escapa, y el CTA largo baja a bajada.
//
// Lo que sí cambió es el markup, y por eso ninguno es un buscar-y-reemplazar: donde había UNA foto
// (`<img class="hero-img">` dentro de `<header class="portada con-img">`) hay ahora una pista de hasta
// cinco diapositivas (`<li class="diapo" id="hs-N">`) dentro de `<header class="portada">` a secas.

test("heroSlider: con foto de portada dibuja titular, bajada, CTA y la foto", () => {
  const html = heroSlider.render(
    ctxDe({
      story: pageToStory(validPage(), validBrief()),
      profile: perfilCompleto({ portada: { src: FOTO_OK, alt: "La sala" } }),
    }),
  );
  assert.match(html, /<h1>Restaurante Italiano en Madrid Centro<\/h1>/);
  assert.match(html, /class="lede">/);
  assert.match(html, /class="cta" href="#contacto"/);
  assert.match(diapo(html, 1) ?? "", /src="https:\/\/a\.storyblok\.com/, "la foto va en la primera diapositiva");
  assert.match(html, /<header class="portada">/);
  assert.doesNotMatch(html, /sin-img/, "con foto NO puede anunciarse como portada sin imagen");
});

test("🔴 heroSlider: SIN ninguna foto degrada a hero TIPOGRÁFICO, no a un hueco", () => {
  // El caso que la spec nombra: «Sin foto degrada a hero tipográfico, no a un hueco». Un hueco sería
  // emitir el carrusel vacío, o dejar el titular con el tamaño que solo tiene sentido cuando compite
  // con una foto. La clase `sin-img` es lo que el CSS usa para agrandarlo y pasar a una columna.
  //
  // Sigue siendo el caso NORMAL: ninguna ficha de producción tiene una sola foto.
  const html = heroSlider.render(
    ctxDe({ story: pageToStory(validPage(), validBrief()), profile: validProfile() }),
  );
  assert.match(html, /<h1>Restaurante Italiano en Madrid Centro<\/h1>/, "el titular sigue estando");
  assert.match(html, /class="portada sin-img"/, "y se anuncia como lo que es: un hero sin foto");
  assert.equal(imgsDe(html).length, 0, "ni una <img> vacía ni un envoltorio esperando una imagen");
  assert.ok(!html.includes("class=\"pista\""), "ni la pista del carrusel sin diapositivas dentro");
});

test("heroSlider: la imagen del BLOK va PRIMERA, delante de `profile.portada` (es la foto DE esa página)", () => {
  // ⚠️ **La conducta cambió con el rediseño y conviene decirlo.** Con `heroPortada` la del blok
  // *excluía* a la de la ficha, porque solo cabía una. Con el carrusel caben las dos, así que la
  // precedencia dejó de ser "cuál se dibuja" y pasó a ser "cuál va primera" — y la primera es la que
  // se ve sin desplazar y la que el navegador mide como LCP, así que es la que sigue mandando.
  const html = heroSlider.render(
    ctxDe({
      story: storyConImagenDeHero("https://a.storyblok.com/f/1/1600x900/blok/de-la-pagina.jpg"),
      profile: validProfile({ portada: { src: "https://a.storyblok.com/f/1/800x600/ficha/de-la-ficha.jpg" } }),
    }),
  );
  assert.match(diapo(html, 1) ?? "", /de-la-pagina\.jpg/, "la foto del blok es la específica de la página");
  assert.match(diapo(html, 2) ?? "", /de-la-ficha\.jpg/, "la de la ficha la sigue: es el respaldo, no la que gana");
  assert.match(diapo(html, 1) ?? "", /fetchpriority="high"/, "y la del blok es la prioritaria");
  assert.match(diapo(html, 2) ?? "", /loading="lazy"/, "la segunda NO: marcar dos es no marcar ninguna");
});

test("heroSlider: sin titular —ni del blok ni del contexto— devuelve '' (no hay portada que anunciar)", () => {
  // ⚠️ `heroPortada` exigía el blok `hero` y devolvía `""` sin él. `heroSlider` cubre TAMBIÉN la home
  // sintetizada, cuyo titular sale del contexto, así que la condición se corrió: lo que no puede haber
  // es una portada sin ningún titular.
  assert.equal(heroSlider.render(ctxDe({ story: storySin("hero"), profile: perfilCompleto() })), "");
  assert.equal(heroSlider.render(ctxDe({ profile: perfilCompleto() })), "");

  // Y el positivo que impide que los dos casos de arriba pasen por vacío: con titular de contexto SÍ
  // dibuja, que es exactamente el caso de `home`.
  const home = heroSlider.render(ctxDe({ profile: perfilCompleto(), titulo: "Trattoria en Madrid" }));
  assert.match(home, /<h1>Trattoria en Madrid<\/h1>/);
});

test("🔴 heroSlider: una portada de host NO permitido no sale, y la página sale igual", () => {
  const html = heroSlider.render(
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

test("🔴 heroSlider: una foto prohibida se descarta y las BUENAS siguen saliendo, sin dejar hueco", () => {
  // El caso que la pieza de una sola foto no podía tener: con varias candidatas, una mala no puede
  // producir una diapositiva vacía ni correr a las demás fuera del carrusel.
  const html = heroSlider.render(
    ctxDe({
      story: pageToStory(validPage(), validBrief()),
      profile: validProfile({ portada: { src: HOST_PROHIBIDO }, fotos: [{ src: FOTO_OK, alt: "La sala" }] }),
    }),
  );
  assert.equal(imgsDe(html).length, 1, "la buena se dibuja");
  assert.ok(!html.includes("evil"));
  assert.match(diapo(html, 1) ?? "", /foto\.jpg/, "y ocupa la PRIMERA diapositiva, no la segunda");
  assert.equal(diapo(html, 2), undefined, "la descartada no deja una diapositiva vacía detrás");
});

test("🔴 heroSlider: el titular se escapa y una portada `javascript:` no se dibuja", () => {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { headline: VENENO });
  const html = heroSlider.render(
    ctxDe({ story: s, profile: validProfile({ portada: { src: "javascript:alert(1)" } }) }),
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img"));
});

test("heroSlider: el `cta_label` largo degrada igual que en `hero` (la regla es una sola)", () => {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { cta_label: "Reserva tu mesa y disfruta de la cocina." });
  const html = heroSlider.render(ctxDe({ story: s, profile: perfilCompleto() }));
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
  // El gancho es el DESTINO, no la forma del enlace: el rediseño lo convirtió en botón
  // (`class="cta"`), y una expresión que exigiera `<a href="/menu">` literal estaría fijando el
  // marcado en vez del contrato. Lo que no puede desaparecer es el enlace a la carta.
  assert.match(html, /href="\/menu"/, "el extracto solo tiene sentido si lleva a la carta");
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
  assert.equal(MAX_PLATOS_DESTACADOS, 6);
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
  assert.match(html, /<h3>Pizzas<\/h3>/);
  assert.match(html, /<h3>Pastas<\/h3>/);
  assert.match(html, /<img class="categoria-img"/, "la categoría con foto la dibuja");
  assert.equal(imgsDe(html).length, 1, "y la que no tiene foto NO deja un hueco esperando una imagen");
  assert.match(html, /Margherita/);
  assert.match(html, /Cacio e pepe/);
});

test("cartaCategorias: SIN `menu_categorias` la carta se agrupa por `category`, como hasta ahora", () => {
  // «Un cliente que solo tiene la lista de platos conserva su carta entera» (enmienda 2026-08-02).
  const html = cartaCategorias.render(ctxDe({ profile: validProfile({ menu: CARTA }) }));
  assert.match(html, /<h3>Pizzas<\/h3>/);
  assert.match(html, /<h3>Pastas<\/h3>/);
  assert.equal(imgsDe(html).length, 0, "sin categorías declaradas no hay foto de categoría que dibujar");
  assert.ok(html.indexOf("Margherita") < html.indexOf("Cacio e pepe"), "y el orden es el de aparición");
});

test("cartaCategorias: los platos SIN categoría van juntos al final, sin encabezado inventado", () => {
  const html = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "Suelto" }, { category: "Pizzas", name: "Margherita" }] }) }),
  );
  assert.ok(html.indexOf("Margherita") < html.indexOf("Suelto"));
  // Se cuentan los rótulos de CATEGORÍA (h3), no todos los encabezados: la sección tiene su propio
  // h2 desde el rediseño, y contar los dos niveles juntos medía otra cosa. La garantía es la misma:
  // el grupo sin categoría no estrena un título inventado.
  assert.equal((html.match(/<h3>/g) ?? []).length, 1, "el grupo sin categoría no puede tener título");
  assert.equal((html.match(/<h2>/g) ?? []).length, 1, "y la sección lleva exactamente un encabezado");
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
  assert.match(html, /<h3>Pizzas<\/h3>/);
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
  assert.match(html, /<h3>Bebidas<\/h3>/, "la carta del cliente no se pierde por no haber declarado la categoría");
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
  assert.match(html, /<h3>Pizzas<\/h3>/);
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

const VIDEO_OK = "https://a.storyblok.com/f/1/margherita.mp4";
const POSTER_OK = { src: FOTO_OK, alt: "Pizza recién horneada" };

test("cartaCategorias: un plato con video Y foto muestra el VIDEO, no la foto", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", foto: { src: FOTO_OK }, video: { src: VIDEO_OK, poster: POSTER_OK } }],
      }),
    }),
  );
  assert.match(html, /<video class="plato-foto"[^>]*src="https:\/\/a\.storyblok\.com\/f\/1\/margherita\.mp4"/);
  assert.doesNotMatch(html, /<img class="plato-foto"/, "la foto no se dibuja cuando hay video");
});

test("cartaCategorias: un video de host prohibido cae a la FOTO, no a un hueco", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", foto: { src: FOTO_OK }, video: { src: "https://cdn.evil.tld/x.mp4", poster: POSTER_OK } }],
      }),
    }),
  );
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /<img class="plato-foto"[^>]*src="https:\/\/a\.storyblok\.com/);
});

test("cartaCategorias: un video SIN poster no se dibuja (cae a la foto si la hay, si no a nada)", () => {
  const conFoto = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "P", foto: { src: FOTO_OK }, video: { src: VIDEO_OK } }] }) }),
  );
  assert.doesNotMatch(conFoto, /<video/);
  assert.match(conFoto, /<img class="plato-foto"/);

  const sinFoto = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "P", video: { src: VIDEO_OK } }] }) }),
  );
  assert.doesNotMatch(sinFoto, /<video|<img class="plato-foto"/);
});

test("cartaCategorias: TODO <video> lleva controls, preload=\"none\" y NUNCA autoplay", () => {
  const html = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "P", video: { src: VIDEO_OK, poster: POSTER_OK } }] }) }),
  );
  assert.match(html, /<video[^>]*\bcontrols\b/);
  assert.match(html, /<video[^>]*preload="none"/);
  assert.doesNotMatch(html, /autoplay/);
});

test("cartaCategorias: alérgenos y etiquetas se dibujan como texto, escapado", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", alergenos: ["gluten", "lacteos"], etiquetas: ["vegetariano"] }],
      }),
    }),
  );
  assert.match(html, /class="alergenos"/);
  assert.match(html, /Gluten/);
  assert.match(html, /Lácteos/);
  assert.match(html, /class="tag">Vegetariano</);
});

test("cartaCategorias: sin alérgenos ni etiquetas, no se dibuja ningún bloque vacío", () => {
  const html = cartaCategorias.render(ctxDe({ profile: validProfile({ menu: [{ name: "Cacio e pepe" }] }) }));
  assert.doesNotMatch(html, /class="alergenos"|class="tags"/);
});

test("cartaCategorias: la nutrición sale en un <details> colapsado, con solo los campos presentes", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", nutricion: { calorias: 820, proteinas_g: 34 } }],
      }),
    }),
  );
  assert.match(html, /<details class="nutricion"><summary>Información nutricional<\/summary>/);
  assert.match(html, /820 kcal/);
  assert.match(html, /Proteínas: 34 g/);
  assert.doesNotMatch(html, /Carbohidratos:|Grasas:/);
});

test("cartaCategorias: sin nutrición, no se dibuja el <details>", () => {
  const html = cartaCategorias.render(ctxDe({ profile: validProfile({ menu: [{ name: "Cacio e pepe" }] }) }));
  assert.doesNotMatch(html, /<details class="nutricion"/);
});

test("cartaCategorias: `comensales` se muestra junto a su precio", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", precios: [{ etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" }] }],
      }),
    }),
  );
  assert.match(html, /14,50 €.*\(2-3 personas\)/);
});

test("🔴 cartaCategorias: alérgenos, etiquetas y comensales se escapan", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [
          {
            name: "P",
            alergenos: ["gluten"],
            precios: [{ etiqueta: VENENO, importe: "9 €", comensales: VENENO }],
          },
        ],
      }),
    }),
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
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

  for (const pieza of [heroSlider, barraDatos, platosDestacados, cartaCategorias, galeria, ctaFinal]) {
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
  // Los dos del bloque K. Entran acá el mismo día que nacen, que es lo que este test enseñó: un tope
  // nuevo que no esté atado es un tope que dentro de tres meses dice dos cosas distintas.
  assert.equal(MAX_DESTACADOS_RENDER, MAX_DESTACADOS);
  assert.equal(MAX_TESTIMONIOS_RENDER, MAX_TESTIMONIOS);
});

// ---------------------------------------------------------------- el LCP de la landing

test("🔴 la foto de portada NO lleva `loading=\"lazy\"`: es el elemento LCP de toda landing", () => {
  // `loading="lazy"` es correcto para casi toda imagen y catastrófico para una sola: la que el
  // navegador mide como Largest Contentful Paint. Diferirla obliga al navegador a terminar el layout
  // para descubrir que está en el viewport, y solo entonces pedirla — retrasa exactamente lo que la
  // métrica mide.
  //
  // Hasta esta entrega daba igual: ninguna ficha tenía `portada` y `handoff/adapter.ts` nunca rellena
  // `image`, así que ninguna landing tenía foto arriba. Desde que la portada dibuja `profile.portada`
  // (`heroPortada` primero, `heroSlider` desde el rediseño), esa foto es el LCP de todas las landings
  // de todos los clientes, y habría sido la única regresión de rendimiento de una entrega cuyo
  // objetivo es que el sitio se vea MEJOR.
  const html = heroSlider.render(
    ctxDe({
      story: pageToStory(validPage(), validBrief()),
      profile: perfilCompleto({ portada: { src: FOTO_OK, alt: "La sala" } }),
    }),
  );
  const portada = diapo(html, 1);
  assert.ok(portada, "la landing tiene que llevar su foto de portada");
  assert.doesNotMatch(portada, /loading="lazy"/, "la portada NO puede diferirse: es el LCP");
  assert.match(portada, /fetchpriority="high"/, "y se pide con prioridad alta");
});

test("🔴 …y es la ÚNICA prioritaria del documento: marcar dos imágenes es no marcar ninguna", () => {
  // Compiten por el mismo ancho de banda. El resto —el resto del carrusel, la galería, los platos, las
  // categorías, los locales— sigue con `loading="lazy"`, que es lo correcto para todo lo que está bajo
  // el pliegue o fuera de la primera diapositiva. Se mide sobre el DOCUMENTO entero y no sobre una
  // pieza, porque es una propiedad del documento: dos piezas podrían marcarse prioritarias cada una
  // por su cuenta sin que ningún test de pieza lo viera.
  // `ctxCompleto()` es el único fixture que trae portada Y galería Y fotos de categoría, que es lo
  // que hace falta para que "la única prioritaria" signifique algo: con una sola foto en el documento
  // el test pasaría por vacío.
  //
  // ⚠️ Con `heroSlider` el riesgo se DUPLICÓ y por eso el caso creció: antes había una sola foto
  // arriba y la pregunta era si alguna otra pieza se marcaba prioritaria; ahora la portada emite hasta
  // cinco, y marcarlas todas —que es el error natural al escribir el bucle— sería el mismo fallo
  // dentro de una sola pieza. Se comprueba las dos cosas: que hay exactamente UNA en el documento, y
  // que es la primera diapositiva y no otra.
  const html = renderStory(pageToStory(validPage(), validBrief()), ctxCompleto().profile);
  const prioritarias = html.match(/<img[^>]*fetchpriority="high"[^>]*>/g) ?? [];
  assert.equal(prioritarias.length, 1, "solo la primera diapositiva de la portada puede ser prioritaria");

  const primera = diapo(html, 1);
  assert.ok(primera, "el documento tiene que llevar su carrusel de portada");
  assert.equal(prioritarias[0], primera, "la prioritaria tiene que ser ESA, no otra imagen del documento");

  // Y el carrusel tiene que traer más de una diapositiva, o "solo la primera" no dice nada.
  const segunda = diapo(html, 2);
  assert.ok(segunda, "sin una segunda diapositiva este caso pasaría por vacío");
  assert.match(segunda, /loading="lazy"/, "la segunda diapositiva se difiere como cualquier otra foto");

  const diferidas = html.match(/<img[^>]*loading="lazy"[^>]*>/g) ?? [];
  assert.ok(diferidas.length > 0, "el resto de las fotos SÍ se difiere");
  for (const img of diferidas) {
    assert.notEqual(img, primera, "la primera diapositiva no puede aparecer entre las diferidas");
  }
});

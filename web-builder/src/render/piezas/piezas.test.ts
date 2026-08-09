import { test } from "node:test";
import assert from "node:assert/strict";
import { pageToStory } from "../../handoff/adapter.js";
import { validBrief, validPage, validProfile } from "../../fixtures.js";
import { ctxCompleto, ctxDe, perfilCompleto } from "../ctx-de-prueba.js";
import type { Story } from "../../types.js";
import { CATALOGO } from "./index.js";
import { blogIndice } from "./blog-indice.js";
import { cabecera } from "./cabecera.js";
import { contacto } from "./contacto.js";
import { faq } from "./faq.js";
import { hero } from "./hero.js";
import { indice } from "./indice.js";
import { locales } from "./locales.js";
import { seccionProsa } from "./seccion-prosa.js";

/**
 * El test por pieza que pide la spec: **con datos → renderiza; sin datos → `""`; con datos hostiles
 * → escapado**.
 *
 * La tercera columna no es ceremonia: en PROD el perfil llega de Storyblok **sin pasar por Zod**, así
 * que cada pieza es la última defensa de lo que interpola. Y el `""` importa tanto como el HTML —es
 * lo que hace que el CSS de la pieza tampoco viaje— así que se prueba explícitamente.
 */

const VENENO = '</p><script>alert(1)</script>';

/** Una story a la que se le pueden quitar bloks, para probar el caso "sin datos" de cada pieza. */
function storySin(componente: "hero" | "section" | "faq"): Story {
  const s = pageToStory(validPage(), validBrief());
  s.content.body = s.content.body.filter((b) => b.component !== componente);
  return s;
}

// ---------------------------------------------------------------- cabecera

test("cabecera: con perfil dibuja marca y nav", () => {
  const html = cabecera.render(ctxDe({ profile: perfilCompleto(), activeSlug: "menu" }));
  assert.match(html, /class="sitebar"/);
  assert.match(html, /class="marca">Trattoria Bella Napoli/);
  assert.match(html, /<a href="\/menu" class="activo" aria-current="page">Menú<\/a>/);
});

test("cabecera: SIN perfil devuelve '' (no hay sitio del que ser cabecera)", () => {
  assert.equal(cabecera.render(ctxDe({ activeSlug: "x" })), "");
});

test("🔴 cabecera: el nombre se escapa y un logo `javascript:` cae al nombre, no al `<img src>`", () => {
  const html = cabecera.render(
    ctxDe({ profile: validProfile({ name: VENENO, brand: { logo: "javascript:alert(1)" } }) }),
  );
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes('src="javascript:'), "un logo con esquema no puede llegar a un <img src>");
  assert.match(html, /class="marca"/, "cae al nombre del negocio");
});

// ---------------------------------------------------------------- hero

test("hero: con blok `hero` dibuja titular, bajada y CTA", () => {
  const html = hero.render(ctxDe({ story: pageToStory(validPage(), validBrief()), profile: perfilCompleto() }));
  assert.match(html, /<h1>Restaurante Italiano en Madrid Centro<\/h1>/);
  assert.match(html, /class="cta" href="#contacto"/, "con perfil, el CTA ancla al contacto del pie");
});

test("hero: sin perfil el CTA ancla a las FAQ, y sin FAQ no hay CTA", () => {
  const conFaq = hero.render(ctxDe({ story: pageToStory(validPage(), validBrief()) }));
  assert.match(conFaq, /class="cta" href="#faq"/);
  const sinFaq = hero.render(ctxDe({ story: storySin("faq") }));
  assert.ok(!sinFaq.includes("class=\"cta\""), "sin destino no se dibuja un botón que no lleva a ningún lado");
});

// ---------------------------------------------------------------- hero: el CTA largo (entrega 3)
//
// El brief del research escribe el CTA, y a veces escribe una frase: "Reserva tu mesa y disfruta de
// la auténtica cocina italiana" son 57 caracteres dentro de un botón. Se resuelve **en el render**
// —no en el contrato del brief— porque es un problema de cuánto entra en un botón, no de qué dijo el
// research: `kr-service` no sabe con qué ancho se va a dibujar su texto.

/** Una story con el `cta_label` que se le pida. */
function storyConCta(cta: string): Story {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { cta_label: cta });
  return s;
}

const CTA_LARGO = "Reserva tu mesa y disfruta de la cocina."; // 40 caracteres
const CTA_CORTO = "Reserva ya"; // 10

test("hero: un `cta_label` LARGO baja a bajada y el botón toma una etiqueta derivada del dato", () => {
  assert.equal(CTA_LARGO.length, 40, "el caso pierde sentido si el texto deja de ser largo");
  assert.equal(CTA_CORTO.length, 10, "y el corto tiene que seguir siendo corto");
  const html = hero.render(ctxDe({ story: storyConCta(CTA_LARGO), profile: perfilCompleto() }));
  assert.match(html, /class="cta-lede">Reserva tu mesa y disfruta de la cocina\.</, "el texto no se pierde");
  assert.match(html, /class="cta" href="#contacto">Llamar</, "y el botón dice lo que se puede hacer");
  assert.ok(!html.includes('class="cta" href="#contacto">Reserva'), "la frase larga no puede quedar en el botón");
});

test("hero: un `cta_label` CORTO se dibuja tal cual en el botón, como siempre", () => {
  const html = hero.render(ctxDe({ story: storyConCta(CTA_CORTO), profile: perfilCompleto() }));
  assert.match(html, /class="cta" href="#contacto">Reserva ya</);
  assert.ok(!html.includes("cta-lede"), "sin frase larga no hay bajada de CTA");
});

test("hero: sin teléfono, la etiqueta derivada es 'Cómo llegar' y apunta a las ubicaciones", () => {
  // La etiqueta sale del DATO que hay: un botón "Llamar" en una ficha sin teléfono sería una promesa
  // que la página no puede cumplir.
  const sinTel = validProfile({ telephone: undefined });
  const html = hero.render(ctxDe({ story: storyConCta(CTA_LARGO), profile: sinTel }));
  assert.match(html, /class="cta" href="#ubicaciones">Cómo llegar</);
});

test("hero: sin teléfono NI dirección, la etiqueta derivada no inventa nada que la página no tenga", () => {
  const pelado = validProfile({ telephone: undefined, address: undefined, opening_hours: undefined });
  const html = hero.render(ctxDe({ story: storyConCta(CTA_LARGO), profile: pelado }));
  assert.match(html, /class="cta" href="#contacto">Contactar</);
  assert.match(html, /class="cta-lede"/, "y la frase larga sigue estando, como bajada");
});

test("hero: en una página SINTETIZADA el titular sale del contexto", () => {
  const html = hero.render(ctxDe({ titulo: "Menú · Trattoria", bajada: "Madrid" }));
  assert.match(html, /<h1>Menú · Trattoria<\/h1>/);
  assert.match(html, /class="lede">Madrid</);
});

test("hero: sin blok `hero` NI titular sintetizado devuelve ''", () => {
  assert.equal(hero.render(ctxDe({ story: storySin("hero") })), "");
  assert.equal(hero.render(ctxDe({})), "");
});

test("🔴 hero: el titular se escapa y una imagen `javascript:` no se dibuja", () => {
  const s = pageToStory(validPage(), validBrief());
  const h = s.content.body.find((b) => b.component === "hero")!;
  Object.assign(h, { headline: VENENO, image: { src: "javascript:alert(1)", alt: "x" } });
  const html = hero.render(ctxDe({ story: s }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img"), "una imagen rota es peor que ninguna, y un esquema peor todavía");
});

// ---------------------------------------------------------------- seccionProsa

test("seccionProsa: con secciones las dibuja todas, en orden", () => {
  const html = seccionProsa.render(ctxDe({ story: pageToStory(validPage(), validBrief()) }));
  assert.ok(html.indexOf("Sobre Nosotros") < html.indexOf("Especialidades"));
});

test("seccionProsa: sin secciones devuelve ''", () => {
  assert.equal(seccionProsa.render(ctxDe({ story: storySin("section") })), "");
  assert.equal(seccionProsa.render(ctxDe({})), "");
});

test("🔴 seccionProsa: el encabezado y el cuerpo se escapan", () => {
  const s = pageToStory(validPage(), validBrief());
  const sec = s.content.body.find((b) => b.component === "section")!;
  Object.assign(sec, { heading: VENENO, body: VENENO });
  const html = seccionProsa.render(ctxDe({ story: s }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

// ---------------------------------------------------------------- faq

test("faq: con blok `faq` dibuja el detalle y es dueña de id='faq'", () => {
  const html = faq.render(ctxDe({ story: pageToStory(validPage(), validBrief()) }));
  assert.match(html, /id="faq"/);
  assert.match(html, /<summary>¿Tienen opciones sin gluten\?<\/summary>/);
});

test("faq: sin blok `faq` devuelve ''", () => {
  assert.equal(faq.render(ctxDe({ story: storySin("faq") })), "");
  assert.equal(faq.render(ctxDe({})), "");
});

test("🔴 faq: pregunta y respuesta se escapan", () => {
  const s = pageToStory(validPage(), validBrief());
  const f = s.content.body.find((b) => b.component === "faq")!;
  Object.assign(f, { items: [{ question: VENENO, answer: VENENO }] });
  const html = faq.render(ctxDe({ story: s }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
});

// ---------------------------------------------------------------- indice y blogIndice

test("indice: con páginas dibuja una tarjeta por página", () => {
  const html = indice.render(ctxDe({ paginas: [{ slug: "menu", name: "La carta" }] }));
  assert.match(html, /class="card" href="\/menu"><h3>La carta<\/h3>/);
});

test("indice: SIN páginas el estado 'sin datos' es un AVISO, no el vacío", () => {
  // No devuelve "" a propósito: el aviso es texto visible y es lo que le dice a un cliente recién
  // dado de alta que su portada existe. Devolver "" dejaría la home muda y tiraría el gate de paridad.
  const html = indice.render(ctxDe({}));
  assert.match(html, /class="pending"/);
  assert.ok(!html.includes('class="cards"'), "ni una tarjeta fantasma");
});

test("blogIndice: con posts dibuja tarjetas; sin posts, el aviso", () => {
  assert.match(blogIndice.render(ctxDe({ paginas: [{ slug: "b/x", name: "X" }] })), /class="card"/);
  assert.match(blogIndice.render(ctxDe({})), /class="pending"/);
});

test("🔴 indice/blogIndice: el nombre se escapa y el slug se vuelve ruta, nunca esquema", () => {
  const veneno = [{ slug: "javascript:alert(1)", name: "</h3><script>x</script>" }];
  for (const pieza of [indice, blogIndice]) {
    const html = pieza.render(ctxDe({ paginas: veneno }));
    assert.ok(!html.includes("</h3><script>"), `${pieza.id}: el nombre salió crudo`);
    assert.ok(!/href="javascript:/i.test(html), `${pieza.id}: el slug salió como esquema`);
  }
});

// La carta vive ahora en `cartaCategorias` y sus tests, en `piezas-foto.test.ts`. `carta` se retiró
// del catálogo en la entrega 3 (mitad B): ver el porqué en `index.ts`.

// ---------------------------------------------------------------- contacto

test("contacto: con perfil dibuja el bloque y es dueña de id='contacto'", () => {
  const html = contacto.render(ctxDe({ profile: perfilCompleto() }));
  assert.match(html, /id="contacto"/);
  assert.match(html, /href="tel:\+34911234567"/);
});

test("contacto: SIN perfil devuelve ''", () => {
  assert.equal(contacto.render(ctxDe({})), "");
});

test("🔴 contacto: el nombre del negocio se escapa", () => {
  const html = contacto.render(ctxDe({ profile: validProfile({ name: VENENO }) }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

// ---------------------------------------------------------------- locales

test("locales: dibuja un bloque por local y es dueña de id='ubicaciones'", () => {
  const html = locales.render(ctxDe({ profile: perfilCompleto() }));
  assert.equal((html.match(/id="ubicaciones"/g) ?? []).length, 1);
  assert.match(html, /Calle Mayor 12, 28013 Madrid/);
  assert.match(html, /Zurbano 40, Madrid/, "sin código postal la coma sigue después de la calle");
  assert.match(html, /Nuestros locales/, "con más de uno, el encabezado va en plural");
});

test("locales: sin locales NI campos clásicos devuelve '' (y el nav tampoco ofrece el ancla)", () => {
  const pelado = validProfile({ address: undefined, telephone: undefined, opening_hours: undefined });
  assert.equal(locales.render(ctxDe({ profile: pelado })), "");
  assert.equal(locales.render(ctxDe({})), "");
});

test("locales: un perfil clásico sin `locations` sintetiza UN local con sus campos sueltos", () => {
  const html = locales.render(ctxDe({ profile: validProfile() }));
  assert.match(html, /Dónde estamos/, "con uno solo, el encabezado va en singular");
  assert.match(html, /Calle Mayor 12/);
});

test("🔴 locales: el nombre de un local se escapa (viene de la base, sin Zod)", () => {
  const html = locales.render(ctxDe({ profile: validProfile({ locations: [{ name: VENENO }] }) }));
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.match(html, /&lt;script&gt;/);
});

// ---------------------------------------------------------------- transversal

test("ninguna pieza deja pasar `<script>` sin escapar con datos hostiles en TODOS los campos a la vez", () => {
  // Barrido: si mañana aparece una pieza que interpola un campo nuevo sin `esc()`, cae acá aunque
  // nadie le haya escrito su caso hostil propio.
  //
  // ⚠️ Recorre **`CATALOGO`**, no una lista escrita a mano. Hasta la entrega 3 era un literal con las
  // nueve piezas de entonces, y esa lista es justo lo que NO cumple la promesa del comentario de
  // arriba: una pieza nueva no aparece sola en un array literal. Al añadir seis de golpe se vio.
  const s = pageToStory(validPage(), validBrief());
  for (const b of s.content.body) {
    if (b.component === "hero") Object.assign(b, { headline: VENENO, subhead: VENENO, cta_label: VENENO });
    if (b.component === "section") Object.assign(b, { heading: VENENO, body: VENENO });
    if (b.component === "faq") Object.assign(b, { items: [{ question: VENENO, answer: VENENO }] });
  }
  const ctx = ctxDe({
    ...ctxCompleto(),
    story: s,
    titulo: VENENO,
    bajada: VENENO,
    profile: validProfile({
      name: VENENO,
      telephone: VENENO,
      opening_hours: VENENO,
      menu: [
        {
          category: VENENO,
          name: VENENO,
          description: VENENO,
          price: VENENO,
          nota: VENENO,
          precios: [{ etiqueta: VENENO, importe: VENENO }],
          foto: { src: VENENO },
        },
      ],
      menu_categorias: [{ nombre: VENENO, foto: { src: VENENO } }],
      portada: { src: VENENO, alt: VENENO },
      fotos: [{ src: VENENO, alt: VENENO }],
      locations: [{ name: VENENO, opening_hours: VENENO }],
    }),
    paginas: [{ slug: VENENO, name: VENENO }],
  });

  for (const pieza of CATALOGO) {
    assert.ok(
      !pieza.render(ctx).includes("<script>"),
      `la pieza "${pieza.id}" dejó pasar un <script> sin escapar`,
    );
  }
});

test("🔴 el ORDEN del catálogo es un contrato, y hasta ahora nada lo imponía", () => {
  // El comentario de `index.ts` dice que reordenar este array es un cambio deliberado porque cambia
  // los bytes del `<style>` de todas las páginas publicadas. Era una intención: el test de ensamblado
  // derivaba el orden esperado del propio `CATALOGO`, así que reordenarlo movía los dos lados a la vez
  // y seguía verde; y el gate de paridad no mira el `<style>`. Lo cazó una revisión.
  //
  // Esta lista literal es lo que convierte "reordenar es deliberado" en algo que hay que editar aquí
  // a propósito. Si cambiás el orden y este test cae, la pregunta es por qué, no cómo ponerlo verde.
  //
  // ⚠️ La entrega 3 (mitad B) lo cambió a propósito: entran las seis piezas con imagen y sale `carta`
  // (ver `index.ts`). El orden sigue siendo el del documento — cabecera, contenido en el orden en que
  // suele aparecer, pie— con las dos variantes de titular juntas al principio.
  assert.deepEqual(
    CATALOGO.map((p) => p.id),
    [
      "cabecera",
      "heroPortada",
      "hero",
      "barraDatos",
      "seccionProsa",
      "platosDestacados",
      "cartaCategorias",
      "galeria",
      "faq",
      "indice",
      "blogIndice",
      "ctaFinal",
      "contacto",
      "locales",
    ],
  );
});

test("🔴 hero: el LÍMITE del CTA es 28 exactos — el default de producción, fijado en su borde", () => {
  // Los dos tests de arriba eligen 40 y 10, así que cualquier umbral entre 15 y 39 los dejaba en
  // verde: el 28 no estaba en ningún assert y el JSDoc afirmaba que «tiene que doler en un test».
  // Lo cazó una revisión mutando el valor a 20 sin que cayera nada. Un default que el test no fija
  // no está fijado, y éste gobierna cómo se ve el botón en el móvil de cualquier cliente.
  //
  // Se fija el BORDE y no un rango: 28 caracteres caben, 29 no. Mover el número tumba este test y
  // la pregunta pasa a ser por qué se movió, que es lo que el comentario promete.
  const justo = "Reserva tu mesa por telefono"; // 28
  const unoMas = "Reserva tu mesa por telefonos"; // 29
  assert.equal(justo.length, 28, "el caso pierde sentido si el texto deja de medir 28");
  assert.equal(unoMas.length, 29);

  const ctx = { profile: perfilCompleto() };
  const conJusto = hero.render(ctxDe({ story: storyConCta(justo), ...ctx }));
  const conUnoMas = hero.render(ctxDe({ story: storyConCta(unoMas), ...ctx }));

  // A 28 el texto va DENTRO del botón y no hay bajada de CTA.
  assert.match(conJusto, new RegExp(`<a[^>]*class="cta"[^>]*>${justo}</a>`));
  assert.doesNotMatch(conJusto, /cta-lede/, "a 28 caracteres todavía no debe degradar");

  // A 29 baja a bajada y el botón toma la etiqueta derivada del dato.
  assert.match(conUnoMas, new RegExp(`class="cta-lede">${unoMas}</p>`));
  assert.doesNotMatch(conUnoMas, new RegExp(`class="cta"[^>]*>${unoMas}<`), "a 29 no puede seguir en el botón");
});

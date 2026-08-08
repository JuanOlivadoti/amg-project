import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderStory, type Story } from "web-builder";
import { perfilValido } from "./perfil.js";

const NAP_BUENO = {
  name: "Trattoria Bella Napoli",
  telephone: "+34 910 000 000",
  address: { streetAddress: "Calle Mayor 1", postalCode: "28013", addressLocality: "Madrid" },
};

describe("perfilValido", () => {
  it("deja pasar un perfil bien formado, entero", () => {
    const p = perfilValido(NAP_BUENO);
    assert.equal(p?.name, "Trattoria Bella Napoli");
    assert.equal(p?.address?.postalCode, "28013");
    assert.equal(p?.telephone, "+34 910 000 000");
  });

  it("un perfil con solo `name` es válido: el resto es opcional", () => {
    const p = perfilValido({ name: "Bar Pepe" });
    assert.equal(p?.name, "Bar Pepe");
    assert.equal(p?.address, undefined);
  });

  it("sin `name` no hay perfil", () => {
    assert.equal(perfilValido({ telephone: "+34" }), null);
    assert.equal(perfilValido({ name: "  " }), null);
  });

  it("lo que no es un objeto es null, sin explotar", () => {
    for (const basura of [null, undefined, "texto", 42, [], true]) {
      assert.equal(perfilValido(basura), null, `debería descartar: ${JSON.stringify(basura)}`);
    }
  });

  it("🔴 una dirección en texto plano se DESCARTA, no se cuela", () => {
    // Es la forma exacta en la que el bug apareció: `address` como string.
    const p = perfilValido({ name: "N", address: "Calle Mayor 1, Madrid" });
    assert.equal(p?.name, "N");
    assert.equal(p?.address, undefined, "media dirección es peor que ninguna");
  });

  it("🔴 una dirección a la que le falta calle o ciudad se descarta entera", () => {
    // Calle y ciudad siguen siendo obligatorias: `renderContact()` las da por hechas. El código
    // postal ya no (ver `direccion()`), así que la parte que puede faltar acá es la ciudad.
    const p = perfilValido({ name: "N", address: { streetAddress: "Calle Mayor 1" } });
    assert.equal(p?.address, undefined);
  });

  it("una dirección sin código postal ya es válida (calle + ciudad alcanzan)", () => {
    const p = perfilValido({
      name: "X",
      address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" },
    });
    assert.equal(p?.address?.streetAddress, "San Jerónimo 3");
    assert.equal(p?.address?.postalCode, undefined);
  });

  it("🔴 una dirección sin calle sigue descartándose entera", () => {
    const p = perfilValido({ name: "X", address: { addressLocality: "Madrid" } });
    assert.equal(p?.address, undefined);
  });

  it("🔴 los locales sobreviven al validador y llegan al render", () => {
    const p = perfilValido({
      name: "La Birra Bar",
      locations: [
        { name: "Centro", address: { streetAddress: "San Jerónimo 3", addressLocality: "Madrid" } },
        { name: "Salamanca", opening_hours: "hasta la 01:00" },
      ],
    });
    assert.equal(p?.locations?.length, 2);
    assert.equal(p?.locations?.[0]?.name, "Centro");
  });

  it("🔴 la carta sobrevive al validador", () => {
    const p = perfilValido({ name: "X", menu: [{ category: "Cervezas", name: "Ale", price: "5 €" }] });
    assert.equal(p?.menu?.[0]?.name, "Ale");
    assert.equal(p?.menu?.[0]?.price, "5 €");
  });

  it("🔴 un ítem de carta sin nombre se descarta (no se puede mostrar)", () => {
    const p = perfilValido({ name: "X", menu: [{ price: "5 €" }, { name: "Ale" }] });
    assert.equal(p?.menu?.length, 1);
    assert.equal(p?.menu?.[0]?.name, "Ale");
  });

  it("🔴 un local sin ningún dato usable se descarta", () => {
    const p = perfilValido({ name: "X", locations: [{ name: "Vacío" }, { opening_hours: "11:00" }] });
    assert.equal(p?.locations?.length, 1);
  });

  it("🔴 una lista hostilmente larga se acota (la columna jsonb no la valida nadie)", () => {
    const menu = Array.from({ length: 500 }, (_, i) => ({ name: `Item ${i}` }));
    const p = perfilValido({ name: "X", menu });
    assert.ok((p?.menu?.length ?? 0) <= 200);
  });
});

// ------------------------------------------------------------------ el contrato con renderStory

function story(): Story {
  return {
    name: "Inicio",
    slug: "home",
    content: {
      component: "page",
      seo: {
        title: "Inicio",
        description: "d",
        canonical: "https://bellanapoli.es/home",
        og_title: "Inicio",
        og_description: "d",
      },
      schema_type: "LocalBusiness",
      page_type: "servicio",
      intent: "local",
      is_local: true,
      body: [{ component: "hero", headline: "Bienvenidos", subhead: "Cocina napolitana" }],
      meta: {
        contract_version: "web.v0.1",
        source_keyword: "restaurante madrid",
        secondary_keywords: [],
        internal_links: [],
        word_count_objetivo: 800,
        opportunity_score: 70,
        volumen: 1000,
        dificultad: 30,
      },
    },
  };
}

describe("perfilValido + renderStory: el contrato de verdad", () => {
  it("🔴 renderStory LANZA con una dirección en texto plano (por eso existe perfilValido)", () => {
    // Este test documenta el fallo del que hay que protegerse. Si algún día `renderStory` se vuelve
    // tolerante, este test cae y avisa de que la defensa de abajo pasó a ser redundante — que es
    // información útil, no ruido.
    assert.throws(() => renderStory(story(), { name: "N", address: "Calle Mayor 1" } as never, "es"));
  });

  it("🔴 con perfilValido delante, el mismo dato SIRVE la página en vez de tirarla", () => {
    // Una web de restaurante no puede caerse porque alguien cargó mal el NAP en su ficha.
    const html = renderStory(story(), perfilValido({ name: "N", address: "Calle Mayor 1" }), "es");

    assert.match(html, /Bienvenidos/, "la página tiene que salir igual");
    assert.match(html, /<strong>N<\/strong>/, "y con lo que sí era válido del perfil");
    assert.doesNotMatch(html, /undefined/, "sin rastros de lo que se descartó");
  });

  it("🔴 la MARCA sobrevive perfilValido y llega al render (demo)", () => {
    // El tema por tenant se perdía acá: perfilValido recorta con allowlist y tiraba `brand`.
    //
    // Se afirma sobre **el valor del cliente**, no sobre el nombre del token que lo transporta. La
    // versión anterior exigía `--accent:#0a7d34` y se rompió cuando la entrega 3 metió una capa
    // semántica en medio (`--marca-primario` → `--accent`): el contrato —"la marca sobrevive
    // `perfilValido` y llega al render"— se seguía cumpliendo, y el test decía que no. Un test que
    // afirma sobre la forma de emisión de OTRO paquete se rompe cada vez que ese paquete se
    // reorganiza, y entonces se "arregla" mecánicamente sin mirar si el contrato sigue vivo.
    const html = renderStory(story(), perfilValido({ name: "N", brand: { color: "#0a7d34", font: "serif" } }), "es");
    assert.match(html, /#0a7d34/, "el color de marca no llega al CSS emitido");
    assert.match(html, /Georgia/, "la fuente de marca no llega al CSS emitido");
  });

  it("🔴 una marca con inyección/basura se descarta, no llega al render", () => {
    const html = renderStory(
      story(),
      perfilValido({ name: "N", brand: { color: "red;}x{", font: "Comic", logo: "javascript:1" } }),
      "es",
    );
    // El valor hostil ENTERO, no el nombre del token: `--accent:red` ya no se emite nunca, así que
    // esa afirmación pasaba aunque la validación hex se rompiera del todo — un test que solo podía
    // dar verde. Buscando lo que se inyectó, si la validación cae, cae este test.
    //
    // ⚠️ **Este test es de INTEGRACIÓN, y no es quien defiende.** Medido con mutaciones: romper la
    // validación hex de `perfilValido` tumba dos tests de más arriba, y romper la de `css.ts` tumba
    // ocho de `web-builder` — pero **ninguna de las dos tumba a éste**, porque `perfilValido` ya
    // descartó la basura antes de que el render la vea. Lo que aporta es que la CADENA no deje pasar
    // nada; las garantías por capa viven donde se pueden matar. No lo tomes como la red.
    assert.doesNotMatch(html, /red;\}x\{/, "el color basura llegó al <style>: la validación hex no filtró");
    assert.doesNotMatch(html, /Comic/);
    assert.doesNotMatch(html, /javascript:/);
  });

  it("un perfil bien formado sí llega al JSON-LD y al bloque de contacto", () => {
    const html = renderStory(story(), perfilValido(NAP_BUENO), "es");

    assert.match(html, /Calle Mayor 1/);
    assert.match(html, /28013/);
    assert.match(html, /"telephone": "\+34 910 000 000"/, "el NAP es el punto del JSON-LD local");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FRONTERA 3 de 4 — `perfilValido`, el validador del renderizador.
//
// Reconstruye el perfil campo por campo y tira lo que no enumera, AUNQUE haya pasado la allowlist de
// Postgres. En producción el perfil llega de una fila `jsonb` que nadie validó al escribirla: acá no
// se confía en las fronteras anteriores, se revalida.
// ─────────────────────────────────────────────────────────────────────────────

const FOTO = { src: "https://a.storyblok.com/f/1/x.jpg" };

describe("perfilValido — el perfil extendido (fotos, manual de marca, carta)", () => {
  it("deja pasar el manual de marca completo", () => {
    const p = perfilValido({
      name: "X",
      brand: {
        plantilla: "base",
        colores: { primario: "#0a7d34", fondoAlt: "#f4f4f2" },
        fuentes: { titulo: "condensada", decorativa: "script" },
      },
    });
    assert.equal(p?.brand?.plantilla, "base");
    assert.equal(p?.brand?.colores?.primario, "#0a7d34");
    assert.equal(p?.brand?.colores?.fondoAlt, "#f4f4f2");
    assert.equal(p?.brand?.fuentes?.titulo, "condensada");
    assert.equal(p?.brand?.fuentes?.decorativa, "script");
  });

  it("conserva el legacy {color, font} junto al manual: quién gana lo decide la emisión, no acá", () => {
    const p = perfilValido({ name: "X", brand: { color: "#111111", font: "serif", colores: { primario: "#0a7d34" } } });
    assert.equal(p?.brand?.color, "#111111");
    assert.equal(p?.brand?.font, "serif");
    assert.equal(p?.brand?.colores?.primario, "#0a7d34");
  });

  it("un color con `</style>` o `;}` se descarta y cae al default: la web sale sobria, nunca rota", () => {
    const p = perfilValido({
      name: "X",
      brand: { colores: { primario: "#fff</style><script>a()</script>", secundario: "red;}", titulo: "#0a7d34" } },
    });
    assert.equal(p?.brand?.colores?.primario, undefined);
    assert.equal(p?.brand?.colores?.secundario, undefined);
    // El token bueno del mismo objeto sobrevive: se descarta el valor, no la paleta entera.
    assert.equal(p?.brand?.colores?.titulo, "#0a7d34");
  });

  it("un color con `url(...)` no es hex: se descarta", () => {
    const p = perfilValido({ name: "X", brand: { colores: { fondo: "url(javascript:alert(1))" } } });
    assert.equal(p?.brand?.colores, undefined);
  });

  it("una fuente fuera de la allowlist cae al default del rol; un stack CSS nunca pasa", () => {
    const p = perfilValido({ name: "X", brand: { fuentes: { titulo: "Oswald, sans-serif", texto: "humanista" } } });
    assert.equal(p?.brand?.fuentes?.titulo, undefined);
    assert.equal(p?.brand?.fuentes?.texto, "humanista");
  });

  it("el legacy `font` NO acepta los nombres nuevos: son roles del manual, no de la clave vieja", () => {
    const p = perfilValido({ name: "X", brand: { font: "condensada" } });
    assert.equal(p?.brand, undefined);
  });

  it("portada y galería: pasan las https y se descartan las demás, una a una", () => {
    const p = perfilValido({
      name: "X",
      portada: { src: "https://a.storyblok.com/f/1/portada.jpg", alt: "Sala" },
      fotos: [FOTO, { src: "http://a.storyblok.com/f/1/inseguro.jpg" }, "no soy un objeto", { alt: "sin src" }],
    });
    assert.equal(p?.portada?.src, "https://a.storyblok.com/f/1/portada.jpg");
    assert.equal(p?.portada?.alt, "Sala");
    assert.equal(p?.fotos?.length, 1);
    assert.equal(p?.fotos?.[0]?.src, FOTO.src);
  });

  it("una foto sin `alt` NO inventa uno: se emitirá `alt=\"\"` (decorativa)", () => {
    const p = perfilValido({ name: "Trattoria", portada: FOTO });
    assert.equal(p?.portada?.src, FOTO.src);
    assert.equal(p?.portada?.alt, undefined);
  });

  it("una `foto` que viene como string se descarta, y el ítem se dibuja sin foto", () => {
    const p = perfilValido({ name: "X", menu: [{ name: "Pizza", foto: "https://a.storyblok.com/f/1/x.jpg" }] });
    assert.equal(p?.menu?.length, 1);
    assert.equal(p?.menu?.[0]?.foto, undefined);
  });

  it("la galería se corta en 30", () => {
    const p = perfilValido({ name: "X", fotos: Array.from({ length: 500 }, () => FOTO) });
    assert.equal(p?.fotos?.length, 30);
  });

  it("los precios se cortan en 3, y una entrada a medias se descarta sola — no tira el plato", () => {
    const p = perfilValido({
      name: "X",
      menu: [
        {
          name: "Pizza",
          precios: [
            { etiqueta: "Media", importe: "9 €" },
            { etiqueta: "Ración" },
            { importe: "15 €" },
            { etiqueta: "Familiar", importe: "20 €" },
          ],
        },
      ],
    });
    // Se cortan las 3 primeras de la FUENTE y de esas sobrevive la única entera.
    assert.equal(p?.menu?.length, 1);
    assert.deepEqual(p?.menu?.[0]?.precios, [{ etiqueta: "Media", importe: "9 €" }]);
  });

  it("si no sobrevive ningún precio, el plato cae a `price`", () => {
    const p = perfilValido({ name: "X", menu: [{ name: "Pizza", price: "12 €", precios: [{ etiqueta: "Media" }] }] });
    assert.equal(p?.menu?.[0]?.precios, undefined);
    assert.equal(p?.menu?.[0]?.price, "12 €");
  });

  it("`nota` y la foto del plato sobreviven", () => {
    const p = perfilValido({ name: "X", menu: [{ name: "Pizza", nota: "Sin gluten", foto: FOTO }] });
    assert.equal(p?.menu?.[0]?.nota, "Sin gluten");
    assert.equal(p?.menu?.[0]?.foto?.src, FOTO.src);
  });

  it("las categorías: sin `nombre` se descartan; `orden` solo si es entero >= 0", () => {
    const p = perfilValido({
      name: "X",
      menu_categorias: [
        { nombre: "Pizzas", foto: FOTO, orden: 0 },
        { foto: FOTO, orden: 1 },
        { nombre: "Pastas", orden: "2" },
        { nombre: "Postres", orden: -1 },
      ],
    });
    assert.equal(p?.menu_categorias?.length, 3);
    assert.equal(p?.menu_categorias?.[0]?.orden, 0);
    assert.equal(p?.menu_categorias?.[0]?.foto?.src, FOTO.src);
    // La categoría sobrevive sin `orden`: no tenerlo significa "orden de aparición en `menu`".
    assert.equal(p?.menu_categorias?.[1]?.nombre, "Pastas");
    assert.equal(p?.menu_categorias?.[1]?.orden, undefined);
    assert.equal(p?.menu_categorias?.[2]?.orden, undefined);
  });

  it("las categorías se cortan en 20", () => {
    const p = perfilValido({ name: "X", menu_categorias: Array.from({ length: 50 }, (_, i) => ({ nombre: `C${i}` })) });
    assert.equal(p?.menu_categorias?.length, 20);
  });

  it("un local con foto la conserva; una foto sola no convierte en local a un objeto vacío", () => {
    const conDatos = perfilValido({ name: "X", locations: [{ telephone: "+34 910 000 000", foto: FOTO }] });
    assert.equal(conDatos?.locations?.[0]?.foto?.src, FOTO.src);
    const soloFoto = perfilValido({ name: "X", locations: [{ foto: FOTO }] });
    assert.equal(soloFoto?.locations, undefined);
  });

  it("una clave que el validador no enumera NO llega al render, aunque haya pasado la allowlist SQL", () => {
    const p = perfilValido({ name: "X", portada_grande: FOTO, brand: { colores: { acento: "#0a7d34" } } });
    assert.equal((p as unknown as Record<string, unknown>)["portada_grande"], undefined);
    assert.equal((p?.brand?.colores as Record<string, unknown> | undefined)?.["acento"], undefined);
  });
});

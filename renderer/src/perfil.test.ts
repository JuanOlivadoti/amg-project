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
    const html = renderStory(story(), perfilValido({ name: "N", brand: { color: "#0a7d34", font: "serif" } }), "es");
    assert.match(html, /--accent:#0a7d34/, "el color de marca llega al CSS");
    assert.match(html, /--font:Georgia/, "y la fuente");
  });

  it("🔴 una marca con inyección/basura se descarta, no llega al render", () => {
    const html = renderStory(
      story(),
      perfilValido({ name: "N", brand: { color: "red;}x{", font: "Comic", logo: "javascript:1" } }),
      "es",
    );
    assert.doesNotMatch(html, /--accent:red/);
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

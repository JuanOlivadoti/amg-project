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

  it("🔴 una dirección a la que le falta una parte se descarta entera", () => {
    // `renderContact()` lee las tres SIN comprobar. Si falta una, imprime `undefined`, o lanza.
    const p = perfilValido({ name: "N", address: { streetAddress: "Calle Mayor 1" } });
    assert.equal(p?.address, undefined);
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

  it("un perfil bien formado sí llega al JSON-LD y al bloque de contacto", () => {
    const html = renderStory(story(), perfilValido(NAP_BUENO), "es");

    assert.match(html, /Calle Mayor 1/);
    assert.match(html, /28013/);
    assert.match(html, /"telephone": "\+34 910 000 000"/, "el NAP es el punto del JSON-LD local");
  });
});

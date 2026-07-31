import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, buildUserPrompt, type ProseInput } from "./content.js";

const input = (): ProseInput => ({
  businessContext: "Trattoria",
  languageCode: "es",
  pageTitle: "Título",
  intent: "local",
  pageType: "landing_local",
  isLocal: true,
  sections: ["Sobre Nosotros", "Especialidades"],
  faqs: ["¿Cómo reservo?"],
});

test("#8 reconcile: respuesta completa se usa tal cual", () => {
  const r = reconcile(
    {
      sections: [
        { heading: "Sobre Nosotros", body: "Somos una trattoria." },
        { heading: "Especialidades", body: "Pizza napolitana." },
      ],
      faqs: [{ question: "¿Cómo reservo?", answer: "Por teléfono." }],
    },
    input(),
  );
  assert.equal(r.sections[0]!.body, "Somos una trattoria.");
  assert.equal(r.faqs[0]!.answer, "Por teléfono.");
});

test("#8 reconcile: 'sections' como string (no-array) no crashea → usa fallback", () => {
  const r = reconcile({ sections: "texto suelto" as never, faqs: undefined }, input());
  assert.equal(r.sections.length, 2, "mantiene las secciones de entrada");
  assert.ok(r.sections.every((s) => s.body.length > 0), "todas con fallback");
});

test("#8 reconcile: elemento sin 'heading' se ignora sin romper norm()", () => {
  const r = reconcile({ sections: [{ body: "huérfano" } as never] }, input());
  assert.equal(r.sections.length, 2);
  assert.ok(r.sections.every((s) => s.body.length > 0));
});

test("#8 reconcile: siempre devuelve una entrada por cada heading/question de entrada", () => {
  const r = reconcile({}, input());
  assert.deepEqual(
    r.sections.map((s) => s.heading),
    ["Sobre Nosotros", "Especialidades"],
  );
  assert.equal(r.faqs.length, 1);
  assert.ok(r.faqs[0]!.answer.length > 0);
});

test("buildUserPrompt: con dirección sin postalCode, el prompt NO contiene 'undefined'", () => {
  const inp = input();
  inp.profile = {
    name: "La Birra Bar",
    address: { streetAddress: "Carrera de San Jerónimo 3", addressLocality: "Madrid" },
  };
  const prompt = buildUserPrompt(inp);
  assert.ok(!prompt.includes("undefined"), "El prompt NO debe contener la palabra 'undefined'");
  assert.ok(prompt.includes("Ubicación: Carrera de San Jerónimo 3, Madrid"), "Debe incluir calle y ciudad sin paréntesis");
  assert.ok(!prompt.includes("Ubicación: Carrera de San Jerónimo 3, Madrid ("), "La ubicación NO debe tener paréntesis si no hay código postal");
});

test("buildUserPrompt: con dirección incluyendo postalCode, el prompt lo incluye entre paréntesis", () => {
  const inp = input();
  inp.profile = {
    name: "La Birra Bar",
    address: {
      streetAddress: "Carrera de San Jerónimo 3",
      addressLocality: "Madrid",
      postalCode: "28014",
    },
  };
  const prompt = buildUserPrompt(inp);
  assert.ok(!prompt.includes("undefined"), "El prompt NO debe contener la palabra 'undefined'");
  assert.ok(
    prompt.includes("Ubicación: Carrera de San Jerónimo 3, Madrid (28014)"),
    "Debe incluir calle, ciudad y código postal entre paréntesis",
  );
});

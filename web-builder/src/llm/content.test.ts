import { test } from "node:test";
import assert from "node:assert/strict";
import { reconcile, type ProseInput } from "./content.js";

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

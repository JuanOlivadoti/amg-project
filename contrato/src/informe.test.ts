import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./index.js";
import type { KeywordResearchBrief } from "./index.js";
// El mismo fixture de emisión, desde `fixtures.ts` y NO desde `esquema.test.ts`: importar un módulo de
// test haría que node:test corra sus casos dos veces.
import { briefM2 } from "./fixtures.js";

test("el informe nunca contiene NaN, con cualquier dato incompleto", () => {
  const b = briefM2();
  // El default de la columna `coste_breakdown` es '{}' y el seed de la demo no lo puebla.
  b.meta_run.coste_breakdown = {} as KeywordResearchBrief["meta_run"]["coste_breakdown"];
  b.meta_run.calidad_datos = {
    cobertura_volumen: null,
    cobertura_kd: null,
    endpoints_degradados: null,
  };

  const md = renderReport(b);
  assert.ok(!md.includes("NaN"), `el informe emitió NaN:\n${md}`);
  assert.ok(!md.includes("undefined"), `el informe emitió undefined:\n${md}`);
});

test("sin desglose, NO se pinta la tabla de desglose, y el total sigue estando", () => {
  const b = briefM2();
  b.meta_run.coste_breakdown = {} as KeywordResearchBrief["meta_run"]["coste_breakdown"];

  const md = renderReport(b);
  // Una tabla de tres `n/d` ocupa el lugar del argumento comercial sin decirlo, y parece un fallo del
  // sistema en vez de un dato que falta. El total SÍ es un dato: se muestra.
  assert.ok(!md.includes("| DataForSEO |"), "pintó el desglose sin tener los datos");
  assert.ok(md.includes("0.3097"), "perdió el total, que sí se conoce");
  assert.match(md, /desglose.*no.*registr/i, "no dijo que el desglose falta");
});

test("una cobertura null sale n/d, no 0% ni NaN%", () => {
  const b = briefM2();
  b.meta_run.calidad_datos.cobertura_kd = null;
  const md = renderReport(b);
  assert.match(md, /dificultad \(KD\).*\bn\/d\b/i);
  assert.ok(!md.includes("0%"), "un dato ausente se mostró como 0%");
});

test("endpoints_degradados null dice que no se sabe; [] no dice nada", () => {
  const sinSaber = briefM2();
  sinSaber.meta_run.calidad_datos.endpoints_degradados = null;
  assert.match(renderReport(sinSaber), /no.*se.*registr/i);

  const ninguno = briefM2();
  ninguno.meta_run.calidad_datos.endpoints_degradados = [];
  const md = renderReport(ninguno);
  assert.ok(!md.includes("🔴"), "avisó de un fallo que no hubo");
  assert.ok(!/no.*se.*registr/i.test(md), "dijo 'no se sabe' cuando sí se sabe: ninguno falló");
});

test("un backlog vacío no pinta la sección", () => {
  const md = renderReport(briefM2({ backlog: [] }));
  assert.ok(!md.includes("Backlog"), "pintó una sección vacía");
});

import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "../types.js";
import { usdFromMicros } from "../lib/cost.js";
import type { CostBreakdown } from "../lib/cost.js";
import type { DataQuality, KeywordResearchBrief, Market, ProposedPage } from "../types.js";

export function assembleBrief(args: {
  /** Compartidos con el dataset crudo (`out/keywords.json`) para poder cruzarlos. */
  runId: string;
  generatedAt: string;
  cliente: string;
  market: Market;
  pages: ProposedPage[];
  backlog: Array<{ keyword_principal: string; opportunity_score: number }>;
  keywordsAnalizadas: number;
  calidadDatos: DataQuality;
  costeMicros: number;
  costeBreakdown: CostBreakdown;
  modelosSinPrecio: string[];
}): KeywordResearchBrief {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: args.runId,
    cliente: args.cliente,
    market: args.market,
    generated_at: args.generatedAt,
    status: "pending_approval",
    paginas_propuestas: args.pages,
    backlog: args.backlog,
    meta_run: {
      keywords_analizadas: args.keywordsAnalizadas,
      paginas_propuestas: args.pages.length,
      calidad_datos: args.calidadDatos,
      coste_micros_usd: args.costeMicros,
      coste_breakdown: args.costeBreakdown,
      ...(args.modelosSinPrecio.length ? { modelos_sin_precio: args.modelosSinPrecio } : {}),
    },
  };
}

/**
 * Métrica ausente → "n/d", nunca "0". El informe es el entregable que ve el cliente: mostrar 0
 * donde no hay dato equivale a afirmar que la keyword no tiene búsquedas, que es falso.
 */
function metric(v: number | null): string {
  return v === null ? "n/d" : String(v);
}

/** Informe legible (Markdown) — el entregable humano de la compuerta (ADR-07). */
export function renderReport(brief: KeywordResearchBrief): string {
  const l: string[] = [];
  l.push(`# Keyword Research — ${brief.cliente}`);
  l.push(`\n_${brief.market.country} · ${brief.market.language_code} · ${brief.generated_at}_\n`);
  l.push(`- Keywords analizadas: **${brief.meta_run.keywords_analizadas}**`);
  l.push(`- Páginas propuestas: **${brief.meta_run.paginas_propuestas}**`);

  const c = brief.meta_run.coste_breakdown;
  l.push(`\n### Coste del research\n`);
  l.push(`| Proveedor | Coste |`);
  l.push(`|---|---|`);
  l.push(`| DataForSEO | $${usdFromMicros(c.dataforseo_micros)} |`);
  l.push(`| LLM (generación) | $${usdFromMicros(c.llm_generation_micros)} |`);
  l.push(`| LLM (embeddings) | $${usdFromMicros(c.llm_embeddings_micros)} |`);
  l.push(`| **TOTAL** | **$${usdFromMicros(brief.meta_run.coste_micros_usd)}** |`);
  if (brief.meta_run.modelos_sin_precio?.length) {
    l.push(
      `\n> ⚠️ Coste **incompleto**: sin tarifa configurada para ${brief.meta_run.modelos_sin_precio.join(", ")}.`,
    );
  }
  l.push("");

  // Calidad de los datos del run. Va ARRIBA de las páginas a propósito: quien aprueba tiene que
  // saber sobre qué base está aprobando ANTES de mirar la lista.
  const q = brief.meta_run.calidad_datos;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  l.push(`### Calidad de los datos\n`);
  l.push(`| Métrica | Cobertura |`);
  l.push(`|---|---|`);
  l.push(`| Keywords con **volumen** conocido | **${pct(q.cobertura_volumen)}** |`);
  l.push(`| Keywords con **dificultad (KD)** conocida | **${pct(q.cobertura_kd)}** |`);
  if (q.endpoints_degradados.length) {
    l.push(
      `\n> 🔴 **Datos incompletos:** falló el endpoint \`${q.endpoints_degradados.join("`, `")}\`. ` +
        `Las métricas que faltan **no son ceros**: no se pudieron obtener.`,
    );
  }
  l.push("");

  // Las páginas se separan por EVIDENCIA, no solo por score. Mezclarlas en una sola tabla hacía
  // indistinguible una página respaldada por 480 búsquedas/mes de una apuesta sin ningún dato.
  const conDatos = brief.paginas_propuestas.filter((p) => p.evidencia === "datos_mercado");
  const sinValidar = brief.paginas_propuestas.filter((p) => p.evidencia === "sin_validar");

  const tabla = (pages: ProposedPage[], offset: number) => {
    l.push(`| # | Tipo | Keyword principal | Vol. | KD | Score | Conf. | Intención |`);
    l.push(`|---|---|---|---|---|---|---|---|`);
    pages.forEach((p, i) => {
      l.push(
        `| ${offset + i + 1} | ${p.tipo} | ${p.keyword_principal} | ${metric(p.volumen)} | ${metric(p.dificultad)} | ` +
          `${p.opportunity_score} | ${p.score_confidence} | ${p.intencion}${p.local ? " (local)" : ""} |`,
      );
    });
  };

  l.push(`## Páginas propuestas\n`);

  if (conDatos.length) {
    l.push(`### ✅ Respaldadas por datos de mercado (${conDatos.length})\n`);
    l.push(`Hay demanda de búsqueda **demostrable** detrás de estas páginas.\n`);
    tabla(conDatos, 0);
    l.push("");
  }

  if (sinValidar.length) {
    l.push(`### ⚠️ Sin validar (${sinValidar.length})\n`);
    l.push(
      `**Ninguna keyword de estos grupos tiene volumen de búsqueda conocido.** Suelen ser servicios ` +
        `reales que el negocio ofrece, y por eso la página puede tener sentido igual — pero **no hay ` +
        `evidencia de que alguien los busque**, así que no se pueden vender como oportunidad SEO.\n`,
    );
    tabla(sinValidar, conDatos.length);
    l.push("");
  }

  if (brief.paginas_propuestas.some((p) => p.volumen === null || p.dificultad === null)) {
    l.push(
      `> **n/d** = el proveedor de datos no devolvió la métrica para esa keyword. ` +
        `**No es un 0**: es un dato que no tenemos, y por eso esas páginas van con la confianza baja.`,
    );
  }

  l.push(`\n## Detalle por página\n`);
  brief.paginas_propuestas.forEach((p, i) => {
    l.push(`### ${i + 1}. ${p.content_brief.h1}`);
    l.push(`- **Slug:** \`${p.url_slug}\` · **Tipo:** ${p.tipo} · **Schema:** ${p.seo.schema_type}`);
    l.push(`- **Meta title:** ${p.seo.meta_title}`);
    l.push(`- **Meta description:** ${p.seo.meta_description}`);
    l.push(
      `- **Keyword principal:** ${p.keyword_principal} (vol ${metric(p.volumen)} · KD ${metric(p.dificultad)})`,
    );
    if (p.keywords_secundarias.length) l.push(`- **Secundarias:** ${p.keywords_secundarias.join(", ")}`);
    if (p.content_brief.secciones_sugeridas.length)
      l.push(`- **Secciones:** ${p.content_brief.secciones_sugeridas.join(" · ")}`);
    if (p.preguntas_frecuentes.length)
      l.push(`- **FAQs:** ${p.preguntas_frecuentes.map((q) => `_${q}_`).join(" · ")}`);
    if (p.content_brief.claims_prohibidos?.length)
      l.push(`- ⚠️ **Claims prohibidos:** ${p.content_brief.claims_prohibidos.join(", ")}`);
    l.push("");
  });

  if (brief.backlog.length) {
    l.push(`## Backlog (fases futuras)\n`);
    for (const b of brief.backlog) l.push(`- ${b.keyword_principal} — score ${b.opportunity_score}`);
  }
  return l.join("\n") + "\n";
}

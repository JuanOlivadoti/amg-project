import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "../types.js";
import type { KeywordResearchBrief, Market, ProposedPage } from "../types.js";

export function assembleBrief(args: {
  cliente: string;
  market: Market;
  pages: ProposedPage[];
  backlog: Array<{ keyword_principal: string; opportunity_score: number }>;
  keywordsAnalizadas: number;
  costeMicros: number;
}): KeywordResearchBrief {
  return {
    schema_version: SCHEMA_VERSION,
    run_id: randomUUID(),
    cliente: args.cliente,
    market: args.market,
    generated_at: new Date().toISOString(),
    status: "pending_approval",
    paginas_propuestas: args.pages,
    backlog: args.backlog,
    meta_run: {
      keywords_analizadas: args.keywordsAnalizadas,
      paginas_propuestas: args.pages.length,
      coste_micros_usd: args.costeMicros,
    },
  };
}

/** Informe legible (Markdown) — el entregable humano de la compuerta (ADR-07). */
export function renderReport(brief: KeywordResearchBrief): string {
  const l: string[] = [];
  l.push(`# Keyword Research — ${brief.cliente}`);
  l.push(`\n_${brief.market.country} · ${brief.market.language_code} · ${brief.generated_at}_\n`);
  l.push(`- Keywords analizadas: **${brief.meta_run.keywords_analizadas}**`);
  l.push(`- Páginas propuestas: **${brief.meta_run.paginas_propuestas}**`);
  l.push(`- Coste API: **$${(brief.meta_run.coste_micros_usd / 1_000_000).toFixed(4)}**\n`);

  l.push(`## Páginas propuestas\n`);
  l.push(`| # | Tipo | Keyword principal | Vol. | KD | Score | Conf. | Intención |`);
  l.push(`|---|---|---|---|---|---|---|---|`);
  brief.paginas_propuestas.forEach((p, i) => {
    l.push(
      `| ${i + 1} | ${p.tipo} | ${p.keyword_principal} | ${p.volumen} | ${p.dificultad} | ` +
        `${p.opportunity_score} | ${p.score_confidence} | ${p.intencion}${p.local ? " (local)" : ""} |`,
    );
  });

  l.push(`\n## Detalle por página\n`);
  brief.paginas_propuestas.forEach((p, i) => {
    l.push(`### ${i + 1}. ${p.content_brief.h1}`);
    l.push(`- **Slug:** \`${p.url_slug}\` · **Tipo:** ${p.tipo} · **Schema:** ${p.seo.schema_type}`);
    l.push(`- **Meta title:** ${p.seo.meta_title}`);
    l.push(`- **Meta description:** ${p.seo.meta_description}`);
    l.push(`- **Keyword principal:** ${p.keyword_principal} (vol ${p.volumen} · KD ${p.dificultad})`);
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

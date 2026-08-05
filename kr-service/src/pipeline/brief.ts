// Armado del brief: la ESTRUCTURA que el M2 emite al final del run.
//
// El render legible (`renderReport`) ya no vive acá: se mudó a `contrato/src/informe.ts` en KR-2a,
// porque tiene más de un llamador y el criterio de qué se le dice al cliente cuando falta un dato no
// puede tener dos versiones. Se importa `from "contrato"`.
import { SCHEMA_VERSION } from "../types.js";
import type { CostBreakdown } from "../lib/cost.js";
import type { DataQuality, KeywordResearchBrief, Market, ProposedPage } from "../types.js";

export function assembleBrief(args: {
  /** Compartidos con el dataset crudo (`datasets/keywords.json`) para poder cruzarlos. */
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

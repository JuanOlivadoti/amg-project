// La superficie pública del contrato compartido. Lo que no se exporta acá, no existe para los demás
// paquetes: se importa por NOMBRE de paquete (`from "contrato"`), nunca por ruta relativa.
export { SCHEMA_VERSION } from "./tipos.js";
export type {
  Market,
  SearchIntent,
  PageType,
  PageStrategy,
  PageEvidence,
  DataQuality,
  PageSeo,
  ContentBrief,
  ProposedPage,
  KeywordResearchBrief,
  CostBreakdown,
} from "./tipos.js";
export { usdFromMicros } from "./dinero.js";
export { renderReport } from "./informe.js";
export {
  emisionM2,
  esquemaBase,
  consumoM1,
  parseBrief,
  SUPPORTED_SCHEMA_VERSIONS,
} from "./esquema.js";
// Los tipos de CONSUMO, derivados de `consumoM1` con `z.infer`. Son lo que el M1 recibe de verdad, y
// NO lo mismo que `KeywordResearchBrief`/`ProposedPage`, que son los de emisión: ver el comentario
// largo en `esquema.ts`, que explica los cinco campos de diferencia y por qué confundirlos mentía.
export type { ConsumoM1Brief, ConsumoM1Pagina } from "./esquema.js";

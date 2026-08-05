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
export {
  emisionM2,
  esquemaBase,
  consumoM1,
  parseBrief,
  SUPPORTED_SCHEMA_VERSIONS,
} from "./esquema.js";

/**
 * Punto de entrada del paquete `db`. Es lo único que los demás paquetes deberían importar: el
 * resto de los archivos son detalle interno.
 */
export { PgStore, PLAZO_RUN_COLGADO, RunSinWorkflowError } from "./store.js";
export type {
  TenantContext,
  NewRun,
  RunMarket,
  RunStatus,
  KeywordRow,
  PageRow,
  PaginaPropuesta,
  ClientRow,
  CambiosPagina,
  RunSummary,
  InformeRow,
  DatosEntregable,
  ClienteConectadoGoogle,
  ResenaParaGuardar,
  BorradorParaGuardar,
  ResenaParaPublicar,
  ResenaPendienteAlerta,
} from "./store.js";

export { PgSitios, MemSitios } from "./sitios.js";
export type { Sitio, SitioResolver } from "./sitios.js";

export { PgClientes } from "./clientes.js";
export type { ClienteCRM, NuevoCliente, CambiosCliente } from "./clientes.js";

export { PgMembresias } from "./membresias.js";
export type { Miembro, CambioRol, CodigoTelegram } from "./membresias.js";

export { PgIdeas, ESTADOS_IDEA, TRANSICIONES_IDEA, esEstadoIdea, esTransicionValida, LIMITE_IDEAS } from "./ideas.js";
export type {
  EstadoIdea,
  IdeaResumen,
  IdeaDetalle,
  FiltrosIdeas,
  CambiosIdea,
  ResultadoCambioEstado,
} from "./ideas.js";

export { PgResenas } from "./resenas.js";
export type { ResenaGoogle } from "./resenas.js";

export { NodePgPool, PglitePool, ejecutorDe } from "./pool.js";
export type { DbPool, Tx, SqlExecutor, NodePgPoolLike, NodePgClientLike } from "./pool.js";

export { PgKeywordCache } from "./cache.js";
export type { KeywordCache, CacheMeta } from "./cache.js";

export { PgTaskLog, MAX_INTENTOS } from "./task-log.js";
export type { Reserva } from "./task-log.js";

export { aplicarMigraciones, MIGRATIONS_DIR } from "./migrate.js";

export { migrarConRegistro, ConexionReservada } from "./deploy.js";

export { sembrarDemo, PERFIL_DEMO, DEMO_CLIENT_ID } from "./seed-demo.js";
export type { OpcionesSeed, ResultadoSeed } from "./seed-demo.js";

/**
 * Seed de ideas de EJEMPLO. Se exporta porque `api/src/dev-server.ts` lo necesita y los paquetes se
 * importan por nombre, no por ruta. **No** está enganchado a `reseed:demo`: producción tiene los
 * datos reales de la demo y sembrar ahí ideas inventadas es una decisión que nadie ha tomado.
 */
export { sembrarIdeasDemo, IDEAS_DEMO, MARCA_EJEMPLO } from "./seed-ideas-demo.js";
export type { DestinoIdeasDemo, IdeaDemo, AnalisisIdeaDemo } from "./seed-ideas-demo.js";

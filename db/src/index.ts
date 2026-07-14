/**
 * Punto de entrada del paquete `db`. Es lo único que los demás paquetes deberían importar: el
 * resto de los archivos son detalle interno.
 */
export { PgStore } from "./store.js";
export type {
  TenantContext,
  NewRun,
  RunMarket,
  RunStatus,
  KeywordRow,
  PageRow,
  RunSummary,
} from "./store.js";

export { NodePgPool, PglitePool, ejecutorDe } from "./pool.js";
export type { DbPool, Tx, SqlExecutor, NodePgPoolLike, NodePgClientLike } from "./pool.js";

export { PgKeywordCache } from "./cache.js";
export type { KeywordCache, CacheMeta } from "./cache.js";

export { PgTaskLog, MAX_INTENTOS } from "./task-log.js";
export type { Reserva } from "./task-log.js";

export { aplicarMigraciones, MIGRATIONS_DIR } from "./migrate.js";

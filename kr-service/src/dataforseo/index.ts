import { config } from "../config.js";
import { LiveProvider } from "./live-provider.js";
import { MockProvider } from "./mock-provider.js";
import { CachedProvider } from "./cached-provider.js";
import { FileCache } from "./cache.js";
import type { KeywordCache } from "./cache.js";
import type { KeywordDataProvider } from "./provider.js";
import type { ProviderTaskLog } from "./task-log.js";

/**
 * Provider según config (mock por default, live si DATAFORSEO_MODE=live), envuelto en la cache.
 *
 * La cache SOLO envuelve al provider live: cachear el mock no ahorra nada (es determinista y
 * gratis) y ensuciaría el loop de desarrollo sirviendo datos viejos cuando se toca el propio mock.
 */
/**
 * @param cache  La cache a usar. Si no se inyecta, cae en `FileCache` (un archivo JSON local).
 *
 * Inyectarla NO es un lujo: `PgKeywordCache` existía, tenía tests, y **no la usaba nadie** — el
 * pipeline seguía clavado a `FileCache`. En un despliegue con varias instancias eso significa que
 * cada proceso paga sus propios misses (la cache no se comparte) y que dos procesos escribiendo el
 * mismo archivo se pisan las entradas. La cache de Postgres es lo que hace que la 2ª corrida de
 * CUALQUIER cliente del mismo vertical salga gratis; en un archivo local, ese ahorro no existe.
 */
export function getProvider(taskLog?: ProviderTaskLog, cache?: KeywordCache): KeywordDataProvider {
  if (config.dataforseo.mode !== "live") return new MockProvider();

  const live = new LiveProvider(taskLog);
  if (!config.cache.enabled) return live;

  /*
   * NO se cachea el SANDBOX. Y no es una optimización: es una defensa.
   *
   * El sandbox es GRATIS, así que cachearlo no ahorra un centavo — su único efecto posible es
   * envenenar producción. Como las claves no llevaban el entorno, una corrida de sandbox dejaba
   * 217 entradas con `volume: null` (el sandbox no devuelve volúmenes); al cambiar la URL base a
   * producción —que es UN renglón del .env, y es exactamente lo que dice la guía de la corrida
   * real— esas entradas se servían como ACIERTOS. La corrida "de producción" salía barata, sin
   * volúmenes, y con un brief basura que parecía legítimo.
   *
   * Beneficio cero, riesgo de corromper el entregable del cliente en silencio: no se cachea.
   */
  if (config.dataforseo.isSandbox) return live;

  // Defensa en profundidad: aunque acá ya no se cachea el sandbox, las claves llevan el entorno
  // igual. Si alguien reactiva la cache del sandbox, los datos no se van a mezclar.
  return new CachedProvider(live, cache ?? new FileCache(config.cache.path), cacheNamespace());
}

/**
 * Espacio de nombres de la cache: proveedor + entorno.
 *
 * Todo lo que cambia la RESPUESTA tiene que estar en la clave. El entorno la cambia por completo
 * (sandbox devuelve ficción), así que omitirlo era un bug de corrección, no de higiene.
 */
function cacheNamespace(): string {
  const host = config.dataforseo.isSandbox ? "sandbox" : "prod";
  return `dfs:${host}`;
}

export type { KeywordDataProvider };
export { CachedProvider } from "./cached-provider.js";
export { MemTaskLog, NoopTaskLog, payloadHash, MAX_INTENTOS } from "./task-log.js";
export type { ProviderTaskLog, Reserva } from "./task-log.js";

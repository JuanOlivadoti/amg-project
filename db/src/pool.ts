/**
 * El contrato de conexión de la capa de datos.
 *
 * ## Por qué esto existe (y por qué no es un envoltorio decorativo)
 *
 * El `PgStore` aplica el contexto de tenant con `set_config(..., true)` y `set local role app_user`.
 * Las dos cosas son **locales a la transacción**, y una transacción vive en **una conexión**.
 *
 * La versión anterior tenía un `Db` con un `query()` suelto y hacía `begin` / `set_config` / la
 * query / `commit` llamándolo cuatro veces. Contra PGlite —una sola conexión— eso funciona por
 * accidente. Contra un `pg.Pool` de verdad, **cada `query()` toma una conexión cualquiera**: el
 * `begin` se iría a la conexión 1, el `set_config` a la 2 y el `insert` a la 3. El insert correría
 * fuera de la transacción, sin tenant seteado y sin `set local role app_user` — es decir, **con el
 * rol del pool, que salta RLS**. El aislamiento entre clientes no se degradaría: desaparecería.
 *
 * Por eso el único acceso a la base es a través de `transaction(fn)`, que **reserva una conexión**
 * y se la pasa a `fn`. El Store ya no tiene ningún `query()` al que llamar por fuera: no es que
 * "haya que acordarse" de usar la transacción, es que no existe otra forma. El tipo es el que
 * impide reintroducir el bug.
 */

/** Una conexión RESERVADA, dentro de una transacción abierta. */
export interface Tx {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

export interface DbPool {
  /**
   * Toma una conexión, abre transacción, corre `fn`, y hace `commit` (o `rollback` si `fn` lanza).
   * La conexión se devuelve al pool SIEMPRE.
   *
   * Las queries de `fn` DEBEN ir por el `tx` que recibe. Es la única forma de garantizar que el
   * `set local` del contexto de tenant aplica a las queries que se quieren proteger.
   */
  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
}

/** Ejecuta SQL sin contexto de tenant. Es lo que usan las caches (service-role, ver `cache.ts`). */
export interface SqlExecutor {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

// ---------------------------------------------------------------- PGlite (tests)

/** Lo que se le pide a PGlite. Tipado estructural para no atarse a su clase concreta. */
interface PgliteLike {
  transaction<T>(fn: (tx: PgliteTx) => Promise<T>): Promise<T>;
}
interface PgliteTx {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

/**
 * Adaptador de PGlite. Su `transaction()` es exclusiva (`_runExclusiveTransaction`): serializa las
 * transacciones sobre su única conexión, que es exactamente la semántica que hace falta para que
 * dos runs concurrentes no se pisen el contexto.
 */
export class PglitePool implements DbPool {
  constructor(private readonly pg: PgliteLike) {}

  transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    // PGlite ya emite BEGIN/COMMIT/ROLLBACK: no hay que hacerlo a mano.
    return this.pg.transaction(async (tx) => fn(adaptarTx(tx)));
  }
}

function adaptarTx(tx: PgliteTx): Tx {
  return {
    query: <T>(sql: string, params?: unknown[]) => tx.query<T>(sql, params) as Promise<{ rows: T[] }>,
    exec: (sql: string) => tx.exec(sql),
  };
}

// ---------------------------------------------------------------- node-postgres (producción)

/**
 * Tipado estructural de `pg.Pool` — así el paquete `db` no depende de `pg` para compilar, y el
 * mismo adaptador sirve para Supabase, un Postgres propio o cualquier cliente compatible.
 */
export interface NodePgPoolLike {
  connect(): Promise<NodePgClientLike>;
}
export interface NodePgClientLike {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  release(err?: unknown): void;
}

/**
 * Adaptador de `pg.Pool`. Acá está lo que la versión anterior no hacía: **una sola conexión** para
 * toda la transacción, y `release()` en el `finally` (una conexión que no se devuelve agota el pool
 * y cuelga la aplicación entera).
 *
 * El `release(err)` con el error no es cosmético: le dice al pool que **descarte** la conexión en
 * vez de reciclarla. Si el rollback falló, esa conexión puede seguir en transacción abierta y con
 * el rol `app_user` y el tenant del usuario anterior pegados — devolverla al pool sería servir el
 * contexto de un cliente a la petición del siguiente.
 */
export class NodePgPool implements DbPool {
  constructor(private readonly pool: NodePgPoolLike) {}

  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: Tx = {
      query: (sql, params) => client.query(sql, params),
      exec: (sql) => client.query(sql),
    };

    try {
      await client.query("begin");
      const out = await fn(tx);
      await client.query("commit");
      client.release();
      return out;
    } catch (e) {
      try {
        await client.query("rollback");
        client.release();
      } catch (errRollback) {
        // No se pudo limpiar: la conexión queda envenenada. Se destruye, no se recicla.
        client.release(errRollback);
      }
      throw e;
    }
  }
}

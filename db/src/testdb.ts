import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

/**
 * Postgres REAL para los tests, sin Docker ni cuenta: PGlite es Postgres compilado a WASM y corre
 * dentro de Node.
 *
 * Por qué importa: ADR-10 exige tests de RLS ANTES de la Fase 1, y el aislamiento entre tenants es
 * LA garantía que se le vende al cliente. Una política que no se testea es una política que no
 * existe. Simular RLS con mocks no prueba nada —el bug siempre está en la semántica exacta de
 * Postgres—, y exigir Docker rompería el principio de que todo el proyecto corre sin instalar nada.
 */

const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(here, "..", "migrations");

/** Identidad de la petición. Es lo que las políticas RLS leen (vía las funciones de `app`). */
export interface RequestContext {
  tenantId?: string | null;
  role?: "maestro" | "equipo" | "cliente" | null;
  clientId?: string | null;
}

export class TestDb {
  private constructor(private readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite();
    const sql = await readFile(join(MIGRATIONS, "0001_init.sql"), "utf8");
    await pg.exec(sql);
    return new TestDb(pg);
  }

  /**
   * Corre una query CON las políticas RLS activas, en el contexto de un usuario.
   *
   * Todo dentro de una transacción con `set local`: el contexto no se filtra a la query siguiente.
   * `set local role app_user` es la clave — como superusuario, PGlite saltaría las políticas y el
   * test pasaría siempre (un test de seguridad que siempre pasa es peor que no tenerlo).
   */
  async asUser<T = Record<string, unknown>>(
    ctx: RequestContext,
    sql: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    await this.pg.exec("begin");
    try {
      await this.pg.query("select set_config('app.tenant_id', $1, true)", [ctx.tenantId ?? ""]);
      await this.pg.query("select set_config('app.role', $1, true)", [ctx.role ?? ""]);
      await this.pg.query("select set_config('app.client_id', $1, true)", [ctx.clientId ?? ""]);
      await this.pg.exec("set local role app_user");

      const res = await this.pg.query<T>(sql, params);
      await this.pg.exec("rollback"); // los tests no se ensucian entre sí
      return res.rows;
    } catch (e) {
      await this.pg.exec("rollback");
      throw e;
    }
  }

  /** Query como service-role (salta RLS). Es como el backend siembra datos y toca las caches. */
  async asService<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}

/** Dos tenants con un cliente y un run cada uno: el escenario mínimo para probar el aislamiento. */
export interface Seed {
  tenantA: string;
  tenantB: string;
  clientA1: string;
  clientA2: string;
  clientB1: string;
  runA1: string;
  runB1: string;
}

export async function seed(db: TestDb): Promise<Seed> {
  const [t] = await db.asService<{ a: string; b: string }>(`
    with a as (insert into tenants (nombre, slug) values ('Agencia A', 'agencia-a') returning id),
         b as (insert into tenants (nombre, slug) values ('Agencia B', 'agencia-b') returning id)
    select a.id as a, b.id as b from a, b
  `);
  const tenantA = t!.a;
  const tenantB = t!.b;

  const mkClient = async (tenantId: string, nombre: string) => {
    const [c] = await db.asService<{ id: string }>(
      "insert into clients (tenant_id, nombre) values ($1, $2) returning id",
      [tenantId, nombre],
    );
    return c!.id;
  };

  const clientA1 = await mkClient(tenantA, "Trattoria Bella Napoli");
  const clientA2 = await mkClient(tenantA, "Bar Pepe");
  const clientB1 = await mkClient(tenantB, "Sushi Zen");

  const mkRun = async (tenantId: string, clientId: string) => {
    const [r] = await db.asService<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country, market_language)
       values ($1, $2, 'kr.v0.5', 'prompt de prueba', 'ES', 'es') returning id`,
      [tenantId, clientId],
    );
    return r!.id;
  };

  const runA1 = await mkRun(tenantA, clientA1);
  const runB1 = await mkRun(tenantB, clientB1);

  return { tenantA, tenantB, clientA1, clientA2, clientB1, runA1, runB1 };
}

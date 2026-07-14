import { PGlite } from "@electric-sql/pglite";
import { aplicarMigraciones } from "./migrate.js";

/**
 * Postgres REAL para los tests, sin Docker ni cuenta: PGlite es Postgres compilado a WASM y corre
 * dentro de Node.
 *
 * Por qué importa: ADR-10 exige tests de RLS ANTES de la Fase 1, y el aislamiento entre tenants es
 * LA garantía que se le vende al cliente. Una política que no se testea es una política que no
 * existe. Simular RLS con mocks no prueba nada —el bug siempre está en la semántica exacta de
 * Postgres—, y exigir Docker rompería el principio de que todo el proyecto corre sin instalar nada.
 */

/**
 * Identidad de la petición. Lo que las políticas leen (vía las funciones de `app`).
 *
 * **No hay rol acá.** Desde `0002_auth.sql`, el rol se DERIVA de `memberships`: quien llama dice
 * quién es, no qué puede hacer. Que este tipo ya no tenga dónde poner un rol no es cosmética — es
 * la garantía, en el tipo, de que ningún test (ni ningún caller) pueda declararse `maestro`.
 */
export interface RequestContext {
  tenantId?: string | null;
  userId?: string | null;
  /** El proceso del backend: se conecta como `app_service`, no suplanta a nadie. */
  servicio?: boolean;
}

export class TestDb {
  private constructor(private readonly pg: PGlite) {}

  static async create(): Promise<TestDb> {
    const pg = new PGlite();
    await aplicarMigraciones(pg);
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
      await this.pg.query("select set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);
      await this.pg.exec(ctx.servicio ? "set local role app_service" : "set local role app_user");

      const res = await this.pg.query<T>(sql, params);
      await this.pg.exec("rollback"); // los tests no se ensucian entre sí
      return res.rows;
    } catch (e) {
      await this.pg.exec("rollback");
      throw e;
    }
  }

  /**
   * Query como service-role de INFRAESTRUCTURA (superusuario: salta RLS).
   *
   * Ojo con no confundirla con `app_service`: esta es la que corre migraciones y siembra datos.
   * `app_service` (el orquestador) SÍ está sujeto a RLS.
   */
  async asService<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  /**
   * Query cruda en la conexión actual, respetando el estado que haya (transacción abierta, `set
   * local role`, GUCs seteados a mano).
   *
   * Existe para UN caso: montar a mano el contexto exacto del ataque —incluido setear `app.role`,
   * el GUC que ya nadie lee— y comprobar que no sirve de nada.
   */
  async queryEnTx<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const res = await this.pg.query<T>(sql, params);
    return res.rows;
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
  /** Usuarios CON membresía. El rol sale de acá, no de lo que diga el que llama. */
  equipoA: string;
  equipoB: string;
  /** Dueño del negocio A1: rol `cliente`, atado a SU cliente. */
  duenoA1: string;
  /** Un usuario sin ninguna membresía: no debe ver absolutamente nada. */
  intruso: string;
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

  const mkMembresia = async (tenantId: string, rol: string, clientId: string | null) => {
    const [m] = await db.asService<{ user_id: string }>(
      `insert into memberships (tenant_id, user_id, rol, client_id)
       values ($1, gen_random_uuid(), $2::user_role, $3) returning user_id`,
      [tenantId, rol, clientId],
    );
    return m!.user_id;
  };

  const equipoA = await mkMembresia(tenantA, "equipo", null);
  const equipoB = await mkMembresia(tenantB, "equipo", null);
  const duenoA1 = await mkMembresia(tenantA, "cliente", clientA1);

  const [i] = await db.asService<{ id: string }>("select gen_random_uuid() as id");
  const intruso = i!.id; // existe como uuid, pero NO tiene membresía en ningún lado

  const mkRun = async (tenantId: string, clientId: string) => {
    const [r] = await db.asService<{ id: string }>(
      `insert into kr_runs (tenant_id, client_id, schema_version, prompt, market_country,
                            market_language, market_location_code)
       values ($1, $2, 'kr.v0.5', 'prompt de prueba', 'ES', 'es', 2724) returning id`,
      [tenantId, clientId],
    );
    return r!.id;
  };

  const runA1 = await mkRun(tenantA, clientA1);
  const runB1 = await mkRun(tenantB, clientB1);

  return {
    tenantA,
    tenantB,
    clientA1,
    clientA2,
    clientB1,
    runA1,
    runB1,
    equipoA,
    equipoB,
    duenoA1,
    intruso,
  };
}

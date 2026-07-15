import type { DbPool } from "./pool.js";

/**
 * Registro de peticiones facturables al proveedor, sobre `kr_provider_tasks` (ADR-10 / ADR-14).
 *
 * ## Por qué NO lleva `tenant_id`
 *
 * Igual que las caches: lo que se registra es una petición al MERCADO (un lote de keywords en un
 * mercado), no un dato de un cliente. El resultado se comparte entre tenants — es justo lo que hace
 * que la segunda corrida salga gratis. Por eso la tabla va **RLS deny-all** para `app_user` y
 * `app_service`: si estuviera expuesta, un tenant podría leer qué keywords investigó otro. Solo la
 * toca el rol `amg_cache` (ver `0003_credenciales.sql`).
 *
 * ## Los cuatro estados, y por qué son cuatro
 *
 * La versión anterior tenía tres, y le faltaba **el que importaba**: distinguir "el proceso murió"
 * de "el proceso está trabajando AHORA MISMO". Al no distinguirlos, dos procesos concurrentes con
 * la misma petición **la pagaban los dos** — medido: de 2 reservas simultáneas, 2 autorizaban el
 * POST. El test que tenía comprobaba "solo una es `nueva`", que era cierto e irrelevante: la otra
 * salía `huerfana`, y `huerfana` también autoriza gastar.
 */

export type Reserva<T> =
  /** Ya se pagó y tenemos el resultado. Gasto: cero. */
  | { estado: "listo"; result: T[] }
  /** Nadie la pidió (o la anterior falló CON respuesta = no cobró). Adelante, con este token. */
  | { estado: "nueva"; attemptId: string }
  /**
   * **Otro proceso la está pidiendo ahora mismo.** Su lease sigue vivo. NO se paga otra vez: se
   * espera su resultado. Este es el estado que faltaba.
   */
  | { estado: "en_progreso"; leaseHasta: Date }
  /**
   * El lease VENCIÓ sin resultado: el proceso murió entre el envío y la respuesta. La petición pudo
   * haberse cobrado.
   *
   * Si es un endpoint **Standard** y el intento anterior alcanzó a anotar el `taskId`, ese id
   * recupera el resultado ya pagado con `task_get` (gratis) — no hay repago. En un endpoint **live**,
   * `taskId` es `undefined` y reenviar es repago (o se detiene).
   */
  | {
      estado: "huerfana";
      intento: number;
      attemptId: string;
      taskId?: string | undefined;
      /** Coste ya pagado por el `task_post` (Standard). Persistido: no se pierde con el proceso. */
      costMicros?: number | undefined;
    };

export const MAX_INTENTOS = 3;

/**
 * Cuánto dura el lease.
 *
 * Tiene que cubrir con holgura lo que tarda la petición más lenta (DataForSEO live puede tardar
 * decenas de segundos) más los reintentos HTTP. Si se queda corto, un proceso VIVO se declara
 * muerto y se paga dos veces — que es exactamente lo que esto viene a impedir.
 */
export const LEASE_MS = 120_000;

interface FilaTarea {
  status: "pending" | "done" | "failed";
  attempt: number;
  attempt_id: string;
  lease_vivo: boolean;
  lease_until: string | null;
  result: { v: unknown[] } | null;
  provider_task_id: string | null;
  cost_micros_usd: number;
}

export class PgTaskLog {
  constructor(
    private readonly pool: DbPool,
    private readonly provider = "dataforseo",
  ) {}

  /**
   * Reserva la petición y devuelve qué sabemos de ella ANTES de gastar un centavo.
   *
   * **Atómico**: el `insert ... on conflict do nothing` decide quién la creó y el
   * `select ... for update` bloquea la fila, así que dos procesos no pueden creerse ambos los
   * primeros. Con un `select` y después un `insert`, los dos pagarían.
   */
  async reservar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T>> {
    return this.pool.transaction(async (tx) => {
      const { rows: creada } = await tx.query<{ attempt_id: string }>(
        `insert into kr_provider_tasks
           (provider, endpoint, payload_hash, status, attempt, lease_until)
         values ($1, $2, $3, 'pending', 1, now() + ($4 || ' milliseconds')::interval)
         on conflict (provider, endpoint, payload_hash) do nothing
         returning attempt_id`,
        [this.provider, endpoint, payloadHash, String(LEASE_MS)],
      );
      if (creada[0]) return { estado: "nueva" as const, attemptId: creada[0].attempt_id };

      const { rows } = await tx.query<FilaTarea>(
        `select status, attempt, attempt_id, result, lease_until, provider_task_id, cost_micros_usd,
                (lease_until is not null and lease_until > now()) as lease_vivo
         from kr_provider_tasks
         where provider = $1 and endpoint = $2 and payload_hash = $3
         for update`,
        [this.provider, endpoint, payloadHash],
      );
      const f = rows[0];
      if (!f) return { estado: "nueva" as const, attemptId: crypto.randomUUID() };

      if (f.status === "done") {
        return { estado: "listo" as const, result: (f.result?.v ?? []) as T[] };
      }

      if (f.status === "pending" && f.lease_vivo) {
        /*
         * OTRO PROCESO LA ESTÁ PIDIENDO AHORA. Su lease sigue vivo.
         *
         * Antes esto caía en "huérfana" y el segundo proceso salía a pagar la misma petición. Es el
         * doble cobro que estaba midiendo mal.
         */
        return { estado: "en_progreso" as const, leaseHasta: new Date(f.lease_until!) };
      }

      if (f.status === "pending") {
        /*
         * El lease VENCIÓ sin resultado: el proceso murió, pudo cobrar. Se renueva el lease (para
         * exclusión) pero **NO se incrementa `attempt`**: reservar no es enviar. El tope de envíos se
         * aplica en `contarEnvio`, al repostear — así consultar una huérfana o recuperar por
         * `task_get` no consume intentos (6ª review).
         *
         * `provider_task_id` y `cost_micros_usd` NO se tocan: si el intento anterior los anotó, este
         * los hereda para recuperar el resultado ya pagado con `task_get` (gratis).
         */
        const { rows: r } = await tx.query<{ attempt_id: string }>(
          `update kr_provider_tasks set
             attempt_id = gen_random_uuid(),
             lease_until = now() + ($4 || ' milliseconds')::interval
           where provider = $1 and endpoint = $2 and payload_hash = $3
           returning attempt_id`,
          [this.provider, endpoint, payloadHash, String(LEASE_MS)],
        );
        return {
          estado: "huerfana" as const,
          intento: f.attempt,
          attemptId: r[0]!.attempt_id,
          taskId: f.provider_task_id ?? undefined,
          costMicros: f.cost_micros_usd ?? undefined,
        };
      }

      // `failed`: hubo respuesta y el proveedor dijo que la task falló → NO cobró. Arranca limpia:
      // se borra también el `provider_task_id`, porque la próxima es un `task_post` nuevo.
      const { rows: r } = await tx.query<{ attempt_id: string }>(
        `update kr_provider_tasks set
           status = 'pending',
           attempt = $4,
           attempt_id = gen_random_uuid(),
           lease_until = now() + ($5 || ' milliseconds')::interval,
           result = null,
           provider_task_id = null,
           completed_at = null
         where provider = $1 and endpoint = $2 and payload_hash = $3
         returning attempt_id`,
        [this.provider, endpoint, payloadHash, f.attempt + 1, String(LEASE_MS)],
      );
      return { estado: "nueva" as const, attemptId: r[0]!.attempt_id };
    });
  }

  /** Lee el estado actual sin reservar nada. Lo usa quien espera a que otro proceso termine. */
  async consultar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T> | null> {
    return this.pool.transaction(async (tx) => {
      const { rows } = await tx.query<FilaTarea>(
        `select status, attempt, attempt_id, result, lease_until,
                (lease_until is not null and lease_until > now()) as lease_vivo
         from kr_provider_tasks
         where provider = $1 and endpoint = $2 and payload_hash = $3`,
        [this.provider, endpoint, payloadHash],
      );
      const f = rows[0];
      if (!f) return null;
      if (f.status === "done") return { estado: "listo", result: (f.result?.v ?? []) as T[] };
      if (f.status === "pending" && f.lease_vivo) {
        return { estado: "en_progreso", leaseHasta: new Date(f.lease_until!) };
      }
      return null; // failed, o lease vencido: quien espera tiene que volver a reservar
    });
  }

  /**
   * Método Standard: guarda el `task_id` remoto tras un `task_post` exitoso, **antes** de tener el
   * resultado. Es lo que hace recuperable una respuesta perdida — sin este id, morir después del
   * `task_post` sería dinero perdido. **CAS por `attempt_id`**: solo el intento con el lease anota.
   */
  async anotarTareaRemota(
    endpoint: string,
    payloadHash: string,
    taskId: string,
    costMicros: number,
    attemptId: string,
  ): Promise<boolean> {
    return this.pool.transaction(async (tx) => {
      // `cost_micros_usd = $5` (SET, no +=): es el coste del `task_post`, que se conoce una vez.
      // Persistirlo acá es lo que evita que el ledger quede en cero si el proceso muere antes de
      // `completar`. Por eso `completar`, en Standard, pasa `costMicros: 0` (ya está puesto).
      const { rows } = await tx.query<{ id: string }>(
        `update kr_provider_tasks set provider_task_id = $4, cost_micros_usd = $5
         where provider = $1 and endpoint = $2 and payload_hash = $3
           and attempt_id = $6 and status = 'pending'
         returning id`,
        [this.provider, endpoint, payloadHash, taskId, costMicros, attemptId],
      );
      return rows.length > 0;
    });
  }

  /**
   * Cuenta un ENVÍO facturable y aplica `MAX_INTENTOS`. Devuelve `ok: false` si ya se alcanzó el
   * tope. **CAS por `attempt_id`.** Reservar y recuperar NO llaman acá: por eso una consulta no
   * consume intentos.
   */
  async contarEnvio(
    endpoint: string,
    payloadHash: string,
    attemptId: string,
  ): Promise<{ ok: boolean; intento: number }> {
    return this.pool.transaction(async (tx) => {
      const { rows } = await tx.query<{ attempt: number }>(
        `update kr_provider_tasks set
           attempt = attempt + 1,
           lease_until = now() + ($5 || ' milliseconds')::interval
         where provider = $1 and endpoint = $2 and payload_hash = $3
           and attempt_id = $4 and status = 'pending'
           and attempt < $6
         returning attempt`,
        [this.provider, endpoint, payloadHash, attemptId, String(LEASE_MS), MAX_INTENTOS],
      );
      if (rows[0]) return { ok: true, intento: rows[0].attempt };
      // No actualizó: o perdimos el lease (otro attemptId), o ya se alcanzó el tope de envíos.
      return { ok: false, intento: MAX_INTENTOS };
    });
  }

  /**
   * Llegó el resultado. **CAS por `attempt_id`.**
   *
   * Sin el CAS, una respuesta TARDÍA del intento 1 (que creíamos muerto) pisaba el resultado del
   * intento 2. Devuelve `false` si el lease ya no era nuestro: el resultado no se escribe, y el
   * llamador se entera en vez de creer que guardó algo.
   */
  async completar<T>(
    endpoint: string,
    payloadHash: string,
    datos: { result: T[]; costMicros: number; attemptId: string; taskId?: string | undefined },
  ): Promise<boolean> {
    return this.pool.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update kr_provider_tasks set
           status = 'done',
           result = $4::jsonb,
           cost_micros_usd = cost_micros_usd + $5,
           provider_task_id = $6,
           lease_until = null,
           completed_at = now()
         where provider = $1 and endpoint = $2 and payload_hash = $3
           and attempt_id = $7 and status = 'pending'
         returning id`,
        [
          this.provider,
          endpoint,
          payloadHash,
          // Envuelto en {v}: un resultado vacío legítimo (`[]`) no se confunde con "no hay fila".
          JSON.stringify({ v: datos.result }),
          datos.costMicros,
          datos.taskId ?? null,
          datos.attemptId,
        ],
      );
      return rows.length > 0;
    });
  }

  /**
   * Hubo respuesta y la task falló SIN cobrar. Se marca `failed` → el próximo intento arranca
   * limpio.
   *
   * Un timeout NO llega acá **a propósito**: sin respuesta no sabemos si cobró, así que la fila se
   * queda en `pending` con su lease. Marcarla `failed` sería afirmar que no cobró sin tener ni idea.
   */
  async fallar(
    endpoint: string,
    payloadHash: string,
    _error: string,
    attemptId: string,
  ): Promise<boolean> {
    return this.pool.transaction(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `update kr_provider_tasks set
           status = 'failed', result = null, lease_until = null, completed_at = now()
         where provider = $1 and endpoint = $2 and payload_hash = $3
           and attempt_id = $4 and status = 'pending'
         returning id`,
        [this.provider, endpoint, payloadHash, attemptId],
      );
      return rows.length > 0;
    });
  }

  /**
   * Peticiones que se enviaron y cuyo lease venció sin resultado: **dinero que puede haberse gastado
   * sin obtener el dato**. Es la lista que hay que mirar si el saldo de DataForSEO no cuadra.
   */
  async huerfanas(): Promise<Array<{ endpoint: string; attempt: number; created_at: string }>> {
    return this.pool.transaction(async (tx) => {
      const { rows } = await tx.query<{ endpoint: string; attempt: number; created_at: string }>(
        `select endpoint, attempt, created_at from kr_provider_tasks
         where provider = $1 and status = 'pending'
           and (lease_until is null or lease_until <= now())
         order by created_at desc`,
        [this.provider],
      );
      return rows;
    });
  }
}

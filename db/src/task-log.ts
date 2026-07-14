import type { DbPool } from "./pool.js";

/**
 * Registro de peticiones facturables al proveedor, sobre `kr_provider_tasks` (ADR-10).
 *
 * Es la implementación de producción de la misma interfaz `ProviderTaskLog` que declara
 * `kr-service` — que sigue sin saber que existe una base de datos.
 *
 * ## Por qué NO lleva `tenant_id` (y por qué eso está bien)
 *
 * Igual que las caches: lo que se registra es una petición al MERCADO (un lote de keywords en un
 * mercado), no un dato de un cliente. El resultado se comparte entre tenants — es justo lo que hace
 * que la segunda corrida salga gratis. Por eso la tabla va **RLS deny-all** y solo la toca la
 * service-role: si estuviera expuesta a `app_user`, un tenant podría leer qué keywords investigó
 * otro. Ver `migrations/0001_init.sql`.
 *
 * ## El estado `pending` es el que importa
 *
 * Se escribe ANTES de enviar la petición. Si el proceso muere entre el envío y la respuesta, la
 * fila queda en `pending` sin resultado — y eso es exactamente la información que hace falta: **esa
 * petición pudo haberse cobrado sin que tengamos el dato**. El siguiente intento la ve, lo cuenta
 * como repago y lo grita, en vez de volver a pagar en silencio.
 */

/** Copia local del contrato de `kr-service` (los paquetes no se importan entre sí). */
export type Reserva<T> =
  | { estado: "listo"; result: T[] }
  | { estado: "nueva" }
  | { estado: "huerfana"; intento: number };

export const MAX_INTENTOS = 3;

interface FilaTarea {
  status: "pending" | "done" | "failed";
  attempt: number;
  result: { v: unknown[] } | null;
}

export class PgTaskLog {
  constructor(
    private readonly pool: DbPool,
    private readonly provider = "dataforseo",
  ) {}

  /**
   * Reserva la petición y devuelve qué sabemos de ella ANTES de gastar un centavo.
   *
   * **Atómico de verdad**, y hace falta: con un `select` y después un `insert`, dos procesos que
   * reserven la misma petición a la vez pueden creerse ambos los primeros y pagarla los dos. Acá el
   * `insert ... on conflict do nothing` decide quién la creó, y el `select ... for update` bloquea
   * la fila para que el segundo espere y vea el estado real.
   */
  async reservar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T>> {
    return this.pool.transaction(async (tx) => {
      const { rows: creada } = await tx.query<{ id: string }>(
        `insert into kr_provider_tasks (provider, endpoint, payload_hash, status, attempt)
         values ($1, $2, $3, 'pending', 1)
         on conflict (provider, endpoint, payload_hash) do nothing
         returning id`,
        [this.provider, endpoint, payloadHash],
      );
      if (creada[0]) return { estado: "nueva" as const }; // la creé yo: nadie la pidió antes

      // Ya existía. Se bloquea la fila: si otro proceso está decidiendo sobre ella, esperamos.
      const { rows } = await tx.query<FilaTarea>(
        `select status, attempt, result from kr_provider_tasks
         where provider = $1 and endpoint = $2 and payload_hash = $3
         for update`,
        [this.provider, endpoint, payloadHash],
      );
      const f = rows[0];
      if (!f) return { estado: "nueva" as const }; // carrera con un borrado: tratarla como nueva

      // Ya se pagó y tenemos el resultado. Gasto: cero.
      if (f.status === "done") {
        return { estado: "listo" as const, result: (f.result?.v ?? []) as T[] };
      }

      if (f.status === "pending") {
        // Se envió y NUNCA volvió. Pudo cobrarse. Reenviar es la única forma de obtener el dato.
        const intento = f.attempt + 1;
        if (intento > MAX_INTENTOS) {
          throw new Error(
            `La petición a ${endpoint} ya se envió ${f.attempt} veces sin respuesta. No se reenvía ` +
              `más: cada intento puede estar cobrando. Revisá el saldo en DataForSEO.`,
          );
        }
        await tx.query(
          `update kr_provider_tasks set attempt = $4
           where provider = $1 and endpoint = $2 and payload_hash = $3`,
          [this.provider, endpoint, payloadHash, intento],
        );
        return { estado: "huerfana" as const, intento };
      }

      // `failed`: hubo respuesta y el proveedor dijo que la task falló → NO cobró. Reintentar es
      // seguro, así que vuelve a arrancar como nueva.
      await tx.query(
        `update kr_provider_tasks set status = 'pending', attempt = $4, result = null, completed_at = null
         where provider = $1 and endpoint = $2 and payload_hash = $3`,
        [this.provider, endpoint, payloadHash, f.attempt + 1],
      );
      return { estado: "nueva" as const };
    });
  }

  /** Llegó el resultado. Se guarda con su costo: la tabla es también la auditoría del gasto. */
  async completar<T>(
    endpoint: string,
    payloadHash: string,
    datos: { result: T[]; costMicros: number; taskId?: string | undefined },
  ): Promise<void> {
    await this.pool.transaction(async (tx) => {
      await tx.query(
        `update kr_provider_tasks set
           status = 'done',
           result = $4::jsonb,
           cost_micros_usd = $5,
           provider_task_id = $6,
           completed_at = now()
         where provider = $1 and endpoint = $2 and payload_hash = $3`,
        [
          this.provider,
          endpoint,
          payloadHash,
          // Envuelto en {v}: un resultado vacío legítimo (`[]`) no se confunde con "no hay fila".
          JSON.stringify({ v: datos.result }),
          datos.costMicros,
          datos.taskId ?? null,
        ],
      );
    });
  }

  /**
   * Hubo respuesta y la task falló → el proveedor NO cobró, y lo sabemos porque nos lo dijo.
   * Se marca `failed` para que el próximo intento arranque limpio (reintentar es seguro).
   *
   * Un timeout NO llega acá **a propósito**: sin respuesta no sabemos si cobró, así que la fila se
   * queda en `pending`. Marcarla `failed` sería afirmar que no cobró sin tener ni idea.
   */
  async fallar(endpoint: string, payloadHash: string, _error: string): Promise<void> {
    await this.pool.transaction(async (tx) => {
      await tx.query(
        `update kr_provider_tasks set status = 'failed', result = null, completed_at = now()
         where provider = $1 and endpoint = $2 and payload_hash = $3`,
        [this.provider, endpoint, payloadHash],
      );
    });
  }

  /**
   * Peticiones que se enviaron y NUNCA volvieron: dinero que puede haberse gastado sin obtener el
   * dato. Es la lista que hay que mirar si el saldo de DataForSEO no cuadra.
   */
  async huerfanas(): Promise<Array<{ endpoint: string; attempt: number; created_at: string }>> {
    return this.pool.transaction(async (tx) => {
      const { rows } = await tx.query<{ endpoint: string; attempt: number; created_at: string }>(
        `select endpoint, attempt, created_at from kr_provider_tasks
         where provider = $1 and status = 'pending' order by created_at desc`,
        [this.provider],
      );
      return rows;
    });
  }
}

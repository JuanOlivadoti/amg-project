import { createHash } from "node:crypto";

/**
 * Registro de peticiones FACTURABLES al proveedor (ADR-10: "idempotencia real de tareas del
 * proveedor, `payload_hash`").
 *
 * ## El problema que resuelve (y el que NO puede resolver)
 *
 * Cada POST a DataForSEO cuesta dinero. Hay dos formas de fallar, y solo una es recuperable:
 *
 *  · **Respuesta recibida con la task en error** (p. ej. 40501). El proveedor NO cobró y lo sabemos
 *    porque nos lo dijo. Reintentar es seguro.
 *  · **Sin respuesta** (timeout, 5xx, el proceso muere). **Ambiguo**: la petición pudo llegar,
 *    ejecutarse y cobrarse. No hay forma de distinguirlo desde acá.
 *
 * Por eso la reserva se escribe ANTES de enviar. Si el proceso muere en el medio, queda la huella:
 * `pending`, sin resultado. El siguiente intento la ve, sabe que puede haber pagado ya, lo cuenta
 * como **repago** y lo grita — en vez de volver a pagar en silencio, que es lo que pasaba antes.
 *
 * ## Por qué esto NO es "migrar al método Standard"
 *
 * La review externa pedía `task_post` + `task_get`, que permitiría RECUPERAR el resultado ya pagado.
 * Pero **la API DataForSEO Labs es live-only**: no existe `task_post` para ella. Y Labs
 * (`keyword_suggestions` + `bulk_keyword_difficulty`) es donde está la MAYORÍA del gasto (~$0.136
 * de los $0.2522 de una corrida real). Migrar a Standard blindaría el endpoint más barato y dejaría
 * fuera el grueso.
 *
 * Este registro, en cambio, cubre el **100%** de la superficie facturable: los cuatro endpoints.
 * Lo que no puede hacer —y ningún diseño puede, con un endpoint live— es rescatar el resultado de
 * una respuesta que se perdió. Ese dinero está perdido. Lo que sí garantiza es que **no se pague
 * dos veces por la misma petición** en un reintento, que con los reintentos de Inngest re-ejecutando
 * el pipeline entero dejó de ser hipotético.
 */

/** Lo que el registro sabe de una petición antes de enviarla. */
export type Reserva<T> =
  /** Ya se pagó y tenemos el resultado. Gasto: cero. */
  | { estado: "listo"; result: T[] }
  /** Nunca se pidió (o la anterior falló con respuesta = no cobró). Adelante. */
  | { estado: "nueva" }
  /**
   * Una petición anterior se envió y NUNCA volvió. Pudo haberse cobrado.
   * Reenviar es la única forma de obtener el dato, pero se cuenta como repago.
   */
  | { estado: "huerfana"; intento: number };

export interface ProviderTaskLog {
  /** Escribe la reserva ANTES del envío. Si el proceso muere después, queda la huella. */
  reservar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T>>;
  /** Llegó el resultado: se guarda con su costo. */
  completar<T>(
    endpoint: string,
    payloadHash: string,
    datos: { result: T[]; costMicros: number; taskId?: string | undefined },
  ): Promise<void>;
  /** Hubo respuesta y la task falló → NO cobró. Se marca para que el reintento sea seguro. */
  fallar(endpoint: string, payloadHash: string, error: string): Promise<void>;
}

/**
 * Cuántas veces se reenvía una petición huérfana antes de rendirse.
 *
 * No es infinito a propósito: si algo falla sistemáticamente sin devolver respuesta, seguir
 * reenviando es pagar una y otra vez por nada.
 */
export const MAX_INTENTOS = 3;

/**
 * Hash de la petición. Incluye el ENTORNO, y no es cosmético: sandbox y producción devuelven cosas
 * distintas para el mismo cuerpo. Es exactamente el bug que envenenó la cache — no se repite acá.
 */
export function payloadHash(ns: string, endpoint: string, body: unknown): string {
  return createHash("sha256").update(`${ns}|${endpoint}|${jsonEstable(body)}`).digest("hex");
}

/** JSON con las claves ordenadas: `{a:1,b:2}` y `{b:2,a:1}` son la MISMA petición. */
function jsonEstable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(jsonEstable).join(",")}]`;
  const claves = Object.keys(v as Record<string, unknown>).sort();
  const pares = claves.map((k) => `${JSON.stringify(k)}:${jsonEstable((v as Record<string, unknown>)[k])}`);
  return `{${pares.join(",")}}`;
}

/** Sin registro: todo es nuevo. Es lo que corre en sandbox (gratis) y con el provider mock. */
export class NoopTaskLog implements ProviderTaskLog {
  async reservar<T>(): Promise<Reserva<T>> {
    return { estado: "nueva" };
  }
  async completar(): Promise<void> {}
  async fallar(): Promise<void> {}
}

/** Registro en memoria. Para tests y para un proceso suelto sin base de datos. */
export class MemTaskLog implements ProviderTaskLog {
  private readonly filas = new Map<
    string,
    { estado: "pending" | "done" | "failed"; intento: number; result?: unknown[] }
  >();

  async reservar<T>(endpoint: string, hash: string): Promise<Reserva<T>> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);

    if (f?.estado === "done") return { estado: "listo", result: f.result as T[] };

    if (f?.estado === "pending") {
      // Se envió y nunca volvió. Pudo cobrar.
      const intento = f.intento + 1;
      if (intento > MAX_INTENTOS) {
        throw new Error(
          `La petición a ${endpoint} ya se envió ${f.intento} vez/veces sin respuesta. No se reenvía ` +
            `más: cada intento puede estar cobrando.`,
        );
      }
      this.filas.set(k, { estado: "pending", intento });
      return { estado: "huerfana", intento };
    }

    // Nueva, o la anterior falló CON respuesta (no cobró) → reintentar es seguro.
    this.filas.set(k, { estado: "pending", intento: (f?.intento ?? 0) + 1 });
    return { estado: "nueva" };
  }

  async completar<T>(
    endpoint: string,
    hash: string,
    datos: { result: T[]; costMicros: number; taskId?: string | undefined },
  ): Promise<void> {
    const k = `${endpoint}|${hash}`;
    this.filas.set(k, { estado: "done", intento: this.filas.get(k)?.intento ?? 1, result: datos.result });
  }

  async fallar(endpoint: string, hash: string, _error: string): Promise<void> {
    const k = `${endpoint}|${hash}`;
    this.filas.set(k, { estado: "failed", intento: this.filas.get(k)?.intento ?? 1 });
  }
}

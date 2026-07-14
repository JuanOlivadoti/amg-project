import { createHash, randomUUID } from "node:crypto";

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

/**
 * Lo que el registro sabe de una petición antes de enviarla.
 *
 * Son CUATRO estados, y la versión anterior tenía tres: le faltaba **el que importaba**, distinguir
 * "el proceso murió" de "otro proceso está pidiendo esto AHORA MISMO". Sin esa distinción, dos
 * corridas concurrentes con la misma petición **la pagaban las dos**.
 */
export type Reserva<T> =
  /** Ya se pagó y tenemos el resultado. Gasto: cero. */
  | { estado: "listo"; result: T[] }
  /** Nadie la pidió (o la anterior falló CON respuesta = no cobró). Adelante, con este token. */
  | { estado: "nueva"; attemptId: string }
  /** Otro proceso la está pidiendo ahora. Se ESPERA su resultado; no se paga otra vez. */
  | { estado: "en_progreso"; leaseHasta: Date }
  /** El lease venció sin resultado: el proceso murió y pudo haber cobrado. Reenviar = repago. */
  | { estado: "huerfana"; intento: number; attemptId: string };

export interface ProviderTaskLog {
  /** Escribe la reserva ANTES del envío. Si el proceso muere después, queda la huella. */
  reservar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T>>;
  /** Estado actual sin reservar. Lo usa quien espera a que otro proceso termine. */
  consultar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T> | null>;
  /**
   * Llegó el resultado. **CAS por `attemptId`**: devuelve `false` si el lease ya no era nuestro
   * (una respuesta tardía no puede pisar el resultado de un intento posterior).
   */
  completar<T>(
    endpoint: string,
    payloadHash: string,
    datos: { result: T[]; costMicros: number; attemptId: string; taskId?: string | undefined },
  ): Promise<boolean>;
  /** Hubo respuesta y la task falló SIN cobrar. Se marca para que el reintento sea seguro. */
  fallar(endpoint: string, payloadHash: string, error: string, attemptId: string): Promise<boolean>;
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

/**
 * JSON canónico: **dos peticiones semánticamente iguales tienen que dar el MISMO hash.**
 *
 * Ordenaba las claves de los objetos y **NO los arrays** — y el comentario decía, tan campante, "con
 * las claves ordenadas", que era cierto y engañoso a la vez. Para DataForSEO,
 * `{keywords: ["pizza","pasta"]}` y `{keywords: ["pasta","pizza"]}` son **la misma consulta y el
 * mismo cobro**, pero hasheaban distinto: dos procesos concurrentes pedían lo mismo, ninguno veía la
 * reserva del otro, y **se pagaba dos veces**.
 *
 * Los arrays de DataForSEO son **conjuntos** (una lista de keywords a consultar), no secuencias: el
 * orden no lleva información. Por eso ordenarlos es correcto y no pierde nada.
 */
function jsonEstable(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) {
    // Ordenar por su propia forma canónica: estable, sin depender del tipo de los elementos.
    return `[${v.map(jsonEstable).sort().join(",")}]`;
  }
  const claves = Object.keys(v as Record<string, unknown>).sort();
  const pares = claves.map((k) => `${JSON.stringify(k)}:${jsonEstable((v as Record<string, unknown>)[k])}`);
  return `{${pares.join(",")}}`;
}

/** Cuánto dura el lease. Tiene que cubrir con holgura la petición más lenta + sus reintentos. */
export const LEASE_MS = 120_000;

/** Sin registro: todo es nuevo. Es lo que corre en sandbox (gratis) y con el provider mock. */
export class NoopTaskLog implements ProviderTaskLog {
  async reservar<T>(): Promise<Reserva<T>> {
    return { estado: "nueva", attemptId: randomUUID() };
  }
  async consultar<T>(): Promise<Reserva<T> | null> {
    return null;
  }
  async completar(): Promise<boolean> {
    return true;
  }
  async fallar(): Promise<boolean> {
    return true;
  }
}

/** Registro en memoria. Para tests y para un proceso suelto sin base de datos. */
export class MemTaskLog implements ProviderTaskLog {
  private readonly filas = new Map<
    string,
    {
      estado: "pending" | "done" | "failed";
      intento: number;
      attemptId: string;
      leaseHasta: number;
      result?: unknown[];
    }
  >();

  /** Los tests necesitan simular "el proceso murió": el lease vence sin que nadie complete. */
  vencerLeases(): void {
    for (const [k, f] of this.filas) {
      if (f.estado === "pending") this.filas.set(k, { ...f, leaseHasta: 0 });
    }
  }

  async reservar<T>(endpoint: string, hash: string): Promise<Reserva<T>> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);

    if (f?.estado === "done") return { estado: "listo", result: f.result as T[] };

    if (f?.estado === "pending" && f.leaseHasta > Date.now()) {
      // Otro proceso la está pidiendo AHORA. No se paga otra vez: se espera.
      return { estado: "en_progreso", leaseHasta: new Date(f.leaseHasta) };
    }

    if (f?.estado === "pending") {
      // Lease vencido: el proceso murió. Pudo cobrar.
      const intento = f.intento + 1;
      if (intento > MAX_INTENTOS) {
        throw new Error(
          `La petición a ${endpoint} ya se envió ${f.intento} vez/veces sin respuesta. No se reenvía ` +
            `más: cada intento puede estar cobrando.`,
        );
      }
      const attemptId = randomUUID();
      this.filas.set(k, { estado: "pending", intento, attemptId, leaseHasta: Date.now() + LEASE_MS });
      return { estado: "huerfana", intento, attemptId };
    }

    // Nueva, o la anterior falló CON respuesta (no cobró) → reintentar es seguro.
    const attemptId = randomUUID();
    this.filas.set(k, {
      estado: "pending",
      intento: (f?.intento ?? 0) + 1,
      attemptId,
      leaseHasta: Date.now() + LEASE_MS,
    });
    return { estado: "nueva", attemptId };
  }

  async consultar<T>(endpoint: string, hash: string): Promise<Reserva<T> | null> {
    const f = this.filas.get(`${endpoint}|${hash}`);
    if (!f) return null;
    if (f.estado === "done") return { estado: "listo", result: f.result as T[] };
    if (f.estado === "pending" && f.leaseHasta > Date.now()) {
      return { estado: "en_progreso", leaseHasta: new Date(f.leaseHasta) };
    }
    return null;
  }

  async completar<T>(
    endpoint: string,
    hash: string,
    datos: { result: T[]; costMicros: number; attemptId: string },
  ): Promise<boolean> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);
    // CAS: una respuesta tardía del intento anterior no pisa el resultado del actual.
    if (!f || f.estado !== "pending" || f.attemptId !== datos.attemptId) return false;
    this.filas.set(k, { ...f, estado: "done", leaseHasta: 0, result: datos.result });
    return true;
  }

  async fallar(endpoint: string, hash: string, _error: string, attemptId: string): Promise<boolean> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);
    if (!f || f.estado !== "pending" || f.attemptId !== attemptId) return false;
    this.filas.set(k, { ...f, estado: "failed", leaseHasta: 0 });
    return true;
  }
}

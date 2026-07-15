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
 * ## Dos garantías distintas, según el endpoint
 *
 * La review externa pedía `task_post` + `task_get`, que permite **RECUPERAR** el resultado ya
 * pagado. No se puede en todos lados, así que el sistema da la garantía más fuerte donde puede:
 *
 *  · **SERP y Search Volume (46% del gasto) → método Standard.** El `task_post` cobra y devuelve un
 *    `task_id`; el `task_get` recupera el resultado **gratis** durante 30 días. Persistimos ese
 *    `task_id`, así que una respuesta perdida **deja de ser dinero perdido**: el siguiente intento
 *    hace `task_get` y recupera lo pagado. Ver `DataForSeoClient.postStandard`.
 *  · **Labs — `keyword_suggestions` + `bulk_keyword_difficulty` (54%) → live-only.** No existe
 *    `task_post` para Labs. Ahí la garantía es más débil y honesta: una respuesta perdida **detiene
 *    el run** en vez de arriesgar un doble cobro (`PeticionAmbiguaError`). El dinero de esa petición,
 *    si se cobró, está perdido — y ningún diseño puede rescatarlo con un endpoint live.
 *
 * En los dos casos, el registro cubre el **100%** de la superficie facturable: **nunca se paga dos
 * veces por la misma petición sin que un humano lo decida** (`DFS_PERMITIR_REPAGO`). Lo que cambia
 * es si, además, el resultado se puede rescatar (Standard sí; live no).
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
  /**
   * El lease venció sin resultado: el proceso murió y pudo haber cobrado.
   *
   * En un endpoint **live**, reenviar es repago (o se detiene). Pero si es **Standard** y alcanzó a
   * anotar el `taskId` antes de morir, ese id es el rescate: `task_get(taskId)` recupera el resultado
   * ya pagado **gratis**, y no hay repago. Por eso `taskId` viaja acá.
   */
  | {
      estado: "huerfana";
      intento: number;
      attemptId: string;
      taskId?: string | undefined;
      /** Coste ya pagado por el `task_post` (Standard). Se persiste al anotar, y NO se pierde con el
       *  proceso que murió: es lo que evita que el ledger quede en cero tras una recuperación. */
      costMicros?: number | undefined;
    };

export interface ProviderTaskLog {
  /**
   * ¿Sobrevive el registro a la muerte del proceso? Solo `PgTaskLog` (Postgres) es `true`.
   *
   * No es cosmético: en PRODUCCIÓN, un registro NO durable no protege del caso que de verdad cuesta
   * dinero — un crash + re-run vuelve a pagar los ~$0.25, porque toda reserva vuelve a ser "nueva".
   * `getProvider` EXIGE `durable` en live+prod y falla cerrado si no lo tiene (ADR-14). En sandbox
   * (gratis) no hace falta, y `Noop`/`Mem` bastan para tests y desarrollo.
   */
  readonly durable: boolean;
  /** Escribe la reserva ANTES del envío. Si el proceso muere después, queda la huella. */
  reservar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T>>;
  /** Estado actual sin reservar. Lo usa quien espera a que otro proceso termine. */
  consultar<T>(endpoint: string, payloadHash: string): Promise<Reserva<T> | null>;
  /**
   * Método Standard: tras un `task_post` exitoso, guarda el `task_id` **y el coste ya pagado**,
   * **antes** de tener el resultado. Dos cosas a la vez, y las dos importan: el id hace recuperable
   * la respuesta perdida; el coste evita que el ledger quede en cero si el proceso muere antes de
   * completar. CAS por `attemptId`.
   */
  anotarTareaRemota?(
    endpoint: string,
    payloadHash: string,
    taskId: string,
    costMicros: number,
    attemptId: string,
  ): Promise<boolean>;
  /**
   * Cuenta un ENVÍO facturable (un `task_post`/POST de repago) y aplica el tope `MAX_INTENTOS`.
   * Devuelve `ok: false` si ya se alcanzó el tope. Reservar o recuperar NO cuentan como envío: por
   * eso el conteo vive acá y no en `reservar`.
   */
  contarEnvio?(
    endpoint: string,
    payloadHash: string,
    attemptId: string,
  ): Promise<{ ok: boolean; intento: number }>;
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
  readonly durable = false;
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

/** Registro en memoria. Para tests y desarrollo. NO durable: muere con el proceso, así que en
 *  producción no protege del re-pago tras un crash — para eso está `PgTaskLog`. */
export class MemTaskLog implements ProviderTaskLog {
  readonly durable = false;
  private readonly filas = new Map<
    string,
    {
      estado: "pending" | "done" | "failed";
      /** ENVÍOS facturables hechos (no reservas). Una consulta o recuperación NO lo sube. */
      intento: number;
      attemptId: string;
      leaseHasta: number;
      result?: unknown[];
      /** El `task_id` del proveedor (método Standard). Presente = la respuesta perdida se recupera. */
      taskId?: string;
      /** Coste ya pagado por el `task_post`. Persistido para que no se pierda con el proceso. */
      costMicros?: number;
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
      /*
       * Lease vencido: el proceso murió, pudo cobrar. Se renueva el lease (para exclusión) pero
       * **NO se incrementa `intento`**: reservar no es enviar. Consultar una huérfana o recuperar por
       * `task_get` no cuesta un envío — antes sí lo contaba, y agotaba MAX_INTENTOS con consultas que
       * nunca postearon nada (6ª review). El envío se cuenta en `contarEnvio`, al repostear.
       */
      const attemptId = randomUUID();
      this.filas.set(k, { ...f, attemptId, leaseHasta: Date.now() + LEASE_MS });
      return { estado: "huerfana", intento: f.intento, attemptId, taskId: f.taskId, costMicros: f.costMicros };
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

  async anotarTareaRemota(
    endpoint: string,
    hash: string,
    taskId: string,
    costMicros: number,
    attemptId: string,
  ): Promise<boolean> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);
    // CAS: solo el intento que tiene el lease anota. Guarda id Y coste: el coste sobrevive al proceso.
    if (!f || f.estado !== "pending" || f.attemptId !== attemptId) return false;
    this.filas.set(k, { ...f, taskId, costMicros });
    return true;
  }

  async contarEnvio(endpoint: string, hash: string, attemptId: string): Promise<{ ok: boolean; intento: number }> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);
    if (!f || f.estado !== "pending" || f.attemptId !== attemptId) return { ok: false, intento: 0 };
    const intento = f.intento + 1;
    if (intento > MAX_INTENTOS) return { ok: false, intento: f.intento };
    this.filas.set(k, { ...f, intento, leaseHasta: Date.now() + LEASE_MS });
    return { ok: true, intento };
  }

  async completar<T>(
    endpoint: string,
    hash: string,
    datos: { result: T[]; costMicros: number; attemptId: string; taskId?: string | undefined },
  ): Promise<boolean> {
    const k = `${endpoint}|${hash}`;
    const f = this.filas.get(k);
    // CAS: una respuesta tardía del intento anterior no pisa el resultado del actual.
    if (!f || f.estado !== "pending" || f.attemptId !== datos.attemptId) return false;
    this.filas.set(k, { ...f, estado: "done", leaseHasta: 0, result: datos.result, taskId: datos.taskId ?? f.taskId });
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

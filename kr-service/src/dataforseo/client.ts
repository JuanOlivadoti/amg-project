import { config } from "../config.js";
import { currentMeter } from "../lib/cost.js";
import { backoffMs, fetchWithRetry } from "../lib/http.js";
import { NoopTaskLog, payloadHash } from "./task-log.js";
import type { ProviderTaskLog } from "./task-log.js";

/**
 * Cliente DataForSEO (Basic Auth). Arranca contra sandbox.
 * Acumula el costo reportado por la API (`cost`) para el presupuesto del run.
 */
export class DataForSeoClient {
  private authHeader: string;
  public costUsd = 0; // acumulado del run (en USD; la API devuelve `cost` por task)

  /** Peticiones que hubo que reenviar sin saber si la anterior ya se cobró. Ver `task-log.ts`. */
  public repagos = 0;

  constructor(private readonly taskLog: ProviderTaskLog = new NoopTaskLog()) {
    const { login, password } = config.dataforseo;
    this.authHeader =
      "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
  }

  get costMicros(): number {
    return Math.round(this.costUsd * 1_000_000);
  }

  /** Espacio de nombres del proveedor + entorno. Sandbox y producción NO comparten nada. */
  private get ns(): string {
    return `dfs:${config.dataforseo.isSandbox ? "sandbox" : "prod"}`;
  }

  /**
   * POST facturable, con registro de idempotencia (ADR-10).
   *
   * La reserva se escribe ANTES de enviar. Si el proceso muere entre el envío y la respuesta, queda
   * la huella (`pending`, sin resultado) y el siguiente intento sabe que **puede haber pagado ya**.
   * Antes, ese caso volvía a pagar en silencio — y con los reintentos de Inngest re-ejecutando el
   * pipeline entero, dejó de ser hipotético.
   *
   * El sandbox no se registra: es gratis, no hay nada que proteger, y ensuciaría la auditoría del
   * gasto real. Misma lógica que la cache.
   */
  async post<T = unknown>(path: string, body: unknown): Promise<T[]> {
    if (config.dataforseo.isSandbox) return this.postConReintentos<T>(path, body);

    const hash = payloadHash(this.ns, path, body);
    const reserva = await this.taskLog.reservar<T>(path, hash);

    if (reserva.estado === "listo") {
      // Ya se pagó por esto y el resultado está guardado. Gasto: cero.
      return reserva.result;
    }

    if (reserva.estado === "huerfana") {
      this.repagos++;
      console.warn(
        `  ⚠️  [dataforseo] REPAGO en ${path}: un envío anterior nunca devolvió respuesta y pudo ` +
          `haberse cobrado. Reenviando (intento ${reserva.intento}/3) — es la única forma de obtener ` +
          `el dato, pero puede estar pagándose dos veces.`,
      );
    }

    const costeAntes = this.costUsd;
    try {
      const result = await this.postConReintentos<T>(path, body);
      await this.taskLog.completar(path, hash, {
        result,
        costMicros: Math.round((this.costUsd - costeAntes) * 1_000_000),
      });
      return result;
    } catch (e) {
      /*
       * La distinción que hace correcto todo esto:
       *
       *  · `DataForSeoTaskError` = HUBO RESPUESTA y la task falló → el proveedor NO cobró, y lo
       *    sabemos porque nos lo dijo. Se marca `failed` → el reintento es seguro.
       *
       *  · Cualquier otro error (timeout, 5xx, red) = NO HUBO RESPUESTA → **ambiguo**: la petición
       *    pudo llegar, ejecutarse y cobrarse. La reserva se deja en `pending` A PROPÓSITO, para
       *    que el próximo intento sepa que puede estar repagando. Marcarla `failed` acá sería
       *    mentir: estaríamos afirmando que no cobró cuando no tenemos ni idea.
       */
      if (e instanceof DataForSeoTaskError) {
        await this.taskLog.fallar(path, hash, e.message);
      }
      throw e;
    }
  }

  /**
   * Reintenta el RATE LIMIT a nivel de task (código 40202 dentro de un HTTP 200): DataForSEO
   * reporta sus rate limits en el cuerpo JSON, no como HTTP 429, así que `fetchWithRetry` —que sí
   * maneja el 429— nunca los veía. Es seguro reintentarlo: un rechazo por rate limit significa que
   * la task no se creó ni se cobró.
   */
  private async postConReintentos<T>(path: string, body: unknown): Promise<T[]> {
    const maxIntentos = 1 + (config.http.retries ?? 3);
    for (let intento = 1; ; intento++) {
      try {
        return await this.postOnce<T>(path, body);
      } catch (e) {
        const rateLimit = e instanceof DataForSeoTaskError && e.esRateLimit;
        if (!rateLimit || intento >= maxIntentos) throw e;

        const delay = backoffMs(intento - 1, { baseDelayMs: 500, maxDelayMs: 8_000 });
        console.warn(
          `  [dataforseo] rate limit (40202) en ${path}; reintento ${intento} tras ${delay}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  private async postOnce<T>(path: string, body: unknown): Promise<T[]> {
    const url = `${config.dataforseo.baseUrl}${path}`;
    // Con timeout y reintentos (#11): DataForSEO tiene rate limits (429) y picos de 5xx.
    // Un 401/400 NO se reintenta: es un error nuestro, no del servidor.
    const res = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      },
      {
        ...config.http,
        // Cada POST a DataForSEO es una task FACTURABLE. El 429 se sigue reintentando (es un
        // rechazo previo a ejecutar: no cobró nada), pero los timeouts y 5xx NO: son ambiguos, el
        // proveedor pudo haber ejecutado y cobrado, y el reintento pagaría la task dos veces.
        billable: true,
        onRetry: (attempt, delayMs, reason) =>
          console.warn(`  [dataforseo] reintento ${attempt} en ${path} tras ${delayMs}ms (${reason})`),
      },
    );

    const json = (await res.json()) as DfsResponse<T>;
    if (json.status_code !== 20000) {
      throw new Error(`DataForSEO status ${json.status_code}: ${json.status_message}`);
    }

    const results: T[] = [];
    const fallidas: Array<{ code: number; message: string }> = [];

    for (const task of json.tasks ?? []) {
      if (typeof task.cost === "number") {
        this.costUsd += task.cost;
        currentMeter().addUsd("dataforseo", task.cost); // alimenta el costo total del run
      }
      if (typeof task.status_code === "number" && task.status_code !== 20000) {
        fallidas.push({ code: task.status_code, message: task.status_message ?? "sin detalle" });
        continue;
      }
      for (const r of task.result ?? []) results.push(r);
    }

    /*
     * Una task fallida ROMPE la llamada. Antes solo se avisaba por consola y se omitía su
     * resultado ("parcial visible, no silencioso", decía el comentario).
     *
     * Con la cache eso dejó de ser cierto y se volvió peligroso: el pipeline recibe un array más
     * corto, no puede distinguir "el proveedor no tiene dato para esta keyword" de "la task que
     * traía esa keyword se cayó", y CACHEA la ausencia. Un fallo transitorio quedaba FOSILIZADO
     * entre 7 y 30 días, sirviendo `null` como si fuera un hecho del mercado.
     *
     * Si algo falló, no sabemos QUÉ falta. Lo honesto es fallar: el pipeline ya degrada bien
     * (marca el endpoint como degradado, la cobertura baja y el brief lo declara), y nada se
     * cachea porque la excepción se propaga antes.
     */
    if (fallidas.length > 0) {
      const detalle = fallidas.map((f) => `${f.code} (${f.message})`).join("; ");
      throw new DataForSeoTaskError(
        `${fallidas.length} task(s) fallaron en ${path}: ${detalle}. No se puede saber qué keywords ` +
          `faltan, así que la respuesta se descarta entera en vez de tomar las ausencias por ceros.`,
        fallidas.map((f) => f.code),
      );
    }

    return results;
  }
}

/**
 * Una o más tasks de DataForSEO fallaron dentro de una respuesta HTTP 200.
 *
 * DataForSEO reporta sus propios errores —incluidos los RATE LIMITS— como códigos dentro del JSON,
 * no como status HTTP. Un 40202 ("rate limit") llega con HTTP 200, así que la lógica de reintentos
 * a nivel HTTP (que sí maneja el 429) nunca lo veía.
 */
export class DataForSeoTaskError extends Error {
  constructor(
    message: string,
    readonly codes: number[],
  ) {
    super(message);
    this.name = "DataForSeoTaskError";
  }

  /**
   * ¿Fue un rechazo por rate limit? Ese código significa que la task NO se creó ni se cobró, así
   * que reintentar es seguro (misma distinción que el 429 a nivel HTTP: rechazo previo a ejecutar).
   */
  get esRateLimit(): boolean {
    return this.codes.length > 0 && this.codes.every((c) => c === 40202);
  }
}

interface DfsResponse<T> {
  status_code: number;
  status_message: string;
  tasks?: Array<{
    id?: string;
    cost?: number;
    status_code?: number;
    status_message?: string;
    result?: T[] | null;
  }>;
}

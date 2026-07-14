import { config } from "../config.js";
import { currentMeter } from "../lib/cost.js";
import { backoffMs, fetchWithRetry } from "../lib/http.js";
import { MAX_INTENTOS, NoopTaskLog, payloadHash } from "./task-log.js";
import type { ProviderTaskLog } from "./task-log.js";

/**
 * Una petición quedó **ambigua**: se envió y nunca volvió respuesta. Puede haberse cobrado.
 *
 * No es un error transitorio y **no se reintenta solo**: reintentar es exactamente lo que puede
 * cobrar dos veces. Detiene el run y deja el hash para que un humano lo resuelva.
 */
export class PeticionAmbiguaError extends Error {
  constructor(
    readonly path: string,
    readonly hash: string,
    readonly intento: number,
  ) {
    super(
      `[dataforseo] ${path}: una petición anterior se envió y NUNCA devolvió respuesta (intento ` +
        `${intento}). DataForSEO pudo haberla ejecutado y cobrado, y en los endpoints live-only no ` +
        `hay forma de comprobarlo desde el código.\n` +
        `  · payload_hash: ${hash}\n` +
        `  · El run se DETIENE en vez de reenviar: reenviar puede pagar la misma petición dos veces.\n` +
        `  · Comprobá en el panel de DataForSEO si se cobró. Si asumís el riesgo, reintentá con ` +
        `DFS_PERMITIR_REPAGO=1.`,
    );
    this.name = "PeticionAmbiguaError";
  }
}

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
    let reserva = await this.taskLog.reservar<T>(path, hash);

    /*
     * OTRO PROCESO YA ESTÁ PIDIENDO ESTO. No se paga otra vez: se espera su resultado.
     *
     * Antes este caso no existía, y era el doble cobro: la reserva se commiteaba ANTES del POST, así
     * que un segundo proceso veía `pending`, lo declaraba huérfano al instante y salía a pagar la
     * misma petición. Medido: de 2 reservas simultáneas, 2 autorizaban el POST.
     */
    if (reserva.estado === "en_progreso") {
      const listo = await this.esperarAOtroProceso<T>(path, hash, reserva.leaseHasta);
      if (listo) return listo;
      // El otro murió (su lease venció) o falló: ahora sí nos toca a nosotros.
      reserva = await this.taskLog.reservar<T>(path, hash);
      if (reserva.estado === "listo") return reserva.result;
      if (reserva.estado === "en_progreso") {
        throw new Error(`${path}: otro proceso sigue pidiéndolo. No se reintenta para no pagar dos veces.`);
      }
    }

    if (reserva.estado === "listo") {
      // Ya se pagó por esto y el resultado está guardado. Gasto: cero.
      return reserva.result;
    }

    /*
     * UNA PETICIÓN AMBIGUA NO AUTORIZA GASTAR. Se detiene.
     *
     * `huerfana` significa: hubo un envío que nunca devolvió respuesta. DataForSEO **pudo haber
     * ejecutado y cobrado**, y no hay forma de averiguarlo desde acá — en los endpoints *live-only*
     * (Labs) no existe una task que consultar.
     *
     * Antes esto REENVIABA, hasta 3 veces, imprimiendo "REPAGO" por consola. O sea: el código sabía
     * que podía estar pagando dos veces, lo decía, y lo hacía igual. Y ADR-14 afirmaba, dos párrafos
     * más abajo, que "se garantiza que no se pague dos veces por la misma petición". **Era falso, y
     * el propio código lo desmentía.**
     *
     * Ahora falla cerrado. El run se detiene con el hash exacto, y un humano decide: o acepta el
     * riesgo de repago (`DFS_PERMITIR_REPAGO=1`), o va al panel de DataForSEO y comprueba si esa
     * petición se cobró. Detener un research es barato; pagarlo dos veces sin enterarse, no.
     *
     * Esto es la MITAD del arreglo. La otra mitad es dejar de tener peticiones ambiguas: SERP y
     * Search Volume (el 46% del gasto) soportan el método Standard, donde la task ya pagada se
     * recupera GRATIS. Ver ADR-14.
     */
    if (reserva.estado === "huerfana") {
      if (!config.dataforseo.permitirRepago) {
        throw new PeticionAmbiguaError(path, hash, reserva.intento);
      }
      this.repagos++;
      console.warn(
        `  ⚠️  [dataforseo] REPAGO AUTORIZADO en ${path} (DFS_PERMITIR_REPAGO=1): un envío anterior ` +
          `nunca devolvió respuesta y pudo haberse cobrado. Reenviando (intento ${reserva.intento}/${MAX_INTENTOS}). ` +
          `Esto PUEDE estar pagándose dos veces.`,
      );
    }

    const attemptId = reserva.attemptId;
    const costeAntes = this.costUsd;
    try {
      const result = await this.postConReintentos<T>(path, body);
      const guardado = await this.taskLog.completar(path, hash, {
        result,
        costMicros: Math.round((this.costUsd - costeAntes) * 1_000_000),
        attemptId,
      });
      if (!guardado) {
        // El lease ya no era nuestro: otro intento tomó el relevo. No pisamos su resultado.
        console.warn(`  [dataforseo] ${path}: el resultado llegó tarde; otro intento ya tomó el relevo.`);
      }
      return result;
    } catch (e) {
      /*
       * La distinción que hace correcto todo esto — hay tres casos, no dos:
       *
       *  1. `DataForSeoTaskError` SIN costo cobrado → el proveedor respondió que falló y NO cobró.
       *     Se marca `failed`: el reintento es seguro.
       *
       *  2. `DataForSeoTaskError` CON costo cobrado (una task del lote salió bien y se pagó, otra
       *     falló) → **sí cobró**. Marcarlo `failed` sería declarar "no cobró" y el reintento
       *     pagaría otra vez. Se deja en `pending`: el próximo intento lo verá como repago.
       *
       *  3. Cualquier otro error (timeout, 5xx, red) → **ambiguo**: no hubo respuesta, la petición
       *     pudo llegar, ejecutarse y cobrarse. También queda `pending`.
       */
      const cobro = this.costUsd - costeAntes;
      if (e instanceof DataForSeoTaskError && cobro === 0) {
        await this.taskLog.fallar(path, hash, e.message, attemptId);
      }
      throw e;
    }
  }

  /**
   * Espera a que el proceso que tiene el lease termine. Devuelve su resultado, o `null` si murió.
   *
   * Sondea con espera fija: la alternativa —salir a pedirlo también— es pagar la misma petición dos
   * veces, que es justo lo que este registro existe para impedir.
   */
  private async esperarAOtroProceso<T>(
    path: string,
    hash: string,
    leaseHasta: Date,
  ): Promise<T[] | null> {
    console.warn(
      `  [dataforseo] ${path}: otra corrida ya está pidiendo esto. Espero su resultado en vez de ` +
        `volver a pagarlo.`,
    );
    const INTERVALO = 1_000;
    while (Date.now() < leaseHasta.getTime()) {
      await new Promise((r) => setTimeout(r, INTERVALO));
      const estado = await this.taskLog.consultar<T>(path, hash);
      if (estado?.estado === "listo") return estado.result;
      if (estado?.estado !== "en_progreso") return null; // murió o falló
    }
    return null;
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

    /*
     * El código de estado SUPERIOR también puede ser un rate limit (40202).
     *
     * Antes lanzaba un `Error` genérico, así que: (a) no entraba en el reintento de rate limit, y
     * (b) la reserva quedaba `pending` como si el resultado fuera AMBIGUO — cuando en realidad un
     * rate limit es un rechazo PREVIO a ejecutar y sabemos con certeza que no cobró. Se clasificaba
     * como "puede haber cobrado" algo que seguro no cobró.
     */
    if (json.status_code !== 20000) {
      throw new DataForSeoTaskError(
        `DataForSEO status ${json.status_code}: ${json.status_message}`,
        [json.status_code],
      );
    }

    /*
     * UNA RESPUESTA SIN `tasks` NO ES UN ÉXITO CON CERO RESULTADOS.
     *
     * `json.tasks ?? []` tomaba por bueno un HTTP 200 sin el array de tasks (respuesta truncada,
     * proxy que devuelve otra cosa, cambio de la API). El resultado quedaba `[]`, la tarea se
     * marcaba `done`, y el decorador cacheaba `null` para CADA keyword durante 7 días. Un fallo de
     * transporte se fosilizaba como "el mercado no tiene datos para esto".
     *
     * Ausencia de datos y ausencia de respuesta no son lo mismo. Solo se cachea la ausencia después
     * de una respuesta estructuralmente válida.
     */
    if (!Array.isArray(json.tasks)) {
      throw new Error(
        `DataForSEO devolvió 200 sin el array 'tasks' en ${path}. La respuesta no es válida: no se ` +
          `puede tomar por "sin datos" lo que en realidad es "sin respuesta".`,
      );
    }
    if (json.tasks.length === 0) {
      throw new Error(
        `DataForSEO devolvió 200 con 'tasks' vacío en ${path}. Se pidió al menos una task y no volvió ` +
          `ninguna: la respuesta está incompleta.`,
      );
    }
    if (typeof json.tasks_count === "number" && json.tasks_count !== json.tasks.length) {
      throw new Error(
        `DataForSEO dice tasks_count=${json.tasks_count} pero devolvió ${json.tasks.length} en ${path}. ` +
          `La respuesta está truncada y no se sabe qué falta.`,
      );
    }

    const results: T[] = [];
    const fallidas: Array<{ code: number; message: string }> = [];

    for (const task of json.tasks) {
      if (typeof task.cost === "number") {
        this.costUsd += task.cost;
        currentMeter().addUsd("dataforseo", task.cost); // alimenta el costo total del run
      }
      if (typeof task.status_code === "number" && task.status_code !== 20000) {
        fallidas.push({ code: task.status_code, message: task.status_message ?? "sin detalle" });
        continue;
      }
      // Una task OK sin `result` es una respuesta incompleta, no un "no hay datos".
      if (task.result == null) {
        throw new Error(
          `DataForSEO devolvió una task OK sin 'result' en ${path}. Incompleta: no se puede tomar por ` +
            `ausencia de datos.`,
        );
      }
      for (const r of task.result) results.push(r);
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
  /** Cuántas tasks dice haber devuelto. Si no cuadra con `tasks.length`, la respuesta está rota. */
  tasks_count?: number;
  tasks?: Array<{
    id?: string;
    cost?: number;
    status_code?: number;
    status_message?: string;
    result?: T[] | null;
  }>;
}

/**
 * Cliente HTTP resiliente (#11 review Codex).
 *
 * Antes, los `fetch` no tenían timeout (una conexión colgada colgaba el run entero) ni
 * reintentos (un 429 de DataForSEO fallaba de inmediato). Acá viven las tres piezas:
 *  - **timeout** por intento (AbortSignal),
 *  - **reintentos** con backoff exponencial + jitter,
 *  - **clasificación** de errores: 429 y 5xx se reintentan; el resto de los 4xx NO
 *    (reintentar un 401 o un 400 no lo va a arreglar, solo gasta tiempo y dinero).
 *
 * Respeta `Retry-After` cuando el servidor lo manda (es la señal autorizada de cuándo volver).
 */

export interface RetryOptions {
  /** Reintentos ADEMÁS del intento inicial. */
  retries: number;
  /** Timeout por intento, en ms. */
  timeoutMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Se llama antes de cada reintento (para loguear). */
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
  /**
   * Marca la operación como FACTURABLE y no idempotente (#1 review Codex).
   *
   * El riesgo: si el proveedor PROCESÓ la petición pero la respuesta se perdió (timeout, corte de
   * red, 5xx tras ejecutar), reintentar vuelve a ejecutar — y a COBRAR — la misma operación. Peor
   * aún, el medidor solo contabiliza la respuesta que sí llegó, así que el primer cargo ni siquiera
   * aparece en `meta_run`: se paga dos veces y el brief informa una.
   *
   * La distinción correcta NO es "pago vs. gratis" (no reintentar nada pago dejaría al sistema
   * indefenso ante los 429, que son constantes y esperables). Es **si el proveedor llegó a
   * procesar**:
   *
   *  - **429** → rechazo por rate limit, ANTES de ejecutar. No se cobró nada. Reintentar es seguro
   *    y sigue haciéndose siempre.
   *  - **Timeout / error de red / 5xx** → AMBIGUO. Puede haberse ejecutado. Con `billable: true`
   *    no se reintenta: se propaga el error y el pipeline degrada (la métrica queda `null`, que ya
   *    se reporta honestamente como "n/d").
   *
   * Un dato faltante cuesta $0 y se ve en el informe. Un cobro duplicado cuesta plata y es
   * invisible. Ante la duda, se prefiere el dato faltante.
   */
  billable?: boolean;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 3,
  timeoutMs: 30_000,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}

/** 429 (rate limit) y 5xx (fallo del servidor) son transitorios → tiene sentido reintentar. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Backoff exponencial con jitter completo, topeado. El jitter evita el "thundering herd". */
export function backoffMs(attempt: number, o: Pick<RetryOptions, "baseDelayMs" | "maxDelayMs">): number {
  const exp = Math.min(o.maxDelayMs, o.baseDelayMs * 2 ** attempt);
  return Math.round(Math.random() * exp);
}

/** `Retry-After` puede venir en segundos o como fecha HTTP. Devuelve ms, o null si no aplica. */
export function retryAfterMs(header: string | null, now = Date.now()): number | null {
  if (!header) return null;
  const secs = Number(header);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * `fetch` con timeout y reintentos. Devuelve la Response solo si es 2xx.
 * Lanza `HttpError` si el status no es reintentable (o si se agotaron los reintentos),
 * y un Error normal si fue un fallo de red/timeout persistente.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: Partial<RetryOptions> = {},
): Promise<Response> {
  const o: RetryOptions = { ...DEFAULT_RETRY, ...opts };

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(o.timeoutMs) });
    } catch (e) {
      const reason = (e as Error).name === "TimeoutError" ? `timeout (${o.timeoutMs}ms)` : (e as Error).message;

      // AMBIGUO: no sabemos si el proveedor llegó a procesar (y a cobrar). En una operación
      // facturable, reintentar puede pagar dos veces la misma task. Se propaga el error.
      if (o.billable) {
        throw new Error(
          `Fallo de red en una operación FACTURABLE (${url}): ${reason}. No se reintenta: el ` +
            `proveedor podría haberla procesado y cobrado, y un reintento la pagaría de nuevo.`,
        );
      }
      if (attempt >= o.retries) {
        throw new Error(`Fallo de red tras ${attempt + 1} intento(s) en ${url}: ${reason}`);
      }
      const delay = backoffMs(attempt, o);
      o.onRetry?.(attempt + 1, delay, reason);
      await sleep(delay);
      continue;
    }

    if (res.ok) return res;

    const body = await res.text();

    // Un 5xx en una operación facturable también es ambiguo: el servidor pudo ejecutar y fallar al
    // responder. El 429, en cambio, es un rechazo ANTES de ejecutar → siempre seguro de reintentar.
    const ambiguoYFacturable = o.billable === true && res.status >= 500;
    if (!isRetryableStatus(res.status) || ambiguoYFacturable || attempt >= o.retries) {
      throw new HttpError(res.status, body);
    }

    // El servidor manda cuándo volver: su Retry-After gana sobre nuestro backoff.
    const delay = retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt, o);
    o.onRetry?.(attempt + 1, delay, `HTTP ${res.status}`);
    await sleep(delay);
  }
}

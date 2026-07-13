/**
 * Cliente HTTP resiliente (#11 review Codex).
 *
 * NOTA: es una copia de `kr-service/src/lib/http.ts`. Los módulos son paquetes independientes
 * y no comparten código a propósito (ver arquitectura). Cuando se extraiga el paquete común
 * (junto con el esquema Zod del contrato), este archivo se va con él.
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
      // Red caída o timeout: transitorio por naturaleza → reintentar.
      const reason = (e as Error).name === "TimeoutError" ? `timeout (${o.timeoutMs}ms)` : (e as Error).message;
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
    if (!isRetryableStatus(res.status) || attempt >= o.retries) {
      throw new HttpError(res.status, body);
    }

    // El servidor manda cuándo volver: su Retry-After gana sobre nuestro backoff.
    const delay = retryAfterMs(res.headers.get("retry-after")) ?? backoffMs(attempt, o);
    o.onRetry?.(attempt + 1, delay, `HTTP ${res.status}`);
    await sleep(delay);
  }
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { HttpError, backoffMs, fetchWithRetry, isRetryableStatus, retryAfterMs } from "./http.js";

type Spec = { status: number; headers?: Record<string, string> } | Error;

/**
 * Reemplaza globalThis.fetch por una secuencia de respuestas. Construye una Response NUEVA en
 * cada llamada: reusar la misma daría "body already consumed" en el segundo intento.
 * Si se agota la lista, repite la última.
 */
function stubFetch(specs: Spec[]) {
  const calls = { n: 0 };
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    const s = specs[Math.min(calls.n, specs.length - 1)]!;
    calls.n++;
    if (s instanceof Error) throw s;
    return new Response("body", { status: s.status, headers: s.headers ?? {} });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const res = (status: number, headers: Record<string, string> = {}): Spec => ({ status, headers });

// Reintentos rápidos para no demorar los tests.
const FAST = { baseDelayMs: 1, maxDelayMs: 2, timeoutMs: 1000 };

test("#11 isRetryableStatus: 429 y 5xx sí; el resto de 4xx no", () => {
  assert.equal(isRetryableStatus(429), true);
  assert.equal(isRetryableStatus(500), true);
  assert.equal(isRetryableStatus(503), true);
  assert.equal(isRetryableStatus(400), false);
  assert.equal(isRetryableStatus(401), false);
  assert.equal(isRetryableStatus(404), false);
});

test("#11 backoffMs: crece con el intento y nunca supera el tope", () => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const d = backoffMs(attempt, { baseDelayMs: 500, maxDelayMs: 8_000 });
    assert.ok(d >= 0 && d <= 8_000, `delay fuera de rango: ${d}`);
  }
});

test("#11 retryAfterMs: acepta segundos y fecha HTTP", () => {
  assert.equal(retryAfterMs("2"), 2000);
  const now = Date.now();
  const inFive = new Date(now + 5000).toUTCString();
  const ms = retryAfterMs(inFive, now);
  assert.ok(ms !== null && ms > 3000 && ms <= 5000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(retryAfterMs("basura"), null);
});

test("#11 fetchWithRetry: devuelve la respuesta si es 2xx al primer intento", async () => {
  const s = stubFetch([res(200)]);
  try {
    const r = await fetchWithRetry("http://x", {}, FAST);
    assert.equal(r.status, 200);
    assert.equal(s.calls.n, 1);
  } finally {
    s.restore();
  }
});

test("#11 fetchWithRetry: reintenta un 500 y termina bien", async () => {
  const s = stubFetch([res(500), res(500), res(200)]);
  try {
    const r = await fetchWithRetry("http://x", {}, { ...FAST, retries: 3 });
    assert.equal(r.status, 200);
    assert.equal(s.calls.n, 3, "dos fallos + un éxito");
  } finally {
    s.restore();
  }
});

test("#11 fetchWithRetry: un 429 se reintenta", async () => {
  const s = stubFetch([res(429), res(200)]);
  try {
    const r = await fetchWithRetry("http://x", {}, { ...FAST, retries: 2 });
    assert.equal(r.status, 200);
    assert.equal(s.calls.n, 2);
  } finally {
    s.restore();
  }
});

test("#11 fetchWithRetry: un 400 NO se reintenta (falla al primer intento)", async () => {
  const s = stubFetch([res(400)]);
  try {
    await assert.rejects(() => fetchWithRetry("http://x", {}, { ...FAST, retries: 3 }), HttpError);
    assert.equal(s.calls.n, 1, "no debe reintentar un error del cliente");
  } finally {
    s.restore();
  }
});

test("#11 fetchWithRetry: agotados los reintentos, lanza HttpError con el status", async () => {
  const s = stubFetch([res(503)]);
  try {
    await assert.rejects(
      () => fetchWithRetry("http://x", {}, { ...FAST, retries: 2 }),
      (e: unknown) => e instanceof HttpError && e.status === 503,
    );
    assert.equal(s.calls.n, 3, "intento inicial + 2 reintentos");
  } finally {
    s.restore();
  }
});

test("#11 fetchWithRetry: un fallo de red se reintenta y luego se propaga", async () => {
  const s = stubFetch([new Error("ECONNRESET")]);
  try {
    await assert.rejects(
      () => fetchWithRetry("http://x", {}, { ...FAST, retries: 1 }),
      /Fallo de red tras 2 intento/,
    );
    assert.equal(s.calls.n, 2);
  } finally {
    s.restore();
  }
});

test("#11 fetchWithRetry: onRetry avisa de cada reintento", async () => {
  const s = stubFetch([res(500), res(200)]);
  const seen: string[] = [];
  try {
    await fetchWithRetry("http://x", {}, { ...FAST, retries: 2, onRetry: (_a, _d, r) => seen.push(r) });
    assert.deepEqual(seen, ["HTTP 500"]);
  } finally {
    s.restore();
  }
});

// ---------------------------------------------------------------- #1: doble cobro
//
// Un POST facturable a DataForSEO que hace timeout es AMBIGUO: el proveedor pudo procesarlo (y
// cobrarlo) aunque la respuesta se perdiera. Reintentar pagaría la misma task dos veces, y el
// medidor solo vería el segundo cargo. Un dato faltante cuesta $0 y se ve en el informe como
// "n/d"; un cobro duplicado cuesta plata y es invisible.

test("#1 billable: un timeout NO se reintenta (evita pagar la task dos veces)", async () => {
  const s = stubFetch([Object.assign(new Error("timed out"), { name: "TimeoutError" })]);
  try {
    await assert.rejects(
      () => fetchWithRetry("https://api.dataforseo.com/x", {}, { billable: true, retries: 3 }),
      /FACTURABLE/,
    );
    assert.equal(s.calls.n, 1, "debe hacer UNA sola llamada, sin reintentos");
  } finally {
    s.restore();
  }
});

test("#1 billable: un 5xx NO se reintenta (el servidor pudo ejecutar y fallar al responder)", async () => {
  const s = stubFetch([res(500), res(200)]);
  try {
    await assert.rejects(() =>
      fetchWithRetry("https://api.dataforseo.com/x", {}, { billable: true, retries: 3 }),
    );
    assert.equal(s.calls.n, 1);
  } finally {
    s.restore();
  }
});

test("#1 billable: un 429 SÍ se reintenta (rechazo previo a ejecutar → no cobró nada)", async () => {
  const s = stubFetch([res(429), res(429), res(200)]);
  try {
    const r = await fetchWithRetry(
      "https://api.dataforseo.com/x",
      {},
      { billable: true, retries: 3, baseDelayMs: 1 },
    );
    assert.equal(r.status, 200);
    assert.equal(s.calls.n, 3, "el rate limit debe seguir reintentándose");
  } finally {
    s.restore();
  }
});

test("#1 no-billable: el timeout se sigue reintentando (lecturas idempotentes)", async () => {
  const s = stubFetch([
    Object.assign(new Error("timed out"), { name: "TimeoutError" }),
    res(200),
  ]);
  try {
    const r = await fetchWithRetry("https://example.com/x", {}, { retries: 3, baseDelayMs: 1 });
    assert.equal(r.status, 200);
    assert.equal(s.calls.n, 2);
  } finally {
    s.restore();
  }
});

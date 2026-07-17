import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crearApi, type ApiError } from './api-core';

/** Captura la última request y devuelve lo que se le configure. Sin red. */
function fakeFetch(respuesta: { status?: number; body?: unknown }) {
  const capturado: { url?: string; method?: string; headers?: Record<string, string>; body?: string } = {};
  const fn = (async (url: string, init: RequestInit = {}) => {
    capturado.url = url;
    capturado.method = init.method;
    capturado.headers = init.headers as Record<string, string>;
    capturado.body = init.body as string;
    const status = respuesta.status ?? 200;
    return new Response(respuesta.body === undefined ? null : JSON.stringify(respuesta.body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, capturado };
}

const opts = (fn: typeof fetch) => ({
  baseUrl: 'http://api.test',
  getToken: () => 'tok-123',
  getTenant: () => 'tenant-abc',
  fetchFn: fn,
});

test('cada request lleva Authorization y x-amg-tenant', async () => {
  const { fn, capturado } = fakeFetch({ body: { runs: [] } });
  await crearApi(opts(fn)).listarRuns();
  assert.equal(capturado.url, 'http://api.test/runs');
  assert.equal(capturado.headers!['authorization'], 'Bearer tok-123');
  assert.equal(capturado.headers!['x-amg-tenant'], 'tenant-abc');
});

test('listarRuns con clientId lo pasa como query', async () => {
  const { fn, capturado } = fakeFetch({ body: { runs: [] } });
  await crearApi(opts(fn)).listarRuns('cli-1');
  assert.equal(capturado.url, 'http://api.test/runs?clientId=cli-1');
});

test('crearRun postea el cuerpo y devuelve el runId', async () => {
  const { fn, capturado } = fakeFetch({ status: 201, body: { runId: 'run-9' } });
  const runId = await crearApi(opts(fn)).crearRun({ clientId: 'cli-1', prompt: 'pizza' });
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/runs');
  assert.deepEqual(JSON.parse(capturado.body!), { clientId: 'cli-1', prompt: 'pizza' });
  assert.equal(runId, 'run-9');
});

test('verBrief pega a /runs/:id y devuelve run+pages', async () => {
  const brief = { run: { id: 'run-9' }, pages: [{ id: 'p1' }] };
  const { fn, capturado } = fakeFetch({ body: brief });
  const res = await crearApi(opts(fn)).verBrief('run-9');
  assert.equal(capturado.url, 'http://api.test/runs/run-9');
  assert.deepEqual(res, brief);
});

test('aprobarPagina / editarPagina / aprobarRun usan el método y la ruta correctos', async () => {
  {
    const { fn, capturado } = fakeFetch({ body: { ok: true } });
    await crearApi(opts(fn)).aprobarPagina('p1');
    assert.equal(capturado.method, 'POST');
    assert.equal(capturado.url, 'http://api.test/pages/p1/approve');
  }
  {
    const { fn, capturado } = fakeFetch({ body: { ok: true } });
    await crearApi(opts(fn)).editarPagina('p1', { keyword_principal: 'x' });
    assert.equal(capturado.method, 'PATCH');
    assert.equal(capturado.url, 'http://api.test/pages/p1');
    assert.deepEqual(JSON.parse(capturado.body!), { keyword_principal: 'x' });
  }
  {
    const { fn, capturado } = fakeFetch({ body: { ok: true } });
    await crearApi(opts(fn)).aprobarRun('run-9');
    assert.equal(capturado.method, 'POST');
    assert.equal(capturado.url, 'http://api.test/runs/run-9/approve');
  }
});

test('un error de la API se propaga con status y el mensaje del body', async () => {
  const { fn } = fakeFetch({ status: 403, body: { error: 'No autorizado para esta operación.' } });
  await assert.rejects(
    () => crearApi(opts(fn)).aprobarRun('run-9'),
    (e: ApiError) => {
      assert.equal(e.status, 403);
      assert.equal(e.message, 'No autorizado para esta operación.');
      return true;
    },
  );
});

test('sin token no se manda el header Authorization (la API responderá 401)', async () => {
  const { fn, capturado } = fakeFetch({ body: { runs: [] } });
  await crearApi({ baseUrl: 'http://api.test', getToken: () => null, getTenant: () => 't', fetchFn: fn }).listarRuns();
  assert.equal(capturado.headers!['authorization'], undefined);
});

/** fetch que devuelve una secuencia de respuestas, una por llamada. */
function fakeSecuencia(respuestas: Array<{ status: number; body?: unknown }>) {
  let i = 0;
  const fn = (async () => {
    const r = respuestas[Math.min(i, respuestas.length - 1)];
    i++;
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), {
      status: r.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, llamadas: () => i };
}

test('un 401 refresca y reintenta UNA vez; el retry sale bien', async () => {
  const { fn, llamadas } = fakeSecuencia([{ status: 401 }, { status: 200, body: { runs: [] } }]);
  let refrescos = 0;
  const api = crearApi({
    baseUrl: 'http://api.test',
    getToken: () => 'tok',
    getTenant: () => 't',
    fetchFn: fn,
    refrescar: async () => {
      refrescos++;
      return true;
    },
  });
  await api.listarRuns();
  assert.equal(refrescos, 1, 'refrescó una vez');
  assert.equal(llamadas(), 2, 'reintentó el request');
});

test('si tras refrescar sigue 401, se propaga y NO se refresca en bucle', async () => {
  const { fn, llamadas } = fakeSecuencia([{ status: 401 }, { status: 401, body: { error: 'sigue mal' } }]);
  let refrescos = 0;
  const api = crearApi({
    baseUrl: 'http://api.test',
    getToken: () => 'tok',
    getTenant: () => 't',
    fetchFn: fn,
    refrescar: async () => {
      refrescos++;
      return true;
    },
  });
  await assert.rejects(() => api.listarRuns(), (e: ApiError) => e.status === 401);
  assert.equal(refrescos, 1, 'refrescó una sola vez');
  assert.equal(llamadas(), 2, 'reintentó una sola vez');
});

test('si el refresh falla (false), el 401 se propaga sin reintentar', async () => {
  const { fn, llamadas } = fakeSecuencia([{ status: 401, body: { error: 'no autorizado' } }]);
  const api = crearApi({
    baseUrl: 'http://api.test',
    getToken: () => 'tok',
    getTenant: () => 't',
    fetchFn: fn,
    refrescar: async () => false,
  });
  await assert.rejects(() => api.listarRuns(), (e: ApiError) => e.status === 401);
  assert.equal(llamadas(), 1, 'no reintentó');
});

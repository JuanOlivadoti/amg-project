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

test('🔴 un 503 se propaga como ApiError con status 503 y NO dispara refrescar', async () => {
  // El refresh solo tiene sentido para un token vencido (401). Un 503 es la API diciendo "no puedo
  // verificar el token" (caída del JWKS) — refrescar ahí no arregla nada, y gatillar el reintento en
  // ese caso reabriría exactamente el hueco que el 401-vs-503 del lado de la API vino a cerrar.
  const { fn, llamadas } = fakeSecuencia([{ status: 503, body: { error: 'No se puede verificar el token' } }]);
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
  await assert.rejects(
    () => api.listarRuns(),
    (e: ApiError) => {
      assert.equal(e.status, 503);
      return true;
    },
  );
  assert.equal(refrescos, 0, 'un 503 no es un token vencido: no debe refrescar');
  assert.equal(llamadas(), 1, 'no reintentó');
});

test('sin token no se manda el header Authorization (la API responderá 401)', async () => {
  const { fn, capturado } = fakeFetch({ body: { runs: [] } });
  await crearApi({ baseUrl: 'http://api.test', getToken: () => null, getTenant: () => 't', fetchFn: fn }).listarRuns();
  assert.equal(capturado.headers!['authorization'], undefined);
});

test('listarClientes pega a GET /clients y desenvuelve { clientes }', async () => {
  const clientes = [{ id: 'c1', nombre: 'Pizzería Roma' }];
  const { fn, capturado } = fakeFetch({ body: { clientes } });
  const res = await crearApi(opts(fn)).listarClientes();
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/clients');
  assert.equal(capturado.headers!['authorization'], 'Bearer tok-123');
  assert.equal(capturado.headers!['x-amg-tenant'], 'tenant-abc');
  assert.deepEqual(res, clientes);
});

test('verCliente pega a GET /clients/:id y desenvuelve { cliente }', async () => {
  const cliente = { id: 'c1', nombre: 'Pizzería Roma' };
  const { fn, capturado } = fakeFetch({ body: { cliente } });
  const res = await crearApi(opts(fn)).verCliente('c1');
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/clients/c1');
  assert.deepEqual(res, cliente);
});

test('crearCliente postea el cuerpo a POST /clients y devuelve el id', async () => {
  const { fn, capturado } = fakeFetch({ status: 201, body: { id: 'c9' } });
  const id = await crearApi(opts(fn)).crearCliente({ nombre: 'Nuevo Cliente' });
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/clients');
  assert.deepEqual(JSON.parse(capturado.body!), { nombre: 'Nuevo Cliente' });
  assert.equal(id, 'c9');
});

test('actualizarCliente usa PATCH /clients/:id con los cambios', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).actualizarCliente('c1', { score: 80 });
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/clients/c1');
  assert.deepEqual(JSON.parse(capturado.body!), { score: 80 });
});

test('archivarCliente / desarchivarCliente usan POST y la ruta correcta', async () => {
  {
    const { fn, capturado } = fakeFetch({ body: { ok: true } });
    await crearApi(opts(fn)).archivarCliente('c1');
    assert.equal(capturado.method, 'POST');
    assert.equal(capturado.url, 'http://api.test/clients/c1/archive');
  }
  {
    const { fn, capturado } = fakeFetch({ body: { ok: true } });
    await crearApi(opts(fn)).desarchivarCliente('c1');
    assert.equal(capturado.method, 'POST');
    assert.equal(capturado.url, 'http://api.test/clients/c1/desarchivar');
  }
});

test('un error de /clients se propaga como ApiError con status y mensaje legible', async () => {
  const { fn } = fakeFetch({ status: 404, body: { error: 'Cliente no encontrado.' } });
  await assert.rejects(
    () => crearApi(opts(fn)).verCliente('inexistente'),
    (e: ApiError) => {
      assert.equal(e.status, 404);
      assert.equal(e.message, 'Cliente no encontrado.');
      return true;
    },
  );
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

// ---------------------------------------------------------------- miembros (pieza 2)

test('listarMiembros pega a GET /members y desenvuelve { miembros }', async () => {
  const miembros = [{ id: 'm1', user_id: 'u1', rol: 'maestro', email: 'a@x.test' }];
  const { fn, capturado } = fakeFetch({ body: { miembros } });
  const res = await crearApi(opts(fn)).listarMiembros();
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/members');
  assert.equal(capturado.headers!['x-amg-tenant'], 'tenant-abc');
  assert.deepEqual(res, miembros);
});

test('cambiarRolMiembro patchea /members/:userId con el userId escapado', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  // Un `userId` con barra reventaría la ruta si no se escapara: pasaría a apuntar a otro recurso.
  await crearApi(opts(fn)).cambiarRolMiembro('u1/../otro', { rol: 'equipo' });
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/members/u1%2F..%2Fotro');
});

test('🔴 cambiarRolMiembro NO manda client_id cuando el rol no es cliente', async () => {
  // La base fuerza `client_id = null` para cualquier rol que no sea `cliente`
  // (`cliente_exige_client_id`, 0001). Mandarlo igual sugeriría que se conserva, y el día que alguien
  // lea el body en un log creería que ese cliente sigue asignado.
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).cambiarRolMiembro('u1', { rol: 'equipo', client_id: 'c-viejo' });
  assert.deepEqual(JSON.parse(capturado.body!), { rol: 'equipo' });
});

test('cambiarRolMiembro sí manda client_id cuando el rol es cliente', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).cambiarRolMiembro('u1', { rol: 'cliente', client_id: 'c-1' });
  assert.deepEqual(JSON.parse(capturado.body!), { rol: 'cliente', client_id: 'c-1' });
});

test('cambiarRolMiembro propaga el 403 de RLS con su status', async () => {
  // Un `equipo` que intenta repartir roles: la política `membership_update` lanza 42501 y la API lo
  // mapea a 403. La UI tiene que poder distinguirlo de un 404 para decir "no tenés permiso".
  const { fn } = fakeFetch({ status: 403, body: { error: 'No autorizado para esta operación.' } });
  const api = crearApi(opts(fn));
  await assert.rejects(() => api.cambiarRolMiembro('u2', { rol: 'maestro' }), (e: ApiError) => e.status === 403);
});

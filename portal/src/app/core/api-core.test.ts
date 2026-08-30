import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crearApi,
  esSinPaginasAprobadas,
  esTransicionInvalida,
  nombreDeDescarga,
  type ApiError,
} from './api-core';
import { SIN_PAGINAS_APROBADAS, TRANSICION_INVALIDA } from './codigos';

/**
 * Captura la última request y devuelve lo que se le configure. Sin red.
 *
 * `crudo: true` manda el body TAL CUAL en vez de serializarlo a JSON, y `headers` agrega cabeceras de
 * respuesta: las dos cosas hacen falta para la descarga del informe, que es `text/markdown` con un
 * `Content-Disposition` y no un JSON.
 */
function fakeFetch(respuesta: {
  status?: number;
  body?: unknown;
  crudo?: boolean;
  headers?: Record<string, string>;
}) {
  const capturado: { url?: string; method?: string; headers?: Record<string, string>; body?: string } = {};
  const fn = (async (url: string, init: RequestInit = {}) => {
    capturado.url = url;
    capturado.method = init.method;
    capturado.headers = init.headers as Record<string, string>;
    capturado.body = init.body as string;
    const status = respuesta.status ?? 200;
    const cuerpo =
      respuesta.body === undefined
        ? null
        : respuesta.crudo
          ? String(respuesta.body)
          : JSON.stringify(respuesta.body);
    return new Response(cuerpo, {
      status,
      headers: {
        'content-type': respuesta.crudo ? 'text/markdown; charset=utf-8' : 'application/json',
        ...respuesta.headers,
      },
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

test('🔴 listarRuns("") NO degrada a la lista global: lanza ANTES de salir a la red', async () => {
  /*
   * Un `clientId` vacío no es «todos»: es un id que no llegó — un `:id` ausente en la ruta, un signal
   * todavía sin escribir. Con el `clientId ? … : ''` a secas, ese caso construía `GET /runs` **sin
   * filtro**: la lista de research de TODA la cartera, que el portal retiró al mudar el research bajo
   * la ficha del cliente. El fallo era mudo —200, una lista más larga, ningún error— y la única cosa
   * que lo evitaba era una guarda en el `ngOnInit` de una pantalla, que se lee como un dedup
   * redundante y se borra sin miedo.
   *
   * Omitir el argumento SÍ sigue siendo la lista sin filtro (lo usa el primer test de este archivo):
   * la distinción entre «no pedí filtro» y «pedí filtrar por nada» es justamente el arreglo.
   */
  const { fn, capturado } = fakeFetch({ body: { runs: [] } });
  await assert.rejects(() => crearApi(opts(fn)).listarRuns(''), /clientId/);
  assert.equal(capturado.url, undefined, 'no tenía que haber salido ninguna petición');
});

test('listarIdeas con clientId lo pasa como query', async () => {
  const { fn, capturado } = fakeFetch({ body: { ideas: [] } });
  await crearApi(opts(fn)).listarIdeas('cli-1');
  assert.equal(capturado.url, 'http://api.test/ideas?clientId=cli-1');
});

test('listarIdeas con estado lo agrega a la query, junto al clientId', async () => {
  const { fn, capturado } = fakeFetch({ body: { ideas: [] } });
  await crearApi(opts(fn)).listarIdeas('cli-1', 'en_revision');
  assert.equal(capturado.url, 'http://api.test/ideas?clientId=cli-1&estado=en_revision');
});

test('🔴 listarIdeas("") NO expone la cartera entera: lanza ANTES de salir a la red', async () => {
  /*
   * Mismo motivo que `listarRuns('')`, pero acá NO hay variante «sin clientId»: este tab siempre
   * tiene un cliente (sale del `:id` de la ruta), así que la interfaz no ofrece un modo sin filtrar
   * y un clientId vacío no puede significar «dame todo» — solo puede ser un id que no llegó.
   */
  const { fn, capturado } = fakeFetch({ body: { ideas: [] } });
  await assert.rejects(() => crearApi(opts(fn)).listarIdeas(''), /clientId/);
  assert.equal(capturado.url, undefined, 'no tenía que haber salido ninguna petición');
});

// ---------------------------------------------------------------- todas las ideas del tenant (dashboard)

test('listarTodasLasIdeas() pide GET /ideas SIN clientId en el query string', async () => {
  const { fn, capturado } = fakeFetch({ body: { ideas: [] } });
  await crearApi(opts(fn)).listarTodasLasIdeas();
  assert.equal(capturado.url, 'http://api.test/ideas');
});

test('listarTodasLasIdeas(estado) agrega ?estado=… a la query', async () => {
  const { fn, capturado } = fakeFetch({ body: { ideas: [] } });
  await crearApi(opts(fn)).listarTodasLasIdeas('en_revision');
  assert.equal(capturado.url, 'http://api.test/ideas?estado=en_revision');
});

// ---------------------------------------------------------------- el detalle de una idea (Task 2)

test('obtenerIdea pega a /ideas/:id y devuelve la idea', async () => {
  const idea = { id: 'idea-1', client_id: 'c1', titulo: 'x', estado: 'nueva', creada_en: '2026-01-01T00:00:00.000Z' };
  const { fn, capturado } = fakeFetch({ body: { idea } });
  const res = await crearApi(opts(fn)).obtenerIdea('idea-1');
  assert.equal(capturado.url, 'http://api.test/ideas/idea-1');
  assert.equal(capturado.method, 'GET');
  assert.deepEqual(res, idea);
});

test('🔴 obtenerIdea devuelve null en un 404, no lanza — mismo patrón que "no existe / no es visible"', async () => {
  /*
   * `GET /ideas/:id` unifica a propósito "no existe", "es de otro tenant" y "no la puede ver" en un
   * solo 404 (`api/src/app.ts`). La pantalla de detalle tiene que poder mostrar "no encontrada" sin
   * que cada llamador tenga que envolver la promesa en un try/catch — por eso `null` y no una
   * excepción, al revés que `cambiarEstadoIdea`/`editarIdea`, donde SÍ hace falta el mensaje del
   * servidor (ver los tests de abajo).
   */
  const { fn } = fakeFetch({ status: 404, body: { error: 'Idea no encontrada.' } });
  const res = await crearApi(opts(fn)).obtenerIdea('idea-inexistente');
  assert.equal(res, null);
});

test('obtenerIdea relanza cualquier otro error (no se traga un 401/500 disfrazándolo de "no existe")', async () => {
  const { fn } = fakeFetch({ status: 500, body: { error: 'boom' } });
  await assert.rejects(() => crearApi(opts(fn)).obtenerIdea('idea-1'), /boom/);
});

test('cambiarEstadoIdea manda SOLO { estado } por PATCH, nunca contenido', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true, estado: 'en_revision' } });
  await crearApi(opts(fn)).cambiarEstadoIdea('idea-1', 'en_revision');
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/ideas/idea-1');
  assert.deepEqual(JSON.parse(capturado.body!), { estado: 'en_revision' });
});

test('🔴 cambiarEstadoIdea lanza con el mensaje del servidor ante una transición inválida (400)', async () => {
  // La pantalla necesita MOSTRAR este error (el brief lo pide explícitamente): tragárselo dejaría un
  // botón que parece funcionar y no hace nada, el mismo defecto que "Aprobar el run" (15ª review, H1).
  const { fn } = fakeFetch({
    status: 400,
    body: { error: 'Transición de estado inválida: nueva → aprobada.', desde: 'nueva', hacia: 'aprobada' },
  });
  await assert.rejects(
    () => crearApi(opts(fn)).cambiarEstadoIdea('idea-1', 'aprobada'),
    /Transición de estado inválida/,
  );
});

test('🔴 cambiarEstadoIdea lanza en un 404 (no encontrada / no visible / sin permiso, unificados)', async () => {
  const { fn } = fakeFetch({ status: 404, body: { error: 'Idea no encontrada.' } });
  await assert.rejects(() => crearApi(opts(fn)).cambiarEstadoIdea('idea-1', 'en_revision'), /no encontrada/);
});

test('editarIdea manda por PATCH exactamente el subconjunto de cambios, sin `estado`', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).editarIdea('idea-1', { titulo: 'Nuevo título', resumen: null });
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/ideas/idea-1');
  const body = JSON.parse(capturado.body!);
  assert.deepEqual(body, { titulo: 'Nuevo título', resumen: null });
  assert.ok(!('estado' in body), 'editarIdea nunca debe mandar `estado`: eso es cambiarEstadoIdea');
});

test('🔴 editarIdea lanza con el mensaje del servidor si el body no pasa la allowlist (400)', async () => {
  const { fn } = fakeFetch({ status: 400, body: { error: 'audio_url debe ser una URL http(s).' } });
  await assert.rejects(
    () => crearApi(opts(fn)).editarIdea('idea-1', { audio_url: 'javascript:alert(1)' as never }),
    /URL http\(s\)/,
  );
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
    await crearApi(opts(fn)).aprobarRun('run-9', 'crear_web');
    assert.equal(capturado.method, 'POST');
    assert.equal(capturado.url, 'http://api.test/runs/run-9/approve');
    assert.deepEqual(JSON.parse(capturado.body!), { destino: 'crear_web' });
  }
});

// ---------------------------------------------------------------- el informe (KR-2b)

test('verInforme pega a GET /runs/:id/informe con el id escapado', async () => {
  const { fn, capturado } = fakeFetch({ body: { informe_md: '# Informe', generado_at: '2026-07-30T00:16:15.000Z' } });
  const res = await crearApi(opts(fn)).verInforme('run 9/../otro');
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/runs/run%209%2F..%2Fotro/informe');
  assert.equal(capturado.headers!['authorization'], 'Bearer tok-123');
  assert.deepEqual(res, { informe_md: '# Informe', generado_at: '2026-07-30T00:16:15.000Z' });
});

test('🔴 verInforme devuelve informe_md:null tal cual: NO es un error', async () => {
  // El caso que la pantalla tiene que distinguir del 404. Un run que existe y todavía no tiene informe
  // —o cuyo informe no ve este rol, indistinguible a propósito— responde 200 con los dos campos en null.
  // Si esto lanzara, la pantalla mostraría un cartel de error en el estado más normal que hay.
  const { fn } = fakeFetch({ body: { informe_md: null, generado_at: null } });
  const res = await crearApi(opts(fn)).verInforme('run-9');
  assert.deepEqual(res, { informe_md: null, generado_at: null });
});

test('verInforme propaga el 404 (no hay run) con su status, para poder separarlo del null', async () => {
  const { fn } = fakeFetch({ status: 404, body: { error: 'Run no encontrado.' } });
  await assert.rejects(
    () => crearApi(opts(fn)).verInforme('inexistente'),
    (e: ApiError) => {
      assert.equal(e.status, 404);
      assert.equal(e.message, 'Run no encontrado.');
      return true;
    },
  );
});

test('descargarInformeMd pide el .md AUTENTICADO y devuelve el blob con su nombre', async () => {
  // El token va en el header, nunca en la URL: en la query string quedaría en los logs del servidor y en
  // el historial del navegador. Este assert es lo que impide que alguien "simplifique" a un <a href>.
  const { fn, capturado } = fakeFetch({
    body: '# Informe\n',
    crudo: true,
    headers: { 'content-disposition': 'attachment; filename="informe-Bella-Napoli.md"' },
  });
  const archivo = await crearApi(opts(fn)).descargarInformeMd('run-9');
  assert.equal(capturado.url, 'http://api.test/runs/run-9/informe.md');
  assert.equal(capturado.headers!['authorization'], 'Bearer tok-123');
  assert.ok(!capturado.url!.includes('tok-123'), 'el token NO puede viajar en la URL');
  assert.equal(archivo.nombre, 'informe-Bella-Napoli.md');
  assert.equal(await archivo.blob.text(), '# Informe\n');
});

test('🔴 un 401 al bajar el .md también refresca y reintenta: la descarga usa la MISMA política', async () => {
  // La descarga no hace su propio `fetch`, y esto es lo que lo fija. Con una segunda ruta HTTP paralela,
  // un token vencido le daría al usuario un error de la nada justo en el botón de descargar.
  const { fn, llamadas } = fakeSecuencia([{ status: 401 }, { status: 200, body: '# ok' }]);
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
  const archivo = await api.descargarInformeMd('run-9');
  assert.equal(refrescos, 1, 'refrescó una vez');
  assert.equal(llamadas(), 2, 'reintentó el request');
  assert.ok(archivo.blob.size > 0, 'el reintento trajo el cuerpo, no un blob vacío');
});

// ------------------------------------------- el entregable del restaurante (2026-08-07)

test('verEntregableMd pide GET /runs/:id/entregable.md autenticado y devuelve el TEXTO', async () => {
  const { fn, capturado } = fakeFetch({
    body: '# Keyword Research — Borcelle Burger\n',
    crudo: true,
    headers: { 'content-disposition': 'attachment; filename="entregable-Borcelle-Burger.md"' },
  });
  const md = await crearApi(opts(fn)).verEntregableMd('run 9/../otro');
  assert.equal(capturado.method, 'GET');
  // El id se escapa: es un segmento de ruta, y viene de la URL del navegador.
  assert.equal(capturado.url, 'http://api.test/runs/run%209%2F..%2Fotro/entregable.md');
  assert.equal(capturado.headers!['authorization'], 'Bearer tok-123');
  assert.ok(!capturado.url!.includes('tok-123'), 'el token NO puede viajar en la URL');
  // Texto, no Blob: el destino es la pantalla imprimible, que lo parsea a bloques.
  assert.equal(md, '# Keyword Research — Borcelle Burger\n');
});

test('🔴 el 404 del entregable se propaga con su status: no-staff y run inexistente son lo MISMO', async () => {
  /*
   * El endpoint responde 404 en tres casos —run inexistente, run de otro tenant, y quien pregunta no es
   * staff— y con la misma forma, porque `app.es_staff()` va en el PREDICADO de la consulta y devuelve
   * cero filas (`db/src/store.ts`, `getDatosEntregable`). Este test fija que el cliente no inventa una
   * cuarta respuesta: si algún día devolviera `''` en vez de lanzar, la pantalla imprimible pintaría un
   * documento vacío en vez de decir qué pasó.
   */
  const { fn } = fakeFetch({ status: 404, body: { error: 'Run no encontrado.' } });
  await assert.rejects(
    () => crearApi(opts(fn)).verEntregableMd('inexistente'),
    (e: ApiError) => {
      assert.equal(e.status, 404);
      assert.equal(e.message, 'Run no encontrado.');
      return true;
    },
  );
});

test('🔴 un 401 al pedir el entregable también refresca y reintenta', async () => {
  // Misma política que todo lo demás. Sin esto, la pantalla imprimible sería la única del portal que
  // le muestra al usuario un error de la nada cuando el token vence mientras la mira.
  const { fn, llamadas } = fakeSecuencia([{ status: 401 }, { status: 200, body: '# ok' }]);
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
  // `includes` y no `equal`: `fakeSecuencia` serializa el body a JSON, así que el cuerpo llega con
  // comillas alrededor. Lo que importa acá es que sea el cuerpo del REINTENTO y no una cadena vacía.
  assert.ok((await api.verEntregableMd('run-9')).includes('# ok'), 'el reintento trajo el cuerpo');
  assert.equal(refrescos, 1, 'refrescó una vez');
  assert.equal(llamadas(), 2, 'reintentó el request');
});

// ------------------------------------ el 409 «no hay ninguna página aprobada» (B1, 2026-08-07)

/** La respuesta exacta del endpoint, copiada de `api/src/app.ts`. */
const CUERPO_409 = {
  error:
    'Este research no tiene ninguna página aprobada, así que el entregable saldría vacío. ' +
    'Aprobá al menos una página antes de generarlo.',
  codigo: SIN_PAGINAS_APROBADAS,
};

test('🔴 el 409 del entregable llega con su CÓDIGO, no solo con la frase', async () => {
  /*
   * Sin el `codigo` en el `ApiError`, la pantalla solo tiene el mensaje en español para decidir qué
   * hacer — y decidir comparando la frase convierte una corrección de redacción en un bug de
   * comportamiento. El status tampoco alcanza como sustituto: hoy este endpoint tiene un solo 409, pero
   * el día que tenga dos, ramificar por status confundiría uno con el otro.
   */
  const { fn } = fakeFetch({ status: 409, body: CUERPO_409 });
  await assert.rejects(
    () => crearApi(opts(fn)).verEntregableMd('run-sin-aprobadas'),
    (e: ApiError) => {
      assert.equal(e.status, 409);
      assert.equal(e.codigo, 'SIN_PAGINAS_APROBADAS');
      // El mensaje sigue siendo el del servidor: el código es para el programa, la frase para el humano.
      assert.equal(e.message, CUERPO_409.error);
      return true;
    },
  );
});

test('🔴 un error SIN código no se inventa uno', async () => {
  // El 404 del entregable —run inexistente, otro tenant, o rol `cliente`— no lleva `codigo`, y no puede
  // salir de acá con uno. Si `codigo` cayera a una cadena vacía o al status, `esSinPaginasAprobadas`
  // dejaría de significar algo.
  const { fn } = fakeFetch({ status: 404, body: { error: 'Run no encontrado.' } });
  await assert.rejects(
    () => crearApi(opts(fn)).verEntregableMd('inexistente'),
    (e: ApiError) => {
      assert.equal(e.codigo, undefined);
      return true;
    },
  );
});

test('🔴 esSinPaginasAprobadas mira el CÓDIGO y nunca la frase', () => {
  /*
   * Los dos casos que separan una implementación de la otra, y ninguno sirve solo:
   *
   * · el mismo código con el mensaje reescrito **sigue** siendo el caso (si la comparación fuera por
   *   texto, retocar la redacción del servidor apagaría la rama en silencio);
   * · el mensaje exacto sin código **no** lo es (el mensaje se puede repetir en otro endpoint, o
   *   llegar de un proxy, y ahí la pantalla mandaría al usuario a aprobar páginas de la nada).
   */
  const conCodigo = Object.assign(new Error('otra redacción cualquiera'), {
    status: 409,
    codigo: SIN_PAGINAS_APROBADAS,
  }) as ApiError;
  assert.equal(esSinPaginasAprobadas(conCodigo), true);

  const soloLaFrase = Object.assign(new Error(CUERPO_409.error), { status: 409 }) as ApiError;
  assert.equal(esSinPaginasAprobadas(soloLaFrase), false);

  // Y no explota con lo que no es un error de la API: el `catch` recibe `unknown`.
  assert.equal(esSinPaginasAprobadas(null), false);
  assert.equal(esSinPaginasAprobadas('SIN_PAGINAS_APROBADAS'), false);
});

test('🔴 esTransicionInvalida mira el CÓDIGO, y no se confunde con el OTRO 409', () => {
  /*
   * Los dos 409 del portal viven en endpoints distintos hoy, así que ramificar por status parecería
   * alcanzar — y ése es justo el atajo que hay que impedir. `aprobarRun` ya puede devolver dos 409
   * distintos (`SIN_PAGINAS_APROBADAS` y `TRANSICION_INVALIDA`), y confundirlos manda a alguien a
   * aprobar páginas de un run que aprobando páginas no se destraba.
   */
  const conCodigo = Object.assign(new Error('cualquier redacción'), {
    status: 409,
    codigo: TRANSICION_INVALIDA,
  }) as ApiError;
  assert.equal(esTransicionInvalida(conCodigo), true);
  assert.equal(esSinPaginasAprobadas(conCodigo), false, 'los dos 409 no se pueden confundir');

  const elOtro409 = Object.assign(new Error('cualquier redacción'), {
    status: 409,
    codigo: SIN_PAGINAS_APROBADAS,
  }) as ApiError;
  assert.equal(esTransicionInvalida(elOtro409), false);

  // Sin código no hay caso, aunque el status coincida.
  assert.equal(esTransicionInvalida(Object.assign(new Error('x'), { status: 409 })), false);
  assert.equal(esTransicionInvalida(null), false);
  assert.equal(esTransicionInvalida('TRANSICION_INVALIDA'), false);
});

test('nombreDeDescarga: usa el filename del header cuando viene', () => {
  assert.equal(
    nombreDeDescarga('attachment; filename="informe-Bella-Napoli.md"', 'informe-run-9.md'),
    'informe-Bella-Napoli.md',
  );
});

test('🔴 nombreDeDescarga cae al fallback si el header falta o no trae filename usable', () => {
  // El header SÍ llega hoy: `api/src/app.ts` declara `exposeHeaders: ["content-disposition"]`, y sin esa
  // línea el navegador se lo escondía a JavaScript (`headers.get()` → null, medido en Chrome). Esta rama
  // es defensiva y sigue haciendo falta: el portal no puede comprobar desde acá que el header venga —un
  // proxy que filtre cabeceras, un `exposeHeaders` recortado, o un `filename` vacío lo dejan sin nombre—.
  // Si esto devolviera '' o 'null', el archivo bajaría sin nombre en vez de con uno peor pero utilizable.
  assert.equal(nombreDeDescarga(null, 'informe-run-9.md'), 'informe-run-9.md');
  assert.equal(nombreDeDescarga('attachment', 'informe-run-9.md'), 'informe-run-9.md');
  assert.equal(nombreDeDescarga('attachment; filename=""', 'informe-run-9.md'), 'informe-run-9.md');
});

test('🔴 nombreDeDescarga sanea el header Y el fallback con la misma allowlist', () => {
  // Defensa en profundidad: el servidor ya sanea, pero este código no puede comprobar que siga
  // haciéndolo. Y el fallback lo arma el portal con el `runId` de la URL, que es entrada del usuario: si
  // la allowlist se aplicara solo al header, la rama que corre sería la no saneada.
  assert.equal(nombreDeDescarga('attachment; filename="../../etc/passwd"', 'x.md'), 'etc-passwd.md');
  assert.equal(nombreDeDescarga(null, '../../evil'), 'evil.md');
  assert.equal(nombreDeDescarga('attachment; filename="🍕🍕"', '🍕🍕'), 'informe.md');
  // Un nombre largo NO pierde la extensión: 60 caracteres saneados + "informe-" + ".md" son 71, y el
  // tope de acá (80) los deja pasar enteros. Con 60 el archivo bajaría cortado y sin `.md`.
  const largo = `informe-${'A'.repeat(60)}.md`;
  assert.equal(nombreDeDescarga(`attachment; filename="${largo}"`, 'x.md'), largo);
  assert.ok(nombreDeDescarga('attachment; filename="' + 'B'.repeat(200) + '"', 'x.md').endsWith('.md'));
});

test('un error de la API se propaga con status y el mensaje del body', async () => {
  const { fn } = fakeFetch({ status: 403, body: { error: 'No autorizado para esta operación.' } });
  await assert.rejects(
    () => crearApi(opts(fn)).aprobarRun('run-9', 'crear_web'),
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
  // `vertical` es obligatorio desde el sub-proyecto multivertical-clientes (Task 12): sin él,
  // `NuevoClienteAgencia` ni siquiera compila.
  const id = await crearApi(opts(fn)).crearCliente({ nombre: 'Nuevo Cliente', vertical: 'restauracion' });
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/clients');
  assert.deepEqual(JSON.parse(capturado.body!), { nombre: 'Nuevo Cliente', vertical: 'restauracion' });
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

// ---------------------------------------------------------------- reseñas de Google (Bloque F)

test('listarResenas pega a GET /clients/:id/resenas y desenvuelve { resenas }, en el orden que llega', async () => {
  const resenas = [
    { id: 'r1', clientId: 'c1', puntuacion: 2, autor: 'Ana', texto: 'Tardaron mucho', publicadaEn: '2026-08-01T00:00:00.000Z', vistaEn: null },
    { id: 'r2', clientId: 'c1', puntuacion: 5, autor: 'Beto', texto: null, publicadaEn: '2026-07-01T00:00:00.000Z', vistaEn: '2026-07-02T00:00:00.000Z' },
  ];
  const { fn, capturado } = fakeFetch({ body: { resenas } });
  const res = await crearApi(opts(fn)).listarResenas('c1');
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/clients/c1/resenas');
  // El orden lo impone el SQL (`PgResenas.listarResenas`): este cliente NO reordena, solo desenvuelve.
  assert.deepEqual(res, resenas);
});

test('marcarResenaVista manda PATCH { vista: true } y nada más, con los dos ids escapados', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).marcarResenaVista('c1/../otro', 'r1');
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/clients/c1%2F..%2Fotro/resenas/r1');
  assert.deepEqual(JSON.parse(capturado.body!), { vista: true });
});

test('🔴 marcarResenaVista lanza en un 404 (no encontrada / ya vista / sin permiso, unificados)', async () => {
  const { fn } = fakeFetch({ status: 404, body: { error: 'Reseña no encontrada, ya vista, o sin permiso.' } });
  await assert.rejects(() => crearApi(opts(fn)).marcarResenaVista('c1', 'r1'), /Reseña no encontrada/);
});

// ---------------------------------------------------------------- menú (editor del portal)

test('obtenerMenu pega a GET /clients/:id/menu y devuelve la carta tal cual', async () => {
  const carta = {
    menu: [{ name: 'Margherita', precios: [{ etiqueta: 'Media', importe: '9,00 €' }] }],
    menu_categorias: [{ nombre: 'Pizzas' }],
  };
  const { fn, capturado } = fakeFetch({ body: carta });
  const res = await crearApi(opts(fn)).obtenerMenu('c1');
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/clients/c1/menu');
  assert.deepEqual(res, carta);
});

test('guardarMenu manda PATCH con la carta completa, con el id escapado', async () => {
  const carta = { menu: [{ name: 'Margherita' }], menu_categorias: [] };
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).guardarMenu('c1/../otro', carta);
  assert.equal(capturado.method, 'PATCH');
  assert.equal(capturado.url, 'http://api.test/clients/c1%2F..%2Fotro/menu');
  assert.deepEqual(JSON.parse(capturado.body!), carta);
});

test('🔴 guardarMenu propaga el error del servidor (400 con campos) sin envolverlo', async () => {
  const { fn } = fakeFetch({
    status: 400,
    body: { error: 'El menú no es válido.', campos: [{ ruta: 'menu.0.name', mensaje: 'Required' }] },
  });
  await assert.rejects(
    () => crearApi(opts(fn)).guardarMenu('c1', { menu: [{}], menu_categorias: [] } as never),
    (err: unknown) => {
      assert.match((err as Error).message, /El menú no es válido/);
      assert.deepEqual((err as { campos?: unknown }).campos, [{ ruta: 'menu.0.name', mensaje: 'Required' }]);
      return true;
    },
  );
});

test('conectarGoogle postea a /clients/:id/google/conectar y devuelve { url }', async () => {
  const { fn, capturado } = fakeFetch({ body: { url: 'https://accounts.google.test/consent?state=abc' } });
  const res = await crearApi(opts(fn)).conectarGoogle('c1');
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/clients/c1/google/conectar');
  assert.deepEqual(res, { url: 'https://accounts.google.test/consent?state=abc' });
});

test('desconectarGoogle postea a /clients/:id/google/desconectar', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  await crearApi(opts(fn)).desconectarGoogle('c1');
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/clients/c1/google/desconectar');
});

test('🔴 conectarGoogle/desconectarGoogle propagan el 404 de RLS (rol cliente no puede escribir clients)', async () => {
  // `client_write` exige `app.puede_escribir()`: para un rol `cliente` el update no matchea ninguna
  // fila y el endpoint responde 404 sin que este cliente HTTP sepa qué rol es quien llama.
  const { fn } = fakeFetch({ status: 404, body: { error: 'Cliente no encontrado o sin permiso para conectar.' } });
  await assert.rejects(() => crearApi(opts(fn)).conectarGoogle('c1'), /sin permiso/);
});

test('vincularTelegram postea a /me/telegram/vincular y devuelve { url }, sin clientId (es sobre la propia cuenta)', async () => {
  const { fn, capturado } = fakeFetch({ body: { url: 'https://t.me/amg_alertas_bot?start=abc123' } });
  const res = await crearApi(opts(fn)).vincularTelegram();
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/me/telegram/vincular');
  assert.deepEqual(res, { url: 'https://t.me/amg_alertas_bot?start=abc123' });
});

test('telegramVinculado pega a GET /me/telegram y devuelve { vinculado }', async () => {
  const { fn, capturado } = fakeFetch({ body: { vinculado: true } });
  const res = await crearApi(opts(fn)).telegramVinculado();
  assert.equal(capturado.method, 'GET');
  assert.equal(capturado.url, 'http://api.test/me/telegram');
  assert.deepEqual(res, { vinculado: true });
});

test('desvincularTelegram postea a /me/telegram/desvincular y devuelve { ok }', async () => {
  const { fn, capturado } = fakeFetch({ body: { ok: true } });
  const res = await crearApi(opts(fn)).desvincularTelegram();
  assert.equal(capturado.method, 'POST');
  assert.equal(capturado.url, 'http://api.test/me/telegram/desvincular');
  assert.deepEqual(res, { ok: true });
});

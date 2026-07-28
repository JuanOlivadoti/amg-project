import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './auth';
import type { Sesion } from '../core/models';
import { environment } from '../../environments/environment';

// Si algún día el seam de inyección se rompe, `opts.fetchFn ?? fetch` caería en el fetch REAL y la
// suite empezaría a pegarle a Supabase en silencio. Con esto, romperlo falla ruidosamente.
globalThis.fetch = (() => {
  throw new Error('la suite no toca la red: se rompió la inyección de fetchFn');
}) as unknown as typeof fetch;

/**
 * Lo que se prueba acá NO lo prueban los tests de `auth-core`: que el estado local del portal se
 * limpie SIEMPRE, de inmediato y **también en `localStorage`**, y que ninguna llamada en vuelo pueda
 * resucitar una sesión cerrada ni pisar una nueva.
 *
 * Sin estos tests, mover la limpieza detrás del `await`, borrar la guarda de identidad o quitar el
 * `removeItem` deja todo en verde. Son los primeros tests que tiene el servicio.
 *
 * Las cuatro carreras que se cubren, todas reales:
 *  · login en vuelo → logout → el login resuelve  (no debe autenticar)
 *  · refresh en vuelo → logout → el refresh resuelve  (no debe resucitar)
 *  · sesión A → login B → el refresh de A resuelve  (no debe pisar a B)
 *  · logout lento → login nuevo → la revocación termina  (no debe borrar al nuevo)
 */

const CLAVE = 'amg.sesion';
const TENANT = '11111111-1111-1111-1111-111111111111';

function sesion(id: string, email: string, token: string): Sesion {
  return {
    accessToken: token,
    refreshToken: `${token}-r`,
    expiraEn: Date.now() + 3_600_000,
    userId: id,
    email,
    tenantId: TENANT,
    rol: 'equipo',
  };
}

const SESION_A = sesion('user-a', 'a@ejemplo.com', 'tok-a');
const SESION_B = sesion('user-b', 'b@ejemplo.com', 'tok-b');

/** Cuerpo de respuesta de GoTrue, como lo parsea `aSesion` en `auth-core.ts`. */
function respuestaGoTrue(id: string, email: string, token: string) {
  return {
    access_token: token,
    refresh_token: `${token}-r`,
    expires_in: 3600,
    user: { id, email, app_metadata: { tenant_id: TENANT, rol: 'equipo' } },
  };
}

/**
 * `fetch` falso que **enruta por URL** y deja cada respuesta pendiente hasta que se la suelta.
 *
 * Que las colas estén separadas no es un detalle: con una sola promesa compartida, un test que
 * espera el logout antes de soltar el token se cuelga para siempre en vez de fallar.
 */
function fetchControlado() {
  const colas = { token: [] as ((r: Response) => void)[], logout: [] as ((r: Response) => void)[] };
  // Captura el `init` de CADA request de logout (no solo la última): el reintento de logout (Gap A)
  // hace dos, y hay tests que necesitan comparar ambos —cuántos hubo y qué credencial llevó cada uno.
  const logoutsVistos: RequestInit[] = [];
  const fetchFn = ((url: string, init?: RequestInit) => {
    const cola = url.includes('/logout') ? 'logout' : 'token';
    if (cola === 'logout') logoutsVistos.push(init ?? {});
    return new Promise<Response>((resolver) => {
      colas[cola].push(resolver);
    });
  }) as unknown as typeof fetch;
  return {
    fetchFn,
    soltarToken(cuerpo: unknown, status = 200): void {
      colas.token.shift()!(
        new Response(JSON.stringify(cuerpo), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    soltarLogout(status = 204): void {
      colas.logout.shift()!(new Response(null, { status }));
    },
    get ultimoLogout(): RequestInit | undefined {
      return logoutsVistos[logoutsVistos.length - 1];
    },
    get logoutsVistos(): RequestInit[] {
      return logoutsVistos;
    },
    // Cuántas requests de /token siguen sin soltar: lo usa el test de "no reintentar en indeterminada"
    // para confirmar que `revocar` NO llegó a pedir un access token fresco (no alcanza con mirar el
    // resultado final, porque `logout` ya limpió el estado local antes de tocar la red de cualquier forma).
    get pendientesToken(): number {
      return colas.token.length;
    },
  };
}

/**
 * Deja correr la cola de microtasks (y un tick de macrotask) para que una continuación `async`
 * encadenada —logout falla → refresh → reintento de logout— llegue a inscribirse en la cola
 * correspondiente antes de que el test intente soltarla.
 */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Un servicio nuevo con `localStorage` y red falsos. El almacén se devuelve para poder afirmarlo. */
function crear() {
  const almacen = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => {
      almacen.set(k, v);
    },
    removeItem: (k: string) => {
      almacen.delete(k);
    },
  };
  const red = fetchControlado();
  const a = new AuthService();
  (a as unknown as { authOpts: { fetchFn: unknown } }).authOpts.fetchFn = red.fetchFn;
  return { a, red, almacen };
}

/** Instala una sesión viva, en la signal y en el almacén, sin pasar por la red. */
function instalar(a: AuthService, almacen: Map<string, string>, s: Sesion): void {
  (a as unknown as { _sesion: { set(v: Sesion | null): void } })._sesion.set(s);
  almacen.set(CLAVE, JSON.stringify(s));
}

test('🔴 logout limpia signal y localStorage ANTES de esperar a la red', async () => {
  // Si la limpieza estuviera después del `await`, la UI seguiría autenticada mientras el fetch
  // cuelga — y `fetch` no tiene timeout propio, así que puede colgar indefinidamente.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  assert.equal(a.autenticado(), false, 'la sesión tiene que estar cerrada YA, sin esperar la red');
  assert.equal(almacen.has(CLAVE), false, 'y el localStorage también, o vuelve al recargar');

  // El accessToken de LA sesión que se cerró, no otro campo: con el refreshToken, Supabase
  // respondería 401 y la revocación se volvería un no-op silencioso (mutación confirmada).
  const headers = red.ultimoLogout?.headers as Record<string, string> | undefined;
  assert.equal(headers?.['authorization'], `Bearer ${SESION_A.accessToken}`);
  assert.equal(headers?.['apikey'], environment.supabaseAnonKey);

  red.soltarLogout();
  await cierre;
  assert.equal(a.autenticado(), false);
});

test('🔴 logout deja al usuario deslogueado aunque la revocación falle', async () => {
  const { a, almacen } = crear();
  (a as unknown as { authOpts: { fetchFn: unknown } }).authOpts.fetchFn = () => {
    throw new Error('ECONNREFUSED');
  };
  instalar(a, almacen, SESION_A);

  await a.logout();
  assert.equal(a.autenticado(), false);
  assert.equal(almacen.has(CLAVE), false);
});

test('🔴 un login en vuelo no autentica si mientras tanto hubo logout', async () => {
  const { a, red } = crear();
  const entrada = a.login('b@ejemplo.com', 'pw');
  // Sin sesión viva, `logout` no llama a la red: resuelve solo.
  await a.logout();

  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b'));
  await entrada;

  assert.equal(a.autenticado(), false, 'un login que llega tarde no puede reabrir la sesión');
});

test('🔴 un logout lento no pisa un login posterior', async () => {
  // logout → el usuario vuelve a entrar → la revocación vieja termina. No debe borrar lo nuevo.
  //
  // `login` ya NO espera la revocación (se borró junto con `revocacionEnVuelo`, ver `AuthService`):
  // el `/token` de este login se dispara de inmediato, antes de soltar el `/logout`. Lo que evita
  // que el logout viejo pise la sesión nueva es la ÉPOCA, capturada como primer statement de `login`.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  const entrada = a.login('b@ejemplo.com', 'pw');
  red.soltarLogout();
  await flush();
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b'));
  await entrada;
  await cierre;

  assert.equal(a.autenticado(), true, 'el logout viejo no debe borrar la sesión nueva');
  assert.equal(a.email(), 'b@ejemplo.com');
});

test('🔴 un refresh en vuelo no resucita la sesión después de un logout', async () => {
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const refresco = a.refrescar();
  const cierre = a.logout();
  red.soltarLogout();
  await cierre;

  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2'));
  assert.equal(await refresco, false);
  assert.equal(a.autenticado(), false, 'el refresh no puede resucitar una sesión cerrada');
  assert.equal(almacen.has(CLAVE), false);
});

test('🔴 el refresh de la sesión vieja no pisa un login nuevo', async () => {
  // La carrera que la ÉPOCA sola no cubre: el refresh arranca después del login, así que comparte
  // su época y la guarda por época lo dejaría escribir. Solo la identidad de la sesión lo frena.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const entrada = a.login('b@ejemplo.com', 'pw'); // encola primero
  const refresco = a.refrescar(); // captura A, encola segundo
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b')); // resuelve el LOGIN
  await entrada;
  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2')); // resuelve el REFRESH

  assert.equal(await refresco, false);
  assert.equal(a.email(), 'b@ejemplo.com', 'la sesión nueva tiene que sobrevivir');
});

test('🔴 un refresco en vuelo no se comparte con una sesión distinta', async () => {
  // `refrescoEnVuelo` se comparte para no disparar N refrescos. Compartirlo entre SESIONES haría
  // que el refresh de la sesión nueva devolviera el resultado (false) del de la vieja.
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const viejo = a.refrescar();
  const cierre = a.logout();
  red.soltarLogout();
  await cierre;
  instalar(a, almacen, SESION_B);

  const nuevo = a.refrescar();
  assert.notEqual(nuevo, viejo, 'no debe reusar el refresco de otra sesión');

  // La identidad de las promesas no alcanza: un refactor que devolviera un wrapper nuevo
  // (`Promise.resolve(enVuelo.promesa)`) pasaría el `notEqual` de arriba y seguiría compartiendo el
  // resultado de abajo. Lo que importa es que B no herede el `false` de A.
  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2')); // resuelve el refresco de A (viejo)
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b2')); // resuelve el refresco de B (nuevo)
  const [nuevoResuelto, viejoResuelto] = await Promise.all([nuevo, viejo]);
  assert.equal(nuevoResuelto, true, 'el refresco de la sesión nueva tiene que resolver bien');
  assert.equal(viejoResuelto, false, 'el de la sesión vieja (ya cerrada) tiene que seguir en false');
});

/**
 * Gap A: una pestaña abierta desde ayer tiene el access token vencido. El portal solo refresca ante
 * un 401, así que sin el reintento, el `/logout` con ese JWT muerto fallaría en silencio y el
 * refresh token quedaría vivo para siempre — exactamente lo que este logout vino a evitar.
 */
test('🔴 logout con access token vencido reintenta el /logout con un token fresco (Gap A)', async () => {
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  assert.equal(red.logoutsVistos.length, 1, 'el primer intento usa el token que ya tenía la sesión');
  const headersIniciales = red.ultimoLogout?.headers as Record<string, string> | undefined;
  assert.equal(headersIniciales?.['authorization'], `Bearer ${SESION_A.accessToken}`);

  red.soltarLogout(401); // el access token está vencido: Supabase lo rechaza
  await flush();

  // El 401 dispara un refresh con el refresh token de la sesión que cierra.
  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a-fresco'));
  await flush();

  // El logout se reintenta, esta vez con el access token recién emitido.
  assert.equal(red.logoutsVistos.length, 2, 'tiene que haber un segundo intento con el token fresco');
  const headers = red.ultimoLogout?.headers as Record<string, string> | undefined;
  assert.equal(headers?.['authorization'], 'Bearer tok-a-fresco');

  red.soltarLogout();
  await cierre;
  assert.equal(a.autenticado(), false);
});

/** Gap A, sin reintento infinito: si el segundo intento (ya con token fresco) también falla, no hay un tercero. */
test('🔴 logout no reintenta sin límite: si el segundo intento también falla, igual queda deslogueado', async () => {
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  red.soltarLogout(401); // primer intento: token vencido
  await flush();

  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a-fresco')); // el refresh sí funciona
  await flush();

  red.soltarLogout(500); // el segundo intento, ya con el token fresco, también falla
  await cierre;

  assert.equal(a.autenticado(), false, 'el usuario tiene que quedar deslogueado igual');
  assert.equal(almacen.has(CLAVE), false);
  assert.equal(red.logoutsVistos.length, 2, 'no debe haber un tercer intento de logout');
});

/**
 * Complemento de Gap A: el reintento es SOLO para `'credencial-rechazada'` (401/403). Un 500 es
 * `'indeterminada'` — no dice que el token esté vencido — y reintentar ahí rotaría un refresh token
 * que probablemente estaba bien, para colmo sin garantía de que el segundo intento tampoco falle.
 */
test('🔴 logout NO reintenta un fallo indeterminado (500): reintentar ahí gastaría el refresh token sin motivo', async () => {
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  red.soltarLogout(500); // fallo indeterminado: no dice si el access token está vencido
  await flush();

  // Si hubiera reintentado, ya habría pedido un access token fresco por /token.
  assert.equal(
    red.pendientesToken,
    0,
    'un 500 no es un rechazo de credencial: no debe gastar el refresh token reintentando',
  );
  assert.equal(red.logoutsVistos.length, 1, 'un solo intento de logout, no dos');

  await cierre;
  assert.equal(a.autenticado(), false, 'el usuario queda deslogueado localmente igual');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuthService } from './auth';
import type { Sesion } from '../core/models';

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
  const fetchFn = ((url: string) =>
    new Promise<Response>((resolver) => {
      colas[url.includes('/logout') ? 'logout' : 'token'].push(resolver);
    })) as unknown as typeof fetch;
  return {
    fetchFn,
    soltarToken(cuerpo: unknown): void {
      colas.token.shift()!(
        new Response(JSON.stringify(cuerpo), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    },
    soltarLogout(): void {
      colas.logout.shift()!(new Response(null, { status: 204 }));
    },
  };
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
  const { a, red, almacen } = crear();
  instalar(a, almacen, SESION_A);

  const cierre = a.logout();
  const entrada = a.login('b@ejemplo.com', 'pw');
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b'));
  await entrada;
  red.soltarLogout();
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

  red.soltarToken(respuestaGoTrue('user-a', 'a@ejemplo.com', 'tok-a2'));
  red.soltarToken(respuestaGoTrue('user-b', 'b@ejemplo.com', 'tok-b2'));
  await Promise.allSettled([viejo, nuevo]);
});

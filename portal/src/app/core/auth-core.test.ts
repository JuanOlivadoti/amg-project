import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginConPassword, refrescarSesion, parseSesion } from './auth-core';

function fakeFetch(status: number, body: unknown) {
  const capturado: { url?: string; headers?: Record<string, string>; body?: string } = {};
  const fn = (async (url: string, init: RequestInit = {}) => {
    capturado.url = url;
    capturado.headers = init.headers as Record<string, string>;
    capturado.body = init.body as string;
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fn, capturado };
}

const opts = (fn: typeof fetch) => ({ supabaseUrl: 'https://proj.supabase.co', anonKey: 'anon-key', fetchFn: fn });

test('loginConPassword pega al endpoint de GoTrue con apikey y arma la sesión', async () => {
  const { fn, capturado } = fakeFetch(200, {
    access_token: 'jwt-abc',
    refresh_token: 'ref-abc',
    expires_at: 1_800_000_000,
    user: { id: 'user-1', email: 'a@b.com', app_metadata: { tenant_id: 'tenant-1' } },
  });
  const sesion = await loginConPassword(opts(fn), 'a@b.com', 'secreto');

  assert.equal(capturado.url, 'https://proj.supabase.co/auth/v1/token?grant_type=password');
  assert.equal(capturado.headers!['apikey'], 'anon-key');
  assert.deepEqual(JSON.parse(capturado.body!), { email: 'a@b.com', password: 'secreto' });

  assert.equal(sesion.accessToken, 'jwt-abc');
  assert.equal(sesion.refreshToken, 'ref-abc');
  assert.equal(sesion.userId, 'user-1');
  assert.equal(sesion.email, 'a@b.com');
  assert.equal(sesion.tenantId, 'tenant-1'); // del app_metadata firmado
  assert.equal(sesion.expiraEn, 1_800_000_000 * 1000); // expires_at (s) → ms
});

test('sin tenant_id en app_metadata, tenantId queda vacío (el portal lo dirá)', async () => {
  const { fn } = fakeFetch(200, {
    access_token: 'j',
    refresh_token: 'r',
    expires_in: 3600,
    user: { id: 'u', email: 'a@b.com' },
  });
  const sesion = await loginConPassword(opts(fn), 'a@b.com', 'x');
  assert.equal(sesion.tenantId, '');
  assert.ok(sesion.expiraEn > Date.now()); // expires_in → ahora + 1h
});

test('credenciales inválidas → error con el mensaje de Supabase', async () => {
  const { fn } = fakeFetch(400, { error_description: 'Invalid login credentials' });
  await assert.rejects(() => loginConPassword(opts(fn), 'a@b.com', 'mal'), /Invalid login credentials/);
});

const sesionValida = JSON.stringify({
  accessToken: 'jwt',
  refreshToken: 'ref',
  expiraEn: 1_800_000_000_000,
  userId: 'u1',
  email: 'a@b.com',
  tenantId: 't1',
  rol: '',
});

test('parseSesion acepta una sesión guardada bien formada', () => {
  const s = parseSesion(sesionValida);
  assert.equal(s?.accessToken, 'jwt');
  assert.equal(s?.tenantId, 't1');
});

test('🔴 parseSesion rechaza formas inválidas: nada de sesiones fantasma', () => {
  // El bug: JSON válido pero forma incorrecta se casteaba a Sesion → autenticado() true SIN token.
  assert.equal(parseSesion('{}'), null, 'objeto vacío');
  assert.equal(parseSesion('null'), null);
  assert.equal(parseSesion('"soy-un-string"'), null);
  assert.equal(parseSesion('[]'), null);
  assert.equal(parseSesion('no es json'), null);
  assert.equal(parseSesion(null), null);
  assert.equal(parseSesion(JSON.stringify({ accessToken: 'jwt' })), null, 'faltan campos');
  assert.equal(
    parseSesion(JSON.stringify({ accessToken: '', refreshToken: 'r', userId: 'u', expiraEn: 1, tenantId: 't' })),
    null,
    'token vacío no sirve',
  );
  assert.equal(
    parseSesion(JSON.stringify({ accessToken: 'a', refreshToken: 'r', userId: 'u', expiraEn: 'ayer', tenantId: 't' })),
    null,
    'expiraEn tiene que ser número',
  );
});

test('🔴 parseSesion rechaza un expiraEn imposible, pero ACEPTA uno vencido', () => {
  const con = (expiraEn: unknown) =>
    parseSesion(JSON.stringify({ accessToken: 'a', refreshToken: 'r', userId: 'u', tenantId: 't', expiraEn }));
  assert.equal(con(-1), null, 'negativo es basura');
  assert.equal(con(0), null, 'cero es basura');
  // Vencido NO se rechaza: el refresh token vive más, y el 401 lo resuelve solo. Deslogear acá
  // obligaría a re-entrar cuando no hacía falta.
  assert.ok(con(Date.now() - 60_000), 'una sesión vencida se restaura y se refresca');
});

test('🔴 un rol inventado se normaliza a desconocido', () => {
  const con = (rol: unknown) =>
    parseSesion(
      JSON.stringify({ accessToken: 'a', refreshToken: 'r', userId: 'u', tenantId: 't', expiraEn: 1, rol }),
    );
  assert.equal(con('superadmin-inventado')?.rol, '', 'no se cuela un rol fuera del dominio');
  assert.equal(con(123)?.rol, '');
  assert.equal(con('cliente')?.rol, 'cliente', 'los reales sí pasan');
  assert.equal(con('equipo')?.rol, 'equipo');
  assert.equal(con('maestro')?.rol, 'maestro');
});

test('parseSesion conserva un tenantId vacío: es el caso real del usuario sin app_metadata', () => {
  const raw = JSON.stringify({
    accessToken: 'jwt',
    refreshToken: 'ref',
    expiraEn: 1_800_000_000_000,
    userId: 'u1',
    tenantId: '',
  });
  const s = parseSesion(raw);
  assert.equal(s?.tenantId, '', 'el portal tiene que poder decirlo, no deslogear en silencio');
  assert.equal(s?.rol, '');
});

test('refrescarSesion usa grant_type=refresh_token', async () => {
  const { fn, capturado } = fakeFetch(200, {
    access_token: 'jwt2',
    refresh_token: 'ref2',
    expires_in: 3600,
    user: { id: 'u', app_metadata: { tenant_id: 't' } },
  });
  const sesion = await refrescarSesion(opts(fn), 'ref-viejo');
  assert.equal(capturado.url, 'https://proj.supabase.co/auth/v1/token?grant_type=refresh_token');
  assert.deepEqual(JSON.parse(capturado.body!), { refresh_token: 'ref-viejo' });
  assert.equal(sesion.accessToken, 'jwt2');
});

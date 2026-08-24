import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveTelegramProvider } from "./live-provider.js";

/**
 * Reemplaza `globalThis.fetch` por una respuesta fija -- mismo patrón que `stubFetch` en
 * `kr-service/src/lib/http.test.ts`, adaptado a JSON en vez de a un `Response` de texto plano.
 */
function stubFetch(status: number, body: unknown) {
  const llamadas: Array<{ url: string; init: RequestInit | undefined }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return {
    llamadas,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const TOKEN = "token-de-prueba";

// ---------------------------------------------------------------- obtenerActualizaciones

test("obtenerActualizaciones: un update con texto y otro sin `message` (ej. edited_message)", async () => {
  const s = stubFetch(200, {
    ok: true,
    result: [
      { update_id: 10, message: { text: "/start abc", chat: { id: 555 } } },
      { update_id: 11, edited_message: { text: "editado", chat: { id: 555 } } }, // sin `message`
    ],
  });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    const r = await p.obtenerActualizaciones(0);
    assert.deepEqual(r.mensajes, [{ updateId: 10, texto: "/start abc", chatId: "555" }]);
    assert.equal(r.maxUpdateId, 11, "el mayor update_id de LOS DOS, incluido el que no generó mensaje");
  } finally {
    s.restore();
  }
});

/**
 * 🔴 EL CASO CENTRAL del hallazgo 1 de Codex: un lote formado ÚNICAMENTE por updates sin texto útil
 * (reacciones, ediciones) tiene que devolver `mensajes: []` pero `maxUpdateId` NO NULO -- si no,
 * Telegram vuelve a mandar el mismo lote para siempre y cualquier `/start` real que venga detrás
 * queda bloqueado.
 *
 * Verificación por mutación: si `maxUpdateId` se calculara solo sobre los updates que SÍ generan un
 * `MensajeTelegram` (el bug original), este test cae -- `maxUpdateId` daría `null` en vez de `7`.
 */
test("🔴 un lote de SOLO updates sin texto útil igual avanza maxUpdateId (no queda null)", async () => {
  const s = stubFetch(200, {
    ok: true,
    result: [
      { update_id: 5, edited_message: { text: "editado", chat: { id: 1 } } },
      { update_id: 7, my_chat_member: { chat: { id: 1 } } }, // update de otro tipo, sin `message`
    ],
  });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    const r = await p.obtenerActualizaciones(0);
    assert.deepEqual(r.mensajes, []);
    assert.equal(r.maxUpdateId, 7, "el mayor update_id del lote, aunque NINGUNO generó un mensaje útil");
  } finally {
    s.restore();
  }
});

test("obtenerActualizaciones: lote vacío da maxUpdateId null y mensajes []", async () => {
  const s = stubFetch(200, { ok: true, result: [] });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    const r = await p.obtenerActualizaciones(0);
    assert.equal(r.maxUpdateId, null);
    assert.deepEqual(r.mensajes, []);
  } finally {
    s.restore();
  }
});

test("🔴 un update_id no numérico lanza -- no lo ignora en silencio", async () => {
  const s = stubFetch(200, { ok: true, result: [{ update_id: "10", message: { text: "x", chat: { id: 1 } } }] });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.obtenerActualizaciones(0), /update_id no es un entero seguro/);
  } finally {
    s.restore();
  }
});

test("🔴 un update_id no entero (1.5) lanza", async () => {
  const s = stubFetch(200, { ok: true, result: [{ update_id: 1.5, message: { text: "x", chat: { id: 1 } } }] });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.obtenerActualizaciones(0), /update_id no es un entero seguro/);
  } finally {
    s.restore();
  }
});

test("🔴 un update_id inseguro (fuera de Number.isSafeInteger) lanza", async () => {
  const s = stubFetch(200, {
    ok: true,
    result: [{ update_id: Number.MAX_SAFE_INTEGER + 10, message: { text: "x", chat: { id: 1 } } }],
  });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.obtenerActualizaciones(0), /update_id no es un entero seguro/);
  } finally {
    s.restore();
  }
});

test("🔴 obtenerActualizaciones con ok:false en el body lanza", async () => {
  const s = stubFetch(200, { ok: false, description: "Unauthorized" });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.obtenerActualizaciones(0), /forma inesperada/);
  } finally {
    s.restore();
  }
});

test("🔴 obtenerActualizaciones con HTTP no-200 lanza", async () => {
  const s = stubFetch(500, { ok: false });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.obtenerActualizaciones(0), /HTTP 500/);
  } finally {
    s.restore();
  }
});

test("chat.id como string arbitrario no numérico se ignora ese mensaje puntual (no rompe el lote)", async () => {
  const s = stubFetch(200, {
    ok: true,
    result: [
      { update_id: 1, message: { text: "hola", chat: { id: "no-parece-un-id" } } },
      { update_id: 2, message: { text: "/start x", chat: { id: 42 } } },
    ],
  });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    const r = await p.obtenerActualizaciones(0);
    assert.deepEqual(r.mensajes, [{ updateId: 2, texto: "/start x", chatId: "42" }]);
    assert.equal(r.maxUpdateId, 2, "el update con chat.id raro igual cuenta para el offset");
  } finally {
    s.restore();
  }
});

test("un objeto que no es un update lanza (no un objeto)", async () => {
  const s = stubFetch(200, { ok: true, result: ["no-es-un-objeto"] });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.obtenerActualizaciones(0), /un update no es un objeto/);
  } finally {
    s.restore();
  }
});

// ---------------------------------------------------------------- enviarMensaje

test("enviarMensaje manda el chat_id/text correctos y el header content-type", async () => {
  const s = stubFetch(200, { ok: true, result: {} });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await p.enviarMensaje("555", "hola mundo");
    assert.equal(s.llamadas.length, 1);
    const { init } = s.llamadas[0]!;
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["content-type"], "application/json");
    assert.deepEqual(JSON.parse(init?.body as string), { chat_id: "555", text: "hola mundo" });
  } finally {
    s.restore();
  }
});

test("🔴 enviarMensaje con HTTP no-200 lanza", async () => {
  const s = stubFetch(400, { ok: false });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.enviarMensaje("1", "x"), /HTTP 400/);
  } finally {
    s.restore();
  }
});

/** No lo trata como éxito: Telegram documenta que un HTTP 200 puede llevar `ok:false` (ej. bot bloqueado). */
test("🔴 enviarMensaje con HTTP 200 pero {ok:false} en el body lanza", async () => {
  const s = stubFetch(200, { ok: false, description: "Forbidden: bot was blocked by the user" });
  try {
    const p = new LiveTelegramProvider(TOKEN);
    await assert.rejects(() => p.enviarMensaje("1", "x"), /ok:false/);
  } finally {
    s.restore();
  }
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGoogleReviewsProvider } from "./live-provider.js";

/**
 * Reemplaza `globalThis.fetch` por respuestas fijas -- mismo patrón que `stubFetch` en
 * `../telegram/live-provider.test.ts`. Acepta una COLA de respuestas para poder ejercitar la
 * paginación (una llamada por página) sin inventar un servidor.
 */
function stubFetch(respuestas: Array<{ status: number; body: unknown }>) {
  const llamadas: Array<{ url: string; init: RequestInit | undefined }> = [];
  const original = globalThis.fetch;
  const cola = [...respuestas];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, init });
    const r = cola.shift();
    if (!r) throw new Error("stubFetch: una llamada de más, sin respuesta preparada");
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return {
    llamadas,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const CLIENT_ID = "id-de-prueba.apps.googleusercontent.com";
const CLIENT_SECRET = "secreto-de-prueba";
const TOKEN = "access-token-de-prueba";
/** La v4 direcciona por NOMBRE DE RECURSO completo, no por un id suelto. */
const LOCATION = "accounts/111/locations/222";

function crear(): LiveGoogleReviewsProvider {
  return new LiveGoogleReviewsProvider(CLIENT_ID, CLIENT_SECRET);
}

// ---------------------------------------------------------------- refrescarToken

test("refrescarToken: arma el POST con grant_type=refresh_token y las credenciales del cliente", async () => {
  const s = stubFetch([{ status: 200, body: { access_token: "el-access-token", expires_in: 3599 } }]);
  try {
    const t = await crear().refrescarToken("el-refresh-token");
    assert.equal(t, "el-access-token");

    assert.equal(s.llamadas.length, 1);
    assert.equal(s.llamadas[0]!.url, "https://oauth2.googleapis.com/token");
    const cuerpo = new URLSearchParams(s.llamadas[0]!.init!.body as string);
    assert.equal(cuerpo.get("grant_type"), "refresh_token");
    assert.equal(cuerpo.get("refresh_token"), "el-refresh-token");
    assert.equal(cuerpo.get("client_id"), CLIENT_ID);
    assert.equal(cuerpo.get("client_secret"), CLIENT_SECRET);
  } finally {
    s.restore();
  }
});

test("🔴 refrescarToken: un refresh token vacío no llega a la red", async () => {
  const s = stubFetch([]);
  try {
    await assert.rejects(() => crear().refrescarToken(""));
    assert.equal(s.llamadas.length, 0, "ni una petición: se corta antes");
  } finally {
    s.restore();
  }
});

test("🔴 refrescarToken: HTTP 400 lanza, y el mensaje conserva el `error` de Google", async () => {
  /*
   * `invalid_grant` es exactamente lo que Google devuelve cuando el cliente REVOCÓ el acceso. Este
   * test no implementa la detección de revocación —eso necesita ver la forma real, y sigue
   * pendiente— pero sí fija que el motivo no se pierda por el camino: quien la implemente lo
   * necesita legible en el error.
   */
  const s = stubFetch([{ status: 400, body: { error: "invalid_grant", error_description: "Token has been expired or revoked." } }]);
  try {
    await assert.rejects(
      () => crear().refrescarToken("revocado"),
      /invalid_grant/,
      "el motivo de Google tiene que sobrevivir al error",
    );
  } finally {
    s.restore();
  }
});

test("🔴 refrescarToken: un 200 SIN access_token lanza, no devuelve undefined", async () => {
  const s = stubFetch([{ status: 200, body: { expires_in: 3599 } }]);
  try {
    await assert.rejects(() => crear().refrescarToken("algo"), /access_token/);
  } finally {
    s.restore();
  }
});

// ---------------------------------------------------------------- listarResenas

const RESENA_BASE = {
  reviewId: "rev-1",
  reviewer: { displayName: "Ana" },
  starRating: "FIVE",
  comment: "Excelente",
  createTime: "2026-09-01T10:00:00Z",
};

test("listarResenas: mapea el enum de estrellas a 1..5 y arma la URL del recurso v4", async () => {
  const estrellas = ["ONE", "TWO", "THREE", "FOUR", "FIVE"];
  const s = stubFetch([
    {
      status: 200,
      body: {
        reviews: estrellas.map((e, i) => ({ ...RESENA_BASE, reviewId: `rev-${i}`, starRating: e })),
      },
    },
  ]);
  try {
    const r = await crear().listarResenas(TOKEN, LOCATION);
    assert.deepEqual(
      r.map((x) => x.puntuacion),
      [1, 2, 3, 4, 5],
      "ONE..FIVE es un ENUM, no un número: sin mapeo, el filtro de 4-5★ no dispara nunca",
    );
    assert.ok(
      s.llamadas[0]!.url.startsWith(`https://mybusiness.googleapis.com/v4/${LOCATION}/reviews`),
      "la v4 direcciona por nombre de recurso completo",
    );
    assert.equal(
      (s.llamadas[0]!.init!.headers as Record<string, string>)["authorization"],
      `Bearer ${TOKEN}`,
    );
  } finally {
    s.restore();
  }
});

test("🔴 listarResenas: STAR_RATING_UNSPECIFIED lanza en vez de inventar una puntuación", async () => {
  /*
   * `puntuacion` tiene `check (puntuacion between 1 and 5)` en la 0021, así que un 0 reventaría en el
   * INSERT con un error mucho menos legible. Y descartarla en silencio sería peor: una reseña real
   * que nadie responde nunca, invisible. Se falla ruidoso, que es la doctrina del proyecto.
   */
  const s = stubFetch([{ status: 200, body: { reviews: [{ ...RESENA_BASE, starRating: "STAR_RATING_UNSPECIFIED" }] } }]);
  try {
    await assert.rejects(() => crear().listarResenas(TOKEN, LOCATION), /STAR_RATING_UNSPECIFIED|estrellas/i);
  } finally {
    s.restore();
  }
});

test("listarResenas: una reseña de solo estrellas (sin comment) da texto null, no vacío", async () => {
  const sinComentario = { ...RESENA_BASE };
  delete (sinComentario as { comment?: string }).comment;
  const s = stubFetch([{ status: 200, body: { reviews: [sinComentario] } }]);
  try {
    const r = await crear().listarResenas(TOKEN, LOCATION);
    assert.equal(r[0]!.texto, null, "la columna `texto` es nullable justamente para este caso");
  } finally {
    s.restore();
  }
});

test("listarResenas: un reseñador sin displayName cae a 'Anónimo' (la columna `autor` es NOT NULL)", async () => {
  const s = stubFetch([{ status: 200, body: { reviews: [{ ...RESENA_BASE, reviewer: {} }] } }]);
  try {
    const r = await crear().listarResenas(TOKEN, LOCATION);
    assert.equal(r[0]!.autor, "Anónimo");
  } finally {
    s.restore();
  }
});

test("listarResenas: sigue nextPageToken y concatena las páginas", async () => {
  const s = stubFetch([
    { status: 200, body: { reviews: [{ ...RESENA_BASE, reviewId: "a" }], nextPageToken: "pag2" } },
    { status: 200, body: { reviews: [{ ...RESENA_BASE, reviewId: "b" }] } },
  ]);
  try {
    const r = await crear().listarResenas(TOKEN, LOCATION);
    assert.deepEqual(r.map((x) => x.googleReviewId), ["a", "b"]);
    assert.ok(s.llamadas[1]!.url.includes("pageToken=pag2"), "la segunda llamada lleva el token");
  } finally {
    s.restore();
  }
});

test("🔴 listarResenas: un nextPageToken que nunca termina corta en un tope, no cuelga el ciclo", async () => {
  // Un servidor que siempre devuelve token sería un bucle infinito dentro de un step de Inngest.
  const s = stubFetch(
    Array.from({ length: 50 }, () => ({
      status: 200,
      body: { reviews: [RESENA_BASE], nextPageToken: "siempre-hay-mas" },
    })),
  );
  try {
    await crear().listarResenas(TOKEN, LOCATION);
    assert.ok(s.llamadas.length <= 20, `cortó en ${s.llamadas.length} páginas, sin colgarse`);
  } finally {
    s.restore();
  }
});

test("listarResenas: una ficha sin reseñas (sin la clave `reviews`) da lista vacía, no lanza", async () => {
  const s = stubFetch([{ status: 200, body: { totalReviewCount: 0 } }]);
  try {
    assert.deepEqual(await crear().listarResenas(TOKEN, LOCATION), []);
  } finally {
    s.restore();
  }
});

test("🔴 listarResenas: un locationId que no es un nombre de recurso v4 no llega a la red", async () => {
  const s = stubFetch([]);
  try {
    await assert.rejects(() => crear().listarResenas(TOKEN, "mock-location-abc"), /accounts\/.*locations/);
    assert.equal(s.llamadas.length, 0, "se valida ANTES de armar una URL rota");
  } finally {
    s.restore();
  }
});

test("🔴 listarResenas: HTTP 403 lanza con el status a la vista", async () => {
  const s = stubFetch([{ status: 403, body: { error: { message: "insufficient permissions" } } }]);
  try {
    await assert.rejects(() => crear().listarResenas(TOKEN, LOCATION), /403/);
  } finally {
    s.restore();
  }
});

// ---------------------------------------------------------------- publicarRespuesta

test("publicarRespuesta: PUT al recurso .../reviews/:id/reply con el texto en `comment`", async () => {
  const s = stubFetch([{ status: 200, body: { comment: "gracias", updateTime: "2026-09-26T10:00:00Z" } }]);
  try {
    await crear().publicarRespuesta(TOKEN, LOCATION, "rev-9", "Gracias por tu reseña");
    assert.equal(s.llamadas[0]!.url, `https://mybusiness.googleapis.com/v4/${LOCATION}/reviews/rev-9/reply`);
    assert.equal(s.llamadas[0]!.init!.method, "PUT");
    assert.deepEqual(JSON.parse(s.llamadas[0]!.init!.body as string), { comment: "Gracias por tu reseña" });
  } finally {
    s.restore();
  }
});

test("🔴 publicarRespuesta: un texto vacío no llega a la red", async () => {
  // Publicar una respuesta vacía en la ficha de un cliente es peor que no publicar nada.
  const s = stubFetch([]);
  try {
    await assert.rejects(() => crear().publicarRespuesta(TOKEN, LOCATION, "rev-9", "   "));
    assert.equal(s.llamadas.length, 0);
  } finally {
    s.restore();
  }
});

test("🔴 publicarRespuesta: HTTP 404 lanza -- 'publicado' significa lo que confirma el proveedor", async () => {
  const s = stubFetch([{ status: 404, body: { error: { message: "review not found" } } }]);
  try {
    await assert.rejects(() => crear().publicarRespuesta(TOKEN, LOCATION, "rev-inexistente", "hola"), /404/);
  } finally {
    s.restore();
  }
});

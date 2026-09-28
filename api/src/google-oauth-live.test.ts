import { test } from "node:test";
import assert from "node:assert/strict";
import { LiveGoogleOAuthProvider, SCOPE_BUSINESS } from "./google-oauth-live.js";

/** Cola de respuestas: el intercambio del code encadena hasta tres llamadas. */
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

const REDIRECT = "https://api.bigballs.es/google/callback";
const crear = () => new LiveGoogleOAuthProvider("un-client-id", "un-secreto", REDIRECT);

const TOKEN_OK = { status: 200, body: { refresh_token: "el-refresh", access_token: "el-access" } };

// ---------------------------------------------------------------- urlDeConsentimiento

test("urlDeConsentimiento: access_type=offline y prompt=consent -- sin las dos no hay refresh token", () => {
  const url = new URL(crear().urlDeConsentimiento("el-state", "http://ignorado:3000"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("access_type"), "offline", "sin esto Google no emite refresh token");
  assert.equal(
    url.searchParams.get("prompt"),
    "consent",
    "sin esto, un SEGUNDO consentimiento no trae refresh token y el cliente queda sin credencial",
  );
  assert.equal(url.searchParams.get("scope"), SCOPE_BUSINESS);
  assert.equal(url.searchParams.get("state"), "el-state");
  assert.equal(url.searchParams.get("response_type"), "code");
});

test("urlDeConsentimiento: el redirect_uri es el CONFIGURADO, nunca el origen de la request", () => {
  // Google exige coincidencia exacta con el registrado, y detrás de un proxy el origen que ve el
  // proceso puede no ser el público. El `callbackBaseUrl` se ignora en live, por contrato.
  const url = new URL(crear().urlDeConsentimiento("s", "http://localhost:3000"));
  assert.equal(url.searchParams.get("redirect_uri"), REDIRECT);
});

// ---------------------------------------------------------------- intercambiarCode

test("intercambiarCode: POST con grant_type=authorization_code y el redirect_uri configurado", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }] } },
    { status: 200, body: { locations: [{ name: "locations/222" }] } },
  ]);
  try {
    const r = await crear().intercambiarCode("el-code");
    assert.equal(r.refreshToken, "el-refresh");
    assert.equal(r.locationId, "accounts/111/locations/222", "la v4 direcciona por nombre de recurso completo");

    assert.equal(s.llamadas[0]!.url, "https://oauth2.googleapis.com/token");
    const cuerpo = new URLSearchParams(s.llamadas[0]!.init!.body as string);
    assert.equal(cuerpo.get("grant_type"), "authorization_code");
    assert.equal(cuerpo.get("code"), "el-code");
    assert.equal(cuerpo.get("redirect_uri"), REDIRECT);
  } finally {
    s.restore();
  }
});

test("🔴 intercambiarCode: un code vacío no llega a la red", async () => {
  const s = stubFetch([]);
  try {
    await assert.rejects(() => crear().intercambiarCode("  "));
    assert.equal(s.llamadas.length, 0);
  } finally {
    s.restore();
  }
});

test("🔴 intercambiarCode: un 200 SIN refresh_token lanza -- el fallo más traicionero del flujo", async () => {
  /*
   * Google devuelve `refresh_token` sólo en el primer consentimiento salvo que se pida
   * `prompt=consent`. Sin esta comprobación el cliente quedaría "conectado" con un access token de
   * una hora, y el polling dejaría de traer reseñas al rato sin que nada avisara.
   */
  const s = stubFetch([{ status: 200, body: { access_token: "solo-access" } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /refresh_token/);
  } finally {
    s.restore();
  }
});

test("🔴 intercambiarCode: HTTP 400 conserva el `error` de Google en el mensaje", async () => {
  const s = stubFetch([{ status: 400, body: { error: "redirect_uri_mismatch" } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /redirect_uri_mismatch/);
  } finally {
    s.restore();
  }
});

// ---------------------------------------------------------------- descubrir la ficha

test("🔴 429 al listar cuentas se traduce a un mensaje que nombra el trámite de cuota", async () => {
  // Es el estado REAL hoy: la Account Management API está en cuota 0 en amg-automation. Propagar un
  // "HTTP 429" pelado dejaría a quien conecte sin saber que el problema no es suyo.
  const s = stubFetch([TOKEN_OK, { status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /cuota 0/);
  } finally {
    s.restore();
  }
});

test("🔴 varias fichas: falla nombrando la decisión pendiente en vez de elegir la primera", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }] } },
    { status: 200, body: { locations: [{ name: "locations/222" }, { name: "locations/333" }] } },
  ]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /2 fichas|selección/);
  } finally {
    s.restore();
  }
});

test("🔴 varias cuentas de negocio: tampoco se adivina cuál corresponde a este cliente", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }, { name: "accounts/999" }] } },
  ]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /2 cuentas/);
  } finally {
    s.restore();
  }
});

test("🔴 una cuenta sin ninguna ficha falla explícito, no devuelve un locationId a medias", async () => {
  const s = stubFetch([
    TOKEN_OK,
    { status: 200, body: { accounts: [{ name: "accounts/111" }] } },
    { status: 200, body: { locations: [] } },
  ]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /no tiene ninguna ficha/);
  } finally {
    s.restore();
  }
});

// ------------------------------------- el camino manual: con locationId pegado NO se descubre nada

/*
 * EL test del cambio. Las dos APIs de descubrimiento (Account Management y Business Information)
 * están en cuota 0 en `amg-automation`, así que `descubrirUbicacion` SIEMPRE devuelve 429 hoy. Si el
 * camino manual las intentara "por si acaso" antes de usar el valor pegado, el 429 volvería igual y
 * el cambio entero no serviría para nada. Por eso lo que se afirma no es el resultado: son las URLs
 * que se pidieron.
 */
test("🔴 intercambiarCode con locationId manual NO llama a las APIs de descubrimiento (cuota 0 ⇒ 429)", async () => {
  // Una sola respuesta en la cola: si el provider hiciera una segunda llamada, `stubFetch` lanza.
  const s = stubFetch([TOKEN_OK]);
  try {
    const r = await crear().intercambiarCode("el-code", "accounts/111/locations/222");
    assert.equal(r.refreshToken, "el-refresh");
    assert.equal(r.locationId, "accounts/111/locations/222", "devuelve el valor pegado TAL CUAL");

    assert.equal(s.llamadas.length, 1, "solo el intercambio del code; ni cuentas ni ubicaciones");
    assert.equal(s.llamadas[0]!.url, "https://oauth2.googleapis.com/token");
    const urls = s.llamadas.map((l) => l.url).join(" ");
    assert.ok(!urls.includes("mybusinessaccountmanagement"), "NO se pidió la Account Management API");
    assert.ok(!urls.includes("mybusinessbusinessinformation"), "NO se pidió la Business Information API");
  } finally {
    s.restore();
  }
});

test("🔴 con locationId manual, un 429 de descubrimiento ya no puede ocurrir: no se llega a pedirlo", async () => {
  /*
   * El control de contraste del test de arriba, y lo que hace que muerda: con la MISMA cola de
   * respuestas (token OK y después un 429 preparado), el camino automático se come el 429 y el
   * manual ni lo toca. Si alguien "optimizara" intentando descubrir primero y cayendo al manual,
   * este test se pondría rojo.
   */
  const automatico = stubFetch([TOKEN_OK, { status: 429, body: {} }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code"), /cuota 0/);
  } finally {
    automatico.restore();
  }

  const manual = stubFetch([TOKEN_OK, { status: 429, body: {} }]);
  try {
    const r = await crear().intercambiarCode("code", "accounts/9/locations/9");
    assert.equal(r.locationId, "accounts/9/locations/9");
    assert.equal(manual.llamadas.length, 1, "el 429 quedó sin consumir: nunca se pidió");
  } finally {
    manual.restore();
  }
});

test("🔴 el locationId manual no saltea la validación del code ni la del refresh_token", async () => {
  // El camino manual esquiva SOLO el descubrimiento. Todo lo que hace de esto una credencial válida
  // —que haya code, y que Google devuelva refresh_token— sigue en pie.
  const vacio = stubFetch([]);
  try {
    await assert.rejects(() => crear().intercambiarCode("  ", "accounts/1/locations/2"));
    assert.equal(vacio.llamadas.length, 0);
  } finally {
    vacio.restore();
  }

  const sinRefresh = stubFetch([{ status: 200, body: { access_token: "solo-access" } }]);
  try {
    await assert.rejects(() => crear().intercambiarCode("code", "accounts/1/locations/2"), /refresh_token/);
  } finally {
    sinRefresh.restore();
  }
});

/*
 * Menor 2 del `revisor`: el docblock de `GoogleOAuthProvider` promete "si llega el locationId, no se
 * descubre". Con una guardia truthy esa promesa valía para todos los valores menos uno — `""` se
 * colaba al descubrimiento —, y la interfaz es pública, así que la garantía vale para cualquiera que
 * la llame y no sólo para el handler que hoy ya rechaza el vacío con un 400.
 */
test("🔴 un locationIdManual vacío LANZA en vez de caer al descubrimiento en silencio", async () => {
  const pedidas: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    pedidas.push(String(url));
    return new Response(JSON.stringify({ refresh_token: "r-1", access_token: "a-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const provider = new LiveGoogleOAuthProvider("cid", "secret", "https://api.example/google/callback");
    for (const vacio of ["", "   "]) {
      await assert.rejects(
        () => provider.intercambiarCode("code-1", vacio),
        /locationIdManual vacío/,
        `${JSON.stringify(vacio)} tiene que lanzar, no descubrir`,
      );
    }
    // Lo que de verdad importa: NINGUNA de las dos APIs de descubrimiento se tocó. Si el vacío cayera
    // al descubrimiento, acá habría una URL de mybusinessaccountmanagement y volvería el 429.
    assert.equal(
      pedidas.filter((u) => u.includes("mybusiness")).length,
      0,
      `no se puede tocar el descubrimiento con un locationId vacío; se pidió: ${pedidas.join(", ")}`,
    );
  } finally {
    globalThis.fetch = original;
  }
});

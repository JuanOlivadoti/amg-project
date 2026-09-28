import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { firmarEstado, verificarEstado, VENTANA_ESTADO_MS, type EstadoOAuth } from "./oauth-state.js";

const SECRETO = "secreto-de-test-no-para-produccion";

function estado(extra: Partial<EstadoOAuth> = {}): EstadoOAuth {
  return {
    clientId: "11111111-1111-4111-8111-111111111111",
    tenantId: "22222222-2222-4222-8222-222222222222",
    userId: "33333333-3333-4333-8333-333333333333",
    nonce: "nonce-fijo",
    emitidoEn: Date.now(),
    ...extra,
  };
}

test("firmarEstado + verificarEstado: el camino feliz devuelve el mismo estado", () => {
  const original = estado();
  const state = firmarEstado(original, SECRETO);
  const recuperado = verificarEstado(state, SECRETO);
  assert.deepEqual(recuperado, original);
});

test("🔴 verificarEstado con el secreto equivocado → null", () => {
  const state = firmarEstado(estado(), SECRETO);
  assert.equal(verificarEstado(state, "otro-secreto"), null);
});

test("🔴 verificarEstado: un payload alterado en UN byte invalida la firma", () => {
  const state = firmarEstado(estado(), SECRETO);
  const idx = state.lastIndexOf(".");
  const payload = state.slice(0, idx);
  const firma = state.slice(idx + 1);

  // Cambia un solo carácter del payload (base64url), dejando la firma original intacta.
  const ultimo = payload.at(-1)!;
  const reemplazo = ultimo === "A" ? "B" : "A";
  const payloadAlterado = payload.slice(0, -1) + reemplazo;

  assert.equal(verificarEstado(`${payloadAlterado}.${firma}`, SECRETO), null);
});

test("🔴 verificarEstado: la firma alterada en un byte se rechaza", () => {
  const state = firmarEstado(estado(), SECRETO);
  const idx = state.lastIndexOf(".");
  const payload = state.slice(0, idx);
  const firma = state.slice(idx + 1);

  const ultimo = firma.at(-1)!;
  const reemplazo = ultimo === "A" ? "B" : "A";
  const firmaAlterada = firma.slice(0, -1) + reemplazo;

  assert.equal(verificarEstado(`${payload}.${firmaAlterada}`, SECRETO), null);
});

test("🔴 verificarEstado: un state vencido se rechaza aunque la firma sea correcta", () => {
  const viejo = estado({ emitidoEn: Date.now() - VENTANA_ESTADO_MS - 1 });
  const state = firmarEstado(viejo, SECRETO);
  // La firma ES válida (se firmó de verdad este payload): lo que tiene que fallar es la ventana.
  assert.equal(verificarEstado(state, SECRETO), null);
});

test("un state justo dentro de la ventana todavía verifica", () => {
  const reciente = estado({ emitidoEn: Date.now() - (VENTANA_ESTADO_MS - 1000) });
  const state = firmarEstado(reciente, SECRETO);
  assert.notEqual(verificarEstado(state, SECRETO), null);
});

test("verificarEstado: sin separador '.' → null, no lanza", () => {
  assert.equal(verificarEstado("sin-punto-ninguno", SECRETO), null);
});

test("verificarEstado: payload que no es JSON válido → null, no lanza", () => {
  // base64url de basura, firmada CORRECTAMENTE para ese payload (si no, se rechazaría por la firma
  // y no ejercitaría la rama del `try/catch` del JSON.parse, que es lo que este test prueba).
  const payloadBasura = Buffer.from("no soy json").toString("base64url");
  const firmaReal = createHmac("sha256", SECRETO).update(payloadBasura).digest("base64url");
  assert.equal(verificarEstado(`${payloadBasura}.${firmaReal}`, SECRETO), null);
});

test("firmas de dos estados distintos no coinciden (no hay colisión trivial)", () => {
  const s1 = firmarEstado(estado({ nonce: "a" }), SECRETO);
  const s2 = firmarEstado(estado({ nonce: "b" }), SECRETO);
  assert.notEqual(s1, s2);
});

/** La retención de `oauth_nonces_usados`, tal como la fija la política `nonce_purga` (migración 0034). */
const RETENCION_NONCES_MS = 60 * 60 * 1000;

test("🔴 la ventana del state cabe dentro de la retención de nonces de la migración 0034", () => {
  /*
   * Las dos duraciones viven en archivos distintos de paquetes distintos, y tienen que mantener un
   * orden: si `VENTANA_ESTADO_MS` superara la retención, la purga empezaría a borrar nonces de states
   * TODAVÍA VÁLIDOS, y cada uno de esos volvería a ser reproducible — justo el agujero que la 0034
   * viene a cerrar, reabierto por una constante que alguien cambió en el otro paquete.
   *
   * No se unifican en un solo literal a propósito: no son el mismo número. La ventana es la caducidad
   * OPERATIVA (cuánto tiempo tiene un humano para completar el consentimiento de Google) y la
   * retención es un TECHO con holgura para que el registro no crezca sin fin. Lo que importa no es que
   * coincidan, sino la desigualdad — y eso es exactamente lo que este test fija.
   */
  assert.ok(
    VENTANA_ESTADO_MS < RETENCION_NONCES_MS,
    `VENTANA_ESTADO_MS (${VENTANA_ESTADO_MS}ms) tiene que ser menor que la retención de ` +
      `oauth_nonces_usados (${RETENCION_NONCES_MS}ms, política nonce_purga en ` +
      `db/migrations/0034_oauth_nonce_un_solo_uso.sql). Si ampliás la ventana, ampliá el intervalo ` +
      `de la política en una migración nueva ANTES de tocar esta constante.`,
  );
});

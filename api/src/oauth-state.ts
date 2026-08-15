import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * El `state` de OAuth, firmado. El callback (`GET /clients/:id/google/callback`) es la ÚNICA ruta
 * de la API que responde a una navegación anónima del navegador — no puede llevar ningún header, así
 * que la identidad de quien conecta (tenantId/userId) tiene que viajar DENTRO del `state`, y tiene
 * que venir firmada por este mismo proceso para que nadie pueda escribir `google_refresh_token` en
 * un cliente ajeno simplemente golpeando la URL con un `state` inventado.
 *
 * `POST /clients/:id/google/conectar` (autenticado) FIRMA; `GET .../callback` (anónimo) VERIFICA.
 * La firma es lo que separa "un dato que viajó por una URL pública" de "una credencial" — sin ella,
 * el callback confiaría ciegamente en cualquier tenantId/userId que alguien le mande.
 */
export interface EstadoOAuth {
  clientId: string;
  tenantId: string;
  userId: string;
  nonce: string;
  /** epoch ms de cuándo se firmó. El callback rechaza un state más viejo que VENTANA_MS. */
  emitidoEn: number;
}

/** 10 minutos: tiempo de sobra para completar un consentimiento real de Google, corto para que un
 *  `state` filtrado (logs, historial del navegador) no sirva indefinidamente. */
export const VENTANA_ESTADO_MS = 10 * 60 * 1000;

export function firmarEstado(estado: EstadoOAuth, secreto: string): string {
  const payload = Buffer.from(JSON.stringify(estado)).toString("base64url");
  const firma = createHmac("sha256", secreto).update(payload).digest("base64url");
  return `${payload}.${firma}`;
}

/** `null` si la firma no coincide, si expiró, o si el formato es inválido -- nunca lanza: un state
 *  roto es un 400 de aplicación, no un 500. */
export function verificarEstado(state: string, secreto: string): EstadoOAuth | null {
  const idx = state.lastIndexOf(".");
  if (idx < 0) return null;
  const payload = state.slice(0, idx);
  const firmaRecibida = state.slice(idx + 1);
  const firmaEsperada = createHmac("sha256", secreto).update(payload).digest("base64url");

  const a = Buffer.from(firmaRecibida);
  const b = Buffer.from(firmaEsperada);
  // Comparación de tiempo constante: NO uses `firmaRecibida === firmaEsperada` ni `.equals()`, que
  // salen antes en el primer byte distinto y filtran (por temporización) cuánto de la firma acertó.
  // El chequeo de longitud primero es seguro: el largo de un HMAC-SHA256 en base64url es siempre 43
  // caracteres, así que no revela nada sobre el contenido.
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let estado: EstadoOAuth;
  try {
    estado = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (Date.now() - estado.emitidoEn > VENTANA_ESTADO_MS) return null;

  return estado;
}

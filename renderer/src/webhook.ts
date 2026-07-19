import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificación del webhook de Storyblok, que es lo que autoriza a vaciar una cache.
 *
 * ## Por qué esto no puede ser un endpoint abierto
 *
 * Sin firma, `POST /_webhook` es un **botón público para tirar la cache de cualquier cliente**.
 * Quien lo apriete en bucle convierte un servicio que sirve desde memoria en uno que pega contra la
 * Content Delivery API en cada visita — lento, y facturado a nosotros. No hace falta ninguna
 * vulnerabilidad: alcanza con un `curl` repetido, y no deja rastro sospechoso porque *el endpoint
 * hace lo que dice*. Es la clase de agujero que no parece uno hasta que llega la factura.
 *
 * ## Y por qué la comparación es de tiempo constante
 *
 * Un `===` sobre HMACs filtra, por cuánto tarda en fallar, cuántos bytes acertaste. Con un endpoint
 * que se puede llamar sin límite, eso es suficiente para reconstruir la firma byte a byte. Es un
 * ataque viejo y aburrido, y `timingSafeEqual` cuesta una línea.
 */

/** La cabecera que manda Storyblok con el HMAC del cuerpo crudo. */
export const HEADER_FIRMA = "webhook-signature";

/**
 * `true` solo si la firma corresponde al cuerpo EXACTO recibido.
 *
 * `body` tiene que ser el texto **crudo**: si se parsea y se vuelve a serializar, el JSON cambia
 * (orden de claves, espacios) y la firma deja de validar aunque sea legítima. El orden importa —
 * verificar primero, parsear después.
 */
export function firmaValida(body: string, firma: string | null | undefined, secreto: string): boolean {
  if (!firma || !secreto) return false;

  const esperada = createHmac("sha1", secreto).update(body, "utf8").digest("hex");

  const a = Buffer.from(esperada, "utf8");
  const b = Buffer.from(firma.trim().toLowerCase(), "utf8");

  // `timingSafeEqual` LANZA si los largos difieren — y ese throw, en sí, ya filtra el largo. Como
  // el largo del hex de un SHA-1 es fijo y público, no hay nada que proteger ahí: se corta antes.
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** El cuerpo que manda Storyblok. Solo se usa lo que hace falta; el resto se ignora a propósito. */
export interface EventoWebhook {
  /** `published`, `unpublished`, `deleted`... Todos invalidan: cualquiera cambia lo que se sirve. */
  action?: string;
  space_id?: number | string;
  story_id?: number | string;
  text?: string;
}

/** Parsea sin confiar: un cuerpo que no es el que esperamos es `null`, no una excepción. */
export function parsearEvento(body: string): EventoWebhook | null {
  try {
    const j: unknown = JSON.parse(body);
    if (typeof j !== "object" || j === null) return null;
    return j as EventoWebhook;
  } catch {
    return null;
  }
}

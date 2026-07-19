import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * La URL de preview del Visual Editor, firmada.
 *
 * ## Por qué esto existe
 *
 * ADR-19 eligió renderizar en runtime **por el Visual Editor**: para funcionar necesita una URL en
 * vivo que le muestre al editor lo que está escribiendo, o sea **borradores**. Y ahí está el
 * problema: si `?version=draft` fuera un parámetro cualquiera, **cualquiera** podría leer lo que un
 * cliente escribió y no publicó — precios que todavía no rigen, una carta que sale el mes que viene,
 * un texto a medio corregir. El contenido publicado es público por definición; el borrador es lo
 * contrario, y sale por la misma puerta.
 *
 * ## La decisión
 *
 * Servir draft exige una firma HMAC con vencimiento, atada **al dominio concreto**. Consecuencias
 * de que esté atada al dominio: un enlace de preview de un cliente no sirve para espiar el borrador
 * de otro, aunque se sepa el formato. Y el vencimiento hace que un enlace filtrado (un chat, un
 * historial de navegador, un `Referer`) deje de servir solo.
 *
 * El secreto es UNO del servicio (`PREVIEW_SECRET`), no uno por cliente: quien emite estos enlaces
 * es la agencia, no el cliente. Rotarlo invalida todos los enlaces vivos, que es exactamente lo que
 * uno quiere de una rotación.
 */

export const PARAM_FIRMA = "_amg_preview";
export const PARAM_VENCE = "_amg_exp";

function calcular(secreto: string, dominio: string, vence: number): string {
  // El `\n` separa los campos: sin separador, ("bella.es", 12) y ("bella.e", "s12") firman igual.
  // Es la clase de ambigüedad que convierte un HMAC correcto en uno inútil.
  return createHmac("sha256", secreto).update(`${dominio}\n${vence}`, "utf8").digest("hex");
}

/** Firma un enlace de preview para un dominio, válido `duracionMs` (default 1 h). */
export function firmarPreview(
  secreto: string,
  dominio: string,
  duracionMs = 60 * 60_000,
  ahora: () => number = Date.now,
): { firma: string; vence: number } {
  const vence = ahora() + duracionMs;
  return { firma: calcular(secreto, dominio, vence), vence };
}

/**
 * ¿Esta petición puede ver borradores?
 *
 * **Falla cerrado en todo**: sin secreto configurado, sin firma, con firma vencida o con firma de
 * otro dominio → `false` → se sirve contenido publicado. Nunca lanza: un error acá no puede
 * convertirse en un 500 que le tire la web al visitante, y sobre todo, un fallo del mecanismo de
 * preview tiene que degradar a "público", jamás a "draft".
 */
export function previewAutorizado(
  secreto: string | undefined,
  dominio: string,
  params: URLSearchParams,
  ahora: () => number = Date.now,
): boolean {
  if (!secreto) return false;

  const firma = params.get(PARAM_FIRMA);
  const venceRaw = params.get(PARAM_VENCE);
  if (!firma || !venceRaw) return false;

  const vence = Number(venceRaw);
  if (!Number.isSafeInteger(vence) || vence <= ahora()) return false;

  const esperada = Buffer.from(calcular(secreto, dominio, vence), "utf8");
  const dada = Buffer.from(firma.trim().toLowerCase(), "utf8");
  if (esperada.length !== dada.length) return false;

  return timingSafeEqual(esperada, dada);
}

/**
 * El script del Storyblok Bridge, que es lo que hace que el editor vea sus cambios sin recargar.
 *
 * Se inyecta **solo** en preview. En una página pública sería, a la vez, un script de tercero que
 * nadie pidió y una pista de que este dominio tiene un modo borrador.
 */
export function scriptBridge(): string {
  return '<script src="https://app.storyblok.com/f/storyblok-v2-latest.js"></script>';
}

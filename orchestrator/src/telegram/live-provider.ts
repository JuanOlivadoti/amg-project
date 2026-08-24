import type { MensajeTelegram, ResultadoActualizaciones, TelegramProvider } from "./provider.js";

const BASE = "https://api.telegram.org";
const TIMEOUT_MS = 10_000;

/**
 * Llamadas reales a la API de Telegram. Sin dependencias nuevas: `fetch` nativo. Timeouts explícitos
 * -- mismo criterio que `renderer/src/deps.ts` con el pool de Postgres: "esta consulta es puntual, si
 * tarda algo está roto". Sin reintento acá tampoco -- lo decide la función de Inngest que lo llama
 * (`retries: 0`, ver `functions.ts`).
 */
export class LiveTelegramProvider implements TelegramProvider {
  constructor(private readonly token: string) {}

  async obtenerActualizaciones(offset: number): Promise<ResultadoActualizaciones> {
    const url = `${BASE}/bot${this.token}/getUpdates?offset=${offset}&timeout=0`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`getUpdates: HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (
      typeof body !== "object" ||
      body === null ||
      !("ok" in body) ||
      (body as { ok: unknown }).ok !== true ||
      !("result" in body) ||
      !Array.isArray((body as { result: unknown }).result)
    ) {
      throw new Error("getUpdates: respuesta con forma inesperada");
    }
    const resultado: unknown[] = (body as { result: unknown[] }).result;
    const mensajes: MensajeTelegram[] = [];
    let maxUpdateId: number | null = null;

    for (const u of resultado) {
      // No confiar en la forma sin chequearla -- mismo criterio que `parsearEvento` en
      // `renderer/src/webhook.ts`.
      if (typeof u !== "object" || u === null) {
        throw new Error("getUpdates: un update no es un objeto");
      }
      const updateId = (u as Record<string, unknown>)["update_id"];
      /*
       * Un `update_id` no numérico (o no entero seguro) hace fallar TODO el lote, sin excepción
       * (hallazgo 1 de Codex): no hay forma segura de "saltearlo y seguir" sin arriesgar perder o
       * duplicar la confirmación de offset -- es la clase de dato malformado que indicaría un cambio
       * de la API de Telegram o algo peor, y este proyecto prefiere fallar ruidoso a corromper estado
       * en silencio (mismo criterio que `app_render` con un `select *` que revienta en vez de filtrar
       * en silencio). Un update SIN `message`/`text` (una reacción, una edición) es distinto: es una
       * forma ESPERADA y documentada de la API -- se ignora para `mensajes`, pero SÍ cuenta para
       * `maxUpdateId`.
       */
      if (typeof updateId !== "number" || !Number.isSafeInteger(updateId)) {
        throw new Error("getUpdates: update_id no es un entero seguro");
      }
      // A partir de acá, un update sin forma de mensaje de texto se IGNORA (no lanza) -- pero su
      // update_id YA CUENTA para maxUpdateId, calculado ANTES de decidir si es un mensaje útil. Es
      // exactamente lo que el hallazgo 1 de Codex vino a corregir.
      maxUpdateId = maxUpdateId === null ? updateId : Math.max(maxUpdateId, updateId);

      const mensaje = (u as Record<string, unknown>)["message"];
      if (typeof mensaje !== "object" || mensaje === null) continue;
      const texto = (mensaje as Record<string, unknown>)["text"];
      const chat = (mensaje as Record<string, unknown>)["chat"];
      if (typeof texto !== "string" || typeof chat !== "object" || chat === null) continue;
      const chatId = (chat as Record<string, unknown>)["id"];
      /*
       * Telegram documenta `chat.id` como entero (negativo para grupos/canales), pero este código
       * acepta string también por si acaso. La decisión que el plan dejaba abierta (Step 4): un
       * string que ni siquiera PARECE un id no debería colarse como si fuera válido, así que se
       * exige el mismo formato numérico -- `-?\d+` -- que tendría el entero real, solo que como
       * texto. A diferencia de `update_id`, un `chat.id` inválido ignora ESE mensaje puntual, no el
       * lote entero: no es la clave de confirmación del offset.
       */
      const chatIdValido =
        (typeof chatId === "number" && Number.isSafeInteger(chatId)) ||
        (typeof chatId === "string" && /^-?\d+$/.test(chatId));
      if (!chatIdValido) continue;
      mensajes.push({ updateId, texto, chatId: String(chatId) });
    }
    return { maxUpdateId, mensajes };
  }

  async enviarMensaje(chatId: string, texto: string): Promise<void> {
    const url = `${BASE}/bot${this.token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`sendMessage: HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || (body as { ok: unknown }).ok !== true) {
      // Telegram documenta que TODA respuesta trae `ok` -- un HTTP 200 con `ok: false` es un fallo
      // real (ej. chat_id inválido, bot bloqueado por esa persona), no un éxito.
      throw new Error("sendMessage: la API respondió ok:false");
    }
  }
}

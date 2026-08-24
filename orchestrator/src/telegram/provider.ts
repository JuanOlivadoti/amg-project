import { leerConfig, type ModoTelegram } from "../config.js";
import { MockTelegramProvider } from "./mock-provider.js";
import { LiveTelegramProvider } from "./live-provider.js";

/** Un mensaje de texto de Telegram, ya parseado (potencialmente un "/start <código>"). */
export interface MensajeTelegram {
  updateId: number;
  /** El texto completo del mensaje, tal como lo mandó la persona (ej. "/start abc123"). */
  texto: string;
  chatId: string;
}

/**
 * Lo que devuelve `getUpdates`.
 *
 * **Codex review 2026-08-23, hallazgo 1**: el diseño anterior filtraba los updates sin texto ANTES de
 * devolverlos, y calculaba el offset sobre la lista YA filtrada. Telegram exige confirmar (avanzar el
 * offset más allá de) TODO update que llegó, tenga o no texto útil -- si no, un lote con solo
 * reacciones/ediciones/otros updates sin `message.text` deja el offset clavado, y Telegram vuelve a
 * mandar el mismo lote (hasta 100 updates) para siempre, bloqueando cualquier `/start` real que venga
 * detrás. Por eso la interfaz separa las dos cosas.
 */
export interface ResultadoActualizaciones {
  /** El mayor `update_id` visto en el lote, CONTANDO los updates sin texto útil. `null` si el lote
   *  vino vacío -- distinto de `0`, que sería un update_id real. */
  maxUpdateId: number | null;
  /** Solo los updates que son un mensaje de texto (potencialmente un "/start <código>"). */
  mensajes: MensajeTelegram[];
}

/**
 * Separa el polling de si hay o no credenciales reales de Telegram -- mismo molde que
 * `GoogleReviewsProvider` (`../google/provider.ts`): una interfaz, dos implementaciones (mock/live),
 * seleccionadas por config.
 */
export interface TelegramProvider {
  /** Actualizaciones desde `offset` (mismo contrato que el `offset` real de Telegram). */
  obtenerActualizaciones(offset: number): Promise<ResultadoActualizaciones>;
  enviarMensaje(chatId: string, texto: string): Promise<void>;
}

/**
 * El selector. Mismo criterio que `getGoogleReviewsProvider`/`getBorradorProvider`: quien ya tiene la
 * config la pasa explícita (evita una segunda lectura del entorno); quien no -- como `crearDeps`, que
 * no recibe `ConfigOrquestador` -- deja que se resuelva sola desde `leerConfig()`.
 *
 * El `botToken` con default propio (y no leído dentro de `LiveTelegramProvider`, a diferencia de
 * `OpenAIBorradorProvider` con `OPENAI_API_KEY`) porque el token viaja como argumento del constructor
 * (Step 3): así el provider en sí queda testeable sin tocar `process.env`.
 */
export function getTelegramProvider(
  modo: ModoTelegram = leerConfig().telegram,
  // `?.trim() || undefined`, no `??`: env:sync escribe `""` (no `undefined`) cuando la clave falta en
  // credenciales.env -- mismo patrón que `leerModoBorrador()`/`leerModeloBorrador()` en config.ts y
  // openai-provider.ts, por la misma razón.
  botToken: string | undefined = process.env["TELEGRAM_BOT_TOKEN"]?.trim() || undefined,
): TelegramProvider {
  if (modo === "mock") return new MockTelegramProvider();
  if (!botToken) {
    throw new Error("TELEGRAM_MODO=live sin TELEGRAM_BOT_TOKEN.");
  }
  return new LiveTelegramProvider(botToken);
}

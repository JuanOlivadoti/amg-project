import "dotenv/config";
import type { Market } from "./types.js";

export const MARKET_ES: Market = { country: "ES", language_code: "es", location_code: 2724 };

const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

// Autodetección de proveedor LLM: explícito > OpenAI > Anthropic > mock.
const llmProvider =
  (process.env.LLM_PROVIDER as "openai" | "anthropic" | "mock" | undefined) ??
  (hasOpenAI ? "openai" : hasAnthropic ? "anthropic" : "mock");

export const config = {
  // Resiliencia HTTP (#11): timeout por intento y reintentos con backoff.
  http: {
    timeoutMs: Number(process.env.HTTP_TIMEOUT_MS ?? 30_000),
    retries: Number(process.env.HTTP_RETRIES ?? 3),
  },

  dataforseo: {
    // 'mock' = datos ficticios locales (sin cuenta) · 'live' = API real.
    mode: (process.env.DATAFORSEO_MODE as "mock" | "live") || "mock",
    baseUrl: process.env.DATAFORSEO_BASE_URL ?? "https://sandbox.dataforseo.com",
    login: process.env.DATAFORSEO_LOGIN ?? "",
    password: process.env.DATAFORSEO_PASSWORD ?? "",
    get isSandbox() {
      return this.baseUrl.includes("sandbox");
    },
    get hasCredentials() {
      return Boolean(this.login && this.password && this.login !== "tu-login");
    },

    /**
     * Autoriza REENVIAR una petición que quedó ambigua (se envió, nunca volvió respuesta).
     *
     * Apagado por defecto, y ese default es la decisión: una petición ambigua **pudo cobrarse**, y
     * reenviarla puede pagarla dos veces. Sin esto, el run se detiene y un humano comprueba en el
     * panel de DataForSEO si se cobró.
     *
     * Encenderlo es asumir el riesgo explícitamente. No es un flag de conveniencia: es la diferencia
     * entre "puede que hayamos pagado dos veces" y "decidimos que podíamos pagar dos veces".
     */
    permitirRepago: process.env.DFS_PERMITIR_REPAGO === "1",
  },

  /**
   * Cache de las respuestas de DataForSEO (ADR-10).
   *
   * Activa por defecto: el 81% del costo de un research es DataForSEO, y sin cache cada corrida
   * vuelve a pagar por keywords que ya se consultaron. `DFS_CACHE=off` la desactiva (útil para
   * medir el costo bruto de un research desde cero).
   *
   * En producción esto se reemplaza por las tablas `kr_metrics_cache` / `kr_serp_cache`, que además
   * comparten la cache entre TODOS los clientes de la plataforma.
   */
  cache: {
    enabled: process.env.DFS_CACHE !== "off",
    path: process.env.DFS_CACHE_PATH ?? ".cache/dataforseo.json",
  },

  llm: {
    // Proveedor de GENERACIÓN (seeds, briefs). Embeddings van aparte (ver abajo).
    provider: llmProvider,
    // Embeddings: OpenAI si hay key; si no, mock. (Anthropic no tiene embeddings propios.)
    embeddingProvider: hasOpenAI ? ("openai" as const) : ("mock" as const),
  },

  openai: {
    apiKey: process.env.OPENAI_API_KEY ?? "",
    get hasKey() {
      return Boolean(this.apiKey);
    },
    // Configurables por env; defaults estables.
    generationModel: process.env.OPENAI_MODEL ?? "gpt-4o",
    embeddingModel: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  },

  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY ?? "",
    get hasKey() {
      return Boolean(this.apiKey);
    },
    // ADR-09: Opus para generación/análisis, Haiku para clasificación.
    generationModel: "claude-opus-4-8",
    classificationModel: "claude-haiku-4-5-20251001",
  },
} as const;

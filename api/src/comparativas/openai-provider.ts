import OpenAI from "openai";
import type { OpcionSeguro } from "db";
import type { Comparativa, LlmComparativaProvider } from "./provider.js";

/**
 * Tope de gasto por comparativa, en USD. Default de PRODUCCIÓN: el preflight de `generar()` aborta
 * ANTES de llamar a OpenAI si la estimación de costo lo supera — misma doctrina que
 * `kr-service/src/lib/budget.ts` (`assertCanSpend`: se estima ANTES de gastar, no se informa después).
 *
 * Fijado por LITERAL, y probado como tal en el `describe` de abajo sin pasar por el constructor ni
 * por ningún otro parámetro inyectable. Este patrón ya falló tres veces en tres días en este repo
 * (`PLAZO_DESCARGA_MS` de `renderer/src/snapshot.ts` y de `api/src/comparativas/sheet.ts`,
 * `MAX_REDIRECCIONES` del segundo): un test que puede elegir el valor no fija el que corre en
 * producción (CHECKPOINTS.md).
 */
export const MAX_COSTO_USD = 0.1;

/**
 * Tokens de salida permitidos: fija el `max_tokens` del pedido a OpenAI Y, por eso mismo, el peor
 * caso de costo de salida que usa el preflight — si el modelo respeta el tope (lo hace: es un
 * parámetro duro de la API, no una sugerencia), el costo real de salida nunca supera lo que el
 * preflight ya descontó.
 */
const MAX_TOKENS_SALIDA = 2000;

/**
 * Caracteres por token estimados, a propósito por LO BAJO (un tokenizer real da más caracteres por
 * token que esto para texto en español/inglés) para que la cuenta de tokens estimada sea mayor que
 * la real — mismo criterio "ante la duda se sobreestima" de `budget.ts`. No hay tokenizer real
 * disponible antes de llamar a OpenAI: usarlo sería resolver el problema que el preflight existe
 * para evitar (llamar para saber cuánto cuesta llamar).
 */
const CARACTERES_POR_TOKEN_ESTIMADO = 3;

/**
 * USD por 1M tokens. Misma tabla, misma fuente y mismo criterio ("costo conocido, no medido", sin
 * configuración por entorno porque el volumen esperado es bajo) que
 * `orchestrator/src/borrador/openai-provider.ts:14`. Si el modelo configurado no está acá,
 * `costoEstimadoUsd` devuelve `null` en vez de inventar un número — y el preflight de esta pieza
 * trata ese `null` como "no se puede confirmar que entra en presupuesto", así que aborta también.
 *
 * ✅ Verificado contra developers.openai.com/api/docs/pricing el 2026-08-18 (misma fecha que la
 * tabla de `orchestrator`, copiada de la misma fuente). Re-verificar si esto empieza a importar para
 * una propuesta comercial.
 */
const PRECIOS_USD_POR_1M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10 },
};

/**
 * Costo en USD a partir de un conteo de tokens — sirve tanto para el preflight (con una ESTIMACIÓN
 * de tokens) como para el log posterior a la llamada (con el `usage` real que devuelve OpenAI).
 * `null` si el modelo no tiene tarifa conocida: nunca inventa un número.
 */
export function costoEstimadoUsd(
  uso: { prompt_tokens: number; completion_tokens: number },
  modelo: string,
): number | null {
  const precio = PRECIOS_USD_POR_1M[modelo];
  if (!precio) return null;
  return (uso.prompt_tokens * precio.input + uso.completion_tokens * precio.output) / 1_000_000;
}

/**
 * `?.trim() || ...`, no `??`: `env:sync` escribe `""` (no `undefined`) cuando la clave falta en
 * `credenciales.env` (`scripts/env-sync.mts`, `repartir()`) — mismo bug que ya provocó una vez en
 * este repo, y mismo patrón que `leerModeloBorrador()` en `orchestrator/src/borrador/openai-provider.ts`.
 * `??` dejaría pasar `""` como modelo real, y OpenAI la rechazaría recién en la llamada — demasiado
 * tarde para un preflight que se supone que decide ANTES de gastar.
 */
function leerModelo(): string {
  return process.env["OPENAI_MODEL"]?.trim() || "gpt-4o-mini";
}

const PROMPT_SISTEMA = `Sos un analista de seguros para una correduría. Recibís cotizaciones que la \
correduría juntó de distintas aseguradoras, en un formato de filas de texto SIN estructura fija — \
cada aseguradora usa sus propias columnas. Tu trabajo es identificar las opciones de seguro que \
aparecen en esas filas, compararlas y recomendar una.

Un corredor humano va a revisar tu respuesta y se la va a mandar TAL CUAL a su cliente final. Por eso:
- NUNCA inventes una aseguradora, un producto o una prima que no esté explícita en los datos.
- Si los datos son ambiguos, están incompletos, o no podés identificar con confianza al menos una
  aseguradora y su prima, declará "confianza": "baja" y devolvé "opciones": [] — NO completes con un
  valor inventado ni "hagas lo mejor que puedas": una comparativa a medias que parece completa es peor
  que un error, porque el corredor no tiene forma de distinguirla de una comparativa real.
- Cada opción que incluyas TIENE que traer "aseguradora" y "prima" tomadas literalmente de los datos.

Devolvé SOLO un JSON con esta forma exacta, sin texto antes o después y sin envolverlo en un bloque \
de markdown:

{
  "confianza": "alta" | "baja",
  "recomendacion": "string: nombre de la opción recomendada y por qué, en una frase",
  "informeMd": "string: informe comparativo completo en Markdown",
  "mailAsunto": "string: asunto del mail para el cliente final",
  "mailCuerpoMd": "string: cuerpo del mail para el cliente final, en Markdown",
  "opciones": [
    {
      "aseguradora": "string",
      "producto": "string",
      "prima": number,
      "cobertura": "string",
      "condiciones": "string o null",
      "notas": "string o null"
    }
  ]
}`;

/**
 * Lo mínimo que este provider necesita del cliente de OpenAI — un solo método, para que los tests lo
 * inyecten sin salir a la red ni tocar el SDK real. Mismo espíritu que el resto de los providers
 * inyectables del repo (`Tx` en `db/`, `fetch` en `sheet.ts`).
 */
export interface ClienteChatOpenAi {
  crear(args: {
    model: string;
    max_tokens: number;
    messages: Array<{ role: "system" | "user"; content: string }>;
  }): Promise<{
    choices: Array<{ message: { content: string | null } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>;
}

/** El cliente real: construye el SDK de OpenAI y lo adapta a `ClienteChatOpenAi`. Solo se instancia
 *  si nadie inyectó uno propio — en los tests siempre se inyecta el mock, así que esto nunca corre
 *  ahí ni sale a la red. */
function clienteOpenAiReal(): ClienteChatOpenAi {
  const openai = new OpenAI({
    apiKey: process.env["OPENAI_API_KEY"] ?? "",
    // La doctrina de este repo rechaza reintentos automáticos en llamadas facturables (mismo
    // criterio que `orchestrator/src/borrador/openai-provider.ts` y `kr-service/src/dataforseo/client.ts`):
    // un reintento automático puede duplicar el gasto de una llamada que sí llegó a destino pero cuya
    // respuesta se perdió en el camino.
    timeout: 30_000,
    maxRetries: 1,
  });
  return {
    crear: (args) => openai.chat.completions.create(args),
  };
}

function textoDeFilas(filas: string[][]): string {
  return filas.map((fila) => fila.join(",")).join("\n");
}

/** Estimación de tokens de ENTRADA a partir del texto crudo, para el preflight — antes de llamar a
 *  OpenAI no hay manera de saber el conteo real (no hay tokenizer acá), así que se aproxima por
 *  longitud de caracteres, del lado que sobreestima (ver `CARACTERES_POR_TOKEN_ESTIMADO`). */
function estimarTokensEntrada(filas: string[][], clienteFinal: string): number {
  const texto = PROMPT_SISTEMA + textoDeFilas(filas) + clienteFinal;
  return Math.ceil(texto.length / CARACTERES_POR_TOKEN_ESTIMADO);
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Los modelos de chat suelen envolver el JSON en un bloque de markdown (```json ... ``` o ``` ... ```)
 * incluso cuando el prompt pide explícitamente lo contrario. Sacarle el envoltorio ANTES de
 * `JSON.parse` no es "interpretar" el contenido — es lo mismo JSON con o sin la cerca alrededor.
 */
function extraerBloqueJson(texto: string): string {
  const t = texto.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return match?.[1] ?? t;
}

function parsearJsonDeRespuesta(texto: string): unknown {
  try {
    return JSON.parse(extraerBloqueJson(texto));
  } catch {
    throw new Error(
      "La comparativa no se generó: OpenAI no devolvió un JSON interpretable. " +
        "Nunca se guarda una comparativa a partir de una respuesta que no se puede leer.",
    );
  }
}

function coercionNumerica(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function requerirString(obj: Record<string, unknown>, campo: string): string {
  const v = obj[campo];
  if (typeof v !== "string") {
    throw new Error(
      `La comparativa no se generó: falta el campo "${campo}" (o no es texto) en la respuesta de OpenAI.`,
    );
  }
  return v;
}

function validarOpcion(o: unknown, idx: number): OpcionSeguro {
  if (!esObjeto(o)) {
    throw new Error(`La comparativa no se generó: la opción #${idx + 1} no es un objeto válido.`);
  }
  const aseguradora = typeof o["aseguradora"] === "string" ? o["aseguradora"].trim() : "";
  if (!aseguradora) {
    throw new Error(
      `La comparativa no se generó: la opción #${idx + 1} no trae aseguradora. ` +
        "Nunca se guarda una comparativa a medias.",
    );
  }
  const prima = coercionNumerica(o["prima"]);
  if (prima == null) {
    throw new Error(
      `La comparativa no se generó: la opción "${aseguradora}" no trae prima. ` +
        "Nunca se guarda una comparativa a medias.",
    );
  }
  return {
    aseguradora,
    producto: typeof o["producto"] === "string" ? o["producto"] : "",
    prima,
    cobertura: typeof o["cobertura"] === "string" ? o["cobertura"] : "",
    condiciones: typeof o["condiciones"] === "string" ? o["condiciones"] : null,
    notas: typeof o["notas"] === "string" ? o["notas"] : null,
  };
}

/**
 * Valida y normaliza el JSON crudo del LLM contra las dos reglas de esta pieza: se rechaza la
 * comparativa ENTERA (nunca un resultado parcial) si la confianza no es "alta" —esto cubre "baja" Y
 * cualquier valor que no sea exactamente "alta": ausente, mal escrito, o un tercer valor que el
 * modelo se haya inventado—, si no hay ninguna opción, o si alguna opción no trae aseguradora o
 * prima.
 */
function validarComparativa(json: unknown): {
  opciones: OpcionSeguro[];
  recomendacion: string;
  informeMd: string;
  mailAsunto: string;
  mailCuerpoMd: string;
} {
  if (!esObjeto(json)) {
    throw new Error("La comparativa no se generó: la respuesta de OpenAI no es un objeto JSON.");
  }

  if (json["confianza"] !== "alta") {
    throw new Error(
      `La comparativa no se generó: confianza declarada "${String(json["confianza"])}" ` +
        '(se exige "alta"). Nunca se guarda un informe con confianza baja o sin declarar: media ' +
        "comparativa que parece completa es peor que un error, porque el corredor la manda.",
    );
  }

  const opcionesRaw = json["opciones"];
  if (!Array.isArray(opcionesRaw) || opcionesRaw.length === 0) {
    throw new Error(
      "La comparativa no se generó: no se encontró ninguna opción de seguro en los datos recibidos.",
    );
  }
  const opciones = opcionesRaw.map((o, idx) => validarOpcion(o, idx));

  return {
    opciones,
    recomendacion: requerirString(json, "recomendacion"),
    informeMd: requerirString(json, "informeMd"),
    mailAsunto: requerirString(json, "mailAsunto"),
    mailCuerpoMd: requerirString(json, "mailCuerpoMd"),
  };
}

/**
 * Genera la comparativa llamando a OpenAI de verdad, con dos garantías que no son negociables (ver
 * el encabezado del módulo):
 *
 * 1. **Preflight**: `generar()` estima el costo por el tamaño de la entrada ANTES de tocar el
 *    cliente, y aborta sin llamar si supera `MAX_COSTO_USD`.
 * 2. **Fallar visible, nunca inventar**: `validarComparativa` rechaza la respuesta entera si el LLM
 *    no puede sostenerla con confianza "alta", si no trae ninguna opción, o si a alguna opción le
 *    falta aseguradora o prima. No hay resultado parcial: o la comparativa completa, o un error.
 */
export class OpenAIComparativaProvider implements LlmComparativaProvider {
  private readonly cliente: ClienteChatOpenAi;
  private readonly modelo: string;

  constructor(cliente: ClienteChatOpenAi = clienteOpenAiReal()) {
    this.cliente = cliente;
    this.modelo = leerModelo();
  }

  async generar(filas: string[][], clienteFinal: string): Promise<Comparativa> {
    // --- 1. Preflight: se estima el costo y se decide ANTES de llamar a OpenAI. --------------------
    const tokensEntradaEstimados = estimarTokensEntrada(filas, clienteFinal);
    const costoEstimado = costoEstimadoUsd(
      { prompt_tokens: tokensEntradaEstimados, completion_tokens: MAX_TOKENS_SALIDA },
      this.modelo,
    );
    if (costoEstimado == null) {
      // Sin tarifa conocida no hay forma de confirmar que entra en presupuesto: se trata igual que
      // "no entra", no como "no importa". Ver `costoEstimadoUsd`.
      throw new Error(
        `Presupuesto: no se pudo estimar el costo porque el modelo "${this.modelo}" no tiene ` +
          "tarifa conocida. No se llamó a OpenAI.",
      );
    }
    if (costoEstimado > MAX_COSTO_USD) {
      throw new Error(
        `Presupuesto insuficiente para esta comparativa: estimado $${costoEstimado.toFixed(4)}, ` +
          `tope $${MAX_COSTO_USD.toFixed(2)}. No se llamó a OpenAI.`,
      );
    }

    // --- 2. La llamada. -----------------------------------------------------------------------------
    // El texto de las filas es de cotizaciones AJENAS (cada correduría trae sus propias columnas, sin
    // estructura fija — ver `filas.ts`) y se interpola ACÁ sin escapar. Decisión consciente, mismo
    // motivo que `autor`/`texto` en `orchestrator/src/borrador/openai-provider.ts`: la garantía real
    // es que ninguna comparativa sale de esta pieza sin pasar por revisión humana antes de llegar al
    // cliente final (Task 6) — esta pieza no publica nada. Si una pieza futura publica esto sin
    // revisión, tiene que decidir esto de nuevo, no heredar el supuesto en silencio.
    const contenidoUsuario =
      `Cliente final: ${clienteFinal}\n\n` +
      "Filas de cotizaciones (formato libre, cada correduría trae sus columnas):\n\n" +
      textoDeFilas(filas);

    const res = await this.cliente.crear({
      model: this.modelo,
      max_tokens: MAX_TOKENS_SALIDA,
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        { role: "user", content: contenidoUsuario },
      ],
    });

    const texto = res.choices[0]?.message.content?.trim();
    if (!texto) {
      throw new Error("La comparativa no se generó: OpenAI no devolvió contenido.");
    }

    // --- 3. Fallar visible, nunca inventar: JSON malformado o comparativa a medias, las dos rechazan
    // el resultado ENTERO, nunca lo que se pudo rescatar. -------------------------------------------
    const json = parsearJsonDeRespuesta(texto);
    const { opciones, recomendacion, informeMd, mailAsunto, mailCuerpoMd } = validarComparativa(json);

    let costoUsd = 0;
    if (res.usage) {
      const costo = costoEstimadoUsd(res.usage, this.modelo);
      costoUsd = costo ?? 0;
      console.log(
        `[comparativa-ia] costo real: ${costo != null ? `$${costo.toFixed(6)}` : "modelo sin tarifa conocida"} ` +
          `(${res.usage.prompt_tokens} in / ${res.usage.completion_tokens} out, modelo ${this.modelo})`,
      );
    }

    return { opciones, recomendacion, informeMd, mailAsunto, mailCuerpoMd, costoUsd };
  }
}

import type { ResultadoLlamada } from "./api-client.js";

/**
 * La forma que el SDK de MCP espera como respuesta de una tool. El índice `[key: string]: unknown`
 * no lo usamos nosotros — lo exige el tipo `CallToolResult` del SDK instalado (permite campos extra
 * como `_meta`), y sin él `tsc` rechaza la asignación aunque en runtime el objeto sea válido.
 */
export interface RespuestaMcp {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  [key: string]: unknown;
}

/**
 * Traduce lo que devuelven las tools (`ResultadoLlamada`) a lo único que Claude Desktop puede
 * mostrar: texto. `isError` marca el camino de fallo para que Claude Desktop lo distinga en la UI,
 * pero el mensaje siempre es el mismo texto legible que ya armó `llamarApi` (spec §7) — ningún error
 * se traga ni se re-envuelve.
 */
export function respuestaTexto(resultado: ResultadoLlamada<unknown>): RespuestaMcp {
  if (!resultado.ok) return { content: [{ type: "text", text: resultado.mensaje }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(resultado.datos, null, 2) }] };
}

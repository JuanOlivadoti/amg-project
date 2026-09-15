import type { OpcionSeguro } from "db";
import type { LlmComparativaProvider, Comparativa } from "./provider.js";

/**
 * El prefijo que hace que un informe o un mail mock NUNCA se confunda con un entregable real cuando
 * el corredor lo imprime o lo copia para mandárselo al cliente final — mismo criterio que
 * `PREFIJO_MOCK_BORRADOR` (`orchestrator/src/borrador/mock-provider.ts`). En v1 no hay edición de
 * contenido (revisar es confirmar, no corregir: la spec lo deja fuera de alcance), así que la única
 * defensa contra confundir una demo con un entregable real es que la marca sea visible a simple
 * vista en el informe y en el mail — el mail en particular se copia literalmente con un botón, sin
 * pasar por la vista del informe.
 */
export const PREFIJO_MOCK_COMPARATIVA = "[COMPARATIVA MOCK — no generada por IA]";

export class MockComparativaProvider implements LlmComparativaProvider {
  async generar(filas: string[][], clienteFinal: string): Promise<Comparativa> {
    // Simular un análisis de filas para extraer opciones de seguro (mock determinista).
    // En un caso real, esto vendría de normalizar el CSV en `OpcionSeguro` (Task 1).
    // Para el mock, generamos opciones basadas en la cantidad de filas.
    const opciones: OpcionSeguro[] = this.extraerOpcionesMock(filas);

    // Seleccionar la opción recomendada (siempre la primera si hay).
    const recomendada = opciones.length > 0 ? opciones[0] : null;

    // Informe determinista.
    const informeMd = `${PREFIJO_MOCK_COMPARATIVA}

## Análisis de Comparativas de Seguros para ${clienteFinal}

Se han revisado ${opciones.length} opciones disponibles en el mercado.

${recomendada ? `### Recomendación Principal\n\nTras analizar las opciones, recomendamos **${recomendada.aseguradora} - ${recomendada.producto}** por la mejor relación cobertura/precio.` : ""}

${opciones.map((o) => `- **${o.aseguradora} ${o.producto}**: $${o.prima.toLocaleString("es-ES")} | Cobertura: ${o.cobertura}${o.condiciones ? ` | Condiciones: ${o.condiciones}` : ""}`).join("\n")}
`;

    // Mail determinista. El mail es, con el informe, uno de los dos entregables que llegan al
    // cliente final — y el que se copia literalmente con un botón, sin pasar por la vista del
    // informe. Por eso lleva la misma marca de mock en las dos partes, no solo en el cuerpo.
    const mailAsunto = `${PREFIJO_MOCK_COMPARATIVA} Comparativa de Seguros - ${clienteFinal}`;
    const mailCuerpoMd = `${PREFIJO_MOCK_COMPARATIVA}

Estimado,

Adjuntamos el análisis comparativo de opciones de seguro solicitado. Hemos evaluado ${opciones.length} alternativas considerando cobertura, deducibles y precio.

${recomendada ? `Recomendamos especialmente **${recomendada.aseguradora}** por su excelente balance entre protección y costo.` : ""}

Quedamos a tu disposición para ampliar la información.

Saludos,
Correduría`;

    const recomendacion = recomendada
      ? `${recomendada.aseguradora} - ${recomendada.producto}`
      : "Sin datos para recomendar";

    return {
      opciones,
      recomendacion,
      informeMd,
      mailAsunto,
      mailCuerpoMd,
      costoUsd: 0, // Mock no cuesta nada.
    };
  }

  /**
   * Extrae opciones de seguros a partir de filas de CSV/Sheet (mock determinista).
   * En un caso real, esto normalizaría los datos en `OpcionSeguro`.
   * Para el mock, construimos opciones ficticias basadas en el contenido.
   */
  private extraerOpcionesMock(filas: string[][]): OpcionSeguro[] {
    return filas.map((fila, idx) => ({
      aseguradora: fila[0] || `Aseguradora ${idx + 1}`,
      producto: fila[1] || "Producto Estándar",
      prima: parseFloat(fila[2] || "0") || 1000,
      cobertura: fila[3] || "Cobertura Básica",
      condiciones: fila[4] && fila[4].trim() ? fila[4] : null,
      notas: fila[5] && fila[5].trim() ? fila[5] : null,
    }));
  }
}

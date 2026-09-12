import type { OpcionSeguro } from "db";
import type { LlmComparativaProvider, Comparativa } from "./provider.js";
import { PREFIJO_MOCK_COMPARATIVA } from "./provider.js";

/**
 * Texto determinista de fixture para comparativas de seguros — nunca sale a internet.
 * Mismo criterio que `MockBorradorProvider` (`orchestrator/src/borrador/mock-provider.ts`):
 * prefijo que hace que no se confunda con un informe real cuando alguien lo edita en el portal.
 */
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

    // Mail determinista.
    const mailAsunto = `Comparativa de Seguros - ${clienteFinal}`;
    const mailCuerpoMd = `Estimado,

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

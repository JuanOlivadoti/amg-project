/**
 * Micros de USD → string con 4 decimales. El dinero viaja SIEMPRE en micros enteros (ADR-10): nunca
 * en coma flotante. Esta función es el único punto donde se convierte para mostrar.
 *
 * Vive en el contrato y no dentro de `informe.ts` porque tiene dos consumidores: el informe legible y
 * los logs de coste de `kr-service`.
 */
export function usdFromMicros(micros: number): string {
  return (micros / 1_000_000).toFixed(4);
}

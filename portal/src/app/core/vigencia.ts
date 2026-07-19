/**
 * Vigencia de un trabajo asincrónico: **¿esta respuesta todavía importa?**
 *
 * Existe porque una promesa no se cancela, y eso produjo dos bugs reales en el brief (9ª review):
 *
 *  1. **La respuesta tardía pisaba la pantalla.** Empieza `cargar(A)`, se navega a B, `cargar(B)`
 *     termina primero y pinta B… y después llega A y **sobrescribe con A**. La URL decía B.
 *  2. **Polling huérfano.** Se destruye el componente con una carga en vuelo: `ngOnDestroy` limpia
 *     el timer, pero la promesa resuelve después, llama a `ajustarPolling()` y crea un intervalo
 *     nuevo **que ya no tiene quién lo limpie**. Queda pegando a la API para siempre.
 *
 * La regla es una sola: se anota a qué corresponde el trabajo ANTES de pedirlo, y al volver se
 * pregunta si sigue vigente. Vive acá, en TypeScript puro, para poder probarla sin navegador.
 */
export class Vigencia {
  private clave = '';
  private destruida = false;

  /** El trabajo pasa a corresponder a `clave`. Todo lo pedido antes queda obsoleto. */
  cambiarA(clave: string): void {
    this.clave = clave;
  }

  /** A qué corresponde el trabajo en curso. Se captura ANTES del `await`. */
  get actual(): string {
    return this.clave;
  }

  /** El componente se fue. Desde acá, nada de lo que vuelva puede tocar nada. */
  destruir(): void {
    this.destruida = true;
  }

  get viva(): boolean {
    return !this.destruida;
  }

  /** ¿La respuesta llegó tarde (ya es otro run) o el componente ya no existe? */
  obsoleta(clave: string): boolean {
    return this.destruida || clave !== this.clave;
  }
}

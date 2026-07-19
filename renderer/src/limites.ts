/**
 * Lo que acota al renderizador frente a una petición anónima.
 *
 * ## Por qué esto existe (10ª review, #3 y #4)
 *
 * La review lo dijo mejor de lo que yo lo tenía pensado: el servicio estaba escrito para el camino
 * feliz y **no tenía ni un solo límite superior**. Cada path aleatorio de un dominio público
 * provocaba un lookup de Postgres **y** una petición a la Content Delivery API; los 404 no se
 * cacheaban, así que `/a-1`, `/a-2`, `/a-3`… amplificaban indefinidamente; y varias peticiones al
 * mismo slug frío disparaban varias llamadas al origen en paralelo.
 *
 * Nada de eso es una vulnerabilidad ingeniosa. Es un bucle `for` con `curl` — y lo paga la cuenta
 * de Storyblok, la conexión de Postgres y, con ADR-19, **todas las webs de cliente a la vez**.
 *
 * Tres piezas, cada una contra un vector distinto:
 *
 * | Pieza | Contra qué |
 * |---|---|
 * | `Coalescedor` | N peticiones al mismo slug frío → **una** llamada al origen |
 * | `CacheNegativa` | enumerar paths inexistentes deja de golpear el origen |
 * | `Semaforo` | un pico no abre sockets ni promesas sin techo |
 *
 * Ninguna sustituye a un rate limit del borde. Son el piso que el servicio tiene que traer puesto
 * **antes** de que exista ese borde, no la defensa completa.
 */

// ---------------------------------------------------------------- coalescing

/**
 * Une peticiones concurrentes por la misma clave en **una sola** ejecución.
 *
 * El caso: cien visitas simultáneas a una portada recién invalidada. Sin esto son cien llamadas a
 * la CDA por el mismo contenido — el patrón que se llama *cache stampede*, y que un webhook de
 * invalidación vuelve fácil de provocar a propósito.
 */
export class Coalescedor<T> {
  private readonly enVuelo = new Map<string, Promise<T>>();

  async hacer(clave: string, fn: () => Promise<T>): Promise<T> {
    const yaVa = this.enVuelo.get(clave);
    if (yaVa) return yaVa;

    // `finally` y no `then`: la entrada se limpia también cuando `fn` lanza. Si no, un fallo
    // quedaría cacheado como promesa rechazada y **todas** las visitas siguientes lo recibirían.
    const p = fn().finally(() => this.enVuelo.delete(clave));
    this.enVuelo.set(clave, p);
    return p;
  }

  get enCurso(): number {
    return this.enVuelo.size;
  }
}

// ---------------------------------------------------------------- cache negativa

/**
 * Recuerda los 404 por un rato corto.
 *
 * **Por qué el TTL es corto y separado del de la cache normal.** Un 404 negativo es una afirmación
 * más peligrosa que un hit: si alguien publica una página nueva, un 404 cacheado la esconde hasta
 * que venza. Treinta segundos alcanzan para absorber una ráfaga de enumeración y son poco tiempo
 * para que un editor note el retraso.
 *
 * **Solo se cachea el 404**, jamás un fallo del origen. Cachear "no existe" porque Storyblok tuvo
 * un mal minuto borraría la web del cliente hasta el vencimiento — es la misma distinción entre
 * "no está" y "se rompió" que hace `ErrorCda`.
 */
export class CacheNegativa {
  private readonly faltantes = new Map<string, number>();

  constructor(
    private readonly ttlMs = 30_000,
    private readonly maxEntradas = 2_000,
    private readonly ahora: () => number = Date.now,
  ) {}

  falta(clave: string): boolean {
    const hasta = this.faltantes.get(clave);
    if (hasta === undefined) return false;
    if (hasta <= this.ahora()) {
      this.faltantes.delete(clave);
      return false;
    }
    return true;
  }

  anotar(clave: string): void {
    this.faltantes.delete(clave);
    this.faltantes.set(clave, this.ahora() + this.ttlMs);

    while (this.faltantes.size > this.maxEntradas) {
      const vieja = this.faltantes.keys().next();
      if (vieja.done) break;
      this.faltantes.delete(vieja.value);
    }
  }

  olvidarTodo(): void {
    this.faltantes.clear();
  }

  get tamano(): number {
    return this.faltantes.size;
  }
}

// ---------------------------------------------------------------- concurrencia

/** Se devuelve cuando el servicio está saturado. El llamador responde 503, no encola sin fin. */
export class Saturado extends Error {
  constructor() {
    super("El renderizador está saturado");
    this.name = "Saturado";
  }
}

/**
 * Tope de trabajo en vuelo hacia el exterior (Postgres + CDA).
 *
 * **Rechaza en vez de encolar sin límite**, y esa es la decisión: una cola infinita no protege de
 * nada — convierte un pico en latencia creciente hasta que el proceso se queda sin memoria, con
 * todas las peticiones esperando por una respuesta que ya no le sirve a nadie. Un 503 rápido le
 * dice la verdad al que pide y deja el proceso vivo para **las páginas que ya están en cache**, que
 * es lo que mantiene en pie a la mayoría de las webs de cliente durante el pico.
 */
export class Semaforo {
  private enUso = 0;

  constructor(private readonly max: number) {}

  async correr<T>(fn: () => Promise<T>): Promise<T> {
    if (this.enUso >= this.max) throw new Saturado();
    this.enUso++;
    try {
      return await fn();
    } finally {
      this.enUso--;
    }
  }

  get ocupados(): number {
    return this.enUso;
  }
}

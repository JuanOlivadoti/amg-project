/**
 * La salud del orquestador, y **por qué no basta con responder `{"ok":true}`**.
 *
 * ## El problema, medido dos veces el mismo día
 *
 * `/_health` respondía `{"ok":true}` con la base inalcanzable. Estaba escrito así a propósito, con un
 * argumento que es correcto para el renderizador y **falso para el orquestador**: que un health check
 * no dependa de terceros. Para el orquestador la base **no es un tercero: es todo lo que hace**. Un
 * orquestador que no alcanza Postgres no puede leer el run, ni escribir keywords, ni cerrar nada; el
 * `onFailure` que existe para que un run no quede colgado muere por la misma causa que lo colgó.
 *
 * El 2026-08-07 pasó exactamente eso —`getaddrinfo ENOTFOUND base`, hora y media— con `/_health`
 * diciendo `{"ok":true,"modo":"cloud"}` todo el rato. Y fue la **segunda** vez en la jornada que un
 * health check declaró sano un servicio inservible: la primera fue la clave de firma, que se validaba,
 * se trimeaba y nunca llegaba a `serve()`, con toda invocación de Inngest rebotando en 401.
 *
 * ## Las tres decisiones, y las tres tienen contra
 *
 * **1. Responde 200 aunque esté degradado.** No es pereza: si `/_health` devolviera 503, Railway
 * consideraría enfermo el deploy y lo **reiniciaría o revertiría**. Tendríamos el servicio caído por
 * otra puerta, y reiniciar no arregla que Postgres no responda — solo tira el proceso que estaba
 * esperando. El código HTTP dice *"el proceso está vivo"*; el cuerpo dice *"y esto no funciona"*.
 *
 * **2. Lo degradado se ESCRIBE EN EL LOG, no solo en el cuerpo.** Ésta es la mitad que la 15ª review
 * externa señaló y que faltaba: un campo `degradado` que nadie consulta es el mismo defecto un piso
 * más arriba — verde porque nadie mira. La review proponía un endpoint de readiness para una alerta
 * externa; **no hay alerta externa en este proyecto**, así que eso habría sido otro sitio sin lector.
 * Lo que sí existe son los logs de Railway, y ahí se escribe.
 *
 * **3. Se loguea la TRANSICIÓN, no el estado.** Una línea por chequeo con la base caída son cientos de
 * líneas idénticas por hora: el ruido esconde exactamente lo que se quería ver, que es *cuándo* se
 * rompió y *cuándo* volvió. Se dice una vez al romperse y una vez al recuperarse.
 *
 * ## Y la cache, que no es una optimización
 *
 * Sin ella, cualquiera que sepa la URL abre una transacción por request contra Postgres — un
 * `/_health` es público y no lleva autenticación. Con TTL, el coste está acotado por tiempo y no por
 * tráfico.
 */

/** Lo que la sonda reporta. `degradado` **ausente** cuando todo responde: un `[]` obliga a mirar. */
export interface Salud {
  degradado?: string[];
}

export interface OpcionesSonda {
  /** La comprobación real. Lanza si no puede. En producción, `store.comprobarAcceso()`. */
  comprobar: () => Promise<unknown>;
  /** Cuánto vale un resultado antes de volver a preguntar. */
  ttlMs?: number;
  /** Cuánto se espera antes de darla por caída. Una base que tarda 30 s **está** caída para esto. */
  timeoutMs?: number;
  /** Dónde se escribe la transición. Por defecto `console.error` (stderr, que Railway sí recoge). */
  log?: (msg: string) => void;
  /** Inyectable para poder testear el TTL sin dormir. */
  ahora?: () => number;
}

/**
 * Los tres números, **con test propio cada uno**: son defaults de producción, y un default que solo
 * elige el test no fija el que corre en prod.
 */
export const TTL_SONDA_MS = 5_000;
export const TIMEOUT_SONDA_MS = 2_000;

/** El nombre de lo que se comprueba. Va en el cuerpo de `/_health` y en el log. */
export const DEPENDENCIA_BASE = "postgres";

export function crearSonda(opciones: OpcionesSonda): () => Promise<Salud> {
  const {
    comprobar,
    ttlMs = TTL_SONDA_MS,
    timeoutMs = TIMEOUT_SONDA_MS,
    log = (m: string) => console.error(m),
    ahora = () => Date.now(),
  } = opciones;

  let cacheHasta = -Infinity;
  let ultima: Salud = {};
  /** `null` = todavía no se comprobó nunca. Distinguirlo de `sano` evita anunciar una recuperación
   *  que nunca ocurrió en el primer chequeo exitoso del proceso. */
  let sanoAntes: boolean | null = null;
  /** Una sola comprobación en vuelo: diez requests concurrentes no abren diez transacciones. */
  let enVuelo: Promise<Salud> | null = null;

  async function medir(): Promise<Salud> {
    let salud: Salud;
    try {
      await conTimeout(comprobar(), timeoutMs);
      salud = {};
    } catch (e) {
      // El motivo va al log, NO al cuerpo: un mensaje de error de Postgres puede llevar el host, el
      // usuario o el nombre de la base, y `/_health` es público y anónimo.
      salud = { degradado: [DEPENDENCIA_BASE] };
      const motivo = e instanceof Error ? e.message : String(e);
      if (sanoAntes !== false) log(`[salud] DEGRADADO: ${DEPENDENCIA_BASE} no responde — ${motivo}`);
      sanoAntes = false;
      return salud;
    }
    if (sanoAntes === false) log(`[salud] recuperado: ${DEPENDENCIA_BASE} vuelve a responder`);
    sanoAntes = true;
    return salud;
  }

  return async function sonda(): Promise<Salud> {
    if (ahora() < cacheHasta) return ultima;
    if (enVuelo) return enVuelo;

    enVuelo = medir()
      .then((s) => {
        ultima = s;
        // El reloj arranca al TERMINAR, no al empezar: si la comprobación tardó cerca del timeout, un
        // TTL contado desde el inicio ya habría vencido al devolver y cada request mediría de nuevo.
        cacheHasta = ahora() + ttlMs;
        return s;
      })
      .finally(() => {
        enVuelo = null;
      });

    return enVuelo;
  };
}

/**
 * Un timeout que **no deja la promesa colgada**: si `p` nunca resuelve, el `setTimeout` rechaza igual.
 * El `unref()` es para que un temporizador pendiente no impida que el proceso (o un test) termine.
 */
function conTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`la comprobación no respondió en ${ms} ms`)), ms);
    if (typeof t.unref === "function") t.unref();
    p.then(resolve, reject).finally(() => clearTimeout(t));
  });
}

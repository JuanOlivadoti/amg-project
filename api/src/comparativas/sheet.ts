/**
 * Descarga del CSV-export de un Google Sheet compartido (Task 3 del módulo de comparativas).
 *
 * ## Por qué esto corre en el servidor y no en el navegador
 *
 * El resto del módulo convierte archivos (.xlsx/.csv) en el navegador a propósito, para que la API
 * nunca reciba un binario ajeno. El link de Google Sheet es la excepción, y por un motivo concreto:
 * **el navegador no puede bajarlo** — Google no manda `Access-Control-Allow-Origin` en el endpoint de
 * export, así que CORS lo bloquea. Lo que baja este archivo es texto CSV, no un binario: el resultado
 * de acá alimenta el mismo `parsearCsv` (Task 2, `filas.ts`) que consume lo que llega del navegador.
 *
 * ## Esto es código que sale a la red con un dato que escribe un usuario
 *
 * El link lo pega un usuario del portal. Las defensas son las mismas que ya aprendió
 * `renderer/src/snapshot.ts` (bajada de assets de terceros) y `renderer/src/cda.ts` (plazo real):
 *
 * - **Allowlist EXACTA de host** (`docs.google.com`), comparada contra un `Set` sobre
 *   `new URL(...).hostname` — nunca `includes`/`endsWith`, que un `evil.example` con el nombre bueno
 *   como subcadena podría colar.
 * - **`https:` obligatorio.**
 * - **Tope de bytes doble**: el que declara `content-length` (corta barato, sin leer el cuerpo) y el
 *   real, cortando el stream mientras llega. Un `content-length` mentido no puede saltarse el tope.
 * - **Plazo con `Promise.race`, no solo la señal**: un `signal` abortado no siempre corta un cuerpo
 *   que ya empezó a llegar (misma lección que `conPlazo` en `cda.ts`).
 * - **Redirecciones a mano** (`redirect: "manual"`), revalidando el host permitido en CADA salto: con
 *   `follow`, un host permitido que redirige se vuelve un permiso para cualquier destino.
 *
 * `MAX_BYTES_ENTRADA` se importa de `filas.ts` (Task 2) y no se redeclara acá: es el mismo tope de
 * producción que acota cuánto texto de una cotización ajena entra al prompt del LLM.
 */

import { MAX_BYTES_ENTRADA } from "./filas.js";

/** El único host del que se acepta bajar algo. Un Set: la comparación es de igualdad exacta. */
const HOSTS_PERMITIDOS = new Set(["docs.google.com"]);

/**
 * Saltos de redirección que se siguen, revalidando el host permitido en cada uno.
 *
 * Exportado por el mismo motivo que `PLAZO_DESCARGA_MS`: el único test que hoy toca redirecciones
 * prueba el camino RECHAZADO (un salto a un host ajeno), donde el tope da igual sin importar su
 * valor — no fija el número de producción.
 */
export const MAX_REDIRECCIONES = 5;

/**
 * Plazo para la respuesta COMPLETA, cuerpo incluido.
 *
 * Exportado a propósito: es lo que permite que `sheet.test.ts` fije el valor de producción por
 * literal, sin pasar por `deps.plazoMs` (que solo fija que el mecanismo de inyección funciona, no
 * qué corre en prod — la lección de `renderer/src/snapshot.ts`, `describe("los defaults de
 * producción del snapshot", …)`).
 */
export const PLAZO_DESCARGA_MS = 15_000;

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface DepsSheet {
  /** `fetch` inyectable: es lo que permite probar la descarga entera sin red ni credenciales. */
  fetch?: FetchLike;
  /** Plazo por descarga, en ms. Default `PLAZO_DESCARGA_MS`. Existe para que el test del plazo no
   * tenga que esperar los 15 s reales — mismo criterio que `plazoMs` en `renderer/src/snapshot.ts`. */
  plazoMs?: number;
}

export type ResultadoSheet = { ok: true; csv: string } | { ok: false; motivo: string };

/**
 * De un link de Google Sheet a la URL de export CSV, o `null` si el link no pasa la allowlist.
 *
 * No es un fetch de propósito general: solo entiende la forma
 * `https://docs.google.com/spreadsheets/d/<ID>/...` y descarta cualquier otra cosa, aunque sea una
 * URL válida — un host que no sea `docs.google.com`, un esquema que no sea `https:`, o un path que no
 * tenga la forma de un Sheet.
 */
export function urlDeExport(link: string): string | null {
  let u: URL;
  try {
    u = new URL(link);
  } catch {
    return null;
  }

  if (u.protocol !== "https:") return null;
  if (!HOSTS_PERMITIDOS.has(u.hostname)) return null;

  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(u.pathname);
  if (!m) return null;
  const id = m[1];
  if (!id) return null;

  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/export?format=csv`;
}

/** ¿Esta URL de redirección sigue pasando la allowlist? Mismo criterio que `urlDeExport`. */
function hostPermitido(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "no es una URL válida";
  }
  if (u.protocol !== "https:") return "no es https";
  if (!HOSTS_PERMITIDOS.has(u.hostname)) return `host no permitido (${u.hostname})`;
  return null;
}

/**
 * Baja el CSV-export de un Google Sheet compartido.
 *
 * **Aborta con `ok: false`**, nunca lanza: un link malo, un Sheet no compartido, o un CSV mal
 * formado (eso lo detecta recién `parsearCsv`, más adelante en el pipeline, no acá) son casos
 * esperados de la entrada de un usuario, no fallos del programa.
 */
export async function bajarSheet(link: string, deps: DepsSheet = {}): Promise<ResultadoSheet> {
  const url = urlDeExport(link);
  if (!url) {
    return {
      ok: false,
      motivo: "El link no es de un Google Sheet válido: tiene que ser un https://docs.google.com/spreadsheets/d/….",
    };
  }

  const hacer = deps.fetch ?? ((u: string, init?: RequestInit) => fetch(u, init));
  const plazoMs = deps.plazoMs ?? PLAZO_DESCARGA_MS;

  const ac = new AbortController();
  let temporizador: NodeJS.Timeout | undefined;
  const vencimiento = new Promise<never>((_, rej) => {
    temporizador = setTimeout(() => {
      ac.abort();
      rej(new Error(`No se pudo bajar el Sheet: no completó en ${plazoMs} ms.`));
    }, plazoMs);
  });

  try {
    // El plazo se corre contra un `Promise.race` y no solo con la señal: un `signal` abortado no
    // interrumpe una lectura de cuerpo que ya está en curso. Misma lección que `conPlazo` en
    // `renderer/src/cda.ts` — lo que garantiza el plazo es la carrera; la señal además libera el socket.
    return await Promise.race([seguir(), vencimiento]);
  } catch (e) {
    return { ok: false, motivo: (e as Error).message };
  } finally {
    clearTimeout(temporizador);
  }

  async function seguir(): Promise<ResultadoSheet> {
    let actual = url as string;
    for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
      // `redirect: "manual"`: con `follow`, el destino final de una redirección no pasaría por la
      // allowlist, y un host permitido que redirige se convierte en un permiso para cualquier otro.
      const res = await hacer(actual, { signal: ac.signal, redirect: "manual" });

      if (res.status >= 300 && res.status < 400) {
        const destino = res.headers.get("location");
        if (!destino) return { ok: false, motivo: `Google respondió una redirección (${res.status}) sin Location.` };
        const siguiente = new URL(destino, actual).toString();
        const rechazo = hostPermitido(siguiente);
        if (rechazo) return { ok: false, motivo: `la redirección lleva a un destino no permitido: ${rechazo}` };
        actual = siguiente;
        continue;
      }

      if (res.status === 403) {
        // Desde afuera un 403 no distingue "el Sheet no existe" de "existe pero no está compartido":
        // los dos dan el mismo código. El mensaje cubre los dos casos a la vez — mandar al usuario a
        // buscar el error equivocado (por ejemplo, decirle "no existe" cuando sí existe pero está
        // privado) es peor que no distinguir.
        return {
          ok: false,
          motivo:
            "No se pudo bajar el Sheet: no existe, o no está compartido (tiene que estar accesible " +
            "como 'cualquiera con el enlace' para poder leerlo).",
        };
      }

      if (!res.ok) {
        return { ok: false, motivo: `Google respondió ${res.status} al bajar el Sheet.` };
      }

      // El `content-length` lo declara quien sirve: se mira primero para cortar barato, y después se
      // cuenta lo que llega de verdad. Un valor mentido no puede saltarse el tope real.
      const declarado = Number(res.headers.get("content-length") ?? "");
      if (Number.isFinite(declarado) && declarado > MAX_BYTES_ENTRADA) {
        return {
          ok: false,
          motivo: `El Sheet declara ${declarado} bytes y el máximo aceptado es ${MAX_BYTES_ENTRADA}.`,
        };
      }

      return leerAcotado(res);
    }
    return { ok: false, motivo: `Más de ${MAX_REDIRECCIONES} redirecciones al bajar el Sheet.` };
  }
}

/**
 * Lee el cuerpo como texto, cortando por bytes **mientras llega**.
 *
 * Un tope aplicado después de `res.text()` no es un tope: ya se recibió el archivo entero. Con el
 * stream se cancela la descarga en el chunk que la excede. Si el runtime (o un mock de test) no
 * expone `body`, se cae a `res.text()` y el tope se comprueba igual sobre el resultado — ahí lo que
 * corta de verdad, si hiciera falta, es el plazo de arriba.
 */
async function leerAcotado(res: Response): Promise<ResultadoSheet> {
  const body = res.body as ReadableStream<Uint8Array> | null | undefined;

  if (!body || typeof body.getReader !== "function") {
    const texto = await res.text();
    const bytes = Buffer.byteLength(texto, "utf8");
    if (bytes > MAX_BYTES_ENTRADA) {
      return { ok: false, motivo: `El Sheet pesa ${bytes} bytes y el máximo aceptado es ${MAX_BYTES_ENTRADA}.` };
    }
    return { ok: true, csv: texto };
  }

  const reader = body.getReader();
  const trozos: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES_ENTRADA) {
      await reader.cancel(); // se corta: no se sigue pagando ancho de banda ni memoria
      return { ok: false, motivo: `El Sheet supera el tope de ${MAX_BYTES_ENTRADA} bytes.` };
    }
    trozos.push(value);
  }
  return { ok: true, csv: Buffer.concat(trozos).toString("utf8") };
}

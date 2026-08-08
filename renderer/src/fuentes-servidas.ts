import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { manifiesto } from "web-builder/fuentes";

/**
 * Las tipografías, servidas desde **nuestro** dominio.
 *
 * ## La pregunta del proyecto: si me lo toman, ¿qué se llevan?
 *
 * Ésta es la primera ruta del renderizador que sirve algo que no es HTML generado, y el renderizador
 * es la **única pieza expuesta a internet anónimo** (ADR-19). La respuesta tiene que ser "unos
 * archivos de fuente que ya son públicos", y para que sea cierta de verdad —y no una intención— la
 * ruta **no toca el filesystem con lo que pida quien llama**:
 *
 * 1. Al arrancar se leen los `.woff2` del manifiesto **a memoria**, una vez.
 * 2. En cada petición se busca el nombre en un `Map`. Si no está, 404.
 *
 * No hay `path.join`, no hay `readFile(req.params.x)`, no hay `..` que normalizar. **No hay path que
 * atravesar**: `/_assets/fonts/../../etc/passwd` no es un caso especial que haya que acordarse de
 * cubrir, es simplemente una clave que no está en el `Map`. Un test lo comprueba igual, porque la
 * garantía tiene que poder caerse si alguien reescribe esto con `readFile`.
 *
 * ## Por qué se lee al arrancar y no por petición
 *
 * Son 148 KB en total: cabe de sobra en memoria y ahorra un `readFile` por visita en el proceso que
 * atiende a todos los clientes. Y sobre todo, **falla al arrancar** si un archivo no está, en vez de
 * dar 500 en la web de un cliente tres semanas después.
 */

/**
 * El nombre público → los bytes. Se llena una vez, al construir.
 *
 * `ArrayBuffer` y no `Buffer` porque es lo que espera la capa HTTP, y convertir por petición sería
 * copiar 25 KB en cada visita para nada. La conversión se hace una vez, al cargar.
 */
export type FuentesServidas = ReadonlyMap<string, ArrayBuffer>;

const DIR = fileURLToPath(new URL("../../web-builder/assets/fonts/", import.meta.url));

/**
 * Lee a memoria los archivos que el manifiesto declara.
 *
 * **Falla cerrado**: si falta uno, lanza al arrancar. Un renderizador que arranca sirviendo 404 en
 * una fuente es peor que uno que no arranca, porque el fallo aparece en la web del cliente y no en el
 * despliegue.
 */
export function cargarFuentes(): FuentesServidas {
  const out = new Map<string, ArrayBuffer>();
  for (const [publico, archivo] of manifiesto()) {
    try {
      const buf = readFileSync(DIR + archivo);
      // El `slice` acota al tramo del Buffer: `buf.buffer` puede ser un pool compartido de Node y
      // servirlo entero filtraría bytes de otros archivos leídos antes. No es teórico: Node reutiliza
      // el pool para lecturas pequeñas.
      out.set(publico, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    } catch (e) {
      throw new Error(
        `No pude leer la fuente "${archivo}" (${DIR}). El manifiesto de web-builder la declara, así ` +
          `que servirla es parte del contrato: se aborta el arranque en vez de dar 404 en la web de ` +
          `un cliente. Causa: ${(e as Error).message}`,
      );
    }
  }
  return out;
}

/**
 * Un año, e `immutable`. Es honesto **porque el hash va en el nombre**: si el archivo cambia, cambia
 * la URL. Sin el hash, esta cabecera sería una promesa que no podríamos cumplir.
 */
export const CACHE_FUENTES = "public, max-age=31536000, immutable";

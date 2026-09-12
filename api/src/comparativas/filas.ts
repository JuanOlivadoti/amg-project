/**
 * Parser de CSV a filas, y los topes de entrada del módulo de comparativas de seguros.
 *
 * Lo que entra acá viene de dos caminos: un CSV que baja el servidor desde Google Sheets (Task 3),
 * o texto que el navegador ya convirtió de un .xlsx/.csv (Task 7, duplicado en `portal/` porque ese
 * paquete no puede importar de `api/`). En los dos casos el formato de las cotizaciones es LIBRE
 * —cada correduría trae sus propias columnas— así que esta función no interpreta el contenido: lo
 * convierte a filas sin tocarlo, o LANZA si el texto está malformado o truncado (una comilla que
 * abre y nunca cierra). No hay término medio: una comilla sin cerrar absorbe todo lo que sigue
 * —comas, saltos de línea, filas enteras— dentro de un único campo, y eso es corromper datos en
 * silencio, no una interpretación alternativa válida. Interpretar el contenido de un campo bien
 * formado es trabajo del provider de LLM (Task 4/5), no de este módulo — pero un campo que nunca
 * cerró no es un campo, y media comparativa que parece completa es peor que un error explícito.
 *
 * Por qué a mano y no una dependencia: es una máquina de estados de un carácter (RFC 4180 mínimo:
 * comillas, comillas escapadas dobles, comas y saltos de línea dentro de un campo entrecomillado,
 * CRLF/LF mezclados), ~40 líneas. Un `split(",")` o una regex se rompen con el primer campo
 * entrecomillado que traiga una coma — es exactamente el bug que los tests de este módulo existen
 * para impedir. El proyecto ya rechazó una dependencia externa para un caso análogo (parseo de PDF,
 * 2026-08-07) por el mismo razonamiento.
 *
 * `MAX_FILAS` y `MAX_BYTES_ENTRADA` son topes de PRODUCCIÓN: acotan cuánto texto de una cotización
 * ajena entra al prompt del LLM (costo y contexto), no un detalle de implementación del parser.
 *
 * Este módulo NO despoja el BOM de UTF-8: los dos llamadores reales (`fetch(...).text()` en el
 * server, `File.text()` en el navegador) ya lo hacen por el propio algoritmo de decodificación de
 * UTF-8. Agregarlo acá sería resolver dos veces lo mismo — verificado, no solo asumido.
 */

export type Filas = string[][];

/** Filas máximas que acepta una comparativa. Encima de esto, `validarFilas` rechaza. */
export const MAX_FILAS = 200;

/** Bytes máximos del texto de entrada, antes de parsear. Lo aplica quien lee el CSV (Task 3/7). */
export const MAX_BYTES_ENTRADA = 512 * 1024;

/**
 * Convierte texto CSV a filas de campos, con máquina de estados de un carácter (dentro/fuera de
 * comillas). No interpreta el contenido de los campos: los devuelve tal como vienen — o LANZA si el
 * texto termina con una comilla abierta sin cerrar, en vez de fusionar en silencio todo lo que
 * quedó atrapado adentro (que puede incluir filas enteras que venían después).
 */
export function parsearCsv(texto: string): Filas {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = "";
  let dentroDeComillas = false;
  // Línea física (1-indexada, cuenta saltos de línea tal cual aparecen en el texto crudo, dentro o
  // fuera de comillas) donde abrió la comilla actualmente sin cerrar — solo se usa para el mensaje
  // de error si el texto termina sin cerrarla.
  let linea = 1;
  let lineaComillaAbierta = 0;

  const cerrarCampo = () => {
    fila.push(campo);
    campo = "";
  };
  const cerrarFila = () => {
    cerrarCampo();
    filas.push(fila);
    fila = [];
  };

  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];

    if (dentroDeComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          // comilla escapada: "" dentro de un campo entrecomillado es una comilla literal
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeComillas = false;
        i += 1;
        continue;
      }
      // cualquier otro carácter, INCLUIDO \n y \r, es parte literal del campo entrecomillado
      if (c === "\n") {
        linea += 1;
      }
      campo += c;
      i += 1;
      continue;
    }

    if (c === '"') {
      dentroDeComillas = true;
      lineaComillaAbierta = linea;
      i += 1;
      continue;
    }
    if (c === ",") {
      cerrarCampo();
      i += 1;
      continue;
    }
    if (c === "\r") {
      cerrarFila();
      i += texto[i + 1] === "\n" ? 2 : 1;
      linea += 1;
      continue;
    }
    if (c === "\n") {
      cerrarFila();
      i += 1;
      linea += 1;
      continue;
    }

    campo += c;
    i += 1;
  }

  // Una comilla que nunca cerró absorbió todo lo que vino después dentro de un único campo —incluida,
  // potencialmente, una fila entera— y devolver eso como si fueran filas válidas es corromper datos
  // en silencio: `validarFilas` nunca se entera de que faltan filas. Fallar acá, con la línea donde
  // abrió, en vez de inventar una interpretación.
  if (dentroDeComillas) {
    throw new Error(`CSV inválido: comilla sin cerrar abierta en la línea ${lineaComillaAbierta}.`);
  }

  // la última línea puede no traer salto de línea final: si quedó algo pendiente, cierra la fila
  if (campo.length > 0 || fila.length > 0) {
    cerrarFila();
  }

  return filas;
}

/**
 * Aplica el tope de `MAX_FILAS` sobre filas ya parseadas. El tope de `MAX_BYTES_ENTRADA` se aplica
 * antes, sobre el texto crudo (quien llama a `parsearCsv` lo mide ahí) — acá ya no hay bytes, hay
 * filas.
 */
export function validarFilas(filas: Filas): { ok: true; filas: Filas } | { ok: false; motivo: string } {
  if (filas.length > MAX_FILAS) {
    return {
      ok: false,
      motivo: `Se recibieron ${filas.length} filas; el máximo permitido es ${MAX_FILAS}.`,
    };
  }
  return { ok: true, filas };
}

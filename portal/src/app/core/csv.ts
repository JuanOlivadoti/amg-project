/**
 * Parser de CSV a filas — DUPLICADO a propósito de `api/src/comparativas/filas.ts` (`parsearCsv`).
 *
 * Por qué existe una copia y no un import: `portal/` está fuera del monorepo a propósito (su
 * toolchain no se mezcla con la de los seis workspaces) y no puede importar `api/` en tiempo de
 * build. La decisión de Juan del 2026-09-12 (Task 7) es que el navegador convierte la hoja a
 * `string[][]` y la API nunca recibe un binario — así que el parser de CSV tiene que correr acá
 * también, byte por byte igual al del servidor.
 *
 * La duplicación NO se sostiene con este comentario: se sostiene con el test cruzado en
 * `api/src/comparativas/filas.test.ts`, que importa este archivo por ruta, en runtime, y exige el
 * MISMO resultado que `parsearCsv` sobre el mismo cuerpo de casos (`CASOS_CSV`,
 * `CASOS_CSV_INVALIDOS`). Si alguien cambia un solo carácter acá sin tocar el otro lado, ese test
 * cae — no hace falta acordarse de sincronizar nada a mano.
 *
 * Este módulo es PURO a propósito: nada de `@angular/*`, nada de la librería de `.xlsx`. El test
 * cruzado lo importa con `import()` dinámico desde Node, y si este archivo arrastrara una librería
 * pensada para el navegador (como la de `.xlsx`, que vive en `hoja-a-filas.ts`), ese `import` podría
 * reventar antes de probar nada. Por eso el parser de `.xlsx` está en otro archivo.
 */

export type Filas = string[][];

/**
 * Convierte texto CSV a filas de campos, con una máquina de estados de un carácter
 * (dentro/fuera de comillas) — RFC 4180 mínimo: comillas, comillas escapadas dobles, comas y
 * saltos de línea dentro de un campo entrecomillado, CRLF/LF mezclados. No interpreta el contenido
 * de los campos: los devuelve tal como vienen — o LANZA si el texto termina con una comilla abierta
 * sin cerrar, en vez de fusionar en silencio todo lo que quedó atrapado adentro (que puede incluir
 * filas enteras que venían después). Ver `api/src/comparativas/filas.ts` para el razonamiento
 * completo: el algoritmo tiene que ser IDÉNTICO, así que la explicación no se repite acá.
 */
export function parsearCsvPortal(texto: string): Filas {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let dentroDeComillas = false;
  let linea = 1;
  let lineaComillaAbierta = 0;

  const cerrarCampo = () => {
    fila.push(campo);
    campo = '';
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
          campo += '"';
          i += 2;
          continue;
        }
        dentroDeComillas = false;
        i += 1;
        continue;
      }
      if (c === '\n') {
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
    if (c === ',') {
      cerrarCampo();
      i += 1;
      continue;
    }
    if (c === '\r') {
      cerrarFila();
      i += texto[i + 1] === '\n' ? 2 : 1;
      linea += 1;
      continue;
    }
    if (c === '\n') {
      cerrarFila();
      i += 1;
      linea += 1;
      continue;
    }

    campo += c;
    i += 1;
  }

  if (dentroDeComillas) {
    throw new Error(`CSV inválido: comilla sin cerrar abierta en la línea ${lineaComillaAbierta}.`);
  }

  if (campo.length > 0 || fila.length > 0) {
    cerrarFila();
  }

  return filas;
}

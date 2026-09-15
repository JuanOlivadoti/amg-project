/**
 * Convierte un archivo que sube el usuario (`.csv` o `.xlsx`) a `string[][]` — la forma que espera
 * `POST /clients/:id/comparativas-seguros`. Decisión de Juan del 2026-09-12, misma doctrina que el
 * PDF (2026-08-07: lo produce el navegador): **la API nunca recibe un binario**.
 *
 * `.csv` usa `parsearCsvPortal` de `./csv.ts` (duplicado a propósito del parser de `api/`, atado por
 * el test cruzado en `api/src/comparativas/filas.test.ts`). `.xlsx` usa `read-excel-file`.
 *
 * Por qué `read-excel-file` y no `xlsx` (SheetJS): SheetJS dejó de publicar en el registro de npm
 * después de la 0.18.5 (2022-03-24, más de cuatro años antes de esta tarea) y distribuye versiones
 * nuevas desde su propio CDN — lo que queda en npm arrastra avisos de seguridad resueltos fuera del
 * registro. `read-excel-file` en cambio: publicado activamente (9.3.10, agosto 2026), pensado para
 * navegador y Node por igual, sin script de instalación, y con pocas dependencias directas (saxen,
 * fflate, worker-f, unzipper-esm). El detalle que definió la elección del *import path*: `/browser`
 * usa Web Workers por defecto (arriesga el build de Angular sin tocar `angular.json`, y no corre en
 * `node:test`), así que se usa `/universal` — funciona en los dos entornos, no genera workers, y
 * acepta un `File` directamente porque `File extends Blob`.
 *
 * `exceljs` se evaluó y se descartó: última versión publicada en diciembre de 2024 (más vieja), y
 * nueve dependencias directas pensadas para Node (`archiver`, `tmp`, `unzipper`, `fast-csv`, …) para
 * un caso de uso que acá es solo LECTURA de un archivo que el usuario ya tiene en el navegador.
 * Comparación completa, con la salida de `npm view`, en el informe de esta tarea.
 */
import { readSheet } from 'read-excel-file/universal';
import { parsearCsvPortal } from './csv';

/**
 * Acepta `.csv` y `.xlsx` (se compara la extensión en minúsculas). Cualquier otra extensión LANZA
 * un error que nombra los dos formatos aceptados: un "no se pudo leer el archivo" manda al usuario
 * a adivinar cuál es el problema.
 */
export async function hojaAFilas(archivo: File): Promise<string[][]> {
  const nombre = archivo.name.toLowerCase();

  if (nombre.endsWith('.csv')) {
    return parsearCsvPortal(await archivo.text());
  }

  if (nombre.endsWith('.xlsx')) {
    // read-excel-file/universal, sin argumento de hoja, lee la PRIMERA hoja del archivo.
    const filas = await readSheet(archivo);
    return filas.map((fila) => fila.map(celdaATexto));
  }

  throw new Error(
    `Formato de archivo no soportado: "${archivo.name}". Se aceptan .csv y .xlsx.`,
  );
}

/**
 * Una celda de `.xlsx` puede ser `string`, `number`, `boolean`, `Date` o `null` (celda vacía) —
 * nunca `undefined` en la salida de esta función: una celda vacía se convierte en `''`, no se
 * descarta ni se filtra la fila, porque quien llama espera filas de igual forma que el CSV.
 */
function celdaATexto(valor: unknown): string {
  if (valor === null || valor === undefined) return '';
  if (valor instanceof Date) return valor.toISOString();
  return String(valor);
}

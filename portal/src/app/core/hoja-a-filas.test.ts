import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hojaAFilas } from './hoja-a-filas';

/**
 * `.xlsx` mínimo, dos filas, dos columnas: `[["corredora","precio"],["mapfre","120"]]`, con ambas
 * celdas tipadas `inlineStr` (texto) — así el valor de "precio" llega como `"120"` sin ambigüedad de
 * si `read-excel-file` lo interpretó como número o como texto.
 *
 * Se generó a mano (Content_Types, _rels, workbook, worksheet — el mínimo de partes que exige Open
 * XML) con un escritor de ZIP de ~60 líneas (método "stored", sin compresión) escrito para esta
 * tarea, y se verificó una vez con `read-excel-file/universal` antes de incrustarlo acá: no hay
 * ninguna dependencia nueva involucrada en generarlo, solo `node:zlib`-adjacent CRC32 casero. Va
 * embebido en base64 (y no como archivo binario aparte) para que el test no dependa de rutas de
 * fixtures ni de cómo el bundler de test resuelve assets binarios.
 */
const XLSX_MINIMO_BASE64 =
  'UEsDBBQAAAAAAAAAIQCwXVXTMwIAADMCAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4KPFR5cGVzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L2NvbnRlbnQtdHlwZXMiPgo8RGVmYXVsdCBFeHRlbnNpb249InJlbHMiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtcGFja2FnZS5yZWxhdGlvbnNoaXBzK3htbCIvPgo8RGVmYXVsdCBFeHRlbnNpb249InhtbCIgQ29udGVudFR5cGU9ImFwcGxpY2F0aW9uL3htbCIvPgo8T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC93b3JrYm9vay54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC5zaGVldC5tYWluK3htbCIvPgo8T3ZlcnJpZGUgUGFydE5hbWU9Ii94bC93b3Jrc2hlZXRzL3NoZWV0MS54bWwiIENvbnRlbnRUeXBlPSJhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQuc3ByZWFkc2hlZXRtbC53b3Jrc2hlZXQreG1sIi8+CjwvVHlwZXM+UEsDBBQAAAAAAAAAIQB+b8CFKgEAACoBAAALAAAAX3JlbHMvLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+CjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPgo8UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL29mZmljZURvY3VtZW50IiBUYXJnZXQ9InhsL3dvcmtib29rLnhtbCIvPgo8L1JlbGF0aW9uc2hpcHM+UEsDBBQAAAAAAAAAIQBxpp6iHQEAAB0BAAAPAAAAeGwvd29ya2Jvb2sueG1sPD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiIHN0YW5kYWxvbmU9InllcyI/Pgo8d29ya2Jvb2sgeG1sbnM9Imh0dHA6Ly9zY2hlbWFzLm9wZW54bWxmb3JtYXRzLm9yZy9zcHJlYWRzaGVldG1sLzIwMDYvbWFpbiIgeG1sbnM6cj0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL29mZmljZURvY3VtZW50LzIwMDYvcmVsYXRpb25zaGlwcyI+CjxzaGVldHM+PHNoZWV0IG5hbWU9IkhvamExIiBzaGVldElkPSIxIiByOmlkPSJySWQxIi8+PC9zaGVldHM+Cjwvd29ya2Jvb2s+UEsDBBQAAAAAAAAAIQBvJc8gKwEAACsBAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHM8P3htbCB2ZXJzaW9uPSIxLjAiIGVuY29kaW5nPSJVVEYtOCIgc3RhbmRhbG9uZT0ieWVzIj8+CjxSZWxhdGlvbnNoaXBzIHhtbG5zPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvcGFja2FnZS8yMDA2L3JlbGF0aW9uc2hpcHMiPgo8UmVsYXRpb25zaGlwIElkPSJySWQxIiBUeXBlPSJodHRwOi8vc2NoZW1hcy5vcGVueG1sZm9ybWF0cy5vcmcvb2ZmaWNlRG9jdW1lbnQvMjAwNi9yZWxhdGlvbnNoaXBzL3dvcmtzaGVldCIgVGFyZ2V0PSJ3b3Jrc2hlZXRzL3NoZWV0MS54bWwiLz4KPC9SZWxhdGlvbnNoaXBzPlBLAwQUAAAAAAAAACEA4MaiGJcBAACXAQAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbDw/eG1sIHZlcnNpb249IjEuMCIgZW5jb2Rpbmc9IlVURi04IiBzdGFuZGFsb25lPSJ5ZXMiPz4KPHdvcmtzaGVldCB4bWxucz0iaHR0cDovL3NjaGVtYXMub3BlbnhtbGZvcm1hdHMub3JnL3NwcmVhZHNoZWV0bWwvMjAwNi9tYWluIj4KPHNoZWV0RGF0YT4KPHJvdyByPSIxIj48YyByPSJBMSIgdD0iaW5saW5lU3RyIj48aXM+PHQ+Y29ycmVkb3JhPC90PjwvaXM+PC9jPjxjIHI9IkIxIiB0PSJpbmxpbmVTdHIiPjxpcz48dD5wcmVjaW88L3Q+PC9pcz48L2M+PC9yb3c+Cjxyb3cgcj0iMiI+PGMgcj0iQTIiIHQ9ImlubGluZVN0ciI+PGlzPjx0Pm1hcGZyZTwvdD48L2lzPjwvYz48YyByPSJCMiIgdD0iaW5saW5lU3RyIj48aXM+PHQ+MTIwPC90PjwvaXM+PC9jPjwvcm93Pgo8L3NoZWV0RGF0YT4KPC93b3Jrc2hlZXQ+UEsBAhQAFAAAAAAAAAAhALBdVdMzAgAAMwIAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAUAAAAAAAAACEAfm/AhSoBAAAqAQAACwAAAAAAAAAAAAAAAABkAgAAX3JlbHMvLnJlbHNQSwECFAAUAAAAAAAAACEAcaaeoh0BAAAdAQAADwAAAAAAAAAAAAAAAAC3AwAAeGwvd29ya2Jvb2sueG1sUEsBAhQAFAAAAAAAAAAhAG8lzyArAQAAKwEAABoAAAAAAAAAAAAAAAAAAQUAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQAFAAAAAAAAAAhAODGohiXAQAAlwEAABgAAAAAAAAAAAAAAAAAZAYAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAABQAFAEUBAAAxCAAAAAA=';

function archivoXlsxMinimo(): File {
  const bytes = Uint8Array.from(Buffer.from(XLSX_MINIMO_BASE64, 'base64'));
  return new File([bytes], 'comparativa.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function archivoCsv(texto: string, nombre = 'comparativa.csv'): File {
  return new File([texto], nombre, { type: 'text/csv' });
}

test('🔴 un .csv produce las filas esperadas', async () => {
  const filas = await hojaAFilas(archivoCsv('corredora,precio\nmapfre,"1.200,50"'));
  assert.deepEqual(filas, [
    ['corredora', 'precio'],
    ['mapfre', '1.200,50'],
  ]);
});

test('🔴 un .xlsx mínimo produce las filas de la primera hoja, todo como texto', async () => {
  const filas = await hojaAFilas(archivoXlsxMinimo());
  assert.deepEqual(filas, [
    ['corredora', 'precio'],
    ['mapfre', '120'],
  ]);
});

test('🔴 una extensión desconocida lanza un error que nombra los formatos aceptados', async () => {
  await assert.rejects(
    () => hojaAFilas(archivoCsv('a,b', 'comparativa.pdf')),
    /\.csv.*\.xlsx|\.xlsx.*\.csv/,
  );
});

test('el nombre de extensión se compara sin distinguir mayúsculas', async () => {
  const filas = await hojaAFilas(archivoCsv('a,b', 'COMPARATIVA.CSV'));
  assert.deepEqual(filas, [['a', 'b']]);
});

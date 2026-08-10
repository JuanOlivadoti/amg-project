import { test } from "node:test";
import assert from "node:assert/strict";
import { IDEAS_DEMO } from "db";
import { CLAVES_ANALISIS, esUrlHttp, validarCambiosIdea } from "./ideas-http.js";

/**
 * El seed de ideas de ejemplo (`db/src/seed-ideas-demo.ts`) contra el borde HTTP de las ideas.
 *
 * **Por qué este test vive en `api/` y no en `db/`:** `db` no puede importar de `api` —la dependencia
 * va al revés—, así que las dos puntas del contrato solo se tocan acá. Y por qué existe: el seed
 * inserta con la conexión de INFRAESTRUCTURA, saltándose entero el borde HTTP, así que nada más
 * comprueba lo que este archivo valida. Lo que la base mira de esos campos es el tamaño y el
 * `jsonb_typeof` (0013); el esquema de las URL y el vocabulario de `analisis` no los mira nadie.
 *
 * No levanta PGlite a propósito: son dos constantes y dos funciones puras. Cuesta milisegundos, y en
 * este paquete cada `beforeEach` que reconstruye el esquema cuesta casi un segundo.
 */

/** Las ideas del seed que ya vienen analizadas (la recién llegada tiene `analisis` vacío). */
const ANALIZADAS = IDEAS_DEMO.filter((i) => Object.keys(i.analisis).length > 0);

test("el seed produce al menos una idea analizada (si no, nada de este archivo mide algo)", () => {
  assert.ok(ANALIZADAS.length > 0);
});

/**
 * 🔴 El vocabulario del seed ⊆ el que admite la API, en las dos direcciones.
 *
 * Si el seed produjera una clave que `validarCambiosIdea` no admite, la pantalla de detalle cargaría
 * el análisis, lo reenviaría entero en un `PATCH` —`analisis` es un reemplazo total, no un merge— y
 * recibiría un 400 por un dato que ella misma acaba de leer. Y al revés: si el seed dejara de usar
 * una de las ocho, la Etapa 5 se escribiría sin haber visto nunca ese campo en pantalla.
 */
test("🔴 las claves de `analisis` del seed son EXACTAMENTE las ocho que admite la API", () => {
  const delSeed = new Set(ANALIZADAS.flatMap((i) => Object.keys(i.analisis)));

  const ajenas = [...delSeed].filter((k) => !CLAVES_ANALISIS.has(k));
  assert.deepEqual(ajenas, [], "el seed produce claves que un PATCH rechazaría con 400");

  const sinEjercitar = [...CLAVES_ANALISIS].filter((k) => !delSeed.has(k));
  assert.deepEqual(sinEjercitar, [], "hay claves admitidas que ninguna idea de ejemplo muestra");
});

/**
 * El camino real de la Etapa 5: la pantalla lee el detalle y reenvía el análisis al guardar. Esto lo
 * ejercita con la función de verdad en vez de comparar conjuntos a mano, que es lo que haría que el
 * test siguiera pasando si la validación cambiara de forma (por ejemplo, mirando también los valores).
 */
test("🔴 reenviar el análisis del seed en un PATCH lo acepta el validador", () => {
  for (const idea of ANALIZADAS) {
    const r = validarCambiosIdea({ analisis: idea.analisis });
    assert.equal(r.ok, true, `'${idea.titulo}': ${r.ok ? "" : r.error}`);
  }
});

/**
 * 🔴 Las URL del seed son http(s).
 *
 * El portal las pinta en un `<a href>` y en un `<audio src>`, donde `javascript:` es XSS y
 * `data:text/html` es una página entera bajo el origen de quien la abra. `validarCambiosIdea` lo
 * exige a quien mande un `PATCH`, pero el seed no pasa por ahí: entra por debajo, con la autoridad de
 * la infraestructura. Si alguien sembrara un `file://` o un `javascript:` "para probar", esto cae.
 */
test("🔴 las URL sembradas son http(s): el seed entra por debajo del validador de la API", () => {
  let comprobadas = 0;
  for (const idea of IDEAS_DEMO) {
    for (const url of [idea.audio_url, idea.carpeta_url]) {
      if (url === null) continue;
      comprobadas++;
      assert.ok(esUrlHttp(url), `'${idea.titulo}' siembra una URL que no es http(s): ${url}`);
    }
  }
  assert.ok(comprobadas > 0, "sin URL sembradas el bucle no comprobó ninguna");
});

/**
 * El dashboard del portal y el seed cuentan el MISMO brief — atado por test.
 *
 * ## Por qué existe (y por qué el comentario que decía que era imposible estaba equivocado)
 *
 * `portal/src/app/core/cartera-mock.ts` tenía escrito: *"El portal vive fuera del monorepo
 * (ADR-16/21), así que esto es una copia que ningún test puede atar al seed"*. Y el 2026-08-01 pasó
 * exactamente lo que esa frase dejaba pasar: el seed cambió sus 14 keywords —`f0c1387`, que las trajo
 * de Storyblok— y el mock se quedó con las viejas. Producción terminó mostrando **las mismas métricas
 * con nombres distintos** en dos pantallas a dos clics: "cerveza Ale Ogham Madrid — 74" en Cartera y
 * "hamburgueseria chamberi — 74" en Research. La suite entera en verde.
 *
 * Estar fuera del monorepo impide **importar el paquete**; no impide **leer el archivo**. `cartera-mock.ts`
 * es un módulo puro (solo tipos y una constante), así que se carga con un `import()` dinámico y se
 * compara. La ruta se arma en runtime a propósito: `tsc` no la resuelve estáticamente, así que el
 * typecheck de `db` no se lleva medio portal por delante.
 *
 * Es el mismo criterio que ya ataba el perfil del negocio entre el seed y
 * `web-builder/business-profile.json`. Faltaba el otro extremo del hilo.
 *
 * ## Contra qué compara, y por qué cambió (otra vez)
 *
 * Hasta el 2026-08-07 esto comparaba el mock contra **`PAGINAS_DEMO`**, la fuente del seed en
 * TypeScript — y hasta esa fecha alcanzaba, porque el `insert` de `sembrarDemo` copiaba
 * `PAGINAS_DEMO` en crudo: fuente y fila decían lo mismo. Desde la `0017` el insert TRADUCE al
 * vocabulario del contrato antes de escribir (`comercial` → `commercial`, ver
 * `db/src/seed-demo.ts` § `aPaginaPropuesta`), así que la fuente y la fila **dejaron de coincidir** en
 * `intencion`. Comparar contra `PAGINAS_DEMO` seguía en verde con el mock sosteniendo el español viejo
 * mientras la fila real ya decía inglés — la red dejó de ver exactamente la deriva que existe para
 * atajar.
 *
 * Por eso ahora se compara contra **la fila real de `kr_pages`**, leída bajo RLS con el mismo rol
 * (`app_user`/staff) con el que la API la serviría — no contra la fuente en TypeScript ni con
 * `asService` (que saltaría RLS y probaría un camino que el portal nunca usa). Es el mismo criterio
 * que ya usa `seed-demo.test.ts` para todo lo que siembra: no "el insert corrió", sino "esto es lo que
 * un usuario autenticado ve".
 *
 * `tipo` y `evidencia` NO se traducen — `PageType`/`PageEvidence` del contrato ya están en español
 * (`contrato/src/tipos.ts`) — así que para esos dos campos comparar contra la fila real o contra
 * `PAGINAS_DEMO` da lo mismo. Solo `intencion` (vía `SearchIntent`, en inglés) y `page_strategy` (que
 * `PaginaDelPortal` ni siquiera trae) divergen. Se compara igual la fila completa, no solo `intencion`
 * a mano, para que un futuro campo traducido caiga acá sin tener que acordarse de él.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { TestDb } from "./testdb.js";
import { ConexionReservada } from "./deploy.js";
import {
  CALIDAD_DATOS_DEMO,
  COSTE_MICROS_DEMO,
  DEMO_CLIENT_ID,
  DEMO_RUN_ID,
  PAGINAS_DEMO,
  sembrarDemo,
} from "./seed-demo.js";

interface PaginaDelPortal {
  readonly keyword: string;
  readonly slug: string;
  readonly tipo: string;
  readonly intencion: string;
  readonly local: boolean;
  readonly volumen: number | null;
  readonly dificultad: number | null;
  readonly score: number;
  readonly confianza: number;
}

/** Lo mínimo del `RunSummary` del portal que hace falta acá. Se declara, no se importa: `db` no depende de `portal`. */
interface RunDelPortal {
  readonly id: string;
  readonly calidad_datos: Record<string, unknown>;
}

interface MockDelPortal {
  readonly PAGINAS_REALES: readonly PaginaDelPortal[];
  readonly CLIENTE_REAL: {
    readonly clientId: string;
    readonly runId: string;
    readonly nombre: string;
    readonly costeMicros: number;
  };
  readonly generarCarteraMock: () => {
    readonly clientes: readonly { readonly client_id: string; readonly runs: readonly RunDelPortal[] }[];
  };
}

/** Una fila de `kr_pages`, con los nombres de columna reales (no los del mock del portal). */
interface FilaKrPages {
  url_slug: string;
  keyword_principal: string;
  tipo: string;
  intencion: string;
  local: boolean;
  volumen: number | null;
  dificultad: number | null;
  evidencia: string;
  opportunity_score: number;
  score_confidence: number;
}

/**
 * Ruta armada en runtime: `tsc` no la sigue, `tsx` sí. Ver el encabezado.
 *
 * `RUTA_MOCK` (el path crudo, para el mensaje de error) y la URL que de verdad se le pasa a
 * `import()` no son la misma cadena: pasar un path absoluto crudo (`C:\...`) directo a `import()`
 * lanza en Windows ("Only URLs with a scheme in: file, data, and node are supported"). Por eso acá
 * se usa `pathToFileURL(RUTA_MOCK).href` y no `RUTA_MOCK` a secas.
 */
const RUTA_MOCK = fileURLToPath(new URL("../../portal/src/app/core/cartera-mock.ts", import.meta.url));

const cargarMock = async (): Promise<MockDelPortal> => {
  try {
    return (await import(pathToFileURL(RUTA_MOCK).href)) as MockDelPortal;
  } catch (e) {
    throw new Error(
      `no pude cargar el mock del dashboard en ${RUTA_MOCK}: ${(e as Error).message}\n` +
        "Si el portal se movió, actualizá la ruta — pero NO borres este test: es lo único que impide " +
        "que el dashboard y el brief vuelvan a contar dos historias distintas.",
    );
  }
};

/** Frank: rol `maestro` en el tenant de la demo — el mismo con el que un `equipo`/`maestro` vería esto en el portal. */
const FRANK = "11111111-1111-1111-1111-111111111111";
const JUAN = "22222222-2222-2222-2222-222222222222";

/** PGlite es una sola conexión → una `ConexionReservada` válida para sembrar en los tests. */
const con = (db: TestDb) => ConexionReservada.desdePglite(db.pglite);

let db: TestDb;
let runId: string;
let tenantId: string;
/** Las 14 páginas de `kr_pages`, en el orden del brief (`orden_brief`) — el mismo orden que `PAGINAS_DEMO`. */
let filasReales: FilaKrPages[];

before(async () => {
  db = await TestDb.create();
  const r = await sembrarDemo(con(db), { frankUserId: FRANK, juanUserId: JUAN });
  runId = r.runId;
  tenantId = r.tenantId;

  filasReales = await db.asUser<FilaKrPages>(
    { tenantId: r.tenantId, userId: FRANK },
    // Sin `order by orden_brief` explícito no habría garantía de orden — `PAGINAS_REALES` del portal
    // se compara POSICIÓN a POSICIÓN contra esto, así que el orden es parte de lo que se prueba (KR-3).
    `select url_slug, keyword_principal, tipo, intencion, local, volumen, dificultad, evidencia,
            opportunity_score::float8 as opportunity_score,
            score_confidence::float8 as score_confidence
       from kr_pages
      where run_id = $1
      order by orden_brief asc nulls last`,
    [r.runId],
  );
});

after(async () => {
  await db.close();
});

test("el dashboard grafica exactamente las páginas que siembra el seed (comparado contra la FILA real, no la fuente TS)", async () => {
  const { PAGINAS_REALES } = await cargarMock();

  assert.equal(
    PAGINAS_REALES.length,
    filasReales.length,
    `\`kr_pages\` tiene ${filasReales.length} páginas y el dashboard ${PAGINAS_REALES.length}`,
  );

  // En orden: el dashboard grafica "Top oportunidades" en el orden en que las recibe, y la fila trae
  // `orden_brief`. Que coincida el conjunto pero no el orden sería otro tipo de deriva.
  //
  // Los pares [campo del mock, campo de la fila] — los nombres NO coinciden 1:1 (`slug` vs.
  // `url_slug`, `score` vs. `opportunity_score`, `confianza` vs. `score_confidence`), así que
  // comparar los objetos enteros con `deepEqual` no serviría.
  const CAMPOS: readonly [keyof PaginaDelPortal, keyof FilaKrPages][] = [
    ["slug", "url_slug"],
    ["keyword", "keyword_principal"],
    ["tipo", "tipo"],
    ["intencion", "intencion"],
    ["local", "local"],
    ["volumen", "volumen"],
    ["dificultad", "dificultad"],
    ["score", "opportunity_score"],
    ["confianza", "score_confidence"],
  ];

  for (const [i, dePortal] of PAGINAS_REALES.entries()) {
    const deLaFila = filasReales[i];
    assert.ok(deLaFila, `sobra la página ${i} en el dashboard: ${dePortal.slug}`);
    for (const [campoPortal, campoFila] of CAMPOS) {
      assert.deepEqual(
        dePortal[campoPortal],
        deLaFila[campoFila],
        `página ${i} (${deLaFila.url_slug}): el dashboard dice ${campoPortal}=${JSON.stringify(dePortal[campoPortal])} ` +
          `y \`kr_pages\`.${campoFila}=${JSON.stringify(deLaFila[campoFila])} — si es \`intencion\`, el mock sigue en ` +
          "español mientras la fila (desde la 0017) ya tradujo al vocabulario del contrato: portal/src/app/core/cartera-mock.ts",
      );
    }
  }
});

test("el split 8 respaldadas / 6 sin validar es el mismo de los dos lados", async () => {
  const { PAGINAS_REALES } = await cargarMock();

  // En la fila la evidencia es una columna propia; en el portal se deriva de tener volumen. Que las
  // dos formas de decirlo coincidan es justo lo que hace que el brief y el dashboard etiqueten igual.
  const respaldadasFila = filasReales.filter((p) => p.evidencia === "datos_mercado");
  const respaldadasPortal = PAGINAS_REALES.filter((p) => p.volumen !== null);

  assert.equal(respaldadasFila.length, 8, "el split real de la acción 06 es 8/6");
  assert.equal(respaldadasPortal.length, respaldadasFila.length);
  assert.deepEqual(
    respaldadasPortal.map((p) => p.slug),
    respaldadasFila.map((p) => p.url_slug),
    "las respaldadas no son las mismas páginas de los dos lados",
  );
});

/**
 * 🔴 La calidad de datos, atada igual que las páginas.
 *
 * Este test **no existía**, y la spec de KR-2b afirmaba que este archivo ya ataba esto: compara nueve
 * campos de PÁGINA y de `calidad_datos` no dice nada. Sin él, cambiar la calidad en un lado deja las
 * dos copias del dato diciendo cosas distintas y nada avisa — el mismo fallo del 2026-08-01 con las
 * keywords, en otro campo.
 *
 * Lo que ataja es el dato, no un pixel, y conviene no exagerarlo: hoy **ninguna plantilla del portal
 * lee `calidad_datos`** (medido con grep sobre `portal/src/app`: solo aparece en el tipo `RunSummary`,
 * en este mock y en un spec). La pantalla que lo va a pintar es de otra tarea, así que este test llega
 * ANTES de que haya deriva que mirar — que es cuándo sirve.
 *
 * **Se lee a través de `generarCarteraMock()`, no de una constante exportada**, y eso es la mitad del
 * test: `calidad_datos` vive DENTRO de `runReal()` (una función no exportada), así que lo único que
 * prueba que el dashboard muestra esto es observar el objeto que el dashboard recibe. Comparar contra
 * una constante exportada dejaría pasar exactamente la deriva que importa —alguien vuelve a poner un
 * literal en `runReal()` y la constante sigue diciendo la verdad—. (El brief de la tarea pedía un
 * `RUN_REAL` exportado, que no existe.)
 *
 * `calidad_datos` no pasa por la traducción de la 0017 (no es un campo de `kr_pages`, y `kr_runs` no
 * tiene ningún `check` de vocabulario sobre esa columna JSON), así que comparar contra la constante
 * `CALIDAD_DATOS_DEMO` sigue siendo válido acá — a diferencia de `intencion`, no hay una fila que la
 * traduzca por debajo.
 */
test("🔴 el seed y el mock del portal dicen lo MISMO en `calidad_datos`", async () => {
  const { generarCarteraMock } = await cargarMock();

  const cliente = generarCarteraMock().clientes.find((c) => c.client_id === DEMO_CLIENT_ID);
  const run = cliente?.runs.find((x) => x.id === DEMO_RUN_ID);
  assert.ok(run, `el mock ya no trae el run ${DEMO_RUN_ID} del cliente real ${DEMO_CLIENT_ID}`);

  assert.deepEqual(
    run.calidad_datos,
    CALIDAD_DATOS_DEMO,
    "la calidad de datos que muestra el portal es la que siembra el seed",
  );
});

test("los IDs fijos y el coste del cliente de la demo son los mismos que siembra el seed", async () => {
  const { CLIENTE_REAL } = await cargarMock();

  // Si estos IDs divergen, el dashboard enlaza a un run que no existe: la fila que Frank abre en la
  // demo lo lleva a un 404, y eso no lo ve ningún test de la API ni del portal por separado.
  assert.equal(CLIENTE_REAL.clientId, DEMO_CLIENT_ID);
  assert.equal(CLIENTE_REAL.runId, DEMO_RUN_ID);
  assert.equal(CLIENTE_REAL.costeMicros, COSTE_MICROS_DEMO);

  // Y que los IDs comparados arriba sean efectivamente los que el seed de ESTE test sembró — si no,
  // las dos aserciones de arriba podrían coincidir por casualidad con constantes que nadie sembró acá.
  assert.equal(runId, DEMO_RUN_ID);
  assert.ok(tenantId, "el seed de este archivo sembró un tenant");
  // PAGINAS_DEMO se sigue usando como referencia de longitud/orden esperado — es la fuente en
  // TypeScript, y su longitud no la toca la traducción de la 0017 (solo el VALOR de dos campos).
  assert.equal(filasReales.length, PAGINAS_DEMO.length);
});

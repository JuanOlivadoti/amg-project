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
 * "hamburgueseria barrio salamanca — 74" en Research. La suite entera en verde.
 *
 * Estar fuera del monorepo impide **importar el paquete**; no impide **leer el archivo**. `cartera-mock.ts`
 * es un módulo puro (solo tipos y una constante), así que se carga con un `import()` dinámico y se
 * compara. La ruta se arma en runtime a propósito: `tsc` no la resuelve estáticamente, así que el
 * typecheck de `db` no se lleva medio portal por delante.
 *
 * Es el mismo criterio que ya ataba el perfil del negocio entre el seed y
 * `web-builder/business-profile.json`. Faltaba el otro extremo del hilo.
 *
 * ## Qué ata de verdad, desde la 0017 — porque ya no es lo mismo que la fila
 *
 * Ata el mock contra **`PAGINAS_DEMO`**, que es la fuente del seed, no contra lo que queda escrito en
 * `kr_pages`. Hasta el 2026-08-07 la distinción no existía: el insert copiaba `PAGINAS_DEMO` en crudo,
 * así que fuente y fila decían lo mismo. Desde la `0017` el insert traduce al vocabulario del contrato
 * (`comercial` → `commercial`), y entonces **el mock coincide con la fuente y difiere de la fila**.
 *
 * Para los 8 campos que este test compara eso da igual salvo en uno: **`intencion`**. El mock dice
 * `comercial` y la API devuelve `commercial`, y este test no lo puede ver porque los dos lados que
 * compara son el mismo eslabón. O sea: **la red contra la deriva dashboard↔brief dejó de cubrir
 * `intencion`**, y decirlo acá es la mitad del arreglo.
 *
 * La otra mitad no es de este archivo: la pantalla de Cartera se alimenta hoy de `generarCarteraMock()`
 * y no de la API, así que no hay nada roto que ver en el navegador. El día que se conecte,
 * `portal/src/app/pages/cartera/cartera-tabla.ts` pinta `{{ p.intencion }}` crudo y la columna dirá
 * inglés. Cerrarlo cruza `db/` y `portal/`, y necesita que se decida antes dónde vive el mapa de
 * etiquetas — que es una decisión de producto, no de este test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  CALIDAD_DATOS_DEMO,
  COSTE_MICROS_DEMO,
  DEMO_CLIENT_ID,
  DEMO_RUN_ID,
  PAGINAS_DEMO,
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

/** Ruta armada en runtime: `tsc` no la sigue, `tsx` sí. Ver el encabezado. */
const RUTA_MOCK = fileURLToPath(new URL("../../portal/src/app/core/cartera-mock.ts", import.meta.url));

const cargarMock = async (): Promise<MockDelPortal> => {
  try {
    return (await import(RUTA_MOCK)) as MockDelPortal;
  } catch (e) {
    throw new Error(
      `no pude cargar el mock del dashboard en ${RUTA_MOCK}: ${(e as Error).message}\n` +
        "Si el portal se movió, actualizá la ruta — pero NO borres este test: es lo único que impide " +
        "que el dashboard y el brief vuelvan a contar dos historias distintas.",
    );
  }
};

test("el dashboard grafica exactamente las páginas que siembra el seed", async () => {
  const { PAGINAS_REALES } = await cargarMock();

  assert.equal(
    PAGINAS_REALES.length,
    PAGINAS_DEMO.length,
    `el seed tiene ${PAGINAS_DEMO.length} páginas y el dashboard ${PAGINAS_REALES.length}`,
  );

  // En orden: el dashboard grafica "Top oportunidades" en el orden en que las recibe, y el seed las
  // tiene ordenadas por score. Que coincida el conjunto pero no el orden sería otro tipo de deriva.
  for (const [i, dePortal] of PAGINAS_REALES.entries()) {
    const delSeed = PAGINAS_DEMO[i];
    assert.ok(delSeed, `sobra la página ${i} en el dashboard: ${dePortal.slug}`);
    for (const campo of ["slug", "keyword", "tipo", "intencion", "local", "volumen", "dificultad", "score", "confianza"] as const) {
      assert.deepEqual(
        dePortal[campo],
        delSeed[campo],
        `página ${i} (${delSeed.slug}): el dashboard dice ${campo}=${JSON.stringify(dePortal[campo])} y el seed ${JSON.stringify(delSeed[campo])}`,
      );
    }
  }
});

test("el split 8 respaldadas / 6 sin validar es el mismo de los dos lados", async () => {
  const { PAGINAS_REALES } = await cargarMock();

  // En el seed la evidencia es una columna propia; en el portal se deriva de tener volumen. Que las
  // dos formas de decirlo coincidan es justo lo que hace que el brief y el dashboard etiqueten igual.
  const respaldadasSeed = PAGINAS_DEMO.filter((p) => p.evidencia === "datos_mercado");
  const respaldadasPortal = PAGINAS_REALES.filter((p) => p.volumen !== null);

  assert.equal(respaldadasSeed.length, 8, "el split real de la acción 06 es 8/6");
  assert.equal(respaldadasPortal.length, respaldadasSeed.length);
  assert.deepEqual(
    respaldadasPortal.map((p) => p.slug),
    respaldadasSeed.map((p) => p.slug),
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
});

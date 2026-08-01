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
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { COSTE_MICROS_DEMO, DEMO_CLIENT_ID, DEMO_RUN_ID, PAGINAS_DEMO } from "./seed-demo.js";

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

interface MockDelPortal {
  readonly PAGINAS_REALES: readonly PaginaDelPortal[];
  readonly CLIENTE_REAL: {
    readonly clientId: string;
    readonly runId: string;
    readonly nombre: string;
    readonly costeMicros: number;
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

test("los IDs fijos y el coste del cliente de la demo son los mismos que siembra el seed", async () => {
  const { CLIENTE_REAL } = await cargarMock();

  // Si estos IDs divergen, el dashboard enlaza a un run que no existe: la fila que Frank abre en la
  // demo lo lleva a un 404, y eso no lo ve ningún test de la API ni del portal por separado.
  assert.equal(CLIENTE_REAL.clientId, DEMO_CLIENT_ID);
  assert.equal(CLIENTE_REAL.runId, DEMO_RUN_ID);
  assert.equal(CLIENTE_REAL.costeMicros, COSTE_MICROS_DEMO);
});

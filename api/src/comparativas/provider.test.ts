import { describe, it, test } from "node:test";
import assert from "node:assert";
import { getComparativaProvider } from "./provider.js";
import { PREFIJO_MOCK_COMPARATIVA } from "./mock-provider.js";
import { MAX_BYTES_ENTRADA } from "./filas.js";
import {
  MAX_COSTO_USD,
  OpenAIComparativaProvider,
  costoEstimadoUsd,
  type ClienteChatOpenAi,
} from "./openai-provider.js";

/**
 * Datos de fixture para los tests. Misma estructura que saldría de parsearCsv:
 * array de filas, cada fila es un array de celdas.
 */
const FILAS = [
  ["Mapfre", "Responsabilidad Civil", "1200", "Hasta 1M", "Sin restricciones", "Cobertura estándar"],
  ["AXA", "Responsabilidad Civil Plus", "1500", "Hasta 2M", "Deducible 500€", "Mejor cobertura"],
  ["Zurich", "Básica", "900", "Hasta 500K", "", ""],
];

/** Alias con el nombre que usa el brief de la Task 5 — mismo fixture que `FILAS` de arriba. */
const FILAS_OK = FILAS;

/**
 * Entrada deliberadamente enorme (~3.5M caracteres): mucho más que `MAX_BYTES_ENTRADA` (el tope que
 * aplica Task 2 al leer el CSV), a propósito — este provider no vuelve a aplicar ese tope, así que el
 * test tiene que poder construir una entrada que lo supere para ejercitar el preflight de costo como
 * una segunda capa independiente. Con la tabla de precios de `gpt-4o-mini`, esto estima muy por
 * encima de `MAX_COSTO_USD` bajo cualquier ratio caracteres/token razonable (3 o 4).
 */
function filasEnormes(): string[][] {
  const celdaEnorme = "x".repeat(1000);
  return Array.from({ length: 3500 }, () => [celdaEnorme]);
}

/** Cliente falso que siempre responde el mismo JSON (envuelto en el shape de OpenAI). Nunca sale a
 *  la red: es la única forma de inyectar un cliente en `OpenAIComparativaProvider`. */
function clienteQueDevuelve(json: unknown): ClienteChatOpenAi {
  return {
    crear: async () => ({
      choices: [{ message: { content: JSON.stringify(json) } }],
      usage: { prompt_tokens: 100, completion_tokens: 100 },
    }),
  };
}

const OPCION_VALIDA = { aseguradora: "Mapfre", producto: "RC", prima: 300, cobertura: "1M" };
const COMPARATIVA_VALIDA = {
  confianza: "alta",
  recomendacion: "Mapfre por precio",
  informeMd: "## Informe",
  mailAsunto: "Tu comparativa",
  mailCuerpoMd: "Cuerpo del mail",
  opciones: [OPCION_VALIDA],
};

test("el mock es determinista: dos llamadas iguales dan lo mismo", async () => {
  const p = getComparativaProvider("mock");
  const resultado1 = await p.generar(FILAS, "Ana");
  const resultado2 = await p.generar(FILAS, "Ana");
  assert.deepEqual(resultado1, resultado2);
});

test("🔴 el informe del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(c.informeMd.includes(PREFIJO_MOCK_COMPARATIVA));
});

test("🔴 el asunto del mail del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(
    c.mailAsunto.includes(PREFIJO_MOCK_COMPARATIVA),
    "el mail se copia literalmente al cliente final sin pasar por la vista del informe: " +
      "el asunto tiene que llevar la marca de mock igual que el informe",
  );
});

test("🔴 el cuerpo del mail del mock se identifica como mock", async () => {
  const c = await getComparativaProvider("mock").generar(FILAS, "Ana");
  assert.ok(
    c.mailCuerpoMd.includes(PREFIJO_MOCK_COMPARATIVA),
    "el mail se copia literalmente al cliente final sin pasar por la vista del informe: " +
      "el cuerpo tiene que llevar la marca de mock igual que el informe",
  );
});

test("el mock no cuesta nada", async () => {
  assert.equal((await getComparativaProvider("mock").generar(FILAS, "Ana")).costoUsd, 0);
});

// ---------------------------------------------------------------------------------------------
// Task 5: el provider real de OpenAI, el preflight de gasto, y la regla de fallar en vez de
// inventar. Todo lo de acá abajo corre con un cliente inyectado: NINGÚN test sale a la red ni
// gasta un céntimo — ver `clienteQueDevuelve` y el cliente que cuenta llamadas.
// ---------------------------------------------------------------------------------------------

test("🔴 el selector 'openai' devuelve el provider real, ya cableado", () => {
  // No se llama a .generar() acá: instanciarlo no debe salir a la red ni gastar. Esto es lo que
  // wireea Task 5 en provider.ts — antes de este cambio, "openai" lanzaba "no implementado aún".
  assert.ok(getComparativaProvider("openai") instanceof OpenAIComparativaProvider);
});

test("🔴 el preflight aborta ANTES de llamar: con entrada gigante, el cliente NUNCA se invoca", async () => {
  let llamadas = 0;
  const p = new OpenAIComparativaProvider({
    crear: async () => {
      llamadas++;
      throw new Error("no debió llamarse");
    },
  });
  await assert.rejects(() => p.generar(filasEnormes(), "Ana"), /presupuesto/i);
  assert.equal(llamadas, 0, "el preflight existe para NO gastar, no para informar después de gastar");
});

test("con entrada normal, el preflight SÍ deja pasar y el cliente se invoca", async () => {
  let llamadas = 0;
  const p = new OpenAIComparativaProvider({
    crear: async () => {
      llamadas++;
      return { choices: [{ message: { content: JSON.stringify(COMPARATIVA_VALIDA) } }] };
    },
  });
  const c = await p.generar(FILAS_OK, "Ana");
  assert.equal(llamadas, 1);
  assert.equal(c.opciones.length, 1);
});

test("🔴 confianza baja produce ERROR, no un informe a medias", async () => {
  const p = new OpenAIComparativaProvider(clienteQueDevuelve({ confianza: "baja", opciones: [] }));
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /confianza/i);
});

test("🔴 confianza ausente o distinta de 'alta' también rechaza (fail-closed, no solo 'baja' literal)", async () => {
  const p = new OpenAIComparativaProvider(
    clienteQueDevuelve({ ...COMPARATIVA_VALIDA, confianza: "media" }),
  );
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /confianza/i);
});

test("🔴 una opción sin aseguradora invalida la comparativa ENTERA", async () => {
  const p = new OpenAIComparativaProvider(
    clienteQueDevuelve({
      ...COMPARATIVA_VALIDA,
      opciones: [
        { aseguradora: "Mapfre", prima: "300" },
        { aseguradora: "", prima: "250" },
      ],
    }),
  );
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /aseguradora/i);
});

test("🔴 una opción sin prima invalida la comparativa ENTERA", async () => {
  const p = new OpenAIComparativaProvider(
    clienteQueDevuelve({
      ...COMPARATIVA_VALIDA,
      opciones: [{ aseguradora: "Mapfre", producto: "RC" }],
    }),
  );
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /prima/i);
});

test("🔴 una opción con prima 0 invalida la comparativa ENTERA (no es un dato real)", async () => {
  const p = new OpenAIComparativaProvider(
    clienteQueDevuelve({
      ...COMPARATIVA_VALIDA,
      opciones: [{ aseguradora: "Mapfre", prima: 0 }],
    }),
  );
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /prima/i);
});

test("🔴 una opción con prima negativa invalida la comparativa ENTERA", async () => {
  const p = new OpenAIComparativaProvider(
    clienteQueDevuelve({
      ...COMPARATIVA_VALIDA,
      opciones: [{ aseguradora: "Mapfre", prima: -300 }],
    }),
  );
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"), /prima/i);
});

test("🔴 cero opciones también es error: 'no encontré nada' no se guarda como comparativa", async () => {
  const p = new OpenAIComparativaProvider(clienteQueDevuelve({ confianza: "alta", opciones: [] }));
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"));
});

test("🔴 texto suelto (no JSON) nunca produce una comparativa", async () => {
  const p = new OpenAIComparativaProvider({
    crear: async () => ({ choices: [{ message: { content: "Claro, acá va tu comparativa:" } }] }),
  });
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"));
});

test("un JSON envuelto en un bloque de markdown SÍ se acepta (el envoltorio no es el contenido)", async () => {
  const p = new OpenAIComparativaProvider({
    crear: async () => ({
      choices: [{ message: { content: "```json\n" + JSON.stringify(COMPARATIVA_VALIDA) + "\n```" } }],
    }),
  });
  const c = await p.generar(FILAS_OK, "Ana");
  assert.equal(c.opciones.length, 1);
});

test("🔴 JSON malformado (una llave que no cierra) nunca produce una comparativa", async () => {
  const p = new OpenAIComparativaProvider({
    crear: async () => ({ choices: [{ message: { content: '{"confianza": "alta"' } }] }),
  });
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"));
});

test("🔴 sin contenido en la respuesta, nunca produce una comparativa", async () => {
  const p = new OpenAIComparativaProvider({
    crear: async () => ({ choices: [{ message: { content: null } }] }),
  });
  await assert.rejects(() => p.generar(FILAS_OK, "Ana"));
});

test("una opción con prima como string numérico ('300') se acepta: no es inventar, es el mismo dato", async () => {
  const p = new OpenAIComparativaProvider(
    clienteQueDevuelve({ ...COMPARATIVA_VALIDA, opciones: [{ aseguradora: "Mapfre", prima: "300" }] }),
  );
  const c = await p.generar(FILAS_OK, "Ana");
  assert.equal(c.opciones[0]?.prima, 300);
});

test("el costo real se calcula del `usage` de la respuesta, no de la estimación del preflight", async () => {
  const p = new OpenAIComparativaProvider({
    crear: async () => ({
      choices: [{ message: { content: JSON.stringify(COMPARATIVA_VALIDA) } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    }),
  });
  const c = await p.generar(FILAS_OK, "Ana");
  // gpt-4o-mini: 1000*0.15/1e6 + 500*0.6/1e6 = 0.00015 + 0.0003 = 0.00045
  assert.ok(Math.abs(c.costoUsd - 0.00045) < 1e-9, `costoUsd inesperado: ${c.costoUsd}`);
});

describe("costoEstimadoUsd", () => {
  it("calcula el costo con la tarifa del modelo conocido", () => {
    const c = costoEstimadoUsd({ prompt_tokens: 1_000_000, completion_tokens: 0 }, "gpt-4o-mini");
    assert.equal(c, 0.15);
  });

  it("🔴 devuelve null para un modelo sin tarifa conocida, en vez de inventar un número", () => {
    assert.equal(costoEstimadoUsd({ prompt_tokens: 1, completion_tokens: 1 }, "modelo-inexistente"), null);
  });
});

describe("los defaults de producción de openai-provider.ts", () => {
  it("🔴 MAX_COSTO_USD es 0.10 — literal, sin pasar por el constructor ni ningún parámetro inyectable", () => {
    // Ningún test de este archivo pasa MAX_COSTO_USD como argumento: todos importan la constante
    // exportada. Si algún día el constructor la recibiera como parámetro con este valor de default,
    // este test dejaría de fijar lo que corre en producción (el error que ya pasó tres veces con
    // PLAZO_DESCARGA_MS / MAX_REDIRECCIONES — CHECKPOINTS.md).
    assert.equal(MAX_COSTO_USD, 0.1);
  });

  it(
    "🔴 una carga del tamaño MÁXIMO permitido por Task 2 (MAX_BYTES_ENTRADA) nunca dispara el " +
      "preflight con el modelo por defecto: las dos capas de defensa no se pisan",
    () => {
      // El preflight de este módulo es una SEGUNDA capa, independiente del tope de bytes que aplica
      // quien lee el CSV (Task 2/3). Si esta consistencia se rompiera silenciosamente (por ejemplo,
      // alguien sube MAX_BYTES_ENTRADA sin revisar MAX_COSTO_USD), una carga perfectamente legítima
      // empezaría a rechazarse siempre — y este test es el que se entera.
      const textoDelTamañoMaximo = "x".repeat(MAX_BYTES_ENTRADA);
      const tokensEstimados = Math.ceil(textoDelTamañoMaximo.length / 3); // mismo ratio que el preflight
      const costo = costoEstimadoUsd(
        { prompt_tokens: tokensEstimados, completion_tokens: 2000 },
        "gpt-4o-mini",
      );
      assert.ok(costo != null && costo < MAX_COSTO_USD, `costo estimado ${costo} debería ser < ${MAX_COSTO_USD}`);
    },
  );
});

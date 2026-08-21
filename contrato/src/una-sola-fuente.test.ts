import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CARACTERES_ESCAPADOS_EN_INFORME, texto } from "./informe.js";

/*
 * La deuda que KR-2a cierra: el contrato del brief vivía en DOS archivos copiados a mano
 * (`kr-service/src/validation/brief.schema.ts` y la mitad de `web-builder/src/contract.ts`), así que
 * cambiar uno dejaba el otro mintiendo sin que nada avisara.
 *
 * Este test DESCUBRE los archivos en vez de listarlos, así que también cubre el paquete que alguien
 * agregue mañana. Es el mismo patrón que usa el portal para los colores incrustados.
 */
const raiz = fileURLToPath(new URL("../..", import.meta.url));

/**
 * El único paquete que PUEDE definir el esquema del brief: es el punto entero de la regla.
 *
 * Los demás no se listan acá: se leen de los `workspaces` de la raíz. Una lista escrita a mano no
 * cubre "el paquete que alguien agregue mañana" — se queda vieja en silencio, que es el mismo modo
 * de fallo (una copia que nadie sincroniza) que este test existe para cerrar.
 */
const DUENO = "contrato";

/** Dependencias y salidas generadas: barrerlas es ruido, y `node_modules` además es enorme. */
const IGNORADOS = new Set(["node_modules", "dist", "out", ".cache", ".git"]);

function paquetesABarrer(): string[] {
  const { workspaces } = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")) as {
    workspaces?: string[];
  };
  assert.ok(workspaces, "la raíz tiene que declarar `workspaces`: sin eso este test no barre nada");
  return workspaces.filter((p) => p !== DUENO);
}

/**
 * Los `.ts` de un paquete: `src/` si lo tiene (la convención de los siete) y, si no, el paquete
 * entero. El fallback es para que un paquete con otro layout no se escape del barrido sin avisar.
 */
function archivosTs(paquete: string): string[] {
  const src = join(raiz, paquete, "src");
  return recorrer(existsSync(src) ? src : join(raiz, paquete));
}

function recorrer(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir)) {
    if (IGNORADOS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) salida.push(...recorrer(p));
    else if (e.endsWith(".ts")) salida.push(p);
  }
  return salida;
}

test("ningún paquete define su propio esquema Zod del brief", () => {
  const culpables: string[] = [];
  for (const paq of paquetesABarrer()) {
    for (const archivo of archivosTs(paq)) {
      const src = readFileSync(archivo, "utf8");
      // La firma de un esquema de brief propio: un z.object con `paginas_propuestas` adentro.
      if (/z\s*\.\s*object\s*\(/.test(src) && /paginas_propuestas\s*:/.test(src)) {
        culpables.push(archivo.slice(raiz.length));
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `el contrato del brief se define fuera de \`contrato\`:\n  ${culpables.join("\n  ")}`,
  );
});

/*
 * El cerrojo del cerrojo, y no es paranoia decorativa: un barrido que no encuentra NINGÚN archivo
 * pasa, y pasaría para siempre. Si `workspaces` cambia de forma, si `src/` se mueve o si `IGNORADOS`
 * se come un paquete, el test de arriba se vuelve verde permanente sin que nada avise — y un guard
 * que nadie verifica es una intención, no un guard. Acá se fija el piso.
 */
/*
 * El barrido de arriba solo ve un mirror de ESQUEMA (un `z.object` copiado). Esta es otra clase de
 * mirror, y la que la deuda de Bloque I señalaba como hueco: un ALFABETO de caracteres, duplicado
 * entre quien genera el escapado (`texto()`, acá en `informe.ts`) y quien lo tiene que deshacer
 * (`parsearInline`, en `portal/src/app/core/markdown.ts`, fuera del monorepo — ADR-21, no se importa,
 * se LEE, mismo criterio que `db/src/cartera-portal.test.ts`). Si alguien agrega un carácter escapable
 * de un lado y no del otro, un LLM que lo use en el informe real queda con la barra de escape visible
 * (`\|` en vez de `|`) o, peor, un desescapado que no debía pasar.
 */
test("CARACTERES_ESCAPADOS_EN_INFORME coincide con lo que texto() escapa de verdad", () => {
  // Ata la CONSTANTE contra el REGEX real: sin esto, la constante es solo documentación que nadie
  // verifica y puede quedarse vieja el día que alguien edite el regex de `texto()` sin tocarla.
  for (const c of CARACTERES_ESCAPADOS_EN_INFORME) {
    assert.equal(texto(c), `\\${c}`, `\`texto()\` tiene que escapar '${c}' — está en la constante`);
  }
  // Y el negativo: un carácter cualquiera que NO está en la lista no se toca.
  assert.ok(!CARACTERES_ESCAPADOS_EN_INFORME.includes("x"), "control positivo de la propia lista");
  assert.equal(texto("x"), "x", "'x' no está en CARACTERES_ESCAPADOS_EN_INFORME: no debe escaparse");
});

test("ESCAPABLES del portal reconoce exactamente los mismos caracteres que escapa el informe", async () => {
  const RUTA_MARKDOWN = fileURLToPath(new URL("../../portal/src/app/core/markdown.ts", import.meta.url));
  let ESCAPABLES: string;
  try {
    ({ ESCAPABLES } = (await import(pathToFileURL(RUTA_MARKDOWN).href)) as { ESCAPABLES: string });
  } catch (e) {
    throw new Error(
      `no pude cargar el parser del portal en ${RUTA_MARKDOWN}: ${(e as Error).message}\n` +
        "Si el portal se movió, actualizá la ruta — pero NO borres este test: es lo único que ata el " +
        "alfabeto de escape entre el generador y el parser.",
    );
  }

  // El generador escapa la barra `\` aparte (primero, para no escaparse a sí misma dos veces), así
  // que no está en `CARACTERES_ESCAPADOS_EN_INFORME` — pero el parser SÍ tiene que reconocerla como
  // escapable (para desescapar `\\` de vuelta a `\`). Por eso se suma acá, no en la constante de
  // producción: la constante documenta el regex de `texto()` tal cual está escrito.
  const esperado = new Set(["\\", ...CARACTERES_ESCAPADOS_EN_INFORME]);
  const real = new Set(ESCAPABLES);

  assert.deepEqual(
    [...real].sort(),
    [...esperado].sort(),
    `ESCAPABLES del portal (${JSON.stringify(ESCAPABLES)}) y el alfabeto que informe.ts escapa ` +
      `(${JSON.stringify([...esperado].join(""))}) tienen que ser el mismo conjunto`,
  );
});

test("el barrido cubre de verdad los paquetes del monorepo (uno vacío pasaría siempre)", () => {
  const paqs = paquetesABarrer();
  for (const conocido of ["kr-service", "web-builder", "orchestrator", "api", "renderer", "db"]) {
    assert.ok(paqs.includes(conocido), `${conocido} quedó fuera del barrido`);
  }
  assert.ok(!paqs.includes(DUENO), "`contrato` no se barre: es el dueño del esquema");
  for (const paq of paqs) {
    assert.ok(archivosTs(paq).length > 0, `no se barrió ningún .ts de ${paq}`);
  }
});

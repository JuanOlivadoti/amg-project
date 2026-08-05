import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

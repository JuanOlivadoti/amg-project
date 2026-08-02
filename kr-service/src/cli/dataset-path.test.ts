import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DATASET_PATH_DEFAULT, datasetPath } from "./dataset-path.js";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * ¿Git ignoraría esta ruta?
 *
 * `git check-ignore -q` es determinista, no toca la red y consulta las MISMAS reglas que decidieron
 * el destino del dataset de la corrida real: exit 0 = ignorada, 1 = no ignorada. Cualquier otro
 * código es un fallo de la herramienta y se trata como tal (no como "no ignorada").
 */
function gitIgnora(ruta: string): boolean {
  const r = spawnSync("git", ["check-ignore", "-q", ruta], { cwd: RAIZ });
  if (r.error) throw r.error;
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(`git check-ignore devolvió ${r.status}: ${r.stderr?.toString() ?? ""}`);
  }
  return r.status === 0;
}

const esRepoGit = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: RAIZ }).status === 0;

/**
 * 🔴 EL TEST QUE HABRÍA CAZADO EL BUG ORIGINAL.
 *
 * El dataset crudo de la corrida real del 2026-07-30 se escribió en `out/keywords.json`, y `out/`
 * está en `.gitignore`. El repo se clonó, el directorio no viajó, y los datos por los que se pagaron
 * ~$0.31 desaparecieron. La tanda 4 lo persistió justamente para que *"ajustar scoring/clustering
 * sea offline y gratis"*, y esa promesa quedó impagable.
 *
 * Nada en el código decía "este destino tiene que sobrevivir a un clon". Ahora sí, y lo dice
 * consultando a git, no a un comentario.
 */
test("🔴 el destino por defecto del dataset NO cae en un directorio ignorado por git", (t) => {
  if (!esRepoGit) return t.skip("no es un repo git: no hay reglas de ignore que consultar");

  // Control positivo: si `gitIgnora` estuviera rota (git ausente, cwd equivocado, flag mal puesto),
  // la aserción de abajo pasaría por vacío. Esto prueba que el mecanismo DETECTA de verdad.
  assert.equal(gitIgnora(join(RAIZ, "out", "keywords.json")), true, "control: out/ sí está ignorado");

  assert.equal(
    gitIgnora(DATASET_PATH_DEFAULT),
    false,
    `${relative(RAIZ, DATASET_PATH_DEFAULT)} está gitignoreado: el dataset no sobreviviría a un clon`,
  );
});

/**
 * Se prueba con un archivo DENTRO del directorio, no con el directorio a secas: `git check-ignore`
 * sobre una ruta sin barra final no la trata como directorio si no existe, así que una regla
 * `datasets/` pasaría desapercibida. Y el README es el archivo que de verdad se commitea ahí: si
 * quedara ignorado, el directorio no existiría en un clon y el dataset volvería a no tener casa.
 */
test("🔴 el README que documenta el directorio del dataset es commiteable", (t) => {
  if (!esRepoGit) return t.skip("no es un repo git");
  assert.equal(gitIgnora(join(dirname(DATASET_PATH_DEFAULT), "README.md")), false);
});

test("el destino por defecto es absoluto y cuelga de la raíz del repo, no del cwd", () => {
  assert.ok(isAbsolute(DATASET_PATH_DEFAULT), "absoluto: no depende de desde dónde se lance el CLI");
  assert.equal(DATASET_PATH_DEFAULT, join(RAIZ, "datasets", "keywords.json"));
  assert.ok(
    !relative(RAIZ, DATASET_PATH_DEFAULT).startsWith(".."),
    "tiene que estar DENTRO del repo, o no se versiona nada",
  );
});

// ---------------------------------------------------------------- la variable de entorno

test("KR_DATASET_PATH manda sobre el default", () => {
  const previo = process.env["KR_DATASET_PATH"];
  try {
    process.env["KR_DATASET_PATH"] = join(RAIZ, "otro", "sitio.json");
    assert.equal(datasetPath(), join(RAIZ, "otro", "sitio.json"));
  } finally {
    if (previo === undefined) delete process.env["KR_DATASET_PATH"];
    else process.env["KR_DATASET_PATH"] = previo;
  }
});

test("KR_DATASET_PATH relativa se resuelve a absoluta; vacía o en blanco cae al default", () => {
  const previo = process.env["KR_DATASET_PATH"];
  try {
    process.env["KR_DATASET_PATH"] = `sub${sep}d.json`;
    assert.ok(isAbsolute(datasetPath()));
    assert.ok(datasetPath().endsWith(`sub${sep}d.json`));

    for (const vacio of ["", "   "]) {
      process.env["KR_DATASET_PATH"] = vacio;
      assert.equal(datasetPath(), DATASET_PATH_DEFAULT, `"${vacio}" no es un destino: se usa el default`);
    }
  } finally {
    if (previo === undefined) delete process.env["KR_DATASET_PATH"];
    else process.env["KR_DATASET_PATH"] = previo;
  }
});

test("sin KR_DATASET_PATH, datasetPath() es el default", () => {
  const previo = process.env["KR_DATASET_PATH"];
  delete process.env["KR_DATASET_PATH"];
  try {
    assert.equal(datasetPath(), DATASET_PATH_DEFAULT);
  } finally {
    if (previo !== undefined) process.env["KR_DATASET_PATH"] = previo;
  }
});

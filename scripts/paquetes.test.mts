import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * `npm test` y `npm run typecheck` de la raíz corren con `--workspaces --if-present`: un paquete que
 * NO declara esos scripts se saltea EN SILENCIO y el arnés informa verde igual. Este test es la única
 * cosa que impide que un workspace nuevo quede fuera de la verificación sin que nada avise.
 *
 * Lo pidió la 14ª review externa, que lo encontró como riesgo del paquete `contrato/`.
 */
// `fileURLToPath`, no `.pathname`: en Windows el pathname trae la barra inicial delante de la
// unidad (`/C:/...`), y `join("/C:/...", "package.json")` da `C:\C:\...` — mismo defecto que ya
// tenían las ataduras por `import()` de otros archivos, acá en un `readFileSync`.
const raiz = fileURLToPath(new URL("..", import.meta.url));
const workspaces = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).workspaces as string[];

test("todo workspace declara `test` y `typecheck`", () => {
  assert.ok(workspaces.length > 0, "el package.json de la raíz no declara workspaces");
  for (const w of workspaces) {
    const pkg = JSON.parse(readFileSync(join(raiz, w, "package.json"), "utf8"));
    for (const script of ["test", "typecheck"]) {
      assert.ok(
        typeof pkg.scripts?.[script] === "string",
        `${w}/package.json no declara el script "${script}": ` +
          `--if-present lo saltearía y quedaría fuera del verde`,
      );
    }
  }
});

test("`contrato` está declarado como workspace", () => {
  assert.ok(
    workspaces.includes("contrato"),
    `el paquete compartido tiene que estar en workspaces; hoy: ${workspaces.join(", ")}`,
  );
});

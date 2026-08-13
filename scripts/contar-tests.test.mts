import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { contarTests } from "./contar-tests.mts";

/*
 * El contador de tests del arnés. El bug que estos tests fijan: `verificar.sh` contaba con
 * `grep -hE '^# pass'`, Node 24 cambió el reporter por defecto de `tap` a `spec` (`ℹ pass 34`), y el
 * arnés empezó a imprimir `[OK] 0 tests en verde` — verde, con la cifra en cero.
 *
 * Los dos primeros tests son los formatos MEDIDOS el 2026-08-05 en esta máquina. El último es el que
 * no envejece: corre el runner de verdad y exige que el formato que imprime el Node de hoy se pueda
 * contar. Si Node 26 vuelve a cambiarlo, ese test se pone rojo en la máquina donde pasa, en vez de
 * degradar la cifra en silencio.
 */

// Copiado literal de la salida de `node --test` bajo v22.21.1 (reporter tap).
const LOG_TAP = `TAP version 13
ok 1 - un test que pasa
  ---
  duration_ms: 1.5
  ...
1..1
# tests 34
# suites 0
# pass 34
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 179.1765
`;

// Copiado literal de la salida de `node --test` bajo v24.18.1 (reporter spec).
const LOG_SPEC = `✔ un test que pasa (0.227709ms)
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 110.468875
`;

test("cuenta el formato `tap`, que es el que imprime Node 22", () => {
  const c = contarTests(LOG_TAP);
  assert.ok(c.ok, `debería poder contar: ${c.ok ? "" : c.motivo}`);
  assert.equal(c.total, 34);
  assert.equal(c.resumenes, 1);
});

test("🔴 cuenta el formato `spec`, que es el que imprime Node 24", () => {
  // Éste es el test que el patrón viejo (`^# pass`) NO pasaba: daba 0 y lo reportaba en verde.
  const c = contarTests(LOG_SPEC);
  assert.ok(c.ok, `debería poder contar: ${c.ok ? "" : c.motivo}`);
  assert.equal(c.total, 34);
  assert.equal(c.resumenes, 1);
});

test("suma los resúmenes de todos los paquetes: `npm test --workspaces` concatena sus logs", () => {
  const c = contarTests(`${LOG_SPEC}\n${LOG_TAP}\n${LOG_SPEC}`);
  assert.ok(c.ok);
  assert.equal(c.total, 34 * 3);
  assert.equal(c.resumenes, 3);
});

test("🔴 un log sin línea de resumen NO devuelve 0: devuelve que no pudo contar", () => {
  // El piso. Es la mitad que importa: cubre el formato que todavía no existe, no el que ya se midió.
  const c = contarTests("✔ un test que pasa (0.2ms)\nalgo que no es un resumen\n");
  assert.equal(c.ok, false);
  assert.match(c.ok ? "" : c.motivo, /no encontré ninguna línea de resumen/);
});

test("🔴 resúmenes que suman 0 tampoco son verde", () => {
  const c = contarTests("ℹ pass 0\nℹ fail 0\n");
  assert.equal(c.ok, false);
  assert.match(c.ok ? "" : c.motivo, /suman 0 tests/);
});

test("🔴 no cuenta un test cuyo NOMBRE contenga «pass»", () => {
  // Sin el ancla del final, "✔ pass 12" entraría en la suma y la inflaría.
  const c = contarTests(`✔ pass 12 (0.3ms)\nok 1 - pass 99\n${LOG_SPEC}`);
  assert.ok(c.ok);
  assert.equal(c.total, 34, "solo la línea de resumen cuenta");
});

test("🔴 no cuenta los resúmenes indentados de los subtests: serían los mismos tests dos veces", () => {
  const c = contarTests(`    # pass 5\n\t# pass 7\n${LOG_TAP}`);
  assert.ok(c.ok);
  assert.equal(c.total, 34);
});

test("🔴 el CLI sale con código distinto de 0 cuando no puede contar", () => {
  // El piso sirve solo si el bash lo recibe. Lo que el bash mira es el exit code.
  const dir = mkdtempSync(join(tmpdir(), "amg-contar-"));
  const log = join(dir, "sin-resumen.txt");
  writeFileSync(log, "✔ un test que pasa (0.2ms)\n");

  // `fileURLToPath`, no `.pathname`: en Windows el pathname trae la barra inicial delante de la
  // unidad (`/C:/...`), que no es un path válido — mismo defecto que ya tenían las ataduras por
  // `import()`, acá en un `cwd` de `spawnSync`.
  const r = spawnSync(process.execPath, ["--import", "tsx", "contar-tests.mts", log], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    encoding: "utf8",
  });

  assert.notEqual(r.status, 0, "un conteo que no pudo contar tiene que fallar, no imprimir 0");
  assert.match(r.stderr, /no encontré ninguna línea de resumen/);
  assert.equal(r.stdout.trim(), "", "no puede imprimir una cifra por stdout cuando falló");
});

test("🔴 el formato que imprime el Node de ESTA máquina se puede contar", () => {
  /*
   * El test que no envejece. Los dos fixtures de arriba son historia; éste es el presente: corre el
   * runner de verdad, con el Node que esté resolviendo el PATH, y exige que su salida se pueda contar.
   * Es la única forma de que un cambio de formato futuro se entere de que rompió algo.
   *
   * Sin TTY, igual que en el arnés (que redirige a un archivo) — que es justo la condición que decide
   * qué reporter usa Node por defecto.
   */
  const dir = mkdtempSync(join(tmpdir(), "amg-runner-"));
  const archivo = join(dir, "trivial.test.mjs");
  writeFileSync(
    archivo,
    `import { test } from "node:test";\n` +
      `test("uno", () => {});\ntest("dos", () => {});\ntest("tres", () => {});\n`,
  );

  /*
   * Hay que limpiar el entorno o esto no mide nada. El runner le pasa `NODE_TEST_CONTEXT` y
   * `NODE_TEST_WORKER_ID` a sus hijos; si el hijo las hereda, Node avisa "run() is being called
   * recursively within a test file. skipping running files", NO corre ningún test y **sale con
   * status 0**. Un verde con la salida vacía — exactamente el fallo que este archivo existe para
   * impedir, escondido dentro del test que lo impide. Lo cazó el assert del conteo, no el del
   * status: por eso el conteo se comprueba y no alcanza con "el hijo no falló".
   */
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_TEST_WORKER_ID;

  const r = spawnSync(process.execPath, ["--test", archivo], { encoding: "utf8", env });
  assert.equal(r.status, 0, `el runner trivial debería pasar:\n${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(
    r.stderr,
    /recursively/,
    "el hijo se saltó los tests por herencia del contexto del runner: revisá qué variables " +
      "NODE_TEST_* hay que borrar del env, porque sin eso este test mide una salida vacía",
  );

  const c = contarTests(r.stdout);
  assert.ok(
    c.ok,
    `node ${process.versions.node} imprime un formato que el contador no entiende ` +
      `(${c.ok ? "" : c.motivo}).\nSalida real:\n${r.stdout}`,
  );
  assert.equal(c.total, 3, `contó ${c.ok ? c.total : "?"} en vez de 3.\nSalida real:\n${r.stdout}`);
});

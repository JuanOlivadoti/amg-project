import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/*
 * El arnés de verificación en sí. Dos trampas medidas el 2026-09-26, las dos del mismo tipo: el
 * comando que decide si una etapa cierra puede reportar verde sin haber verificado nada.
 *
 *   1. `npm run verificar` NO corría en Windows. `"verificar": "./scripts/verificar.sh"` lo lanza
 *      cmd.exe, que responde *"`.` no se reconoce como un comando interno o externo"*. El script
 *      tiene que nombrar su intérprete: el shebang solo lo lee un shell POSIX.
 *   2. Pipear la salida a `tail` devuelve el exit code del `tail`. Una corrida devolvió `exit=0`
 *      con el resumen diciendo FALLA — confiar en ese código hace commitear sobre rojo. El script
 *      no puede arreglar el pipeline de quien lo llama, así que el veredicto viaja TAMBIÉN en la
 *      salida, en una línea fija y grepeable, y no hay ningún `exit` que no la imprima antes.
 *
 * `fileURLToPath` y no `.pathname`: en Windows el pathname trae la barra delante de la unidad
 * (`/C:/...`) — mismo motivo que en paquetes.test.mts.
 */
const raiz = fileURLToPath(new URL("..", import.meta.url));
const rutaScript = join(raiz, "scripts", "verificar.sh");
const script = readFileSync(rutaScript, "utf8");
const pkg = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8"));

test("`npm run verificar` nombra el intérprete en vez de confiar en el shebang", () => {
  const declarado: string = pkg.scripts?.verificar ?? "";
  assert.match(
    declarado,
    /^(bash|sh) /,
    `el script "verificar" es ${JSON.stringify(declarado)}: npm lo lanza por cmd.exe en Windows y ` +
      `falla con "'.' no se reconoce como un comando". Tiene que empezar por "bash "`,
  );
});

test("el veredicto viaja en la salida, con el exit code adentro", () => {
  // Se saca la función del script y se la corre: esto verifica el código real, no una copia.
  const correr = (salida: string) =>
    execFileSync(
      "bash",
      ["-c", `source <(sed -n '/^veredicto()/,/^}/p' "$1"); veredicto ${salida}`, "_", rutaScript],
      { encoding: "utf8" },
    ).trim();

  assert.equal(correr("0"), "RESULTADO=VERDE (exit 0)");
  assert.equal(correr("1"), "RESULTADO=FALLA (exit 1)");
});

test("no hay ningún `exit` del script que no imprima antes el veredicto", () => {
  const lineas = script.split("\n");
  const huerfanos: string[] = [];

  lineas.forEach((linea, i) => {
    // `exit 1` dentro de `|| exit 1` de la línea del `cd` incluido: si el repo no está donde se cree,
    // también hay que decirlo en la línea fija.
    if (!/(^|;|&&|\|\|)\s*exit\b/.test(linea)) return;
    const contexto = lineas.slice(Math.max(0, i - 2), i + 1).join("\n");
    if (!/veredicto\b/.test(contexto)) huerfanos.push(`${i + 1}: ${linea.trim()}`);
  });

  assert.deepEqual(
    huerfanos,
    [],
    `estos \`exit\` salen sin imprimir RESULTADO=, así que quien pipee la salida no puede ` +
      `distinguir verde de rojo:\n${huerfanos.join("\n")}`,
  );
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * El CLI del snapshot, en **subprocesos reales** (mismo molde que `firmar-preview.test.ts`).
 *
 * Lo que se prueba acá es lo que solo existe en el proceso: que se responda el uso **antes** de
 * pedir credenciales, que falte la credencial falle cerrado, y que ninguno de los dos caminos deje
 * un directorio a medio escribir. El resto del comando —parsear, generar, informar y el código de
 * salida— vive en `correrSnapshot` (`../snapshot.ts`) y se prueba ahí con dependencias inyectadas,
 * que es lo que permite cubrir el camino feliz **sin base, sin Storyblok y sin red**.
 *
 * ⚠️ `DATABASE_URL_RENDER: undefined` no es decorativo: `spawnSync` omite del entorno del hijo las
 * claves con valor `undefined`, y sin eso el test heredaría la credencial real de quien lo corre y
 * saldría a Postgres de verdad.
 */
const CLI = fileURLToPath(new URL("./snapshot.ts", import.meta.url));

function correr(
  args: string[],
  env: Record<string, string | undefined> = {},
): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, DATABASE_URL_RENDER: undefined, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("🔴 sin argumentos: falla con el uso, no con un stack trace", () => {
  const r = correr([]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Uso: npm run snapshot -w renderer -- <dominio> <directorio-destino>/);
});

test("🔴 con dominio y sin directorio: también falla — el destino no se inventa", () => {
  const r = correr(["micliente.com"]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Uso: npm run snapshot/);
});

test("🔴 el uso se responde ANTES de exigir la credencial", () => {
  // El orden importa: mandar a alguien a buscar `DATABASE_URL_RENDER` para después decirle que
  // escribió mal el comando es el peor de los dos órdenes posibles.
  const r = correr([]);
  assert.ok(!r.stderr.includes("DATABASE_URL_RENDER"), "no debería mencionar la credencial todavía");
});

test("🔴 sin DATABASE_URL_RENDER: falla cerrado, dice qué falta, y no escribe nada", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "amg-snapshot-cli-"));
  try {
    const r = correr(["micliente.com", dir]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /Falta DATABASE_URL_RENDER/);
    assert.match(r.stderr, /amg_render/, "dice qué login es, no solo el nombre de la variable");
    assert.equal(readdirSync(dir).length, 0, "un comando que no puede correr no deja un directorio a medias");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("el CLI nunca imprime el valor de la credencial", () => {
  const r = correr(["micliente.com", "."], { DATABASE_URL_RENDER: "postgres://u:secreto@127.0.0.1:1/x" });
  assert.ok(!r.stdout.includes("secreto"), "la cadena de conexión NUNCA se imprime");
  assert.ok(!r.stderr.includes("secreto"));
});

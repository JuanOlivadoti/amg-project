import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { previewAutorizado } from "../preview.js";

/**
 * Subprocesos reales, no imports: es la única forma de probar un CLI de punta a punta (mismo motivo
 * que `scripts/credencial.test.mts`). `PREVIEW_SECRET` nunca es un secreto real acá — es un valor de
 * prueba fijo, igual que el `"dev-preview"` de `dev-server.ts`.
 */
const CLI = fileURLToPath(new URL("./firmar-preview.ts", import.meta.url));

function correr(args: string[], env: Record<string, string | undefined> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

test("🔴 sin dominio: falla con el uso, no revienta con un stack trace", () => {
  const r = correr([], { PREVIEW_SECRET: "test-secret" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Uso: npm run preview:firmar/);
});

test("🔴 sin PREVIEW_SECRET: falla cerrado y dice exactamente qué falta", () => {
  const r = correr(["micliente.com"], { PREVIEW_SECRET: undefined });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Falta PREVIEW_SECRET/);
});

test("🔴 duracion_minutos inválida: falla en vez de firmar con NaN", () => {
  const r = correr(["micliente.com", "no-es-un-numero"], { PREVIEW_SECRET: "test-secret" });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /duracion_minutos inválida/);
});

test("con dominio y secreto: imprime una URL usable, y NUNCA el secreto", () => {
  const r = correr(["micliente.com"], { PREVIEW_SECRET: "test-secret" });
  assert.equal(r.status, 0, `no debería fallar (stderr: ${r.stderr})`);
  assert.match(r.stdout, /https:\/\/micliente\.com\/\?_amg_preview=.+&_amg_exp=\d+/);
  assert.ok(!r.stdout.includes("test-secret"), "el secreto NUNCA debe imprimirse, ni siquiera en pruebas");
});

test("la URL impresa autoriza de verdad contra previewAutorizado() — no es un string que solo parece válido", () => {
  const r = correr(["micliente.com", "60"], { PREVIEW_SECRET: "test-secret" });
  const url = new URL(r.stdout.trim().split("\n")[0]!);
  assert.ok(previewAutorizado("test-secret", "micliente.com", url.searchParams), "la firma tiene que validar contra la misma función que usa el server");
  assert.ok(!previewAutorizado("otro-secreto", "micliente.com", url.searchParams), "con otro secreto no debería autorizar");
  assert.ok(!previewAutorizado("test-secret", "otro-dominio.com", url.searchParams), "la firma está atada al dominio: no debería servir para otro");
});

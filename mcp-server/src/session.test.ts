import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { escribirSesion, estaPorVencer, leerSesion, type Sesion } from "./session.js";

const SESION_DE_PRUEBA: Sesion = {
  accessToken: "access-123",
  refreshToken: "refresh-456",
  expiraEn: Date.UTC(2026, 0, 1),
  userId: "11111111-1111-1111-1111-111111111111",
  tenantId: "22222222-2222-2222-2222-222222222222",
};

async function rutaTemporal(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-test-"));
  return join(dir, "session.json");
}

test("escribirSesion + leerSesion: round-trip exacto", async () => {
  const ruta = await rutaTemporal();
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const leida = await leerSesion(ruta);
  assert.deepEqual(leida, SESION_DE_PRUEBA);
});

test("escribirSesion crea el directorio si no existe", async () => {
  const dir = await mkdtemp(join(tmpdir(), "amg-mcp-test-"));
  const ruta = join(dir, "no-existe-todavia", "session.json");
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const leida = await leerSesion(ruta);
  assert.deepEqual(leida, SESION_DE_PRUEBA);
});

test("escribirSesion es atómica: no deja un archivo .tmp colgado", async () => {
  const ruta = await rutaTemporal();
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const archivos = await readdir(join(ruta, ".."));
  assert.deepEqual(
    archivos.filter((f) => f.endsWith(".tmp")),
    [],
    "no debe quedar ningún .tmp después de escribir",
  );
});

test("escribirSesion escribe JSON legible (no un blob de una sola línea imposible de auditar)", async () => {
  const ruta = await rutaTemporal();
  await escribirSesion(SESION_DE_PRUEBA, ruta);
  const crudo = await readFile(ruta, "utf8");
  assert.ok(crudo.includes("\n"), "se espera JSON con indentación, no minificado");
});

test("leerSesion: null si el archivo no existe", async () => {
  const ruta = await rutaTemporal(); // el directorio existe, el archivo no
  assert.equal(await leerSesion(ruta), null);
});

test("leerSesion: null ante JSON inválido", async () => {
  const ruta = await rutaTemporal();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(ruta, "esto no es json{", "utf8");
  assert.equal(await leerSesion(ruta), null);
});

test("leerSesion: null si falta un campo requerido", async () => {
  const ruta = await rutaTemporal();
  const { writeFile } = await import("node:fs/promises");
  const incompleta = { ...SESION_DE_PRUEBA, accessToken: undefined };
  await writeFile(ruta, JSON.stringify(incompleta), "utf8");
  assert.equal(await leerSesion(ruta), null);
});

test("leerSesion: null si tenantId no es un string", async () => {
  const ruta = await rutaTemporal();
  const { writeFile } = await import("node:fs/promises");
  await writeFile(ruta, JSON.stringify({ ...SESION_DE_PRUEBA, tenantId: 123 }), "utf8");
  assert.equal(await leerSesion(ruta), null);
});

test("estaPorVencer: true dentro del margen", () => {
  const ahora = () => 1000;
  const sesion = { ...SESION_DE_PRUEBA, expiraEn: 1500 };
  assert.equal(estaPorVencer(sesion, 600, ahora), true); // vence en 500ms, margen 600ms
});

test("estaPorVencer: false fuera del margen", () => {
  const ahora = () => 1000;
  const sesion = { ...SESION_DE_PRUEBA, expiraEn: 5000 };
  assert.equal(estaPorVencer(sesion, 600, ahora), false);
});

test("estaPorVencer: true si ya venció", () => {
  const ahora = () => 9999;
  const sesion = { ...SESION_DE_PRUEBA, expiraEn: 1000 };
  assert.equal(estaPorVencer(sesion, 600, ahora), true);
});

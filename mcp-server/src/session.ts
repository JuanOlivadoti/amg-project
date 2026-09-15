import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * La sesión guardada en disco, fuera del repo. Subconjunto más chico que la del portal (sin `rol`,
 * sin nada de UI) — spec §3.6.
 */
export interface Sesion {
  accessToken: string;
  refreshToken: string;
  /** Instante (epoch ms) en que vence el `accessToken`. */
  expiraEn: number;
  userId: string;
  tenantId: string;
}

/**
 * `~/.amg-mcp/session.json`. Fuera del repo a propósito: nada de `git add` distraído la agarra —
 * spec §6, la misma clase de accidente que ya sufrió este proyecto con `docs/private.zip`.
 */
export function rutaSesion(): string {
  return join(homedir(), ".amg-mcp", "session.json");
}

/**
 * Lee una sesión guardada, **validando la forma** — no solo que el JSON parsee. Mismo criterio que
 * `portal/src/app/core/auth-core.ts:parseSesion`: un archivo manipulado o de una versión vieja no
 * debe producir una sesión fantasma que después falle en cada llamada con un error confuso. Si algo
 * no cierra, no hay sesión — el llamador ve `null` y sabe pedir `npm run mcp:login`.
 */
export async function leerSesion(ruta: string = rutaSesion()): Promise<Sesion | null> {
  let crudo: string;
  try {
    crudo = await readFile(ruta, "utf8");
  } catch {
    return null;
  }

  let v: unknown;
  try {
    v = JSON.parse(crudo);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const s = v as Record<string, unknown>;

  const texto = (k: string): boolean => typeof s[k] === "string" && (s[k] as string).length > 0;
  if (!texto("accessToken") || !texto("refreshToken") || !texto("userId") || !texto("tenantId")) {
    return null;
  }
  const expiraEn = s["expiraEn"];
  if (typeof expiraEn !== "number" || !Number.isFinite(expiraEn) || expiraEn <= 0) return null;

  return {
    accessToken: s["accessToken"] as string,
    refreshToken: s["refreshToken"] as string,
    expiraEn,
    userId: s["userId"] as string,
    tenantId: s["tenantId"] as string,
  };
}

/**
 * Escribe la sesión de forma ATÓMICA: archivo temporal + `rename`, nunca una escritura parcial sobre
 * el archivo bueno (spec §6, mitigación 1). Es la protección real contra el escenario que el spec
 * nombra: Claude Desktop mata el subproceso MCP libremente, y un `writeFile` directo interrumpido a
 * mitad de escritura dejaría un `session.json` corrupto — sin sesión recuperable, ni siquiera con un
 * login nuevo hasta borrar el archivo a mano.
 *
 * Se intenta `chmod 600` mejor-esfuerzo: en Windows es casi un no-op y NO se documenta como
 * protección real (spec §6) — la protección de verdad es que el archivo vive en el perfil del
 * usuario.
 */
export async function escribirSesion(sesion: Sesion, ruta: string = rutaSesion()): Promise<void> {
  await mkdir(dirname(ruta), { recursive: true });
  const temporal = `${ruta}.tmp`;
  await writeFile(temporal, JSON.stringify(sesion, null, 2), { mode: 0o600 });
  await rename(temporal, ruta);
  try {
    const { chmod } = await import("node:fs/promises");
    await chmod(ruta, 0o600);
  } catch {
    // Mejor esfuerzo — ver el comentario de arriba. Nunca debe tumbar el login por esto.
  }
}

/** ¿Falta menos de `margenMs` para que venza `accessToken`? Vencido cuenta como "por vencer". */
export function estaPorVencer(sesion: Sesion, margenMs: number, ahora: () => number = Date.now): boolean {
  return sesion.expiraEn - ahora() <= margenMs;
}

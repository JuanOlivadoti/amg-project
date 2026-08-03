/**
 * Qué rutas NO pueden estar versionadas ni entrar a un commit, y por qué.
 *
 * Vive acá y no dentro de `verificar.sh` porque es la única comprobación automática de la regla más
 * dura del proyecto —las keys no entran a git, nunca— y una comprobación de seguridad sin test es
 * exactamente lo que este repo aprendió a no hacer. En bash era un `grep` de una línea que dejaba
 * pasar `credenciales.env`, `.envrc` y `portal/node_modules/`: los tres los caza el test de al lado.
 *
 * Se invoca desde `verificar.sh` DESPUÉS de comprobar `node_modules`, así que puede usar `tsx`.
 * Lee rutas por stdin (una por línea) y sale con 1 si alguna está prohibida.
 */

import { pathToFileURL } from "node:url";

export interface Prohibida {
  ruta: string;
  motivo: string;
}

/**
 * Extensiones de comprimido. `.gz` cubre también `.tar.gz`, y están las dos porque la lista se lee
 * como política —"esto no se versiona"— y no como optimización de un `endsWith`.
 */
const COMPRIMIDOS = [".zip", ".tar", ".tar.gz", ".tgz", ".gz", ".bz2", ".xz", ".7z", ".rar"] as const;

/** El nombre del archivo, sin el directorio. */
function base(ruta: string): string {
  const partes = ruta.split("/");
  return partes[partes.length - 1] ?? "";
}

/** Los segmentos de directorio, sin el nombre del archivo. */
function segmentos(ruta: string): string[] {
  return ruta.split("/").slice(0, -1);
}

/**
 * `null` si la ruta puede versionarse; si no, el motivo.
 *
 * El ORDEN importa: `docs/private/` se evalúa antes que la excepción de `.env.example`, porque un
 * `docs/private/algo.env.example` no es una plantilla pública — está en la carpeta que guarda los
 * valores reales, y ahí adentro no se decide por el sufijo del nombre.
 */
export function motivoProhibido(rutaCruda: string): string | null {
  const ruta = rutaCruda.trim();
  if (!ruta) return null;

  // Se compara en minúsculas: en macOS y Windows `git add -f .ENV` versiona el mismo archivo que
  // `.env`, y `.gitignore` (con core.ignorecase) tampoco distingue. El caso que de verdad importa es
  // `.ENVRC`, porque `.envrc` es el único de esta lista que el .gitignore no cubre: ahí este detector
  // es la ÚNICA línea de defensa, y una que se apaga con la tecla Bloq Mayús no es una defensa.
  const dirs = segmentos(ruta).map((d) => d.toLowerCase());
  const nombre = base(ruta).toLowerCase();

  if (dirs[0] === "docs" && dirs[1] === "private") {
    return "docs/private/ guarda los valores reales; nada de ahí se versiona";
  }
  // La misma carpeta, empaquetada como ARCHIVO. La regla de arriba mira el segundo segmento de
  // DIRECTORIO, así que `docs/private.zip` —donde `private.zip` es el nombre— pasaba por el hueco:
  // `dirs` es solo ["docs"]. No es hipotético, es lo que se commiteó en un repo público el
  // 2026-08-01 con `credenciales.env` adentro.
  if (dirs[0] === "docs" && nombre.startsWith("private")) {
    return "docs/private* empaqueta la carpeta de los valores reales";
  }
  if (dirs.includes("node_modules")) {
    return "node_modules no va al repo (en ningún nivel: también portal/node_modules)";
  }
  if (dirs.includes("out") || dirs.includes("dist") || dirs.includes(".cache")) {
    return "salida de build o cache: se regenera, no se versiona";
  }

  // Un comprimido es OPACO para este detector, que decide por ruta y no por contenido: no hay forma
  // de saber si adentro viaja un `.env` sin abrirlo. Así que se rechaza por defecto, con la misma
  // asimetría que gobierna el gasto del pipeline —rechazar de más es gratis, dejar pasar una key es
  // irreversible—. Hoy no hay ni un comprimido versionado, así que la regla no le cuesta nada a
  // nadie; si alguna vez hace falta uno, que sea una decisión y no un descuido.
  if (COMPRIMIDOS.some((ext) => nombre.endsWith(ext))) {
    return "comprimido versionado: el detector no puede ver qué trae adentro";
  }

  // Plantillas sin valores: son lo ÚNICO de la familia .env que sí se comparte.
  if (nombre === ".env.example" || nombre.endsWith(".env.example")) return null;

  // `.env`, `.env.local`, `.env.produccion`… y también `credenciales.env` o `produccion.env`, que la
  // versión vieja en bash no veía porque exigía que el nombre EMPEZARA con `.env`.
  if (nombre === ".env" || nombre.startsWith(".env.") || nombre.endsWith(".env")) {
    return "archivo de entorno: puede tener keys";
  }
  if (nombre === ".envrc") {
    return "direnv exporta variables desde acá: puede tener keys";
  }

  return null;
}

export function filtrarProhibidas(rutas: Iterable<string>): Prohibida[] {
  const salida: Prohibida[] = [];
  for (const ruta of rutas) {
    const motivo = motivoProhibido(ruta);
    if (motivo) salida.push({ ruta: ruta.trim(), motivo });
  }
  return salida;
}

/** CLI: rutas por stdin, una por línea. Exit 1 si alguna está prohibida. */
async function main(): Promise<void> {
  const trozos: Buffer[] = [];
  for await (const t of process.stdin) trozos.push(t as Buffer);
  const rutas = Buffer.concat(trozos).toString("utf8").split("\n");

  const malas = filtrarProhibidas(rutas);
  for (const { ruta, motivo } of malas) console.log(`${ruta} — ${motivo}`);
  process.exitCode = malas.length > 0 ? 1 : 0;
}

// Solo cuando se ejecuta como programa, no cuando lo importa el test.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

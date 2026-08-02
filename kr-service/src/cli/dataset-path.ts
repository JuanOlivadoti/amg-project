import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Raíz del monorepo, derivada del PROPIO archivo (`kr-service/src/cli/` → tres niveles arriba).
 *
 * No se usa `process.cwd()` a propósito: `npm run spike -w kr-service` corre con el cwd en
 * `kr-service/`, y `npm run spike` desde dentro del paquete también. Un destino relativo al cwd
 * pone el dataset en un sitio distinto según desde dónde se lance — que es medio camino hacia
 * volver a perderlo.
 */
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * Dónde va el dataset crudo del research, por defecto: `datasets/keywords.json` en la raíz del repo.
 *
 * **Estaba en `out/`, que git ignora, y por eso el dataset de la corrida real del 2026-07-30 se
 * perdió.** Se había persistido justamente para que ajustar scoring y clustering fuera offline y
 * gratis; al no viajar con el repo, esa promesa quedó impagable y regenerarlo cuesta otra corrida
 * de DataForSEO en producción.
 *
 * Son datos de mercado públicos más el prompt del negocio: no hay nada secreto que justifique
 * dejarlos fuera del repo. Ver `datasets/README.md`. Que este destino no vuelva a un directorio
 * ignorado lo impone `dataset-path.test.ts`, preguntándole a git — no un comentario como este.
 */
export const DATASET_PATH_DEFAULT = join(RAIZ, "datasets", "keywords.json");

/** El destino efectivo. `KR_DATASET_PATH` lo sobreescribe (rutas relativas, contra el cwd). */
export function datasetPath(): string {
  const raw = process.env["KR_DATASET_PATH"]?.trim();
  if (!raw) return DATASET_PATH_DEFAULT;
  return isAbsolute(raw) ? raw : resolve(raw);
}

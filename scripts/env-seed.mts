/**
 * Un solo uso: junta los `.env` que ya existían en un único docs/private/credenciales.env.
 *
 * Cuando dos paquetes tienen la misma clave con DISTINTO valor, no elige un ganador: emite un
 * override por paquete. Elegir en silencio es como se pierde un valor que alguien puso a propósito.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { MAPA, RAIZ, FUENTE, claveDePaquete, parsear, type Paquete } from "./env-sync.mts";

if (existsSync(FUENTE)) {
  console.error(`Ya existe ${FUENTE}. No lo piso: revisalo a mano.`);
  process.exit(1);
}

const PAQUETES = Object.keys(MAPA) as Paquete[];

/** clave -> (paquete -> valor no vacío encontrado en su .env) */
const porClave = new Map<string, Map<Paquete, string>>();
for (const pkg of PAQUETES) {
  const ruta = join(RAIZ, "docs", "private", "backup-env", `${pkg}.env`);
  if (!existsSync(ruta)) continue;
  for (const [k, v] of parsear(readFileSync(ruta, "utf8"))) {
    if (!(MAPA[pkg] as readonly string[]).includes(k) || v === "") continue;
    if (!porClave.has(k)) porClave.set(k, new Map());
    porClave.get(k)!.set(pkg, v);
  }
}

const globales: string[] = [];
const overrides: string[] = [];
const vacias: string[] = [];
const divergentes: string[] = [];

for (const k of [...new Set(Object.values(MAPA).flatMap((c) => [...c]))].sort()) {
  const encontrados = porClave.get(k);
  if (!encontrados || encontrados.size === 0) {
    vacias.push(k);
    globales.push(`${k}=`);
    continue;
  }
  const distintos = new Set(encontrados.values());
  if (distintos.size === 1) {
    globales.push(`${k}=${[...distintos][0]}`);
  } else {
    divergentes.push(k);
    for (const [pkg, v] of encontrados) overrides.push(`${claveDePaquete(pkg, k)}=${v}`);
  }
}

const bloqueOverrides = overrides.length
  ? `\n# ── Overrides por paquete ────────────────────────────────────────────────────────
# Estas claves tenían valores DISTINTOS en cada paquete. Se conservaron los dos: el override
# \`PAQUETE__CLAVE\` gana sobre el valor global. Si alguno era un error, borralo y dejá el global.
${overrides.join("\n")}\n`
  : "";

writeFileSync(
  FUENTE,
  `# FUENTE ÚNICA de credenciales — NO COMMITEAR (docs/private/ está en .gitignore).
# Editá acá y corré \`npm run env:sync\` para repartir a los .env de cada paquete.
# Quién recibe qué lo decide MAPA en scripts/env-sync.mts, y lo verifica su test.

${globales.join("\n")}
${bloqueOverrides}`,
  "utf8",
);

console.log(`✔ Escrito ${FUENTE}`);
console.log(`  globales: ${globales.length - vacias.length} con valor, ${vacias.length} vacías`);
if (vacias.length) console.log(`    a completar: ${vacias.join(", ")}`);
console.log(`  overrides por paquete: ${overrides.length}${divergentes.length ? ` (de ${divergentes.join(", ")})` : ""}`);

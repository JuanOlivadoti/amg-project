/**
 * env-sync — reparte UN archivo fuente privado a los `.env` de cada paquete.
 *
 * Por qué existe: los mismos valores estaban copiados en 5 `.env` distintos (STORYBLOK_SPACE_ID en
 * dos, OPENAI_API_KEY en dos, BUSINESS_PROFILE_PATH en dos), y cada copia se desincronizaba sola.
 *
 * Por qué NO es un único `.env` en la raíz que carguen todos: eso le daría a cada proceso el entorno
 * completo. El renderizador —el único expuesto a internet anónimo (ADR-19)— tendría a mano la
 * password de `amg_api` y el token de escritura de Storyblok. El reparto ES la compartimentación:
 * cada proceso recibe solo sus claves, y `MAPA` es quien lo decide. La separación la impone
 * `env-sync.test.mts`, no este comentario.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

export const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
export const FUENTE = join(RAIZ, "docs", "private", "credenciales.env");

/**
 * Qué claves recibe cada paquete. Tiene que coincidir EXACTAMENTE con su `.env.example`: el test lo
 * verifica en las dos direcciones, así que agregar una clave a un `.env.example` rompe el test hasta
 * que alguien decida acá quién puede verla.
 */
export const MAPA = {
  api: [
    "DATABASE_URL_API",
    "SUPABASE_JWT_ISS",
    "CORS_ORIGINS",
    "SUPABASE_JWT_AUD",
    "INNGEST_EVENT_KEY",
    "OAUTH_STATE_SECRET",
    "GOOGLE_REVIEWS_MODO",
    "TELEGRAM_BOT_USERNAME",
  ],
  db: ["DATABASE_URL_ADMIN", "SEED_FRANK_USER_ID", "SEED_JUAN_USER_ID"],
  "kr-service": [
    "DATAFORSEO_MODE",
    "DATAFORSEO_BASE_URL",
    "DATAFORSEO_LOGIN",
    "DATAFORSEO_PASSWORD",
    "LLM_PROVIDER",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "DATABASE_URL_CACHE",
  ],
  /*
   * El orquestador **faltaba entero**, no le faltaban variables (bloque A4). Se notaba poco porque en
   * local corre sin ninguna —PGlite en memoria y providers mock— y en Railway las variables se cargan
   * a mano; se notaba mucho al querer correr el orquestador REAL en local, que exigía escribir el
   * archivo a mano.
   *
   * Son las que lee `orchestrator/src/config.ts` (u `openai-provider.ts`, vía `OPENAI_API_KEY`) y
   * **no** las de `kr-service` ni las de `web-builder`, aunque en producción los tres compartan
   * proceso: cada paquete tiene su contrato, y el conjunto de producción —más amplio que la suma de
   * los `.env` locales— lo compara el bloque A3 con un inventario propio.
   *
   * No las cuatro de siempre: solo `DATABASE_URL_ORQUESTADOR`, `DATABASE_URL_CACHE`,
   * `INNGEST_SIGNING_KEY` y `PIPELINE_MODO` paran el arranque (`leerConfig`'s `faltan`, en producción).
   * `GOOGLE_REVIEWS_MODO`, `BORRADOR_RESENAS_MODO` y `OPENAI_API_KEY` viajan acá para que `env:sync`
   * las reparta al `.env` local, pero son OPCIONALES con default — `auditar-railway.mts` las clasifica
   * en `SEGUN_MODO`, no en `OBLIGATORIAS`, justo por eso.
   */
  orchestrator: [
    "DATABASE_URL_ORQUESTADOR",
    "DATABASE_URL_CACHE",
    "INNGEST_SIGNING_KEY",
    "PIPELINE_MODO",
    "GOOGLE_REVIEWS_MODO",
    "BORRADOR_RESENAS_MODO",
    "OPENAI_API_KEY",
    "OPENAI_MODEL",
  ],
  renderer: [
    "STORYBLOK_PUBLIC_TOKEN",
    "STORYBLOK_SPACE_ID",
    "DEMO_DOMAIN",
    "STORYBLOK_PREVIEW_TOKEN",
    "STORYBLOK_REGION",
    "BUSINESS_PROFILE_PATH",
    "BRIEF_PATH",
  ],
  "web-builder": [
    "WEB_PUBLISH_MODE",
    "STORYBLOK_MANAGEMENT_TOKEN",
    "STORYBLOK_SPACE_ID",
    "STORYBLOK_REGION",
    "KR_BRIEF_PATH",
    "BUSINESS_PROFILE_PATH",
    "PROSE_MODE",
    "OPENAI_API_KEY",
  ],
} as const satisfies Record<string, readonly string[]>;

export type Paquete = keyof typeof MAPA;

/** Parsea un `.env` a pares. Ignora comentarios y líneas vacías; el valor es todo lo que sigue al primer `=`. */
export function parsear(texto: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const linea of texto.split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i === -1) continue;
    out.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  return out;
}

/**
 * Nombre de la variante por paquete de una clave: `WEB_BUILDER__OPENAI_API_KEY`.
 *
 * No toda clave compartida quiere el mismo valor. `BUSINESS_PROFILE_PATH` es relativa y se resuelve
 * desde cwd distintos (`./x.json` en web-builder es `../web-builder/x.json` en renderer): unificarla
 * rompería uno de los dos. Y dos servicios pueden querer API keys distintas a propósito, para
 * rotarlas o facturarlas por separado. El override deja convivir eso con la fuente única.
 */
export function claveDePaquete(pkg: Paquete, clave: string): string {
  return `${pkg.toUpperCase().replace(/-/g, "_")}__${clave}`;
}

/** Reparte la fuente según MAPA. Función pura: el test la usa sin tocar el disco. */
export function repartir(fuente: Map<string, string>): Record<Paquete, Map<string, string>> {
  const out = {} as Record<Paquete, Map<string, string>>;
  for (const [pkg, claves] of Object.entries(MAPA) as [Paquete, readonly string[]][]) {
    const m = new Map<string, string>();
    // El override del paquete gana sobre el valor global; si no hay ninguno, queda vacía.
    for (const k of claves) m.set(k, fuente.get(claveDePaquete(pkg, k)) ?? fuente.get(k) ?? "");
    out[pkg] = m;
  }
  return out;
}

/**
 * Claves que pueden aparecer en la fuente "sin destino" (ningún paquete del `MAPA` las pide) pero que
 * NO son basura inerte: siguen siendo un riesgo real mientras existan, y el aviso genérico de más
 * abajo las escondía entre lo deliberado. Cada entrada dice POR QUÉ importa, no solo que sobra.
 *
 * `SUPABASE_JWT_SECRET` es la primera y hoy la única confirmada: se sacó del contrato de la API el
 * 2026-07-26 (ya no lo lee, ya no confía en HS256), pero el secreto SIGUE siendo válido en Supabase
 * hasta que se revoque ahí, y un HS256 firmado con él puede acuñar un token `service_role` que
 * bypassea RLS por completo — un radio de daño que no depende de si nuestra API lo acepta. Ver
 * `docs/proyecto/12-credenciales.md` § "No revoques el secreto legacy sin migrar antes el portal": no
 * se puede revocar todavía porque el portal firma su `apikey` de login con ese mismo secreto.
 */
export const SOBRANTES_DE_RIESGO: Record<string, string> = {
  SUPABASE_JWT_SECRET:
    "sigue siendo válido en Supabase y puede acuñar un token service_role que bypassea RLS. " +
    "No revocarlo todavía: el portal firma su apikey de login con el mismo secreto (ver 12-credenciales.md).",
};

/** Separa lo que sobra en "riesgo real conocido" (con su motivo) de todo lo demás (deliberado o no). */
export function clasificarSobrantes(sobrantes: readonly string[]): {
  riesgo: string[];
  resto: string[];
} {
  const riesgo = sobrantes.filter((k) => k in SOBRANTES_DE_RIESGO);
  const resto = sobrantes.filter((k) => !(k in SOBRANTES_DE_RIESGO));
  return { riesgo, resto };
}

const CABECERA = `# GENERADO por \`npm run env:sync\` — NO editar a mano.
# La fuente única es docs/private/credenciales.env (gitignoreada).
# Este archivo recibe SOLO las claves que este paquete necesita (ver MAPA en scripts/env-sync.mts).
`;

export function serializar(claves: Map<string, string>): string {
  return CABECERA + [...claves].map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
}

function main(): void {
  if (!existsSync(FUENTE)) {
    console.error(
      `Falta ${FUENTE}\n` +
        `Es la fuente única de credenciales (gitignoreada). Copiá docs/private/credenciales.env.example\n` +
        `y completala; después volvé a correr \`npm run env:sync\`.`,
    );
    process.exit(1);
  }
  const fuente = parsear(readFileSync(FUENTE, "utf8"));
  const reparto = repartir(fuente);

  let pendientes = 0;
  for (const [pkg, claves] of Object.entries(reparto) as [Paquete, Map<string, string>][]) {
    writeFileSync(join(RAIZ, pkg, ".env"), serializar(claves), "utf8");
    const vacias = [...claves].filter(([, v]) => v === "").map(([k]) => k);
    pendientes += vacias.length;
    const estado = vacias.length ? `${claves.size - vacias.length}/${claves.size}` : `${claves.size}/${claves.size}`;
    console.log(`  ${pkg.padEnd(12)} ${estado} claves${vacias.length ? `  · vacías: ${vacias.join(", ")}` : ""}`);
  }

  const conocidas = new Set<string>();
  for (const [pkg, claves] of Object.entries(MAPA) as [Paquete, readonly string[]][]) {
    for (const k of claves) {
      conocidas.add(k);
      conocidas.add(claveDePaquete(pkg, k));
    }
  }
  const sobrantes = [...fuente.keys()].filter((k) => !conocidas.has(k));
  if (sobrantes.length) {
    const { riesgo, resto } = clasificarSobrantes(sobrantes);
    if (resto.length) console.log(`\n  aviso: en la fuente pero sin destino: ${resto.join(", ")}`);
    for (const k of riesgo) {
      console.log(`\n  ⚠️  ${k}: sin destino, y NO es basura inerte — ${SOBRANTES_DE_RIESGO[k]}`);
    }
  }
  console.log(`\n✔ Sincronizado. ${pendientes ? `${pendientes} clave(s) vacía(s).` : "Sin claves vacías."}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

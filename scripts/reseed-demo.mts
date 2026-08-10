/**
 * reseed-demo — re-siembra la demo (Borcelle Burger) leyendo las credenciales de la FUENTE ÚNICA.
 *
 *   npm run reseed:demo              # muestra a qué base va y pide confirmación
 *   npm run reseed:demo -- --si      # sin confirmación (para automatizar)
 *   npm run reseed:demo -- --dry-run # valida y muestra el destino; NO toca la base
 *
 * ## Por qué existe (y no basta `npm run seed:demo -w db`)
 *
 * El seed necesita tres variables y la forma "obvia" de pasarlas es la línea de comandos
 * (`DATABASE_URL_ADMIN=… npm run seed:demo -w db`), que deja la password de ADMIN en el historial de
 * la shell — el propio `db/.env.example` advierte contra eso. Este script las toma de
 * `docs/private/credenciales.env` (gitignoreada, la fuente única) y las pasa al proceso hijo por su
 * entorno: no pasan por una shell, no quedan en el historial y no se imprimen nunca.
 *
 * ## Por qué invoca el CLI directo y NO `npm run seed:demo -w db`
 *
 * Ese script del paquete carga `db/.env` con `tsx --env-file-if-exists=.env`, y `db/.env` es un
 * ARCHIVO GENERADO que puede estar desincronizado de la fuente (si alguien editó `credenciales.env`
 * y no corrió `env:sync`). Hoy Node le da precedencia al entorno sobre `--env-file`, así que
 * funcionaría; pero apostar una escritura en la base de producción a esa precedencia es una garantía
 * en un comentario. Invocando `db/src/cli/seed.ts` sin `--env-file`, el entorno que armamos acá es la
 * ÚNICA fuente posible de esas tres variables. Lo fija `construirComando` y lo prueba su test.
 *
 * ## Qué NO hace
 *
 * No aplica migraciones. Si el seed falla diciendo que una columna o una tabla no existe, la base
 * está atrasada: corré `npm run migrate:deploy -w db` (que también lee `db/.env`) y volvé a sembrar.
 */
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { MAPA, RAIZ, FUENTE, parsear, repartir } from "./env-sync.mts";

/** Las claves que el seed necesita, en el orden en que se reportan. Es el MAPA de `db`, no una copia. */
export const CLAVES_SEED = MAPA.db;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Los placeholders de `db/.env.example`. Si llegan a la fuente, el fallo sería un timeout confuso. */
const PLACEHOLDERS = ["PROJECT-REF", "LA-PASSWORD"];

/**
 * Las tres variables del seed, resueltas desde la fuente con las MISMAS reglas que `env:sync`
 * (incluidos los overrides `DB__CLAVE`). Se delega en `repartir` a propósito: si el MAPA cambia,
 * este script no se queda con una copia vieja.
 *
 * Recorta acá, una vez, para que lo VALIDADO y lo que recibe el proceso hijo sean el mismo string.
 * (`parsear` ya recorta, pero entonces el invariante viviría en otro archivo.)
 */
export function clavesDeSeed(fuente: Map<string, string>): Map<string, string> {
  return new Map([...repartir(fuente).db].map(([k, v]) => [k, v.trim()]));
}

/**
 * Los problemas encontrados, en texto listo para mostrar. Lista vacía = se puede sembrar.
 *
 * **Nunca incluye el valor de `DATABASE_URL_ADMIN`** (lleva la password de admin adentro); de los
 * UUID sí, porque no son secretos y verlos es lo único que permite darse cuenta de que se pegó un
 * `id` de otro usuario. Lo prueba `reseed-demo.test.mts`.
 */
export function validar(claves: Map<string, string>): string[] {
  const problemas: string[] = [];

  const dsn = claves.get("DATABASE_URL_ADMIN") ?? "";
  if (!dsn) {
    problemas.push("DATABASE_URL_ADMIN está vacía (conexión de ADMIN de Supabase, pestaña «Session pooler»)");
  } else if (/^["'].*["']$/s.test(dsn)) {
    // Las comillas en un `.env` no se quitan: quedan DENTRO del valor. Sin este caso, el mensaje
    // sería "no parece un DSN de Postgres" sobre un valor que a la vista lo es.
    problemas.push("DATABASE_URL_ADMIN está entre comillas: en un archivo .env las comillas quedan dentro del valor, sacalas");
  } else if (!/^postgres(ql)?:\/\//.test(dsn)) {
    problemas.push("DATABASE_URL_ADMIN no parece un DSN de Postgres (tiene que empezar con postgres:// o postgresql://)");
  } else {
    const encontrado = PLACEHOLDERS.filter((p) => dsn.includes(p));
    if (encontrado.length > 0) {
      problemas.push(
        `DATABASE_URL_ADMIN todavía tiene el placeholder del ejemplo (${encontrado.join(", ")}): ` +
          "poné el DSN real en docs/private/credenciales.env",
      );
    }
  }

  const ids = new Map<string, string>();
  for (const clave of ["SEED_FRANK_USER_ID", "SEED_JUAN_USER_ID"] as const) {
    const v = claves.get(clave) ?? "";
    if (!v) {
      problemas.push(`${clave} está vacía (el sub del usuario en Supabase Auth → Authentication → Users)`);
    } else if (!UUID.test(v)) {
      problemas.push(`${clave} no es un UUID: "${v}"`);
    } else {
      ids.set(clave, v.toLowerCase());
    }
  }

  // Si los dos IDs son el mismo, el seed no falla: la segunda membresía hace UPSERT sobre la primera
  // y Frank se queda con rol `equipo`. El síntoma aparece recién en el portal, como botones que no
  // están, y parece un bug de la UI. Mejor no arrancar.
  if (ids.size === 2 && new Set(ids.values()).size === 1) {
    problemas.push(
      "SEED_FRANK_USER_ID y SEED_JUAN_USER_ID son el mismo UUID: la membresía de Frank quedaría " +
        "sobrescrita con rol `equipo` y perdería `maestro` en silencio",
    );
  }

  return problemas;
}

/**
 * El DSN sin password, para que se pueda confirmar el destino antes de escribir. El usuario y el host
 * SÍ se muestran (son lo que distingue un proyecto de Supabase de otro, y no son secretos); la
 * password, nunca — ni en el camino de error.
 */
export function resumirDsn(dsn: string): string {
  try {
    const u = new URL(dsn);
    const usuario = u.username ? `${u.username}:***@` : "";
    return `${u.protocol}//${usuario}${u.host}${u.pathname}`;
  } catch {
    // Sin fallback al DSN crudo: un DSN que no parsea suele ser justamente uno con la password mal
    // escapada, y volcarlo a la consola sería filtrarla.
    return "(no se pudo parsear el DSN: si la password tiene @ # / : ? hay que percent-encodearla)";
  }
}

export interface Comando {
  cmd: string;
  args: string[];
  cwd: string;
}

/**
 * El comando del seed. Es el CLI directo, **sin `--env-file`**: así el entorno que arma este script
 * es la única fuente de las tres variables (ver la cabecera del archivo).
 */
export function construirComando(raiz: string = RAIZ): Comando {
  const bin = process.platform === "win32" ? "tsx.cmd" : "tsx";
  return {
    cmd: join(raiz, "node_modules", ".bin", bin),
    args: [join("src", "cli", "seed.ts")],
    cwd: join(raiz, "db"),
  };
}

function morir(mensaje: string): never {
  console.error(mensaje);
  process.exit(1);
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  const sinPreguntar = flags.has("--si") || flags.has("-s");
  const dryRun = flags.has("--dry-run") || flags.has("-n");
  const desconocidos = [...flags].filter((f) => !["--si", "-s", "--dry-run", "-n"].includes(f));
  if (desconocidos.length > 0) {
    morir(`Flag desconocido: ${desconocidos.join(", ")}\nUso: npm run reseed:demo -- [--si] [--dry-run]`);
  }

  if (!existsSync(FUENTE)) {
    morir(
      `Falta ${FUENTE}\n` +
        "Es la fuente única de credenciales (gitignoreada). Copiá docs/private/credenciales.env.example,\n" +
        "completala y volvé a correr.",
    );
  }

  const claves = clavesDeSeed(parsear(readFileSync(FUENTE, "utf8")));
  const problemas = validar(claves);
  if (problemas.length > 0) {
    morir(
      `No puedo sembrar; arreglá esto en ${FUENTE}:\n  - ${problemas.join("\n  - ")}\n\n` +
        "(Editá SIEMPRE la fuente, no los `.env` de los paquetes: los genera `npm run env:sync`.)",
    );
  }

  const { cmd, args, cwd } = construirComando();
  if (!existsSync(cmd)) {
    morir(`No encuentro ${cmd}\nCorré \`npm install\` en la raíz del monorepo y volvé a intentar.`);
  }

  console.log("Re-siembra del caso de demo (Borcelle Burger), leyendo de docs/private/credenciales.env\n");
  console.log(`  base:  ${resumirDsn(claves.get("DATABASE_URL_ADMIN")!)}`);
  console.log(`  Frank: ${claves.get("SEED_FRANK_USER_ID")}  (maestro)`);
  console.log(`  Juan:  ${claves.get("SEED_JUAN_USER_ID")}  (equipo)`);
  console.log(
    "\nEs idempotente y no destructivo: upserta el tenant, el cliente y las membresías, y reemplaza\n" +
      "SOLO el run de demo de id fijo. Ojo: eso descarta las aprobaciones hechas sobre ese run.\n",
  );

  if (dryRun) {
    console.log("--dry-run: no toco la base. Todo listo para sembrar.");
    return;
  }

  if (!sinPreguntar) {
    if (!process.stdin.isTTY) {
      morir("No hay terminal interactiva para confirmar. Volvé a correr con `-- --si` si es lo que querés.");
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const r = (await rl.question("Escribí `sembrar` para continuar: ")).trim();
      if (r !== "sembrar") morir("Cancelado: no se tocó la base.");
    } finally {
      rl.close();
    }
    console.log("");
  }

  // Las tres variables van por el entorno del hijo —no por la línea de comandos— para que no queden
  // en el historial de la shell. Van DESPUÉS de process.env: si el usuario tiene una exportada en su
  // sesión apuntando a otra base, gana la fuente única.
  const codigo = await new Promise<number>((resolve, reject) => {
    const hijo = spawn(cmd, args, {
      cwd,
      stdio: "inherit",
      env: { ...process.env, ...Object.fromEntries(claves) },
    });
    hijo.on("error", reject);
    hijo.on("close", (code, signal) => resolve(signal ? 1 : (code ?? 1)));
  });

  process.exitCode = codigo;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

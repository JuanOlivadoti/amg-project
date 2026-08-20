/**
 * Genera las credenciales que **nosotros** emitimos, y se niega a inventar las que emite otro.
 *
 *     npm run credencial                                   # el catálogo entero
 *     npm run credencial -- DATABASE_URL_ORQUESTADOR --ref=<ref> --host=<host>
 *     npm run credencial -- PREVIEW_SECRET
 *
 * ## Por qué UN script con argumento y no `create-credential:<nombre>` por cada una
 *
 * Un script de npm por credencial obliga a editar `package.json` cada vez que aparece una, y el día
 * que alguien se olvide el comando simplemente no existe — sin que nada avise. Acá el catálogo vive en
 * un solo sitio (`CATALOGO`, abajo), `npm run credencial` sin argumentos lo lista, y un test ata ese
 * catálogo al `MAPA` de `env-sync.mts`: **agregar una clave al reparto sin clasificarla acá rompe la
 * suite**. La lista no se puede quedar vieja en silencio, que es el único modo de fallo que importa.
 *
 * ## Las cuatro familias, y por qué la distinción no es burocracia
 *
 * - `dsn`      — le generamos la password a un rol de Postgres y armamos su cadena de conexión.
 * - `secreto`  — una cadena opaca al azar (la comparten dos procesos nuestros y nadie más).
 * - `tercero`  — **la emite un proveedor**. Acá NO se genera nada: se dice quién la da y dónde.
 * - `config`   — no es un secreto, es configuración. Un valor al azar sería basura con formato.
 *
 * La familia `tercero` es la razón de ser de esto. Un generador ingenuo, ante `OPENAI_API_KEY`,
 * devolvería 32 caracteres al azar: una cadena que **parece** una key, entra en `credenciales.env` sin
 * chistar, y falla mucho más tarde con un 401 del proveedor que nadie relaciona con haberla
 * "generado". Producir algo plausible y equivocado es peor que no producir nada.
 */
import { randomBytes } from "node:crypto";
import { copyFileSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { FUENTE, MAPA } from "./env-sync.mts";

/**
 * El **puerto 6543 es el transaction pooler**, y no es intercambiable con el 5432. Todo el acceso del
 * proyecto va por transacción con conexión reservada (ADR-13), que es justo el patrón que ese modo
 * soporta. Es un default con dueño: si algún DSN necesitara otro, se declara en su entrada.
 */
const PUERTO_POOLER = 6543;

export type Familia = "dsn" | "secreto" | "tercero" | "config";

export interface Entrada {
  familia: Familia;
  /** `dsn`: el rol de Postgres cuya password se genera. */
  rol?: string;
  /** `dsn`: solo si NO es el pooler de transacciones. */
  puerto?: number;
  /** `tercero`: quién la emite y dónde se saca. `config`/`secreto`: qué es. */
  nota?: string;
}

/**
 * Qué es cada credencial del sistema. Incluye las que `env-sync` todavía no reparte (las del
 * orquestador, y las tres que a propósito no se le entregan al renderizador): el catálogo describe el
 * sistema, no el reparto. Lo que el test exige es la otra dirección — que **nada del `MAPA` falte acá**.
 */
export const CATALOGO: Record<string, Entrada> = {
  // --- Los DSN que emitimos nosotros. Un login por proceso, con su rol (ADR-17). ---
  DATABASE_URL_API: { familia: "dsn", rol: "amg_api" },
  DATABASE_URL_ORQUESTADOR: { familia: "dsn", rol: "amg_orquestador" },
  DATABASE_URL_CACHE: { familia: "dsn", rol: "amg_cache" },
  DATABASE_URL_RENDER: { familia: "dsn", rol: "amg_render" },

  // --- Secretos opacos compartidos entre procesos nuestros. ---
  PREVIEW_SECRET: { familia: "secreto", nota: "firma los enlaces de preview del Visual Editor" },
  STORYBLOK_WEBHOOK_SECRET: { familia: "secreto", nota: "valida los webhooks entrantes de Storyblok" },
  OAUTH_STATE_SECRET: {
    familia: "secreto",
    nota: "firma el `state` del callback OAuth de Google (api/src/oauth-state.ts) — sin él, el callback anónimo no puede confiar en el tenantId/userId que trae",
  },

  /*
   * El DSN del DUEÑO de la base, y por eso no está en la familia `dsn`: su password la fija Supabase
   * en el dashboard del proyecto, y rotarla desde acá con un `alter role postgres` es capaz de dejar
   * fuera al propio panel. Si hay que cambiarla, se cambia donde Supabase la administra.
   */
  DATABASE_URL_ADMIN: {
    familia: "tercero",
    nota: "Supabase → Project Settings → Database. Es el DSN del DUEÑO: no lo rotes con un alter role",
  },

  // --- Emitidas por terceros. Acá no se genera NADA. ---
  INNGEST_EVENT_KEY: { familia: "tercero", nota: "Inngest → entorno → Event Keys (autentica el ENVÍO)" },
  INNGEST_SIGNING_KEY: { familia: "tercero", nota: "Inngest → entorno → Signing Key (verifica la RECEPCIÓN)" },
  OPENAI_API_KEY: { familia: "tercero", nota: "platform.openai.com → API keys" },
  ANTHROPIC_API_KEY: { familia: "tercero", nota: "console.anthropic.com → API keys" },
  DATAFORSEO_LOGIN: { familia: "tercero", nota: "DataForSEO → API access" },
  DATAFORSEO_PASSWORD: { familia: "tercero", nota: "DataForSEO → API access" },
  STORYBLOK_MANAGEMENT_TOKEN: { familia: "tercero", nota: "Storyblok → My account → Personal access tokens (ESCRITURA)" },
  STORYBLOK_PUBLIC_TOKEN: { familia: "tercero", nota: "Storyblok → Space → Access tokens (lectura pública)" },
  STORYBLOK_PREVIEW_TOKEN: { familia: "tercero", nota: "Storyblok → Space → Access tokens (preview)" },

  // --- Configuración: no son secretos y un valor al azar no significaría nada. ---
  SUPABASE_JWT_ISS: { familia: "config", nota: "https://<ref>.supabase.co/auth/v1" },
  SUPABASE_JWT_AUD: { familia: "config", nota: "normalmente `authenticated`" },
  CORS_ORIGINS: { familia: "config", nota: "los orígenes permitidos, separados por coma" },
  SEED_FRANK_USER_ID: { familia: "config", nota: "el UUID del usuario en Supabase Auth" },
  SEED_JUAN_USER_ID: { familia: "config", nota: "el UUID del usuario en Supabase Auth" },
  DATAFORSEO_MODE: { familia: "config", nota: "`live` gasta dinero; cualquier otro valor da mock" },
  DATAFORSEO_BASE_URL: { familia: "config", nota: "sandbox o producción" },
  LLM_PROVIDER: { familia: "config" },
  PROSE_MODE: { familia: "config" },
  WEB_PUBLISH_MODE: { familia: "config", nota: "`dry-run` no publica" },
  PIPELINE_MODO: { familia: "config", nota: "`mock` | `live`, sin default: declara qué corre este despliegue" },
  GOOGLE_REVIEWS_MODO: {
    familia: "config",
    nota: "`mock` | `live`, opcional (default `mock`): en qué modo lee reseñas de Google (Bloque F, fase 1)",
  },
  BORRADOR_RESENAS_MODO: {
    familia: "config",
    nota: "`mock` | `openai`, opcional (default derivado de OPENAI_API_KEY): en qué modo se genera el borrador de respuesta con IA (Bloque F, fase 2)",
  },
  STORYBLOK_SPACE_ID: { familia: "config" },
  STORYBLOK_REGION: { familia: "config" },
  DEMO_DOMAIN: { familia: "config" },
  BUSINESS_PROFILE_PATH: { familia: "config" },
  BRIEF_PATH: { familia: "config" },
  KR_BRIEF_PATH: { familia: "config" },
  // No las reparte `env:sync` (dependen del despliegue, no de la fuente), pero `auditar-railway`
  // necesita saber que NO son secretos: si no, informa "credencial de otro proceso" sobre un
  // booleano, y una herramienta que exagera se deja de leer.
  TRUST_PROXY: { familia: "config", nota: "`1` para confiar en X-Forwarded-For detrás del proxy" },
  CACHE_TTL_MS: { familia: "config", nota: "TTL de la cache del renderizador, en ms" },
  NPM_CONFIG_PRODUCTION: { familia: "config", nota: "del build de Railway, no del código" },
};

/**
 * 24 bytes = 192 bits, 32 caracteres de `A-Za-z0-9-_`.
 *
 * **`base64url` y no un alfabeto elegido a mano, por dos razones distintas.** La primera es que estas
 * cadenas viven DENTRO de una URL (`postgresql://usuario:PASS@host/…`): una `@`, una `/`, una `#` o un
 * `%` la rompen, a veces con un error claro y a veces conectando a otro sitio. `base64url` usa solo
 * caracteres no reservados, así que entra sin escapar nada. La segunda es el sesgo: el atajo habitual
 * —`bytes[i] % alfabeto.length`— favorece las primeras letras cuando la longitud no divide a 256,
 * mientras que base64 mapea 6 bits exactos por carácter y es uniforme por construcción.
 */
export function generarSecreto(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function construirDsn(rol: string, ref: string, host: string, puerto = PUERTO_POOLER): string {
  return `postgresql://${rol}.${ref}:${generarSecreto()}@${host}:${puerto}/postgres`;
}

/**
 * Mete (o reemplaza) `nombre=valor` en el texto de un `.env`, **conservando todo lo demás byte a byte**.
 *
 * Es una función pura sobre el texto y no sobre el disco a propósito: así el test la ejercita sin
 * acercarse a `docs/private/credenciales.env`, que es el archivo que menos ganas tenemos de tocar por
 * accidente.
 *
 * ### Las tres trampas, que son la razón de que esto no sea un `replace` de una línea
 *
 * 1. **El ancla lleva `=`.** Sin él, escribir `DATABASE_URL` pisaría `DATABASE_URL_API`, que empieza
 *    igual. El prefijo compartido es la norma en este proyecto, no la excepción.
 * 2. **Una línea comentada NO es la clave.** `#DATABASE_URL_CACHE=vieja` es historia, no configuración:
 *    tratarla como existente haría que "reemplazar" dejara la clave real intacta más abajo.
 * 3. **Se reemplaza EN SU SITIO.** Borrar y añadir al final movería la clave lejos del comentario que
 *    la explica, y este archivo está agrupado por paquete.
 */
export function upsertEnEnv(
  texto: string,
  nombre: string,
  valor: string,
): { texto: string; reemplazo: boolean; anterior?: string } {
  const lineas = texto.split(/\r?\n/);
  const ancla = new RegExp(`^\\s*${nombre.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);

  const i = lineas.findIndex((l) => ancla.test(l) && !l.trimStart().startsWith("#"));
  if (i === -1) {
    const cuerpo = texto.endsWith("\n") || texto === "" ? texto : `${texto}\n`;
    return { texto: `${cuerpo}${nombre}=${valor}\n`, reemplazo: false };
  }

  const anterior = lineas[i]!.slice(lineas[i]!.indexOf("=") + 1);
  lineas[i] = `${nombre}=${valor}`;
  return { texto: lineas.join("\n"), reemplazo: true, anterior };
}

/** Los últimos 4 caracteres y nada más: suficiente para reconocer un valor, inútil para usarlo. */
function enmascarar(v: string): string {
  return v.length <= 4 ? "****" : `…${v.slice(-4)} (${v.length} caracteres)`;
}

/**
 * Escribe la fuente **sin poder dejarla a medias**: se escribe un temporal y se renombra, que en el
 * mismo sistema de archivos es atómico. Un `writeFileSync` directo interrumpido deja el archivo
 * truncado — y este archivo no está en git, así que un truncamiento no se recupera de ningún lado.
 *
 * Y cuando el valor REEMPLAZA a otro, antes se copia a `.bak-<timestamp>`: la password vieja deja de
 * valer en cuanto corras el `alter role`, pero hasta entonces sigue siendo la que usan los servicios
 * desplegados. (El `.gitignore` cubre `docs/private*`, así que el backup nace ignorado.)
 */
function guardarEnFuente(nombre: string, valor: string, ruta = FUENTE): { reemplazo: boolean; backup?: string } {
  const original = readFileSync(ruta, "utf8");
  const { texto, reemplazo } = upsertEnEnv(original, nombre, valor);

  let backup: string | undefined;
  if (reemplazo) {
    backup = `${ruta}.bak-${Date.now()}`;
    copyFileSync(ruta, backup);
  }

  const tmp = `${ruta}.tmp-${process.pid}`;
  writeFileSync(tmp, texto, { mode: 0o600 });
  renameSync(tmp, ruta);
  return { reemplazo, backup };
}

function listar(): string {
  const porFamilia = (f: Familia) =>
    Object.entries(CATALOGO)
      .filter(([, e]) => e.familia === f)
      .map(([n, e]) => `    ${n}${e.nota ? `\n        ${e.nota}` : e.rol ? `\n        rol ${e.rol}` : ""}`)
      .join("\n");

  return [
    "\nCredenciales que ESTE script genera:\n",
    "  dsn — se genera la password del rol y se arma la cadena de conexión",
    "        (necesita --ref=<project-ref> --host=<host-del-pooler>)\n",
    porFamilia("dsn"),
    "\n  secreto — cadena opaca al azar\n",
    porFamilia("secreto"),
    "\n\nCredenciales que NO se generan acá — las emite un tercero:\n",
    porFamilia("tercero"),
    "\n\nY esto no son secretos, son configuración:\n",
    porFamilia("config"),
    "",
  ].join("\n");
}

function morir(msg: string): never {
  console.error(`\n${msg}\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const nombre = argv.find((a) => !a.startsWith("--"));
  if (!nombre) {
    console.log(listar());
    return;
  }

  const entrada = CATALOGO[nombre];
  if (!entrada) {
    morir(
      `No conozco la credencial \`${nombre}\`.\n` +
        "Corré `npm run credencial` sin argumentos para ver el catálogo.\n" +
        "Si es nueva de verdad, agregala a `CATALOGO` en scripts/credencial.mts decidiendo su familia.",
    );
  }

  if (entrada.familia === "tercero") {
    morir(
      `\`${nombre}\` NO se genera acá: la emite un tercero.\n  → ${entrada.nota ?? "(sin nota)"}\n\n` +
        "Generarte una cadena al azar te daría algo que PARECE una key, entraría en credenciales.env\n" +
        "sin chistar y fallaría mucho después con un 401 que nadie relaciona con esto.",
    );
  }

  if (entrada.familia === "config") {
    morir(
      `\`${nombre}\` no es un secreto, es configuración.\n  → ${entrada.nota ?? "(sin nota)"}\n\n` +
        "Un valor al azar acá sería basura con formato de credencial.",
    );
  }

  const flags = new Map(
    argv.filter((a) => a.startsWith("--")).map((a) => {
      const i = a.indexOf("=");
      return i === -1 ? [a.slice(2), ""] : [a.slice(2, i), a.slice(i + 1)];
    }),
  );

  const dryRun = flags.has("dry-run");
  const sinPreguntar = flags.has("si");

  let valor: string;
  let rol = "";
  let pass = "";

  if (entrada.familia === "secreto") {
    valor = generarSecreto();
  } else {
    const ref = flags.get("ref");
    const host = flags.get("host");
    if (!ref || !host) {
      morir(
        `\`${nombre}\` es un DSN: necesito --ref y --host.\n\n` +
          `  npm run credencial -- ${nombre} --ref=<project-ref> --host=<host-del-pooler>\n\n` +
          "  --ref   el project-ref de Supabase (el mismo que ya aparece en tu DSN de admin)\n" +
          "  --host  Supabase → Project Settings → Database → Connection string → Transaction pooler\n\n" +
          "Ninguno de los dos es secreto: el secreto es la password, y la genera este script.",
      );
    }
    rol = entrada.rol!;
    valor = construirDsn(rol, ref, host, entrada.puerto);
    pass = valor.slice(valor.indexOf(":", valor.indexOf("//")) + 1, valor.lastIndexOf("@"));
  }

  /*
   * Se mira ANTES de escribir si la clave ya estaba, porque las dos situaciones no son la misma cosa:
   * añadir una clave nueva no puede perder nada, y reemplazarla invalida una password que los
   * servicios YA desplegados están usando ahora mismo.
   */
  const previo = upsertEnEnv(readFileSync(FUENTE, "utf8"), nombre, valor);

  if (dryRun) {
    console.log(
      `\n--dry-run: no toco nada.\n\n` +
        `  ${previo.reemplazo ? "REEMPLAZARÍA" : "agregaría"} ${nombre} en ${FUENTE}` +
        (previo.reemplazo ? `\n  el valor actual es ${enmascarar(previo.anterior ?? "")}` : "") +
        "\n",
    );
    return;
  }

  if (previo.reemplazo && !sinPreguntar) {
    if (!process.stdin.isTTY) {
      morir(`\`${nombre}\` YA existe en la fuente. Volvé a correrlo con \`-- --si\` si es lo que querés.`);
    }
    console.log(
      `\n⚠️  \`${nombre}\` ya existe en ${FUENTE}\n` +
        `    valor actual: ${enmascarar(previo.anterior ?? "")}\n\n` +
        "    El valor viejo se guarda en un .bak al lado, pero los servicios YA desplegados\n" +
        "    siguen usando el viejo hasta que los actualices uno por uno.\n",
    );
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const r = (await rl.question("Escribí `reemplazar` para continuar: ")).trim();
      if (r !== "reemplazar") morir("Cancelado: no se tocó nada.");
    } finally {
      rl.close();
    }
  }

  const { reemplazo, backup } = guardarEnFuente(nombre, valor);

  console.log(`
=============================================================================
 ✅ ${reemplazo ? "Reemplazada" : "Agregada"} en docs/private/credenciales.env
=============================================================================
${backup ? `\n El valor anterior quedó en:\n   ${backup}\n (gitignoreado. Borralo cuando confirmes que todo funciona.)\n` : ""}${
    rol
      ? `
=============================================================================
 1. Supabase → SQL Editor — sin esto, el DSN nuevo NO conecta:
=============================================================================

alter role ${rol} with password '${pass}';
`
      : ""
  }
=============================================================================
 ${rol ? "2." : "1."} El panel del servicio que la usa (Railway):
=============================================================================

${nombre}=${valor}
${
  rol
    ? `
=============================================================================
 3. Comprobalo ANTES de desplegar:
=============================================================================

npm run probar-dsn -- ${nombre}

 Lee el DSN de la fuente (no hace falta pegarlo, y así no queda en el historial
 de la shell), conecta con el mismo driver que usa la app y comprueba que el rol
 sea \`${rol}\`. Esa comprobación es el punto: conectar con el rol EQUIVOCADO no
 da error —pasa cuando se copia un DSN y se le cambia la password pero no el
 usuario— y se lee como éxito. Es el tropiezo número uno del renderizador.
`
    : ""
}
=============================================================================

 Ya está guardada en la fuente, pero \`env:sync\` NO la reparte sola: solo llegan
 a un paquete las claves que su entrada del MAPA declara.
${
  reemplazo
    ? `
 Y esto ya NO es reversible sin trabajo: la clave anterior dejó de ser la buena.
 Actualizá ${nombre} en TODOS los sitios que la tengan, no solo en uno.\n`
    : ""
}`);
}

/**
 * Puerta de arranque: solo corre como CLI, para que el test importe sin ejecutar nada.
 *
 * `pathToFileURL(...).href` y no `` `file://${process.argv[1]}` ``: en Windows `process.argv[1]`
 * trae backslashes (`C:\...`) y `import.meta.url` siempre usa `file:///C:/...` (forward slashes,
 * triple barra) — la concatenación cruda nunca compara igual ahí, así que `main()` no corría nunca
 * y el script quedaba mudo (sin error, sin escribir nada). Mismo patrón que ya usan
 * `env-sync.mts`/`secretos.mts`/`reseed-demo.mts`/`contar-tests.mts`/`auditar-railway.mts`.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

export { MAPA };

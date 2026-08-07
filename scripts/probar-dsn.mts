/**
 * Conecta con un DSN de `docs/private/credenciales.env` y comprueba **con qué rol entró**.
 *
 *     npm run probar-dsn -- DATABASE_URL_ORQUESTADOR
 *
 * ## Por qué existe, si el runbook decía `psql`
 *
 * Porque `psql` no está instalado en la máquina de desarrollo (medido el 2026-08-07), así que ese paso
 * del runbook no se podía ejecutar — y es un paso que el propio runbook llama el tropiezo número uno
 * del despliegue del renderizador. `pg` ya es dependencia de `db`, o sea que esto no instala nada y
 * además conecta **con el mismo driver que usa la aplicación**: si esto entra, la app entra.
 *
 * ## Y por qué comprueba el rol en vez de solo imprimirlo
 *
 * `psql … -c 'select current_user'` te imprime un nombre y **vos** tenés que notar que está mal. El
 * modo de fallo real no es no poder conectar: es conectar **con el rol equivocado**, porque alguien
 * copió un DSN y le cambió la password pero no el usuario. Eso conecta perfectamente y se lee como
 * éxito. Acá el rol esperado sale del `CATALOGO`, así que la comprobación la hace el programa.
 *
 * El DSN **no se imprime nunca**, ni siquiera en los errores: lleva la password dentro.
 */
import { readFileSync } from "node:fs";
import pg from "pg";
import { FUENTE, parsear } from "./env-sync.mts";
import { CATALOGO } from "./credencial.mts";

const nombre = process.argv[2];
if (!nombre) {
  console.error("\n  npm run probar-dsn -- DATABASE_URL_ORQUESTADOR\n");
  process.exit(1);
}

const entrada = CATALOGO[nombre];
if (!entrada || entrada.familia !== "dsn") {
  console.error(`\n\`${nombre}\` no es un DSN del catálogo. Mirá \`npm run credencial\`.\n`);
  process.exit(1);
}

const dsn = parsear(readFileSync(FUENTE, "utf8")).get(nombre);
if (!dsn) {
  console.error(`\n\`${nombre}\` no está en ${FUENTE}. Creala con:\n  npm run credencial -- ${nombre} …\n`);
  process.exit(1);
}

// El puerto se comprueba ANTES de conectar porque el 5432 conecta igual: es el pooler de sesión, no el
// de transacciones. Funcionaría hoy y fallaría bajo carga, que es la peor forma de estar mal (ADR-13).
const puerto = new URL(dsn).port;
if (puerto !== "6543") {
  console.warn(`⚠️  el puerto es ${puerto}, no 6543 (transaction pooler). Ver ADR-13.`);
}

const cliente = new pg.Client({ connectionString: dsn, connectionTimeoutMillis: 10_000 });

try {
  await cliente.connect();
  const { rows } = await cliente.query<{ usuario: string; base: string }>(
    "select current_user as usuario, current_database() as base",
  );
  const usuario = rows[0]!.usuario;

  if (usuario === entrada.rol) {
    console.log(`\n✅ ${nombre} conecta como \`${usuario}\` en \`${rows[0]!.base}\`. Es el rol esperado.\n`);
  } else {
    console.error(
      `\n❌ ${nombre} conecta, pero como \`${usuario}\` y se esperaba \`${entrada.rol}\`.\n\n` +
        "   Conectar con el rol equivocado NO da error: le cambiaste la password al DSN pero no el\n" +
        "   usuario. Es el tropiezo número uno del despliegue del renderizador.\n",
    );
    process.exitCode = 1;
  }
} catch (e) {
  // El mensaje del driver, nunca el DSN: la cadena lleva la password dentro.
  console.error(`\n❌ ${nombre} no conecta: ${(e as Error).message}\n`);
  process.exitCode = 1;
} finally {
  await cliente.end().catch(() => {});
}

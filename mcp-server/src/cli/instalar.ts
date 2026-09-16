import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, posix as posixPath, win32 as winPath } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

export interface EntradaMcp {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Ubicación de `claude_desktop_config.json` según el SO — la app la fija, no es configurable.
 * En Windows depende de `APPDATA`, que siempre está seteado salvo un entorno roto; ahí se avisa en
 * vez de adivinar una ruta.
 */
export function rutaConfigClaudeDesktop(
  plataforma: NodeJS.Platform,
  homedirUsuario: string,
  appData?: string,
): string {
  if (plataforma === "win32") {
    if (!appData) {
      throw new Error("No se encontró la variable de entorno APPDATA (necesaria en Windows).");
    }
    return winPath.join(appData, "Claude", "claude_desktop_config.json");
  }
  if (plataforma === "darwin") {
    return posixPath.join(homedirUsuario, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (plataforma === "linux") {
    return posixPath.join(homedirUsuario, ".config", "Claude", "claude_desktop_config.json");
  }
  throw new Error(
    `Plataforma no soportada por el instalador: ${plataforma}. Registrá el servidor a mano — ver README.md.`,
  );
}

/**
 * Rutas absolutas al CLI de `tsx` (dentro de `node_modules/` de la raíz del monorepo, hoisteado por
 * npm workspaces) y a `mcp-server/src/index.ts`, a partir de la raíz del repo. Absolutas a propósito:
 * Claude Desktop arranca el subproceso con un `PATH` que puede no incluir `npx` ni `node_modules/.bin`.
 */
export function resolverRutasRepo(repoRoot: string): { tsxCli: string; rutaIndex: string } {
  return {
    tsxCli: join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"),
    rutaIndex: join(repoRoot, "mcp-server", "src", "index.ts"),
  };
}

export interface OpcionesEntrada {
  nodeBin: string;
  tsxCli: string;
  rutaIndex: string;
  apiUrl: string;
  supabaseUrl: string;
  anonKey: string;
}

/** La entrada de `mcpServers.amg-os` — mismo formato que documenta el README, pero con rutas ya resueltas. */
export function construirEntradaAmg(opciones: OpcionesEntrada): EntradaMcp {
  return {
    command: opciones.nodeBin,
    args: [opciones.tsxCli, opciones.rutaIndex],
    env: {
      AMG_API_URL: opciones.apiUrl,
      AMG_SUPABASE_URL: opciones.supabaseUrl,
      AMG_SUPABASE_ANON_KEY: opciones.anonKey,
    },
  };
}

/**
 * Mergea la entrada `amg-os` dentro de `claude_desktop_config.json`, preservando cualquier otra clave
 * y cualquier otro servidor MCP que el usuario ya tenga registrado. `configTexto` es el contenido
 * crudo del archivo si existe (`undefined` si no hay archivo todavía).
 *
 * Un JSON existente que no parsea NO se pisa en silencio: un `writeFile` ciego ahí podría borrar la
 * configuración de otros servidores MCP del usuario, que no tienen nada que ver con este paquete.
 */
export function mergearConfig(configTexto: string | undefined, entrada: EntradaMcp): Record<string, unknown> {
  let config: Record<string, unknown> = {};
  if (configTexto && configTexto.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(configTexto);
    } catch {
      throw new Error(
        "El claude_desktop_config.json existente no es JSON válido — no lo toco. Arreglalo a mano (o " +
          "hacé una copia y borralo) y volvé a correr el instalador.",
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("El claude_desktop_config.json existente no tiene la forma esperada (un objeto).");
    }
    config = parsed as Record<string, unknown>;
  }

  const mcpServersExistente = config["mcpServers"];
  const mcpServers =
    typeof mcpServersExistente === "object" && mcpServersExistente !== null && !Array.isArray(mcpServersExistente)
      ? (mcpServersExistente as Record<string, unknown>)
      : {};

  return {
    ...config,
    mcpServers: {
      ...mcpServers,
      "amg-os": entrada,
    },
  };
}

/** Mensaje final, deliberadamente SIN ninguna key — solo la ruta y los dos próximos pasos manuales. */
export function mensajeExitoInstalacion(rutaConfig: string): string {
  return (
    `✔ amg-os registrado en ${rutaConfig}. Si todavía no iniciaste sesión, corré ` +
    `"npm run mcp:login -w mcp-server", y reiniciá Claude Desktop para que tome la config nueva.`
  );
}

async function leerConfigExistente(ruta: string): Promise<string | undefined> {
  try {
    return await readFile(ruta, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}

async function main(): Promise<void> {
  const rutaConfig = rutaConfigClaudeDesktop(process.platform, homedir(), process.env["APPDATA"]);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const { tsxCli, rutaIndex } = resolverRutasRepo(repoRoot);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const supabaseUrl = (await rl.question("URL de Supabase (AMG_SUPABASE_URL): ")).trim();
    const anonKey = (await rl.question("Anon key de Supabase (AMG_SUPABASE_ANON_KEY): ")).trim();
    const apiUrlIngresada = (await rl.question("AMG_API_URL [http://localhost:3000]: ")).trim();
    const apiUrl = apiUrlIngresada || "http://localhost:3000";

    if (!supabaseUrl || !anonKey) {
      throw new Error("AMG_SUPABASE_URL y AMG_SUPABASE_ANON_KEY son obligatorios.");
    }

    const entrada = construirEntradaAmg({
      nodeBin: process.execPath,
      tsxCli,
      rutaIndex,
      apiUrl,
      supabaseUrl,
      anonKey,
    });
    const configExistente = await leerConfigExistente(rutaConfig);
    const configFinal = mergearConfig(configExistente, entrada);

    await mkdir(dirname(rutaConfig), { recursive: true });
    await writeFile(rutaConfig, `${JSON.stringify(configFinal, null, 2)}\n`, "utf8");

    console.log(mensajeExitoInstalacion(rutaConfig));
  } finally {
    rl.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  });
}

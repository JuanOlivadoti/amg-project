import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import {
  construirEntradaAmg,
  mensajeExitoInstalacion,
  mergearConfig,
  resolverRutasRepo,
  rutaConfigClaudeDesktop,
} from "./instalar.js";

test("rutaConfigClaudeDesktop: en win32 usa APPDATA\\Claude\\claude_desktop_config.json", () => {
  const ruta = rutaConfigClaudeDesktop("win32", "C:\\Users\\juan", "C:\\Users\\juan\\AppData\\Roaming");
  assert.equal(ruta, "C:\\Users\\juan\\AppData\\Roaming\\Claude\\claude_desktop_config.json");
});

test("rutaConfigClaudeDesktop: en win32 sin APPDATA, tira un error accionable", () => {
  assert.throws(
    () => rutaConfigClaudeDesktop("win32", "C:\\Users\\juan", undefined),
    /APPDATA/,
  );
});

test("rutaConfigClaudeDesktop: en darwin usa ~/Library/Application Support/Claude", () => {
  const ruta = rutaConfigClaudeDesktop("darwin", "/Users/juan");
  assert.equal(ruta, "/Users/juan/Library/Application Support/Claude/claude_desktop_config.json");
});

test("rutaConfigClaudeDesktop: en linux usa ~/.config/Claude", () => {
  const ruta = rutaConfigClaudeDesktop("linux", "/home/juan");
  assert.equal(ruta, "/home/juan/.config/Claude/claude_desktop_config.json");
});

test("rutaConfigClaudeDesktop: plataforma no soportada tira un error que lo dice", () => {
  assert.throws(() => rutaConfigClaudeDesktop("sunos", "/home/juan"), /no soportada/i);
});

test("resolverRutasRepo: arma las rutas de node_modules/tsx y de mcp-server/src/index.ts desde la raíz", () => {
  const { tsxCli, rutaIndex } = resolverRutasRepo("/repo");
  assert.equal(tsxCli, join("/repo", "node_modules", "tsx", "dist", "cli.mjs"));
  assert.equal(rutaIndex, join("/repo", "mcp-server", "src", "index.ts"));
});

test("construirEntradaAmg: arma command/args/env sin depender de PATH (rutas absolutas)", () => {
  const entrada = construirEntradaAmg({
    nodeBin: "/usr/bin/node",
    tsxCli: "/repo/node_modules/tsx/dist/cli.mjs",
    rutaIndex: "/repo/mcp-server/src/index.ts",
    apiUrl: "http://localhost:3000",
    supabaseUrl: "https://proyecto.supabase.co",
    anonKey: "anon-key-de-prueba",
  });
  assert.deepEqual(entrada, {
    command: "/usr/bin/node",
    args: ["/repo/node_modules/tsx/dist/cli.mjs", "/repo/mcp-server/src/index.ts"],
    env: {
      AMG_API_URL: "http://localhost:3000",
      AMG_SUPABASE_URL: "https://proyecto.supabase.co",
      AMG_SUPABASE_ANON_KEY: "anon-key-de-prueba",
    },
  });
});

const entradaDePrueba = construirEntradaAmg({
  nodeBin: "/usr/bin/node",
  tsxCli: "/repo/node_modules/tsx/dist/cli.mjs",
  rutaIndex: "/repo/mcp-server/src/index.ts",
  apiUrl: "http://localhost:3000",
  supabaseUrl: "https://proyecto.supabase.co",
  anonKey: "anon-key-de-prueba",
});

test("mergearConfig: sin archivo previo, crea mcpServers con solo amg-os", () => {
  const resultado = mergearConfig(undefined, entradaDePrueba);
  assert.deepEqual(resultado, { mcpServers: { "amg-os": entradaDePrueba } });
});

test("mergearConfig: preserva otros mcpServers existentes y otras claves del archivo", () => {
  const existente = JSON.stringify({
    algunaOtraClave: true,
    mcpServers: { "otro-server": { command: "otro", args: [] } },
  });
  const resultado = mergearConfig(existente, entradaDePrueba);
  assert.deepEqual(resultado, {
    algunaOtraClave: true,
    mcpServers: {
      "otro-server": { command: "otro", args: [] },
      "amg-os": entradaDePrueba,
    },
  });
});

test("mergearConfig: reinstalar sobreescribe SOLO la entrada amg-os, no el resto", () => {
  const existente = JSON.stringify({
    mcpServers: { "amg-os": { command: "viejo", args: [], env: {} }, "otro-server": { command: "x", args: [] } },
  });
  const resultado = mergearConfig(existente, entradaDePrueba);
  const mcpServers = (resultado as { mcpServers: Record<string, unknown> }).mcpServers;
  assert.deepEqual(mcpServers["amg-os"], entradaDePrueba);
  assert.deepEqual(mcpServers["otro-server"], { command: "x", args: [] });
});

test("mergearConfig: JSON existente inválido NO se pisa en silencio — tira un error", () => {
  assert.throws(() => mergearConfig("{ esto no es json", entradaDePrueba), /JSON válido/);
});

test("mergearConfig: archivo existente que no es un objeto (array) tira un error", () => {
  assert.throws(() => mergearConfig("[1,2,3]", entradaDePrueba), /forma esperada/);
});

test("mensajeExitoInstalacion: menciona la ruta, el login y reiniciar Claude Desktop", () => {
  const msg = mensajeExitoInstalacion("/home/juan/Library/Application Support/Claude/claude_desktop_config.json");
  assert.match(msg, /claude_desktop_config\.json/);
  assert.match(msg, /mcp:login/);
  assert.match(msg, /reinicia|reiniciá/i);
});

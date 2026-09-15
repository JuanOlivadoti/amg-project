import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { iniciarSesion, type OpcionesGoTrue } from "../gotrue.js";
import { escribirSesion, rutaSesion } from "../session.js";

/** Mensaje final, deliberadamente SIN el token — esto es lo único que se imprime tras loguear. */
export function mensajeExito(ruta: string, tenantId: string): string {
  return `✔ Sesión guardada en ${ruta} (tenant ${tenantId}). Ya podés arrancar Claude Desktop.`;
}

function leerOpcionesGoTrue(): OpcionesGoTrue {
  const supabaseUrl = process.env["AMG_SUPABASE_URL"];
  const anonKey = process.env["AMG_SUPABASE_ANON_KEY"];
  if (!supabaseUrl || !anonKey) {
    throw new Error(
      "Faltan AMG_SUPABASE_URL y/o AMG_SUPABASE_ANON_KEY en el entorno. Ver mcp-server/README.md.",
    );
  }
  return { supabaseUrl, anonKey };
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const email = await rl.question("Email de AMG OS: ");
    // Sin enmascarar — node:readline no lo soporta nativo. Ver el comentario del plan de esta tarea.
    const password = await rl.question("Contraseña: ");
    const sesion = await iniciarSesion(leerOpcionesGoTrue(), email.trim(), password);
    await escribirSesion(sesion);
    console.log(mensajeExito(rutaSesion(), sesion.tenantId));
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

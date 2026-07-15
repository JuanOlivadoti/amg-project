import { NodePgPool, PgStore } from "db";
import { Inngest } from "inngest";
import { verificadorSupabase, type VerificadorToken } from "./auth.js";
import type { EmisorEventos } from "./solicitar.js";
import type { ApiDeps } from "./app.js";

/**
 * El composition root de la API: el ÚNICO lugar que toca credenciales y red. `app.ts` no sabe de
 * Postgres, Inngest ni Supabase — recibe interfaces. Es lo que hace la API testeable sin nada de eso.
 */
export interface ConfigApi {
  /** Cadena de conexión del login `amg_api`. Ese login SOLO puede asumir `app_user` (ADR-17). */
  databaseUrl: string;
  /** Secreto del JWT de Supabase (HS256), para verificar la firma del token. */
  jwtSecret: string;
  /** Id de la app Inngest emisora. La API es una app distinta del orquestador: solo envía eventos. */
  inngestId?: string;
}

/** Lee la config del entorno y **falla cerrado** si falta algo: una API a medio configurar no arranca. */
export function leerConfig(): ConfigApi {
  const databaseUrl = process.env["DATABASE_URL_API"];
  const jwtSecret = process.env["SUPABASE_JWT_SECRET"];
  const faltan = [
    !databaseUrl && "DATABASE_URL_API (login amg_api → rol app_user)",
    !jwtSecret && "SUPABASE_JWT_SECRET (para verificar el token)",
  ].filter((x): x is string => Boolean(x));
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno de la API:\n  - ${faltan.join("\n  - ")}`);
  }
  return { databaseUrl: databaseUrl as string, jwtSecret: jwtSecret as string };
}

/** Construye las dependencias reales. Devuelve también `cerrar` para soltar el pool al apagar. */
export async function crearDeps(
  config: ConfigApi,
): Promise<{ deps: ApiDeps; cerrar: () => Promise<void> }> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: config.databaseUrl });

  // amg_api → app_user. Si este login intentara asumir `app_service`, Postgres rechaza el `set role`
  // (0003_credenciales.sql): la frontera es una credencial, no un `if` (ADR-17).
  const store = new PgStore(new NodePgPool(pool), "app_user");

  // Inngest como emisor. La API solo ENVÍA (`research/solicitado`, `research/aprobado`); las funciones
  // suscritas viven en el orquestador. `send({name, data})` ya cumple la interfaz `EmisorEventos`.
  const inngest = new Inngest({ id: config.inngestId ?? "amg-os-api" });
  const emisor: EmisorEventos = {
    send: (evento) => inngest.send({ name: evento.name, data: evento.data }),
  };

  const verificar: VerificadorToken = verificadorSupabase(config.jwtSecret);

  return { deps: { store, emisor, verificar }, cerrar: () => pool.end() };
}

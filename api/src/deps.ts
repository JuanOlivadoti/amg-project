import { NodePgPool, PgStore } from "db";
import { Inngest } from "inngest";
import {
  verificadorSupabase,
  emisorSupabase,
  jwksDeSupabase,
  type EmisorSupabase,
  type VerificadorToken,
} from "./auth.js";
import type { EmisorEventos } from "./solicitar.js";
import type { ApiDeps } from "./app.js";

/**
 * El composition root de la API: el ÚNICO lugar que toca credenciales y red. `app.ts` no sabe de
 * Postgres, Inngest ni Supabase — recibe interfaces. Es lo que hace la API testeable sin nada de eso.
 */
export interface ConfigApi {
  /** Cadena de conexión del login `amg_api`. Ese login SOLO puede asumir `app_user` (ADR-17). */
  databaseUrl: string;
  /**
   * Emisor Supabase **ya validado y canonizado** (de `SUPABASE_JWT_ISS`). **Obligatorio**: de acá
   * salen las dos cosas que antes podían no coincidir — el `iss` que se le exige al token y la URL
   * del JWKS con el que se comprueba la firma. Antes el issuer era opcional; que lo fuera era el
   * agujero: un token válido de OTRO proyecto Supabase entraba.
   */
  emisor: EmisorSupabase;
  /** Id de la app Inngest emisora. La API es una app distinta del orquestador: solo envía eventos. */
  inngestId?: string;
  /** Orígenes CORS permitidos (coma-separados en `CORS_ORIGINS`). Sin esto: `*` (ver `app.ts`). */
  corsOrigins?: string[];
  /** `aud` esperado del JWT. Default `authenticated` (lo que emite Supabase). */
  jwtAudience?: string;
}

/** Lee la config del entorno y **falla cerrado** si falta algo: una API a medio configurar no arranca. */
export function leerConfig(): ConfigApi {
  const databaseUrl = process.env["DATABASE_URL_API"];
  const issCrudo = process.env["SUPABASE_JWT_ISS"]?.trim();
  const corsRaw = process.env["CORS_ORIGINS"]?.trim();
  // CORS_ORIGINS es OBLIGATORIO acá a propósito. `createApp` defaultea a `origin: *`, y para la API
  // local (dev-server, que arma sus deps a mano) eso está bien. Pero este `leerConfig` es el arranque
  // de PRODUCCIÓN, y la API es la única pieza autenticada expuesta a internet: dejarla en `*` porque
  // alguien olvidó una variable es exactamente la clase de default abierto que no debe existir.
  // Falla cerrado: sin el origen del portal, no arranca. (No es un bypass —la auth es por header, no
  // por cookies—, pero una restricción declarada y no impuesta no es una restricción.)
  const faltan = [
    !databaseUrl && "DATABASE_URL_API (login amg_api → rol app_user)",
    !issCrudo && "SUPABASE_JWT_ISS (https://<proy>.supabase.co/auth/v1; de acá sale el JWKS)",
    !corsRaw && "CORS_ORIGINS (origen del portal; en producción no se sirve con `*`)",
  ].filter((x): x is string => Boolean(x));
  if (faltan.length > 0) {
    throw new Error(`Faltan variables de entorno de la API:\n  - ${faltan.join("\n  - ")}`);
  }
  // Cada origen tiene que ser una URL http(s) COMPLETA, y `*` está prohibido explícitamente. Que la
  // variable exista no basta: `CORS_ORIGINS=*` la cumpliría y volvería a abrir la puerta que el `throw`
  // de arriba dice cerrar. Un elemento vacío (coma colgando) tampoco pasa —`origin: [""]` es un
  // origen que nadie tiene y que solo esconde un error de tipeo—.
  const corsOrigins = (corsRaw as string).split(",").map((s) => s.trim());
  for (const origen of corsOrigins) {
    if (origen === "*") {
      throw new Error("CORS_ORIGINS no puede ser `*`: producción se sirve solo a los orígenes del portal.");
    }
    if (origen === "") {
      throw new Error("CORS_ORIGINS tiene un origen vacío (¿una coma colgando?): revisá la lista.");
    }
    if (!esOrigenHttp(origen)) {
      throw new Error(`CORS_ORIGINS tiene un origen inválido: "${origen}". Debe ser una URL http(s) completa.`);
    }
  }

  const aud = process.env["SUPABASE_JWT_AUD"]?.trim();
  // Valida y canoniza acá, al arrancar: si el issuer está mal, la API no levanta. Es preferible a
  // levantar y rechazar todos los logins, que es como se ve el mismo error desde afuera.
  const emisor = emisorSupabase(issCrudo as string);
  return {
    databaseUrl: databaseUrl as string,
    emisor,
    corsOrigins,
    ...(aud ? { jwtAudience: aud } : {}),
  };
}

/**
 * ¿Es un ORIGEN http(s) válido? Un origen es `esquema://host[:puerto]`, sin path, query ni fragment
 * (es lo que un navegador manda en la cabecera `Origin`, y lo que `hono/cors` compara literalmente).
 * `https://app.x` pasa; `app.x`, `ftp://x`, `https://app.x/ruta` y `*` no.
 */
function esOrigenHttp(v: string): boolean {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return (u.pathname === "/" || u.pathname === "") && u.search === "" && u.hash === "";
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

  // El JWKS se deriva del MISMO emisor canónico que se exige como `iss`, y se comparte para toda la
  // vida del proceso: `createRemoteJWKSet` cachea la clave y refresca sola.
  const verificar: VerificadorToken = verificadorSupabase(jwksDeSupabase(config.emisor), {
    ...(config.jwtAudience ? { audience: config.jwtAudience } : {}),
    issuer: config.emisor.issuer,
  });

  return {
    deps: { store, emisor, verificar, ...(config.corsOrigins ? { corsOrigins: config.corsOrigins } : {}) },
    cerrar: () => pool.end(),
  };
}

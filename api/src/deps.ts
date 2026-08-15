import { NodePgPool, PgStore, PgClientes, PgMembresias, PgIdeas, PgResenas } from "db";
import { Inngest } from "inngest";
import {
  verificadorDeEmisor,
  emisorSupabase,
  type EmisorSupabase,
  type VerificadorToken,
} from "./auth.js";
import { getGoogleOAuthProvider } from "./google-oauth.js";
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
  /**
   * Clave de escritura de Inngest (`INNGEST_EVENT_KEY`). **Obligatoria si el SDK está en modo cloud**
   * — ver `exigirEventKeySiEsCloud`. Viaja por la config, y no se deja que el SDK la lea sola del
   * entorno, para que lo que se valida al arrancar y lo que se usa al emitir sean **el mismo valor**.
   */
  inngestEventKey?: string;
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
  // Mismo razonamiento para Inngest: sin event key en cloud, `POST /runs` falla en cada petición.
  const inngestEventKey = exigirEventKeySiEsCloud();
  return {
    databaseUrl: databaseUrl as string,
    emisor,
    corsOrigins,
    ...(aud ? { jwtAudience: aud } : {}),
    ...(inngestEventKey ? { inngestEventKey } : {}),
  };
}

/**
 * Si el SDK de Inngest va a hablar con Inngest **Cloud**, `INNGEST_EVENT_KEY` es obligatoria: sin
 * ella `inngest.send()` LANZA en cada llamada (`components/Inngest.js`: `if (this.mode.isCloud &&
 * !this.eventKeySet()) throw`).
 *
 * Por qué al arrancar y no en el primer `POST /runs`: es exactamente el argumento que ya está escrito
 * arriba para el issuer. Un despliegue sin esta variable **levanta sano** —`/health` responde 200, el
 * PaaS lo da por bueno— y falla recién cuando alguien pide un research; y como la fila del run se crea
 * ANTES de emitir (ADR-18), cada intento deja un run que nace muerto. Mejor no levantar.
 *
 * ## Cómo se decide "es cloud", y por qué NO se reimplementa
 *
 * El SDK infiere el modo de una lista de ~7 variables de varios PaaS (`NODE_ENV` que empiece con
 * `prod`, `RAILWAY_GIT_BRANCH`, `VERCEL_ENV`, `CF_PAGES`, `CONTEXT`…), y `INNGEST_DEV` lo fija a mano.
 * Copiar esa lista acá sería un `if` que se desincroniza de la librería en el próximo `npm update`,
 * **en silencio y hacia el lado inseguro** (una variable nueva que el SDK cuente como cloud y nosotros
 * no ⇒ vuelve el bug que esto arregla). Así que no se copia: se le pregunta al SDK.
 *
 * El problema es que no hay forma soportada de preguntárselo. Medido contra `inngest@3.54.2`:
 * `getMode`/`Mode` existen en `helpers/env.js` pero **el mapa `exports` del paquete no los publica**
 * (`import("inngest/helpers/env")` → `ERR_PACKAGE_PATH_NOT_EXPORTED`), y en la clase el campo es
 * `private get mode()` (`components/Inngest.d.ts:154`), o sea TS2341.
 *
 * De las dos opciones malas se elige la que falla RUIDOSA: se construye un cliente sonda (no hace
 * red — el modo sale de `process.env` en el constructor) y se lee `mode.isCloud` por un cast estrecho,
 * comprobando la forma. Si una versión futura renombra el campo, esto **lanza al arrancar** en vez de
 * asumir "dev" y volver a dejar pasar el despliegue roto.
 *
 * Lo que ata la duplicación que así no hace falta: los tests de `deps.test.ts` no simulan el modo —
 * ponen `RAILWAY_GIT_BRANCH` y `NODE_ENV=production` de verdad y dejan que el SDK decida. Si el SDK
 * cambia cómo infiere, o dónde guarda el modo, esos tests se ponen rojos.
 */
function exigirEventKeySiEsCloud(): string | undefined {
  const eventKey = process.env["INNGEST_EVENT_KEY"]?.trim();
  const sonda = new Inngest({ id: "amg-os-sonda-de-modo" });
  const modo = (sonda as unknown as { mode?: { isCloud?: unknown } }).mode;
  if (typeof modo?.isCloud !== "boolean") {
    throw new Error(
      "No se pudo leer el modo del SDK de Inngest (`mode.isCloud` ya no está donde se lo esperaba). " +
        "Revisá `exigirEventKeySiEsCloud` en api/src/deps.ts contra la versión instalada de `inngest`.",
    );
  }
  if (modo.isCloud && !eventKey) {
    throw new Error(
      "Falta INNGEST_EVENT_KEY: el SDK de Inngest está en modo cloud y sin esa clave `send()` lanza, " +
        "así que POST /runs fallaría en cada petición.\n" +
        "  - Ponela en las variables del servicio de la API en Railway (la Event Key del entorno, " +
        "desde el dashboard de Inngest).\n" +
        "  - Si esto es un arranque LOCAL contra el dev server de Inngest, exportá INNGEST_DEV=1.",
    );
  }
  return eventKey;
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
  // Mismo pool, mismo login/rol: el CRM de clientes no es un dominio distinto de seguridad.
  const clientes = new PgClientes(new NodePgPool(pool), "app_user");
  // Mismo pool, mismo login/rol: los miembros tampoco lo son (pieza 2 — Usuarios).
  const membresias = new PgMembresias(new NodePgPool(pool), "app_user");
  /*
   * Ideas (pieza 3). **Sin literal de rol**, y no es un olvido: `PgIdeas` no acepta el parámetro
   * porque `app_service` no tiene un solo grant sobre `ideas` (0013), así que un `new PgIdeas(pool,
   * "app_service")` no compilaría siquiera. La garantía que en las tres líneas de arriba depende de
   * que este literal diga `app_user`, acá la da el tipo — no hay nada que un test pueda mutar.
   */
  const ideas = new PgIdeas(new NodePgPool(pool));
  // Reseñas de Google (Bloque F, fase 1). Mismo criterio que `ideas`: sin literal de rol.
  const resenas = new PgResenas(new NodePgPool(pool));

  // Inngest como emisor. La API solo ENVÍA (`research/solicitado`, `research/aprobado`); las funciones
  // suscritas viven en el orquestador. `send({name, data})` ya cumple la interfaz `EmisorEventos`.
  //
  // La `eventKey` se pasa EXPLÍCITA aunque el SDK sepa leer `INNGEST_EVENT_KEY` solo
  // (`Inngest.js:187` — `options.eventKey || env[InngestEventKey] || ""`). El motivo es que
  // `leerConfig` ya validó ese valor: si acá el SDK volviera a leer el entorno por su cuenta, lo
  // comprobado y lo usado serían dos lecturas distintas, y una restricción validada sobre otra cosa
  // no es una restricción.
  const inngest = new Inngest({
    id: config.inngestId ?? "amg-os-api",
    ...(config.inngestEventKey ? { eventKey: config.inngestEventKey } : {}),
  });
  const emisor: EmisorEventos = {
    send: (evento) => inngest.send({ name: evento.name, data: evento.data }),
  };

  // `verificadorDeEmisor` arma el `iss` que se exige y la URL del JWKS del MISMO `EmisorSupabase`,
  // así que acá no hay dos valores que puedan discrepar (a diferencia de pasarle el issuer aparte a
  // `verificadorSupabase`). El resolvedor por default de `verificadorDeEmisor` es el JWKS remoto, que
  // se comparte para toda la vida del proceso: `createRemoteJWKSet` cachea la clave y refresca sola.
  const verificar: VerificadorToken = verificadorDeEmisor(config.emisor, undefined, {
    ...(config.jwtAudience ? { audience: config.jwtAudience } : {}),
  });

  // Mock-first (Bloque F fase 1): mismo `GOOGLE_REVIEWS_MODO` que ya usa `orchestrator/src/config.ts`
  // para el polling — es el mismo botón de operación ("¿Google ya tiene credenciales reales?"),
  // aunque API y orquestador sean procesos separados con sus propias variables de entorno. Default
  // `mock`, igual que ahí: sin la variable, un despliegue nuevo no se rompe por no tener todavía la
  // integración real.
  const modoGoogleOAuth = process.env["GOOGLE_REVIEWS_MODO"]?.trim() === "live" ? "live" : "mock";
  const googleOAuth = getGoogleOAuthProvider(modoGoogleOAuth);

  return {
    deps: {
      store,
      clientes,
      membresias,
      ideas,
      resenas,
      googleOAuth,
      emisor,
      verificar,
      ...(config.corsOrigins ? { corsOrigins: config.corsOrigins } : {}),
      // El origen del PORTAL para el redirect final del callback OAuth: MISMO dato que `corsOrigins`,
      // tomado como el primero de la lista. El array puede llevar varios orígenes (front + un futuro
      // panel admin, por ejemplo) pero el callback solo necesita UNO para volver a aterrizar en una
      // pantalla — no es una variable de entorno conceptualmente nueva, es la misma que ya validó
      // `leerConfig` (CORS_ORIGINS), colapsada al primer elemento. El fallback de desarrollo es el
      // mismo puerto que usa `dev-server.ts` para el portal.
      portalUrl: config.corsOrigins?.[0] ?? "http://localhost:4200",
    },
    cerrar: () => pool.end(),
  };
}

/**
 * auditar-railway — compara la FUENTE de credenciales con lo que de verdad tiene cada servicio
 * desplegado, y dice qué falta, qué sobra y qué difiere. **Nunca imprime un valor.**
 *
 *   npm run auditar:railway
 *
 * ## Por qué existe (bloque A3 del plan)
 *
 * `npm run probar-dsn` verifica el DSN **de la fuente** — y no lo que tiene el proceso desplegado. El
 * 2026-08-07 dio verde mientras Railway tenía un `@base:` de host, y tres servicios se rompieron en
 * una hora. `env:sync` reparte a los `.env` **locales**; producción se sigue editando a mano, sin
 * validación, sin aviso, y con el fallo apareciendo minutos después en el arranque.
 *
 * ## Los dos niveles, y por qué no es una sola lista
 *
 * La primera versión de esto tenía **un** inventario: "lo que cada servicio tiene que tener". Al
 * correrlo contra Railway resultó que el orquestador tiene **seis** variables nuestras y no las veinte
 * esperadas, y que las catorce ausentes son **correctas**: sin `DATAFORSEO_*` el research es mock, sin
 * `OPENAI_API_KEY` la prosa es mock, sin `STORYBLOK_MANAGEMENT_TOKEN` la publicación es dry-run. Un
 * comparador que grita catorce veces por un despliegue sano se ignora a la tercera corrida, y entonces
 * no avisa el día que el fallo es real.
 *
 * Así que hay dos niveles, y la diferencia está **medida**, no opinada:
 *
 *  · `OBLIGATORIAS` — sin ellas el proceso **no arranca**. Sale del `faltan` de cada `leerConfig`
 *    (`api/src/deps.ts`, `orchestrator/src/config.ts`, `renderer/src/deps.ts`). Su ausencia es un fallo.
 *  · `SEGUN_MODO` — su ausencia **no es un olvido: es una declaración**, y el informe dice qué implica.
 *
 * ## Por qué el inventario NO es el `MAPA`
 *
 * El `MAPA` de `env-sync.mts` es el contrato del `.env` **local**, con prohibiciones deliberadas —hay
 * un test que impone *"el renderizador NUNCA recibe una credencial de base de datos"*— y el
 * renderizador **sí** tiene `DATABASE_URL_RENDER` en Railway. Comparar contra el `MAPA` pelado
 * informaría "no falta nada": el falso verde que esto existe para evitar. Cada clave que este
 * inventario agrega sobre el `MAPA` tiene que estar **justificada por nombre** o el test falla.
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { CATALOGO } from "./credencial.mts";
import { FUENTE, MAPA } from "./env-sync.mts";

/**
 * Los servicios desplegados, con el nombre EXACTO que tienen en Railway.
 *
 * ⚠️ El de la API se llama **`amg-project`**, no `amg-api`. Es un nombre heredado del primer despliegue
 * y no se toca desde acá (renombrar un servicio en Railway cambia su dominio generado). La primera
 * versión de este archivo asumió `amg-api` y no encontró nada: por eso el descubrimiento lista los
 * servicios reales en el error.
 */
export const SERVICIOS = ["amg-project", "amg-orchestrator", "amg-renderer"] as const;
export type Servicio = (typeof SERVICIOS)[number];

/** Qué proceso es cada uno, para que el informe se lea sin conocer los nombres heredados. */
export const ROL: Record<Servicio, string> = {
  "amg-project": "la API",
  "amg-orchestrator": "el orquestador",
  "amg-renderer": "el renderizador",
};

/**
 * Sin ellas el proceso **no arranca**. Medido en el `faltan` de cada `leerConfig`, no supuesto.
 *
 * `PORT` no está: la inyecta Railway y ponerla a mano rompe el arranque.
 */
export const OBLIGATORIAS: Record<Servicio, readonly string[]> = {
  // api/src/deps.ts:51 — y `INNGEST_EVENT_KEY`, que en modo cloud hace lanzar a `send()` (deps.ts:135).
  "amg-project": ["DATABASE_URL_API", "SUPABASE_JWT_ISS", "CORS_ORIGINS", "INNGEST_EVENT_KEY"],
  // orchestrator/src/config.ts:129 — las cuatro juntas, con `PIPELINE_MODO` sin default a propósito.
  "amg-orchestrator": [...MAPA.orchestrator],
  // renderer/src/deps.ts:39 — el webhook es obligatorio aunque podría arrancar sin él: sin invalidación
  // la cache solo caduca por TTL, y "el Visual Editor funciona" pasa a ser "casi funciona".
  "amg-renderer": ["DATABASE_URL_RENDER", "STORYBLOK_WEBHOOK_SECRET"],
};

/**
 * Su ausencia **no es un error: es una declaración**, y acá está escrito qué declara.
 *
 * Es la parte del informe que contesta la pregunta que uno tiene de verdad delante de un despliegue:
 * *¿esto qué va a hacer?* — y no *¿está completo?*, que no significa nada cuando media plataforma es
 * opcional a propósito.
 */
export const SEGUN_MODO: Record<Servicio, Readonly<Record<string, string>>> = {
  "amg-project": {
    SUPABASE_JWT_AUD: "sin ella, el `aud` esperado es `authenticated` (el default de Supabase)",
    SUPABASE_JWT_SECRET:
      "red de rollback: la exige el código VIEJO de la API. Hoy no se lee (se verifica contra el JWKS)",
  },
  "amg-orchestrator": {
    WEB_PUBLISH_MODE: "sin ella publica en **mock**: no toca Storyblok pero reporta `published: true`",
    STORYBLOK_DRY_RUN: "con `WEB_PUBLISH_MODE=storyblok`, es lo que separa dry-run de publicar de verdad",
    STORYBLOK_MANAGEMENT_TOKEN: "sin él no se puede publicar de verdad: se cae a dry-run",
    STORYBLOK_SPACE_ID: "el space global del CLI. El orquestador usa el del CLIENTE, leído bajo RLS",
    STORYBLOK_REGION: "sin ella, la Management API se busca en el host de la UE",
    DATAFORSEO_MODE: "sin ella el research NO va en vivo. Tiene que ser coherente con `PIPELINE_MODO`",
    DATAFORSEO_BASE_URL: "sandbox vs producción de DataForSEO",
    DATAFORSEO_LOGIN: "sin credenciales de DataForSEO el research es **mock**: keywords inventadas",
    DATAFORSEO_PASSWORD: "ídem",
    LLM_PROVIDER: "qué proveedor genera el contenido",
    OPENAI_API_KEY: "sin ella la prosa es **mock** (y con ella, publicar FACTURA: ver `modoProsa`)",
    ANTHROPIC_API_KEY: "alternativa a OpenAI",
    PROSE_MODE: "fuerza `openai` o `mock`. Sin ella, el default es `openai` **si hay key**",
    KR_BRIEF_PATH: "solo la usa el CLI del M1; el orquestador reconstruye el brief desde la base",
    BUSINESS_PROFILE_PATH: "ídem: el perfil sale de `clients.business_profile`, no de un archivo",
  },
  "amg-renderer": {
    PREVIEW_SECRET: "sin él no hay enlaces firmados de preview: el Visual Editor no puede previsualizar",
    STORYBLOK_PUBLIC_TOKEN: "sin él no se puede leer la Content Delivery API. El servicio arranca igual",
    STORYBLOK_PREVIEW_TOKEN: "el token de borradores, el que usa el Visual Editor",
    STORYBLOK_SPACE_ID: "el space que se sirve",
    STORYBLOK_REGION: "sin ella, la CDA se busca en el host de la UE",
    DEMO_DOMAIN: "el dominio de la demo, para el mapeo dominio → cliente",
    BRIEF_PATH: "solo el `demo-server`",
    BUSINESS_PROFILE_PATH: "solo el `demo-server`",
    CACHE_TTL_MS: "sin ella, el TTL por defecto de la cache",
    TRUST_PROXY: "si no es `1`, no se confía en `X-Forwarded-For`",
  },
};

/** Todo lo que este comando sabe nombrar para un servicio. Lo que no esté acá, "sobra". */
export function esperadas(s: Servicio): string[] {
  return [...OBLIGATORIAS[s], ...Object.keys(SEGUN_MODO[s])];
}

/**
 * Por qué cada clave esperada que **no** sale del `MAPA` de su paquete está en el inventario.
 *
 * No es documentación: es lo que mantiene auditable la holgura entre el contrato local y el de
 * producción. Un test exige que toda clave extra aparezca acá, así que agregar una obliga a redactar
 * el motivo — y una clave indefendible se nota al intentar escribirlo.
 */
export const EXTRA_JUSTIFICADO: Record<string, string> = {
  SUPABASE_JWT_SECRET:
    "Red de rollback: el código VIEJO de la API la exige para arrancar. `leerConfig` ya no la lee " +
    "(desde la pieza A se verifica contra el JWKS público), así que no molesta y permite volver atrás.",
  DATABASE_URL_RENDER:
    "El renderizador SÍ lee de Postgres en producción (login `amg_render` → rol `app_render`, el más " +
    "pobre del sistema). El reparto LOCAL se la niega a propósito y hay un test que lo impone; en " +
    "Railway la tiene porque es donde de verdad sirve dominios.",
  PREVIEW_SECRET:
    "Firma los enlaces de preview del Visual Editor de Storyblok. Solo existe en el servicio que " +
    "atiende el camino anónimo.",
  STORYBLOK_WEBHOOK_SECRET:
    "Verifica la firma del webhook con el que Storyblok invalida la cache al publicar. Sin ella " +
    "cualquiera podría forzar invalidaciones — y sin webhook, la cache solo caduca por TTL.",
  STORYBLOK_DRY_RUN:
    "Junto con `WEB_PUBLISH_MODE=storyblok` es lo que pone la publicación en dry-run: construye el " +
    "payload real y NO lo manda. No está en el `MAPA` porque en local el modo por defecto ya es mock.",
  CACHE_TTL_MS: "Ajuste de la cache del renderizador. No es un secreto y no se reparte.",
  TRUST_PROXY: "Si se confía en `X-Forwarded-For`. Depende del despliegue, no de la fuente.",
};

// ---------------------------------------------------------------- comparación (pura)

/** Qué es de verdad una clave que aparece donde no le toca. */
export type Gravedad = "credencial" | "config" | "sin-clasificar";

export interface Intrusa {
  readonly clave: string;
  readonly duenio: Servicio;
  readonly gravedad: Gravedad;
}

/**
 * Una clave de otro proceso no siempre es un agujero.
 *
 * La primera versión de esto llamaba **credencial** a todo lo que estuviera fuera de su sitio, y al
 * limpiar el panel quedaron `PIPELINE_MODO` y `TRUST_PROXY` bajo el titular "CREDENCIALES DE OTRO
 * PROCESO". Son un enum y un booleano: no hay nada que robar. Exagerar es el mismo pecado que este
 * comando persigue —afirmar más de lo que se sabe— y además se paga caro: una herramienta que
 * exagera se deja de leer, y el día que diga algo grave nadie va a mirar.
 *
 * La familia sale del `CATALOGO` de `credencial.mts`, que ya existe para decidir **cómo se crea**
 * cada credencial. Lo que no esté ahí no se adivina: se marca `sin-clasificar` y se pide decidirlo,
 * que es fallar ruidosamente en vez de fallar bien.
 */
export function gravedadDe(clave: string): Gravedad {
  const entrada = CATALOGO[clave];
  if (!entrada) return "sin-clasificar";
  return entrada.familia === "config" ? "config" : "credencial";
}

export interface Diferencia {
  readonly servicio: Servicio;
  /** Obligatoria y ausente. **Esto rompe el arranque**, y es el hallazgo que justifica el comando. */
  readonly faltan: readonly string[];
  /** Opcional y ausente: no es un error, es una declaración de modo. Se informa con su consecuencia. */
  readonly declaraciones: ReadonlyArray<readonly [string, string]>;
  /**
   * Está en este servicio y **pertenece al inventario de OTRO**. No es "sobra": es algo de otro
   * proceso dentro de éste. Lleva la gravedad, porque no todas pesan igual — ver `gravedadDe`.
   */
  readonly intrusas: ReadonlyArray<Intrusa>;
  /** Está en el servicio y este comando no la sabe nombrar. Nadie la declaró. */
  readonly sobran: readonly string[];
  /** Está en los dos y el valor NO coincide con el de la fuente. */
  readonly difieren: readonly string[];
  /** Está en los dos con el mismo valor. Solo el número: la lista sería ruido. */
  readonly coinciden: number;
}

/**
 * Huella de un valor. **Nunca se imprime el valor**, y esto tampoco lo revierte: 8 hex de un SHA-256.
 *
 * Sirve para lo único que hace falta —¿el de allá es el mismo que el de acá?— y para nada más. El
 * vacío se distingue a propósito: "está pero vacía" es un fallo distinto de "no está", y pasa
 * cualquier chequeo de "está definida".
 */
export function huella(valor: string): string {
  if (valor === "") return "(vacía)";
  return createHash("sha256").update(valor).digest("hex").slice(0, 8);
}

/** Las que pone Railway sola. Que "sobren" es lo normal, y listarlas sería ruido en cada corrida. */
const ES_DE_LA_PLATAFORMA = (k: string): boolean =>
  k === "PORT" || k.startsWith("RAILWAY_") || k.startsWith("NIXPACKS_");

/**
 * Compara lo esperado con lo real. Pura: el test la usa sin red y sin credenciales.
 *
 * Una clave que el servicio tiene y la fuente no, no se puede comparar por valor —y eso pasa a
 * propósito: hay variables que solo viven en Railway—. Lo que sí se puede afirmar siempre es si está.
 */
export function comparar(
  servicio: Servicio,
  real: ReadonlyMap<string, string>,
  fuente: ReadonlyMap<string, string>,
): Diferencia {
  const faltan = OBLIGATORIAS[servicio].filter((k) => !real.has(k));
  const declaraciones = Object.entries(SEGUN_MODO[servicio]).filter(([k]) => !real.has(k));
  const conocidas = new Set(esperadas(servicio));
  const desconocidas = [...real.keys()].filter((k) => !conocidas.has(k) && !ES_DE_LA_PLATAFORMA(k));

  /*
   * De lo que no le corresponde, lo que le corresponde a OTRO se separa a propósito.
   *
   * "Sobra una variable" suena a limpieza pendiente. "Este proceso tiene la contraseña de otro
   * proceso" es lo que de verdad pasa cuando aparece `DATABASE_URL_ORQUESTADOR` en la API, y es
   * justo el reparto que `env:sync` impone en local con un test. Postgres sigue impidiendo que
   * `amg_api` asuma `app_service` (ADR-17), pero un proceso que tiene el DSN del orquestador no
   * necesita asumir nada: se conecta como él.
   */
  const intrusas: Intrusa[] = desconocidas
    .map((k) => ({ clave: k, duenio: SERVICIOS.find((s) => s !== servicio && esperadas(s).includes(k)) }))
    .filter((x): x is { clave: string; duenio: Servicio } => x.duenio !== undefined)
    .map(({ clave, duenio }) => ({ clave, duenio, gravedad: gravedadDe(clave) }));
  const deOtro = new Set(intrusas.map((i) => i.clave));
  const sobran = desconocidas.filter((k) => !deOtro.has(k));

  const difieren: string[] = [];
  let coinciden = 0;
  for (const k of esperadas(servicio)) {
    const alla = real.get(k);
    const aca = fuente.get(k);
    if (alla === undefined || aca === undefined) continue;
    if (huella(alla) === huella(aca)) coinciden += 1;
    else difieren.push(k);
  }

  return { servicio, faltan, declaraciones, intrusas, sobran, difieren, coinciden };
}

/**
 * El informe, en texto. **Este es el sitio donde un descuido filtraría un secreto**, así que es una
 * función aparte y hay un test que le pasa valores reconocibles y exige que no aparezcan.
 */
export function formatear(diffs: readonly Diferencia[]): string {
  const out: string[] = [];
  for (const d of diffs) {
    const roto = d.faltan.length + d.difieren.length + d.sobran.length + d.intrusas.length;
    out.push(`\n── ${d.servicio} (${ROL[d.servicio]}) ${roto === 0 ? "✔" : "✖"}`);
    if (d.faltan.length) out.push(`   ✖ FALTAN, y sin ellas NO ARRANCA (${d.faltan.length}): ${d.faltan.join(", ")}`);
    if (d.difieren.length) out.push(`   ✖ DIFIEREN de la fuente (${d.difieren.length}): ${d.difieren.join(", ")}`);
    const cred = d.intrusas.filter((i) => i.gravedad !== "config");
    const conf = d.intrusas.filter((i) => i.gravedad === "config");
    if (cred.length) {
      out.push(`   ✖ CREDENCIALES DE OTRO PROCESO (${cred.length}) — ADR-17 dice un proceso, un login:`);
      for (const i of cred) {
        const duda = i.gravedad === "sin-clasificar" ? " ⚠️ sin clasificar en CATALOGO: decidí su familia" : "";
        out.push(`       ${i.clave} → es de ${i.duenio} (${ROL[i.duenio]})${duda}`);
      }
    }
    if (conf.length) {
      out.push(`   · configuración de otro proceso (${conf.length}) — no es un secreto, pero confunde:`);
      for (const i of conf) out.push(`       ${i.clave} → es de ${i.duenio} (${ROL[i.duenio]})`);
    }
    if (d.sobran.length) out.push(`   ✖ sin declarar en el inventario (${d.sobran.length}): ${d.sobran.join(", ")}`);
    out.push(`   · coinciden con la fuente: ${d.coinciden}`);
    if (d.declaraciones.length) {
      out.push(`   · ausentes A PROPÓSITO — lo que este despliegue declara (${d.declaraciones.length}):`);
      for (const [k, porque] of d.declaraciones) out.push(`       ${k}: ${porque}`);
    }
  }
  return out.join("\n");
}

/** ¿Hay algo que arreglar? Separado del formato porque decide el exit code. */
export function hayProblemas(diffs: readonly Diferencia[]): boolean {
  return diffs.some(
    (d) =>
      d.faltan.length > 0 ||
      d.difieren.length > 0 ||
      d.sobran.length > 0 ||
      d.intrusas.some((i) => i.gravedad !== "config"),
  );
}

// ---------------------------------------------------------------- Railway (la parte con red)

const API = "https://backboard.railway.com/graphql/v2";

/** Lee las variables de un servicio. Los valores no salen de acá: solo pasan por `huella`. */
export type LeerVariables = (servicio: Servicio) => Promise<Map<string, string>>;

interface RespuestaGql<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

/**
 * ⚠️ La cabecera es `Project-Access-Token`, **no** `Authorization: Bearer`.
 *
 * Medido el 2026-08-08 contra la API real: el token que tenemos es de **proyecto**, y con `Bearer`
 * toda query responde `HTTP 200` con `errors: ["Not Authorized"]` — un 200 que no es un éxito, que es
 * justo la forma de fallo que este archivo existe para no repetir. Con la cabecera correcta,
 * `projectToken { projectId environmentId }` devuelve el proyecto y el entorno **del propio token**,
 * así que no hace falta configurar ningún id: el token ya sabe dónde vive.
 */
async function gql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json", "project-access-token": token },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await r.json()) as RespuestaGql<T>;
  if (body.errors?.length) {
    const msg = body.errors.map((e) => e.message).join("; ");
    throw new Error(
      `Railway respondió ${r.status} con errores: ${msg}\n` +
        (msg.includes("Not Authorized")
          ? "  → `Not Authorized` con HTTP 200 suele ser un token de CUENTA usado como de proyecto (o al revés).\n" +
            "    Este comando espera uno de PROYECTO (Railway → el proyecto → Settings → Tokens)."
          : ""),
    );
  }
  if (!body.data) throw new Error(`Railway respondió ${r.status} sin datos`);
  return body.data;
}

const Q_TOKEN = `query { projectToken { projectId environmentId } }`;
const Q_PROYECTO = `query($id: String!) { project(id: $id) {
  name services { edges { node { id name } } }
} }`;
const Q_VARIABLES = `query($p: String!, $e: String!, $s: String!) {
  variables(projectId: $p, environmentId: $e, serviceId: $s)
}`;

/** Construye el lector contra la API real. El token dice su propio proyecto y entorno. */
export async function lectorDeRailway(token: string): Promise<LeerVariables> {
  const { projectToken } = await gql<{ projectToken: { projectId: string; environmentId: string } }>(
    token,
    Q_TOKEN,
    {},
  );
  const { project } = await gql<{
    project: { name: string; services: { edges: Array<{ node: { id: string; name: string } }> } };
  }>(token, Q_PROYECTO, { id: projectToken.projectId });

  const porNombre = new Map(project.services.edges.map((e) => [e.node.name, e.node.id]));

  return async (servicio) => {
    const id = porNombre.get(servicio);
    if (!id) {
      throw new Error(
        `El proyecto "${project.name}" no tiene el servicio "${servicio}".\n` +
          `  Tiene: ${[...porNombre.keys()].join(", ")}.\n` +
          "  Si alguno se renombró, actualizá SERVICIOS en scripts/auditar-railway.mts.",
      );
    }
    const { variables } = await gql<{ variables: Record<string, string> }>(token, Q_VARIABLES, {
      p: projectToken.projectId,
      e: projectToken.environmentId,
      s: id,
    });
    return new Map(Object.entries(variables ?? {}));
  };
}

// ---------------------------------------------------------------- orquestación

/**
 * Compara los tres servicios. **Control positivo obligatorio**: si un servicio devuelve CERO
 * variables, eso no es "no falta nada" — es que la lectura falló, y tiene que verse como fallo.
 *
 * Es el modo de error que esta herramienta existe para no repetir: `probar-dsn` daba verde midiendo
 * otra cosa. Un comparador que ante una respuesta vacía informa "todo bien" es peor que no tenerlo,
 * porque además tranquiliza.
 */
export async function auditar(
  leer: LeerVariables,
  fuente: ReadonlyMap<string, string>,
): Promise<Diferencia[]> {
  const out: Diferencia[] = [];
  for (const servicio of SERVICIOS) {
    const real = await leer(servicio);
    if (real.size === 0) {
      throw new Error(
        `${servicio} devolvió CERO variables. Eso no es "está limpio": es que la lectura falló ` +
          "(token sin permiso, servicio renombrado, entorno equivocado). Se aborta a propósito: " +
          "informar 'no falta nada' acá sería el falso verde que esta herramienta existe para evitar.",
      );
    }
    out.push(comparar(servicio, real, fuente));
  }
  return out;
}

/** Parsea la fuente. Igual que `env-sync`, pero acá los valores solo se usan para la huella. */
function leerFuente(): Map<string, string> {
  if (!existsSync(FUENTE)) throw new Error(`Falta ${FUENTE} (la fuente única, gitignoreada).`);
  const out = new Map<string, string>();
  for (const linea of readFileSync(FUENTE, "utf8").split(/\r?\n/)) {
    const l = linea.trim();
    if (!l || l.startsWith("#")) continue;
    const i = l.indexOf("=");
    if (i !== -1) out.set(l.slice(0, i).trim(), l.slice(i + 1).trim());
  }
  return out;
}

async function main(): Promise<void> {
  const fuente = leerFuente();
  const token = fuente.get("RAILWAY_API_TOKEN");
  if (!token) {
    console.error(
      "Falta RAILWAY_API_TOKEN en docs/private/credenciales.env.\n" +
        "Railway → el proyecto → Settings → Tokens. Es un token de PROYECTO y solo se lee con él.",
    );
    process.exit(1);
  }

  const diffs = await auditar(await lectorDeRailway(token), fuente);
  console.log(formatear(diffs));

  if (hayProblemas(diffs)) {
    console.log("\n✖ Hay diferencias entre la fuente y lo desplegado (arriba, por nombre).");
    process.exit(1);
  }
  console.log("\n✔ Los tres servicios coinciden con la fuente.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: unknown) => {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  });
}

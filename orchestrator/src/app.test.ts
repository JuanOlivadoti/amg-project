import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { Inngest } from "inngest";
import { serve } from "inngest/node";
import { PgStore } from "db";
import type { DbPool } from "db";
import { crearServidor, opcionesDeServe } from "./app.js";
import { crearFuncionResearch, inngest } from "./functions.js";
import type { Deps } from "./workflow.js";

/**
 * El servidor HTTP del orquestador: **una ruta de salud y una de Inngest**, nada más.
 *
 * Hasta ahora respondía 404 a todo lo que no fuera `/api/inngest`, así que no había health check y
 * el PaaS solo podía saber "el puerto acepta conexiones". La API tiene `/health` y el renderizador
 * `/_health`; acá se sigue al renderizador, que es el precedente más nuevo y el que dejó escrito el
 * porqué de que el chequeo **no toque sus dependencias**.
 */

const HOST = "127.0.0.1";

/** Levanta el servidor en un puerto efímero, corre `fn` contra él y lo cierra pase lo que pase. */
async function conServidor<T>(server: Server, fn: (base: string) => Promise<T>): Promise<T> {
  await new Promise<void>((listo) => server.listen(0, HOST, listo));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://${HOST}:${port}`);
  } finally {
    await new Promise<void>((listo) => server.close(() => listo()));
  }
}

/**
 * Las dependencias del orquestador con **la base caída**: cualquier transacción lanza.
 *
 * No es un adorno del test: es la única forma de probar el contrato del health check. Un chequeo que
 * consultara Postgres devolvería 503 acá, y eso es exactamente lo que no queremos — que Railway mate
 * y reinicie un proceso cuyo único problema es que la base está de mantenimiento, cuando lo correcto
 * es que el proceso siga vivo esperando a que vuelva (los runs de Inngest se reintentan solos).
 */
const CAIDA = "la base está caída (a propósito, en este test)";
const poolCaido: DbPool = {
  transaction: () => {
    throw new Error(CAIDA);
  },
};

function depsSobreBaseCaida(): Deps {
  return {
    store: new PgStore(poolCaido, "app_service"),
    research: () => Promise.reject(new Error("un health check no investiga")),
    publicar: () => Promise.reject(new Error("un health check no publica")),
    validarContrato: () => {
      throw new Error("un health check no valida briefs");
    },
  };
}

test("🔴 /_health responde 200 con la base CAÍDA: el chequeo no depende de sus dependencias", async () => {
  // Composición real: las funciones de Inngest montadas sobre unas deps cuya base lanza siempre.
  const funciones = [crearFuncionResearch(depsSobreBaseCaida())];
  const manejadorInngest = serve({ client: inngest, functions: funciones });
  const server = crearServidor({ manejadorInngest, funciones: funciones.length, modo: "dev", pipeline: "mock" });

  await conServidor(server, async (base) => {
    const r = await fetch(`${base}/_health`);
    assert.equal(r.status, 200, "un proceso vivo tiene que declararse vivo aunque la base no esté");
    const cuerpo = (await r.json()) as Record<string, unknown>;
    assert.equal(cuerpo["ok"], true);
    // Presión interna, que es lo que un operador puede saber sin preguntarle a nadie: un proceso
    // arriba con CERO funciones registradas está sano por dentro y es completamente inútil.
    assert.equal(cuerpo["funciones"], 1);
    assert.equal(cuerpo["modo"], "dev");
  });
});

test("🔴 /_health no pasa por el manejador de Inngest", async () => {
  let invocaciones = 0;
  const espia = (_req: IncomingMessage, res: ServerResponse) => {
    invocaciones += 1;
    res.writeHead(200).end("inngest");
  };
  const server = crearServidor({ manejadorInngest: espia, funciones: 1, modo: "cloud", pipeline: "live" });

  await conServidor(server, async (base) => {
    const r = await fetch(`${base}/_health`);
    assert.equal(r.status, 200);
    assert.equal(
      invocaciones,
      0,
      "el health check no puede delegar en Inngest: si Inngest Cloud está caído, este proceso sigue sano",
    );
    assert.equal(((await r.json()) as Record<string, unknown>)["modo"], "cloud");
  });
});

test("/api/inngest sigue delegando en el manejador del SDK", async () => {
  let invocaciones = 0;
  const espia = (_req: IncomingMessage, res: ServerResponse) => {
    invocaciones += 1;
    res.writeHead(200).end("inngest");
  };
  const server = crearServidor({ manejadorInngest: espia, funciones: 1, modo: "dev", pipeline: "mock" });

  await conServidor(server, async (base) => {
    const r = await fetch(`${base}/api/inngest`);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "inngest");
    assert.equal(invocaciones, 1);
  });
});

/**
 * 🔴 La clave que `leerConfig` validó tiene que ser la que el SDK USA para verificar firmas.
 *
 * Este es el test conductual del hallazgo: no comprueba que pasemos un campo, comprueba que una
 * petición **correctamente firmada por Inngest Cloud** no rebote.
 *
 * El escenario es el real: `INNGEST_SIGNING_KEY` con espacios al final —lo que deja copiar del
 * dashboard—. Nuestra validación la trimea; si `serve()` no recibiera la clave, el SDK releería el
 * entorno **crudo** (`InngestCommHandler.js:1454`) y firmaría contra un secreto distinto. El proceso
 * arranca, `/_health` responde 200, y **toda** invocación de Inngest devuelve 401.
 */
const LIMPIA = "signkey-prod-abc123def456";
const PEGADA = `${LIMPIA}   `;

/**
 * Reproduce la firma del SDK con `node:crypto`, sin importar sus internals (`helpers/net` no está en
 * el mapa `exports` del paquete). El SDK hace HMAC-SHA256 sobre `canonicalize(body) + ts` con la
 * clave SIN su prefijo `signkey-<env>-`, como texto plano (`helpers/net.js:34-45`).
 *
 * El cuerpo de abajo tiene las claves ya en orden alfabético y sin anidamiento con orden ambiguo, así
 * que su forma canónica es su `JSON.stringify` — por eso acá no hace falta `canonicalize`.
 */
function firmar(cuerpo: string, clave: string, ts: string): string {
  return createHmac("sha256", clave.replace(/^signkey-[\w]+-/, ""))
    .update(cuerpo)
    .update(ts)
    .digest("hex");
}

const CUERPO_CANONICO = '{"ctx":{},"event":{},"events":[],"steps":{},"use_api":false}';

async function pedirFirmado(conClaveValidada: boolean): Promise<number> {
  const guardado = { ...process.env };
  const errores = console.error;
  console.error = () => {}; // el SDK vuelca el fallo de firma; en el test es ruido esperado
  try {
    process.env["INNGEST_SIGNING_KEY"] = PEGADA; // el entorno SIEMPRE tiene el valor sucio
    process.env["RAILWAY_GIT_BRANCH"] = "main"; // modo cloud: sin esto no se verifica ninguna firma
    delete process.env["INNGEST_DEV"];

    const cliente = new Inngest({ id: `firma-${conClaveValidada}`, schemas: undefined as never });
    const fn = cliente.createFunction({ id: "f" }, { event: "x" }, () => Promise.resolve("ok"));
    const manejadorInngest = serve(
      opcionesDeServe(conClaveValidada ? { inngestSigningKey: LIMPIA } : {}, cliente, [fn]),
    );
    const server = crearServidor({ manejadorInngest, funciones: 1, modo: "cloud", pipeline: "live" });

    return await conServidor(server, async (base) => {
      const ts = Math.floor(Date.now() / 1000).toString(); // el SDK lo lee en SEGUNDOS
      const r = await fetch(`${base}/api/inngest?fnId=firma-${conClaveValidada}-f&stepId=step`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          // Firmada con la clave LIMPIA, que es la que Inngest Cloud usaría de verdad.
          "x-inngest-signature": `t=${ts}&s=${firmar(CUERPO_CANONICO, LIMPIA, ts)}`,
        },
        body: CUERPO_CANONICO,
      });
      return r.status;
    });
  } finally {
    console.error = errores;
    process.env = guardado;
  }
}

test("🔴 sin pasar la signingKey validada, una firma legítima de Inngest REBOTA con 401", async () => {
  assert.equal(
    await pedirFirmado(false),
    401,
    "si esto deja de dar 401, el escenario que motiva el arreglo ya no se reproduce y el test de abajo no prueba nada",
  );
});

test("🔴 pasando la signingKey validada, la misma firma legítima se ACEPTA", async () => {
  const status = await pedirFirmado(true);
  assert.notEqual(
    status,
    401,
    "la clave validada tiene que ser la usada: con 401 acá, Inngest Cloud no podría invocar ni una función",
  );
});

test("cualquier otra ruta sigue siendo 404", async () => {
  const espia = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(200).end("inngest");
  };
  const server = crearServidor({ manejadorInngest: espia, funciones: 1, modo: "dev", pipeline: "mock" });

  await conServidor(server, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/_health/algo`)).status, 404);
  });
});

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
import { crearSonda, DEPENDENCIA_BASE } from "./salud.js";
import type { Deps } from "./workflow.js";

/**
 * El servidor HTTP del orquestador: **una ruta de salud y una de Inngest**, nada más.
 *
 * Hasta ahora respondía 404 a todo lo que no fuera `/api/inngest`, así que no había health check y
 * el PaaS solo podía saber "el puerto acepta conexiones". La API tiene `/health` y el renderizador
 * `/_health`.
 *
 * ⚠️ **Este bloque decía que acá se sigue al renderizador, "que dejó escrito el porqué de que el
 * chequeo no toque sus dependencias". Era cierto y dejó de serlo el 2026-08-07.** El argumento del
 * renderizador es bueno para el renderizador y falso para el orquestador: para él la base **no es un
 * tercero, es todo lo que hace**. `/_health` ahora la comprueba —y sigue respondiendo **200**, que es
 * lo que de verdad valía de aquel razonamiento: si devolviera 503, Railway reiniciaría en bucle un
 * proceso cuyo único problema es que Postgres no responde.
 *
 * El comportamiento de la sonda (cache, timeout, log de la transición) se prueba en `salud.test.ts`,
 * que puede inyectarle el reloj. Acá se prueba lo que solo se ve por HTTP: que el 200 se mantiene y
 * que el campo llega al cuerpo.
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
 * No es un adorno del test: es la única forma de probar el contrato del health check. Lo que se exige
 * es la combinación —**200 Y `degradado`**—, y las dos mitades importan por motivos opuestos: el 200
 * evita que Railway mate y reinicie un proceso cuyo único problema es que la base está de
 * mantenimiento (los runs de Inngest se reintentan solos), y el `degradado` evita lo que pasó el
 * 2026-08-07: hora y media con `{"ok":true}` y el orquestador sin alcanzar Postgres.
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

test("🔴 /_health con la base CAÍDA: 200 por fuera, `degradado` por dentro", async () => {
  // Composición real: las funciones de Inngest montadas sobre unas deps cuya base lanza siempre, y la
  // sonda de verdad construida sobre el MISMO store. Si la sonda no pasara por el store, este test
  // seguiría verde con un `/_health` que no comprueba nada.
  const deps = depsSobreBaseCaida();
  const funciones = [crearFuncionResearch(deps)];
  const manejadorInngest = serve({ client: inngest, functions: funciones });
  const server = crearServidor({
    manejadorInngest,
    funciones: funciones.length,
    modo: "dev",
    pipeline: "mock",
    publicacion: "mock",
    sonda: crearSonda({ comprobar: () => deps.store.comprobarAcceso(), log: () => {} }),
  });

  await conServidor(server, async (base) => {
    const r = await fetch(`${base}/_health`);
    assert.equal(r.status, 200, "un proceso vivo tiene que declararse vivo aunque la base no esté");
    const cuerpo = (await r.json()) as Record<string, unknown>;
    assert.equal(cuerpo["ok"], true);
    // Presión interna, que es lo que un operador puede saber sin preguntarle a nadie: un proceso
    // arriba con CERO funciones registradas está sano por dentro y es completamente inútil.
    assert.equal(cuerpo["funciones"], 1);
    assert.equal(cuerpo["modo"], "dev");
    // Y la mitad nueva: el 200 ya no puede significar "todo bien".
    assert.deepEqual(
      cuerpo["degradado"],
      [DEPENDENCIA_BASE],
      "sin esto, el 200 vuelve a ser la mentira que costó hora y media el 2026-08-07",
    );
    // El motivo NO viaja: `/_health` es público y el mensaje de Postgres lleva host y usuario.
    assert.equal(JSON.stringify(cuerpo).includes(CAIDA), false);
  });
});

/**
 * 🔴 Con la base SANA, el campo no aparece — el control positivo del test de arriba.
 *
 * Sin éste, una sonda que devolviera `degradado` **siempre** dejaría verde al anterior, y `/_health`
 * pasaría de mentir en un sentido a mentir en el otro.
 */
test("🔴 /_health con la base sana: NI RASTRO del campo `degradado`", async () => {
  const server = crearServidor({
    manejadorInngest: (_req, res) => {
      res.writeHead(200).end("inngest");
    },
    funciones: 2,
    modo: "cloud",
    pipeline: "mock",
    publicacion: "dry-run",
    sonda: crearSonda({ comprobar: async () => undefined }),
  });

  await conServidor(server, async (base) => {
    const cuerpo = (await (await fetch(`${base}/_health`)).json()) as Record<string, unknown>;
    assert.equal(cuerpo["ok"], true);
    assert.equal("degradado" in cuerpo, false);
    /*
     * Y el modo de publicación viaja en el cuerpo (paso C-0 del plan). Va acá, en el test del
     * proceso SANO, porque es el escenario en el que alguien lo va a leer: antes de lanzar un
     * research, para saber si lo que sigue escribe en el Storyblok del cliente o en `out/`.
     *
     * Lo que este test NO puede probar es que el valor sea el verdadero —eso lo fijan los tres tests
     * de `web-builder/src/publish/`, uno por estado—. Acá se fija que el campo exista y no se
     * invente: `dry-run` entró por parámetro y `dry-run` tiene que salir.
     */
    assert.equal(cuerpo["publicacion"], "dry-run");
    assert.equal(cuerpo["pipeline"], "mock", "y no se cruzan: son dos modos distintos");
  });
});

/**
 * 🔴 La sonda recorre el `set local role`, no solo el TCP.
 *
 * Es el punto de fondo de la 15ª review: un `select 1` sobre la conexión cruda prueba que hay red y
 * contraseña, y **no** que el proceso pueda asumir su rol (ADR-17). El fallo del rol es justo el que
 * un `select 1` declararía sano. Se comprueba por el EFECTO —qué SQL acaba ejecutando— y no leyendo
 * un campo privado, que es la misma técnica que fija `app_service` en `config.test.ts`.
 */
test("🔴 la sonda pasa por el rol del proceso (un `select 1` pelado no probaría ADR-17)", async () => {
  const ejecutado: string[] = [];
  const poolEspia: DbPool = {
    transaction: async <T>(fn: (tx: never) => Promise<T>): Promise<T> => {
      const tx = {
        exec: async (sql: string) => {
          ejecutado.push(sql);
        },
        query: async (sql: string) => {
          ejecutado.push(sql);
          return { rows: [] };
        },
      };
      return fn(tx as never);
    },
  };

  await new PgStore(poolEspia, "app_service").comprobarAcceso();

  assert.ok(
    ejecutado.some((s) => s.includes("set local role app_service")),
    `la sonda tiene que asumir el rol real. SQL ejecutado: ${JSON.stringify(ejecutado)}`,
  );
  assert.ok(ejecutado.some((s) => s.includes("select 1")), "y después comprobar que la base contesta");
});

test("🔴 /_health no pasa por el manejador de Inngest", async () => {
  let invocaciones = 0;
  const espia = (_req: IncomingMessage, res: ServerResponse) => {
    invocaciones += 1;
    res.writeHead(200).end("inngest");
  };
  const server = crearServidor({ manejadorInngest: espia, funciones: 1, modo: "cloud", pipeline: "live", publicacion: "mock" });

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
  const server = crearServidor({ manejadorInngest: espia, funciones: 1, modo: "dev", pipeline: "mock", publicacion: "mock" });

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
    const server = crearServidor({ manejadorInngest, funciones: 1, modo: "cloud", pipeline: "live", publicacion: "mock" });

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
  const server = crearServidor({ manejadorInngest: espia, funciones: 1, modo: "dev", pipeline: "mock", publicacion: "mock" });

  await conServidor(server, async (base) => {
    assert.equal((await fetch(`${base}/`)).status, 404);
    assert.equal((await fetch(`${base}/_health/algo`)).status, 404);
  });
});

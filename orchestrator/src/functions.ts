import { Inngest } from "inngest";
import type { GetStepTools } from "inngest";
import { PLAZO_RUN_COLGADO } from "db";
import type { Eventos } from "./events.js";
import type { Deps, Pasos } from "./workflow.js";
import { workflowResearch } from "./workflow.js";

export const inngest = new Inngest({ id: "amg-os", schemas: undefined as never });

type StepTools = GetStepTools<typeof inngest>;

/** Adapta los steps de Inngest a la interfaz mínima que usa el workflow. */
function adaptarPasos(step: StepTools): Pasos {
  return {
    run: (id, fn) => step.run(id, fn) as Promise<never>,
    esperarEvento: async (id, opts) =>
      (await step.waitForEvent(id, {
        event: opts.evento,
        timeout: opts.timeout,
        // Solo despierta el evento que trae ESTE runId. Sin el match, la aprobación de un run
        // despertaría a todos los que estén esperando.
        if: `async.data.runId == "${opts.runId}"`,
      })) as { data: unknown } | null,
  };
}

/**
 * El workflow del research, durable.
 *
 * ## Concurrencia: por qué el tope global NO va por tenant
 *
 * El rate limit de DataForSEO es **por cuenta**, y la cuenta es UNA para toda la agencia. Un tope
 * "2 por tenant" con diez tenants activos son veinte corridas simultáneas contra la misma cuenta:
 * el proveedor devuelve 40202 y las corridas fallan (o se reintentan y se pagan dos veces). Por eso
 * el límite duro es GLOBAL. El segundo límite, ese sí por tenant, es de equidad: impide que un
 * cliente con veinte negocios acapare la cola y deje a los demás esperando.
 *
 * ## Reintentos: pocos, porque cuestan dinero
 *
 * Un step que falla se reintenta ENTERO. El de research le paga a DataForSEO y al LLM. Lo de
 * DataForSEO (el 81% del costo) lo absorbe la cache: el reintento lo encuentra guardado. Lo del LLM
 * NO está cacheado y se vuelve a pagar. Con el default de Inngest (4 reintentos) un fallo
 * persistente del LLM podría multiplicar por cinco esa parte del gasto, así que se baja a 1: los
 * fallos transitorios de red ya los reintenta el cliente HTTP de `kr-service`, mucho más barato.
 */
/**
 * La concurrencia, **extraída para poder testearla**. Antes vivía inline y un typo silencioso
 * (`event.data.ctx.tenantId`, un campo inexistente) desactivó la equidad entre tenants sin que
 * ningún test lo notara — los tests corren `workflowResearch`, no la función de Inngest.
 *
 * `CLAVE_TENANT` tiene que apuntar a un campo que el evento **realmente lleva** (`events.ts`).
 */
export const CLAVE_TENANT = "event.data.tenantId";
export const CONCURRENCIA = [
  { limit: 3 }, // global: protege la CUENTA de DataForSEO (su rate limit no es por tenant)
  { key: CLAVE_TENANT, limit: 1 }, // equidad entre tenants
] as const;

export function crearFuncionResearch(deps: Deps) {
  return inngest.createFunction(
    {
      id: "research-workflow",
      concurrency: [...CONCURRENCIA],
      retries: 1,
      /*
       * Deduplica eventos repetidos… pero SOLO durante 24 h, y la compuerta humana espera 7 DÍAS.
       *
       * Por eso la idempotencia REAL no vive acá: vive en la base. El workflow carga el run y, si ya
       * no está `running`, no vuelve a hacer el research. La ventana de Inngest es una comodidad;
       * la fase durable es la fila. Ver `workflow.ts`.
       */
      idempotency: "event.data.runId",
      onFailure: async ({ event, error }) => {
        /*
         * Agotados los reintentos. El run no puede quedarse colgado en `running` para siempre.
         *
         * Pero `failRun()` solo toca los runs que SIGUEN en `running`: si el fallo ocurrió después
         * de que un humano aprobara —o después de publicar en Storyblok—, el error se registra y el
         * estado NO se pisa. Un fallo del workflow no puede deshacer un hecho del mundo.
         */
        const original = event.data.event.data as Eventos["research/solicitado"]["data"];
        await deps.store.failRun({ tenantId: original.tenantId }, original.runId, error.message);
      },
    },
    { event: "research/solicitado" },
    async ({ event, step }) => {
      const d = event.data as Eventos["research/solicitado"]["data"];
      // El evento solo trae coordenadas. El prompt, el cliente y el mercado salen de la FILA.
      return workflowResearch(
        adaptarPasos(step as StepTools),
        { runId: d.runId, tenantId: d.tenantId },
        deps,
      );
    },
  );
}

/**
 * Cada cuánto barre. **No es el plazo**: el plazo lo decide `PLAZO_RUN_COLGADO` (3 h, en `db`).
 *
 * Cada hora es holgado de sobra. Lo que se ganaría bajándolo es enterarse antes de algo que ya lleva
 * tres horas muerto; lo que se paga es una consulta por corrida contra un índice parcial. Un run
 * colgado no urge — lo que urge es que deje de ser invisible.
 */
export const CRON_BARRIDO = "0 * * * *";

/**
 * El barrido de runs colgados: **la mitad que no comparte punto de fallo con lo que protege**.
 *
 * `onFailure` existe para que un run no quede en `running` para siempre, y su única acción es
 * `failRun()` — o sea, escribir en Postgres. Cuando el workflow muere porque no alcanza la base, el
 * manejador muere por lo mismo: la red de seguridad se rompe justo cuando hace falta. Pasó el
 * 2026-08-07 en producción. Y hay un caso que `onFailure` no cubre ni estando sano: que el evento se
 * emita, no lo consuma nadie, y entonces **ninguna función de Inngest llegue a existir** para ese run.
 *
 * Por eso esto es una función PROGRAMADA y no un reintento: no la dispara el run que falló.
 *
 * ## Por qué la lógica vive acá afuera
 *
 * Mismo motivo que `CONCURRENCIA`: los tests corren la lógica, no la función de Inngest. Un cron mal
 * escrito o un plazo cambiado a mano no lo caza ningún test que ejercite `createFunction`.
 *
 * **`PLAZO_RUN_COLGADO` se IMPORTA de `db`, no se escribe acá.** Si el literal `"3 hours"` viviera en
 * dos sitios, el test del default dejaría de fijar el que corre en producción — que es la definición
 * de un default sin dueño.
 */
export async function barrerRunsColgados(
  deps: Pick<Deps, "store">,
  log: (msg: string) => void = () => {},
): Promise<{ expirados: number }> {
  const runs = await deps.store.expirarRunsColgados(PLAZO_RUN_COLGADO);

  /*
   * El silencio se loguea igual que el ruido, y a propósito: "ningún run colgado" cada hora es la
   * señal de que el barrido CORRE. Sin esa línea no habría forma de distinguir "no había nada
   * colgado" de "el cron dejó de dispararse" — que es exactamente la clase de fallo mudo que este
   * barrido existe para no repetir.
   */
  if (runs.length === 0) {
    log(`[barrido] ningún run colgado (plazo ${PLAZO_RUN_COLGADO})`);
  } else {
    for (const r of runs) {
      log(`[barrido] run ${r.id} (tenant ${r.tenantId}) llevaba más de ${PLAZO_RUN_COLGADO} en running → failed`);
    }
  }
  return { expirados: runs.length };
}

export function crearFuncionBarrido(deps: Deps) {
  return inngest.createFunction(
    {
      id: "barrido-runs-colgados",
      // Uno a la vez: dos barridos simultáneos harían el mismo UPDATE y el segundo no vería nada. No
      // rompe nada —el `where status = 'running'` lo hace idempotente—, pero es trabajo tirado.
      concurrency: [{ limit: 1 }],
      // Sin reintentos: si falla, el del próximo ciclo hace exactamente lo mismo una hora después.
      // Reintentar en caliente contra una base que no responde es lo que ya sabemos que no sirve.
      retries: 0,
    },
    { cron: CRON_BARRIDO },
    async ({ step }) => step.run("expirar", () => barrerRunsColgados(deps, console.log)),
  );
}

/**
 * Cada cuánto se pollea. 30 minutos: las reseñas nuevas no son urgentes -- lo que importa es que el
 * polling CORRA, no que corra cada minuto. A calibrar, igual que `CRON_BARRIDO`.
 *
 * Constante PROPIA, separada de `CRON_BARRIDO`: son dos crons con motivos distintos (uno vigila runs
 * colgados, el otro trae reseñas nuevas) y calibrarlos juntos acoplaría dos decisiones que no tienen
 * nada que ver entre sí.
 */
export const CRON_POLLING_RESENAS = "*/30 * * * *";

/**
 * El polling de reseñas de Google: recorre TODOS los clientes conectados (de todos los tenants --
 * `clientesConectadosGoogle` cruza tenants a propósito, ver `db/src/store.ts`) y trae sus reseñas
 * nuevas.
 *
 * ## Un cliente no frena a los demás
 *
 * Mismo criterio que `barrerRunsColgados` frente a un run individual: el refresh token de un cliente
 * puede estar revocado (el dueño desconectó la cuenta de Google, o la revocó Google mismo) sin que
 * eso le impida al resto seguir polleándose. Por eso el try/catch está DENTRO del loop, por cliente,
 * y el error se loguea con el `tenantId` para poder rastrearlo -- sin él, un fallo de un cliente
 * cualquiera sería indistinguible de otro en los logs.
 *
 * ## La idempotencia la da `registrarResenaGoogle`, no acá
 *
 * `registrarResenaGoogle` hace `on conflict do nothing` (Task 2): correr el polling dos veces con las
 * mismas reseñas no duplica nada. Lo único que esta función tiene que hacer bien es NO IGNORAR su
 * valor de retorno -- si contara todas las reseñas devueltas por el proveedor en vez de las que de
 * verdad se insertaron, `resenasNuevas` mentiría en cada corrida de más.
 */
export async function pollearResenas(
  deps: Pick<Deps, "store" | "resenasProvider" | "borradorProvider">,
  log: (msg: string) => void = () => {},
): Promise<{ clientesRecorridos: number; resenasNuevas: number; fallidos: number }> {
  const clientes = await deps.store.clientesConectadosGoogle();

  let resenasNuevas = 0;
  let fallidos = 0;

  for (const cliente of clientes) {
    try {
      const accessToken = await deps.resenasProvider.refrescarToken(cliente.refreshToken);
      const crudas = await deps.resenasProvider.listarResenas(accessToken, cliente.locationId);

      for (const r of crudas) {
        const insertada = await deps.store.registrarResenaGoogle({
          clientId: cliente.clientId,
          tenantId: cliente.tenantId,
          googleReviewId: r.googleReviewId,
          puntuacion: r.puntuacion,
          autor: r.autor,
          texto: r.texto,
          publicadaEn: r.publicadaEn,
        });
        if (insertada) resenasNuevas++;

        // Borrador de IA (Bloque F, fase 2): solo 4-5★, solo si esta corrida insertó la reseña
        // (una que el polling ya había visto no necesita un borrador nuevo). Try/catch PROPIO, no el
        // del cliente entero: un fallo de OpenAI en UNA reseña no debe impedir que se guarden las
        // demás reseñas nuevas de ese mismo cliente en esta misma corrida.
        if (insertada && r.puntuacion >= 4) {
          try {
            const borrador = await deps.borradorProvider.generar(r);
            await deps.store.guardarBorradorResena({
              clientId: cliente.clientId,
              tenantId: cliente.tenantId,
              googleReviewId: r.googleReviewId,
              borrador,
            });
          } catch (e) {
            // No incrementa `fallidos`: ese contador es de CLIENTES con el token roto, no de
            // borradores puntuales. La reseña queda guardada sin borrador; sin reintento automático
            // (decisión del spec) -- el staff completa el campo a mano desde el portal.
            log(
              `[borrador-ia] reseña ${r.googleReviewId} (cliente ${cliente.clientId}) falló: ${(e as Error).message}`,
            );
          }
        }
      }
    } catch (e) {
      // Un cliente con el token revocado no frena a los demás. Se loguea con el tenant para poder
      // rastrearlo -- ver la nota de arriba.
      fallidos++;
      log(
        `[polling-resenas] cliente ${cliente.clientId} (tenant ${cliente.tenantId}) falló: ${(e as Error).message}`,
      );
    }
  }

  log(
    `[polling-resenas] ${clientes.length} clientes conectados, ${resenasNuevas} reseñas nuevas, ${fallidos} fallidos`,
  );
  return { clientesRecorridos: clientes.length, resenasNuevas, fallidos };
}

export function crearFuncionPollingResenas(deps: Deps) {
  return inngest.createFunction(
    {
      id: "polling-resenas-google",
      // Uno a la vez, mismo motivo que el barrido: dos polleos simultáneos harían el mismo trabajo
      // por partida doble sin romper nada (`registrarResenaGoogle` es idempotente), pero es trabajo
      // tirado y llamadas de más a la Business Profile API de Google.
      concurrency: [{ limit: 1 }],
      // Sin reintentos: si falla, el próximo ciclo (30 min) hace lo mismo. Reintentar en caliente
      // contra una API externa que no responde es el mismo error que ya se descartó en el barrido.
      retries: 0,
    },
    { cron: CRON_POLLING_RESENAS },
    async ({ step }) => step.run("pollear", () => pollearResenas(deps, console.log)),
  );
}

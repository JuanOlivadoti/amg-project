import { Inngest } from "inngest";
import type { GetStepTools } from "inngest";
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
export function crearFuncionResearch(deps: Deps) {
  return inngest.createFunction(
    {
      id: "research-workflow",
      concurrency: [
        { limit: 3 }, // global: protege la CUENTA de DataForSEO (su rate limit no es por tenant)
        /*
         * `event.data.tenantId`. Decía `event.data.ctx.tenantId`, y ese campo NO EXISTE.
         *
         * Es basura de mi propio refactor de ADR-18: cuando saqué el `ctx` del evento —para que el
         * evento dejara de portar autoridad— dejé la clave apuntando a un camino muerto. La clave
         * resolvía a `undefined` para TODOS los eventos, así que la equidad entre tenants que este
         * comentario documentaba simplemente **no existía**: o todos caían en el mismo bucket, o no
         * se aplicaba límite alguno.
         *
         * Ningún test lo agarró porque los tests corren `workflowResearch`, no la función de Inngest.
         */
        { key: "event.data.tenantId", limit: 1 }, // equidad entre tenants
      ],
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

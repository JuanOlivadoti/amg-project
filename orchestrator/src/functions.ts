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
        { key: "event.data.ctx.tenantId", limit: 1 }, // equidad entre tenants
      ],
      retries: 1,
      // Reprocesar el mismo run no debe abrir un segundo run ni volver a pagar.
      idempotency: "event.data.runId",
      onFailure: async ({ event, error }) => {
        // Agotados los reintentos. El run NO puede quedarse colgado en `running` para siempre:
        // se marca `failed` con el motivo, y por eso el runId viaja en el evento (ver events.ts).
        const original = event.data.event.data as Eventos["research/solicitado"]["data"];
        await deps.store.failRun(
          {
            tenantId: original.ctx.tenantId,
            role: "servicio",
            clientId: original.ctx.clientId,
          },
          original.runId,
          error.message,
        );
      },
    },
    { event: "research/solicitado" },
    async ({ event, step }) => {
      const d = event.data as Eventos["research/solicitado"]["data"];
      return workflowResearch(
        adaptarPasos(step as StepTools),
        {
          ctx: d.ctx,
          prompt: d.prompt,
          market: d.market,
          maxCostMicros: d.maxCostMicros,
          maxPages: d.maxPages,
        },
        deps,
        d.runId,
      );
    },
  );
}

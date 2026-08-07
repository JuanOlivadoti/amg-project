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

import { randomUUID } from "node:crypto";
import type { PgStore, TenantContext } from "db";

/**
 * Pedir un research. **Es la puerta por la que la API entra al sistema** — por eso vive acá y no en
 * el orquestador.
 *
 * ## Dónde ocurre la autorización, y por qué acá y no en el orquestador
 *
 * El run se crea **como el humano** (`app_user`), bajo RLS. Si esa persona no tiene membresía en el
 * tenant, o el cliente no es suyo, **Postgres rechaza el insert**. No hay comprobación en
 * TypeScript que se pueda olvidar: la hace la base.
 *
 * Recién entonces se emite el evento — y el evento lleva **solo el `runId`**. El orquestador, que
 * corre con autoridad de servicio, no elige a nombre de quién gasta: lee la fila que un humano
 * autorizado ya creó.
 *
 * Antes era al revés: el evento traía `tenantId` y `clientId` elegidos por quien lo emitía, y el
 * workflow los elevaba a autoridad de servicio. Conocer dos UUID ajenos bastaba para que la agencia
 * pagara el research de otra.
 *
 * ## El ORDEN es la seguridad (ADR-18)
 *
 * Primero el `insert` bajo RLS (autoriza o lanza), y **solo si no lanzó** se emite el evento. Al
 * revés —emitir y después escribir— el orquestador podría arrancar a nombre de un run que la base
 * nunca autorizó.
 */

export interface PeticionResearch {
  clientId: string;
  prompt: string;
  market?: { country: string; language_code: string; location_code: number };
  /** Tope duro de gasto, en micros de USD. Sin esto, un bug de expansión vacía el saldo. */
  maxCostMicros?: number;
  maxPages?: number;
}

const MARKET_POR_DEFECTO = { country: "ES", language_code: "es", location_code: 2724 };

/** Emisor de eventos. Se inyecta para poder testear sin levantar Inngest. */
export interface EmisorEventos {
  send(evento: { name: string; data: Record<string, unknown> }): Promise<unknown>;
}

/**
 * Crea el run (autorizado, bajo RLS) y lo pone en marcha.
 *
 * @param storeHumano  Store atado al login `amg_api` → rol `app_user`. **No puede** asumir
 *                     `app_service`: Postgres se lo impide (ver `0003_credenciales.sql`).
 * @param ctx          Identidad del humano. Su ROL lo deriva la base de `memberships`.
 */
export async function solicitarResearch(
  storeHumano: PgStore,
  emisor: EmisorEventos,
  ctx: TenantContext,
  peticion: PeticionResearch,
): Promise<string> {
  const runId = randomUUID();

  // Acá es donde se autoriza. Si el humano no puede, esto LANZA (RLS), y no se emite nada.
  await storeHumano.createRun(ctx, {
    runId,
    clientId: peticion.clientId,
    schemaVersion: "kr.v0.5",
    prompt: peticion.prompt,
    market: peticion.market ?? MARKET_POR_DEFECTO,
    config: {
      max_cost_micros: peticion.maxCostMicros ?? null,
      max_pages: peticion.maxPages ?? null,
    },
  });

  // El evento no lleva ni el prompt ni el cliente: el orquestador los lee de la fila.
  try {
    await emisor.send({
      name: "research/solicitado",
      data: { runId, tenantId: ctx.tenantId },
    });
  } catch (fallo) {
    /*
     * El hueco propio del orden de ADR-18: la fila YA existe y el evento no salió, así que nadie va a
     * procesar este run. Sin esto queda en `running` para siempre — el portal lo pollea eternamente y
     * el usuario ve un error sin enterarse de que su run existe.
     *
     * El orden NO se invierte para taparlo (emitir antes de escribir dejaría al orquestador
     * arrancando a nombre de un run que la base nunca autorizó). Se compensa: se marca el run como
     * `failed` con el motivo, que es lo mismo que hace el orquestador cuando el workflow muere.
     *
     * Está medido que `app_user` PUEDE hacerlo: quien acaba de pasar el `with check` de `run_write`
     * para el insert cumple el mismo `using` para el update. No hace falta ningún privilegio extra.
     */
    try {
      await storeHumano.failRun(ctx, runId, `No se pudo emitir research/solicitado: ${mensajeDe(fallo)}`);
    } catch (fallaElMarcado) {
      // Si el marcado también falla no hay nada más que hacer acá, pero el operador tiene que poder
      // verlo: es el caso en que el run SÍ queda huérfano.
      console.error(`[api] el run ${runId} quedó en 'running' y no se pudo marcar failed:`, fallaElMarcado);
    }
    // Se propaga el error ORIGINAL: el del evento es el que explica qué pasó (típicamente, falta
    // `INNGEST_EVENT_KEY`). El del marcado sería un síntoma de segundo orden que esconde la causa.
    throw fallo;
  }

  /*
   * TERCER paso, y va DESPUÉS del `send()` a propósito: **fila → evento → marca** (ADR-18 extendido).
   *
   * Es la única prueba, y nuestra, de que hay una ejecución durable esperando el `research/aprobado`
   * de este run. Sin ella, `approveRun` se niega (`RunSinWorkflowError` → 409 `RUN_SIN_WORKFLOW`),
   * que es lo que impide aprobar un run insertado directo en la base — el bug del bloque C0. Ver
   * `db/migrations/0019_marca_solicitud_emitida.sql`.
   *
   * Escribirla ANTES del `send()` la volvería una mentira en cuanto el envío fallara: el `catch` de
   * arriba marca el run `failed`, pero un `failed` con marca es un run que alguien podría aprobar si
   * el estado cambiara. Acá abajo, el camino del fallo sale por el `throw` y no llega nunca.
   *
   * **No lleva `try/catch`, y eso es una decisión.** Si esto lanza, el evento YA salió y el workflow
   * está vivo: no hay nada que compensar (marcar `failed` sería mentir sobre un run que está
   * corriendo). La petición devuelve 500, el operador se entera, y el run queda **no aprobable**
   * hasta que alguien escriba la marca a mano. Falla cerrado, que es la dirección correcta: la
   * alternativa —tragarse el error y devolver 201— deja al usuario con un run que parece normal y un
   * botón de aprobar que le va a dar 409 sin explicación.
   */
  await storeHumano.marcarSolicitudEmitida(ctx, runId);

  return runId;
}

/** El texto de un throw que puede no ser un `Error`. Va a parar a `kr_runs.error` y a la pantalla. */
function mensajeDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

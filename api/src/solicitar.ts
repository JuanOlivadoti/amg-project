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
  await emisor.send({
    name: "research/solicitado",
    data: { runId, tenantId: ctx.tenantId },
  });

  return runId;
}

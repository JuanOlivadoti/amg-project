/**
 * Los eventos del orquestador.
 *
 * ## Un evento es un DISPARADOR, nunca una autoridad
 *
 * `research/aprobado` **no aprueba nada**. Solo despierta al workflow, que va a la base y pregunta
 * qué está realmente aprobado (`getPublishablePages`, que exige las dos condiciones de la compuerta
 * bajo RLS). Si el evento fuera la autoridad, cualquiera que pudiera emitir un evento —un webhook
 * mal protegido, un bug, un job vecino— publicaría contenido que ningún humano miró. Es la misma
 * disciplina que ADR-06: la aprobación vive en la base, no en el mensaje.
 *
 * Por eso el contexto de tenant del workflow se toma SIEMPRE del evento original (`research/
 * solicitado`) y nunca del evento de aprobación: un evento de aprobación forjado con el `runId` de
 * otro tenant se encuentra con que el `PgStore` sigue operando con el tenant de origen y RLS no le
 * devuelve nada.
 */

/** Quién pide el research. `servicio` es el rol del propio orquestador (ver `store.ts`). */
export interface ActorContext {
  tenantId: string;
  clientId: string;
  /** El humano que disparó el research. Solo para auditoría; NO otorga permisos. */
  userId?: string | null;
}

export interface ResearchSolicitado {
  data: {
    /**
     * El id del run lo genera QUIEN EMITE EL EVENTO (`nuevoRunId()`), no la base ni el workflow.
     *
     * No es un capricho. Inngest re-ejecuta todo el código que está FUERA de un step en cada replay
     * del workflow (es así como retoma donde iba). Un `randomUUID()` en el cuerpo del workflow
     * daría un id distinto en cada replay, y los pasos siguientes escribirían en un run que no
     * existe. Viniendo en el evento, es estable — y de paso hace el run idempotente: reprocesar el
     * mismo evento no crea un segundo run ni vuelve a pagarle a DataForSEO.
     */
    runId: string;
    ctx: ActorContext;
    prompt: string;
    market?: { country: string; language_code: string; location_code: number };
    /** Tope duro de gasto del run, en micros de USD. Sin esto, un bug de expansión vacía el saldo. */
    maxCostMicros?: number;
    maxPages?: number;
  };
}

export interface ResearchAprobado {
  data: {
    runId: string;
    /** Solo para trazabilidad. La aprobación REAL está en la base (kr_runs + kr_pages). */
    aprobadoPor?: string;
  };
}

export interface ResearchRechazado {
  data: { runId: string };
}

export type Eventos = {
  "research/solicitado": ResearchSolicitado;
  "research/aprobado": ResearchAprobado;
  "research/rechazado": ResearchRechazado;
};

/**
 * Los eventos del orquestador.
 *
 * ## UN EVENTO NO PORTA AUTORIDAD. NUNCA.
 *
 * La versión anterior de `research/solicitado` llevaba `tenantId` y `clientId` **elegidos por quien
 * emitía el evento**, y el workflow los convertía en contexto de servicio. La FK garantizaba que el
 * cliente pertenecía al tenant; **nadie garantizaba que el humano perteneciera al tenant**. El
 * `userId` que llevaba "para auditoría" no participaba en ninguna decisión.
 *
 * O sea: conocer (o filtrar) un par de UUID ajenos y conseguir que se emitiera el evento bastaba
 * para que el orquestador **pagara un research de otra agencia con autoridad de servicio**. Cerré
 * la puerta de los humanos (ADR-15) y dejé abierta la del servicio.
 *
 * Ahora:
 *
 *  1. La API crea la fila del run **bajo RLS, como `app_user`**, con la identidad del humano. Si no
 *     tiene membresía en ese tenant, Postgres rechaza el insert. La autorización ocurre **ahí**.
 *  2. El evento lleva **solo `runId` y `tenantId`** — y el `tenantId` no es una autoridad, es una
 *     coordenada: si no cuadra con el run, la fila no aparece bajo RLS y el workflow aborta **sin
 *     gastar un centavo**.
 *  3. El orquestador lee el prompt, el cliente y el mercado **de la fila**, jamás del mensaje.
 *
 * Lo mismo vale para `research/aprobado`: solo DESPIERTA al workflow. Lo que se publica se vuelve a
 * preguntar a la base (`getPublishablePages`, compuerta doble, bajo RLS). Si el evento fuera la
 * autoridad, cualquiera capaz de emitirlo publicaría contenido que ningún humano miró.
 */

export interface ResearchSolicitado {
  data: {
    /**
     * El run **ya existe** en la base, creado por la API con la identidad del humano bajo RLS.
     * Este evento no lo crea: lo pone en marcha.
     *
     * Que el id venga en el evento (y no se genere dentro) también lo hace idempotente: Inngest
     * re-ejecuta todo lo que está fuera de un step en cada replay, así que un `randomUUID()` en el
     * workflow daría un id distinto cada vez.
     */
    runId: string;
    /** Coordenada para localizar el run bajo RLS. **No es una autoridad**: ver arriba. */
    tenantId: string;
  };
}

export interface ResearchAprobado {
  data: {
    runId: string;
    /** Solo trazabilidad. La aprobación REAL está en la base (`kr_runs` + `kr_pages`). */
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

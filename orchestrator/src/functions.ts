import { Inngest } from "inngest";
import type { GetStepTools } from "inngest";
import { PLAZO_RUN_COLGADO } from "db";
import type { TenantContext } from "db";
import type { Eventos } from "./events.js";
import type { Deps, Pasos } from "./workflow.js";
import { workflowResearch, workflowDecision } from "./workflow.js";

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

export function crearFuncionDecision(deps: Deps) {
  return inngest.createFunction(
    {
      id: "research-decision-workflow",
      concurrency: [...CONCURRENCIA], // sigue siendo por tenantId — el evento lo sigue trayendo
      retries: 1,
      // Comodidad, NO la garantía (mismo principio que crearFuncionResearch, líneas 65-70 de este
      // archivo): un replay después de 24h todavía tiene que encontrar la decisión ya cerrada y no
      // repetirla. Eso lo impone el guard de kr_run_decisiones.resultado en workflowDecision, no
      // esta key.
      idempotency: "event.data.decisionId",
      onFailure: async ({ event, error }) => {
        const d = event.data.event.data as Eventos["research/aprobado"]["data"];
        const ctx: TenantContext = { tenantId: d.tenantId };
        // `compensarAprobacionFallida` y no `cerrarDecision`: agotados los reintentos de
        // `workflowDecision`, la decisión queda en 'error' pero además hay que revertir la
        // promoción de `kr_runs.status` a 'pending_approval' cuando corresponde — si no, un run
        // cuya PRIMERA decisión falló acá queda 'approved' sin ninguna decisión 'completado', y
        // `registrarDecision` nunca vuelve a calificarlo (ver el comentario de cabecera del
        // método, `db/src/store.ts`). Mismo patrón que `api/src/app.ts`, POST /runs/:id/approve.
        await deps.store.compensarAprobacionFallida(ctx, d.decisionId, error.message);
      },
    },
    { event: "research/aprobado" },
    async ({ event, step }) => {
      const d = event.data as Eventos["research/aprobado"]["data"];
      const ctx: TenantContext = { tenantId: d.tenantId };
      return workflowDecision(adaptarPasos(step as StepTools), { tenantId: ctx.tenantId, decisionId: d.decisionId }, deps);
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
const LARGO_MAXIMO_TEXTO_RESENA = 3500; // deja margen para el resto del mensaje bajo el límite de 4096 de Telegram

function truncar(texto: string, maximo: number): string {
  return texto.length > maximo ? `${texto.slice(0, maximo)}…` : texto;
}

export async function pollearResenas(
  deps: Pick<Deps, "store" | "resenasProvider" | "borradorProvider" | "telegramProvider">,
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
        if (insertada && r.puntuacion >= 4 && r.puntuacion <= 5) {
          try {
            const borrador = await deps.borradorProvider.generar(r);
            const ok = await deps.store.guardarBorradorResena({
              clientId: cliente.clientId,
              tenantId: cliente.tenantId,
              googleReviewId: r.googleReviewId,
              borrador,
            });
            if (!ok) {
              log(
                `[borrador-ia] reseña ${r.googleReviewId} (cliente ${cliente.clientId}) descartada por BD`,
              );
            }
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

    /*
     * Alerta de Telegram por reseñas 1-3★ (Bloque F, fase 2, hallazgo 4 de Codex, decisión de Juan:
     * retry automático, no best-effort perdido).
     *
     * **Rediseñado respecto del plan original**: NO vive adentro del `for (const r of crudas)` de
     * arriba -- eso solo dispararía para reseñas nuevas de ESTE ciclo, y una alerta que fallara se
     * perdería para siempre. Es un paso INDEPENDIENTE, una vez por cliente, y SIBLING del try/catch de
     * arriba (no anidado en su rama de éxito): así corre también para un cliente cuyo token de Google
     * está roto en ESTE ciclo -- las reseñas pendientes de alertar ya están en la base de un ciclo
     * anterior, y no dependen de que el refresh de Google funcione hoy. Usa
     * `resenasPendientesAlertaTelegram`, que trae CUALQUIER reseña 1-3★ del cliente sin alerta
     * confirmada, sea de este ciclo o de uno anterior que falló.
     */
    try {
      const pendientes = await deps.store.resenasPendientesAlertaTelegram(cliente.clientId);
      if (pendientes.length > 0) {
        const chatId = await deps.store.telegramDelAsignado(cliente.clientId);
        if (chatId) {
          for (const p of pendientes) {
            try {
              const texto =
                `⭐ ${p.puntuacion} reseña nueva de ${p.autor} en ${cliente.nombre}` +
                (p.texto ? `:\n"${truncar(p.texto, LARGO_MAXIMO_TEXTO_RESENA)}"` : " (sin comentario)");
              await deps.telegramProvider.enviarMensaje(chatId, texto);
              await deps.store.marcarAlertaTelegramEnviada({
                clientId: cliente.clientId,
                tenantId: cliente.tenantId,
                googleReviewId: p.googleReviewId,
              });
            } catch (e) {
              // Un fallo en UNA reseña no impide intentar las demás pendientes del mismo cliente en
              // esta corrida -- y, si igual falla, alerta_telegram_enviada_en queda en NULL: el
              // PRÓXIMO ciclo (30 min) la vuelve a intentar sola, sin cola ni botón.
              log(
                `[alerta-telegram] reseña ${p.googleReviewId} (cliente ${cliente.clientId}) falló: ${(e as Error).message}`,
              );
            }
          }
        }
      }
    } catch (e) {
      // Un fallo buscando las pendientes (ej. store caído) no debe frenar el resto del polling de
      // este cliente ni de los demás -- mismo criterio que el resto de esta función.
      log(
        `[alerta-telegram] cliente ${cliente.clientId}: no se pudo resolver pendientes: ${(e as Error).message}`,
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

// ---------------------------------------------------------------- vincular Telegram (Bloque F, fase 2)

const PATRON_START = /^\/start\s+([a-f0-9-]+)$/;

/**
 * Procesa los mensajes `/start <código>` pendientes del bot de Telegram, vinculando el `chat_id` al
 * CM que generó el código desde el portal.
 *
 * **Actualizado para el contrato `ResultadoActualizaciones`** (hallazgo 1 de Codex, 2026-08-23): el
 * offset avanza con `maxUpdateId` SIEMPRE que no sea `null`, sin importar si hubo o no un `/start`
 * real en el lote -- un lote de solo reacciones/ediciones (sin ningún `/start`) igual tiene que
 * confirmar esos `update_id`, o Telegram los vuelve a mandar para siempre.
 *
 * Si `obtenerActualizaciones` lanza a mitad de lote (fetch caído, o un `update_id` malformado), el
 * `await` revienta ANTES de que exista `{ maxUpdateId, mensajes }`: no hay riesgo de avanzar el
 * offset sin haber confirmado nada. Si en cambio `vincularTelegramPorCodigo` lanzara a mitad del
 * `for` (no debería: solo hace un `update`), el offset NO se habría avanzado todavía (es lo último) --
 * el próximo ciclo reprocesaría ese lote entero, lo cual es CORRECTO: `vincularTelegramPorCodigo` es
 * idempotente por diseño (un código ya vinculado da `false` la segunda vez, no un error).
 */
export async function vincularTelegramPendientes(
  deps: Pick<Deps, "store" | "telegramProvider">,
  log: (msg: string) => void = () => {},
): Promise<{ vinculados: number }> {
  const offset = await deps.store.offsetTelegramActual();
  const { maxUpdateId, mensajes } = await deps.telegramProvider.obtenerActualizaciones(offset);
  let vinculados = 0;

  for (const m of mensajes) {
    const match = PATRON_START.exec(m.texto.trim());
    if (!match) continue;
    const codigo = match[1] as string;
    const ok = await deps.store.vincularTelegramPorCodigo(codigo, m.chatId);
    if (ok) vinculados++;
    else log(`[telegram] código sin match (vencido, ya usado, o inexistente): ${codigo}`);
  }

  // Avanza con maxUpdateId, NO con el update_id del último mensaje ÚTIL -- ver el docblock de arriba.
  if (maxUpdateId !== null) {
    await deps.store.avanzarOffsetTelegram(maxUpdateId + 1);
  }
  return { vinculados };
}

export function crearFuncionVincularTelegram(deps: Deps) {
  return inngest.createFunction(
    {
      id: "vincular-telegram",
      // Uno a la vez: dos polleos simultáneos del mismo offset harían el mismo `getUpdates` por
      // partida doble -- no rompe nada (`vincularTelegramPorCodigo` es idempotente), pero es trabajo
      // tirado y llamadas de más a la API de Telegram.
      concurrency: [{ limit: 1 }],
      // Sin reintentos: si falla, el próximo minuto hace lo mismo -- mismo criterio que el resto de
      // los pollings de este archivo.
      retries: 0,
    },
    // Cada minuto -- vincular la cuenta es de una sola vez, no hace falta la misma cadencia que el
    // polling de reseñas (30 min): quien acaba de tocar "Conectar Telegram" en el portal quiere ver
    // el resultado pronto.
    { cron: "* * * * *" },
    async ({ step }) => step.run("vincular", () => vincularTelegramPendientes(deps, console.log)),
  );
}

// ---------------------------------------------------------------- publicar la respuesta (Bloque F, fase 2, segunda pieza)

/**
 * Publica la respuesta de vuelta en Google (Bloque F, fase 2, segunda pieza). Reacciona al evento
 * `resenas/respuesta.solicitada`, que NO PORTA AUTORIDAD (ver events.ts): la fila ya quedó
 * marcada bajo RLS por la API antes de emitirlo (ADR-18), y esta función vuelve a preguntarle a
 * la base qué publicar (`resenaParaPublicar`) en vez de confiar en el evento. Cero filas = la
 * solicitud ya no aplica (otra corrida ya publicó, o se borró el borrador entretanto) -- no es un
 * error, es el resultado correcto de una carrera perdida.
 */
export async function publicarRespuestaResena(
  deps: Pick<Deps, "store" | "resenasProvider">,
  resenaId: string,
  log: (msg: string) => void = () => {},
): Promise<{ publicada: boolean }> {
  const info = await deps.store.resenaParaPublicar(resenaId);
  if (!info) {
    log(
      `[publicar-resena] ${resenaId}: la solicitud ya no aplica (publicada, sin borrador, o inexistente)`,
    );
    return { publicada: false };
  }

  const accessToken = await deps.resenasProvider.refrescarToken(info.refreshToken);
  await deps.resenasProvider.publicarRespuesta(
    accessToken,
    info.locationId,
    info.googleReviewId,
    info.borrador,
  );
  const ok = await deps.store.marcarRespuestaPublicada({
    clientId: info.clientId,
    tenantId: info.tenantId,
    googleReviewId: info.googleReviewId,
  });
  if (!ok) {
    log(
      `[publicar-resena] ${resenaId}: publicada en Google pero la confirmación no pisó ninguna fila`,
    );
  }
  return { publicada: ok };
}

export function crearFuncionPublicarResena(deps: Deps) {
  return inngest.createFunction(
    {
      id: "publicar-respuesta-resena",
      // Sin reintentos: reintentar en caliente un publish contra Google es el mismo error que ya
      // se descartó en `crearFuncionPollingResenas`. El reintento real es que el staff vuelva a
      // apretar "Publicar" -- eso pisa `respuesta_solicitada_en` y remite el evento.
      retries: 0,
    },
    { event: "resenas/respuesta.solicitada" },
    async ({ event, step }) =>
      step.run("publicar", () => publicarRespuestaResena(deps, event.data.resenaId, console.log)),
  );
}

// ---------------------------------------------------------------- publicar el post (sub-proyecto 3, Task 7)

/**
 * Sin reintentos de Inngest: mismo criterio que `publicar-respuesta-resena` — el reintento real es
 * que el staff vuelva a apretar "Publicar", que pisa `post_solicitado_en` y remite el evento.
 * Exportada como constante (Codex, ronda 1 sobre el plan, hallazgo Minor: el default vivía inline,
 * sin ningún test que lo ejerciera — cambiarlo a `5` no hacía caer nada) para que el test de abajo
 * la pueda fijar sin inspeccionar el objeto interno que arma `inngest.createFunction`.
 */
export const REINTENTOS_PUBLICAR_POST = 0;

/**
 * Publica el post en el blog externo. Reacciona a `posts/publicacion.solicitada`, que NO PORTA
 * AUTORIDAD (ver events.ts): la fila ya quedó marcada bajo RLS por la API antes de emitirlo
 * (ADR-18), y esta función vuelve a preguntarle a la base qué publicar (`postParaPublicar`) en vez
 * de confiar en el evento.
 *
 * Todo camino de fallo llama a `marcarPostFallido` (Task 3/1) para que la fila NUNCA quede
 * "solicitada" sin que nadie sepa si sigue en curso o ya reventó (Codex, ronda 1 sobre el plan,
 * hallazgo Major "publicación fallida bloquea el post para siempre") — incluido el caso `!info`
 * (best-effort: si no había nada que limpiar, el WHERE de `marcarPostFallido` no toca nada).
 */
export async function publicarPost(
  deps: Pick<Deps, "store" | "postPublisher">,
  pageId: string,
  log: (msg: string) => void = () => {},
): Promise<{ publicada: boolean }> {
  const info = await deps.store.postParaPublicar(pageId);
  if (!info) {
    log(`[publicar-post] ${pageId}: la solicitud ya no aplica (publicada, sin post, credenciales incompletas, o inexistente)`);
    await deps.store.marcarPostFallido(pageId);
    return { publicada: false };
  }

  let resultado: { url: string; publicado: boolean };
  try {
    resultado = await deps.postPublisher.publicar(
      { titulo: info.titulo, cuerpo: info.cuerpo, slug: info.slug },
      info.pageId,
      { tipo: info.blogTipo, url: info.blogUrl, credencial: info.blogCredencial },
    );
  } catch (e) {
    log(`[publicar-post] ${pageId}: el publisher lanzó: ${(e as Error).message}`);
    await deps.store.marcarPostFallido(pageId);
    return { publicada: false };
  }

  if (!resultado.publicado) {
    log(`[publicar-post] ${pageId}: el publisher no confirmó la publicación`);
    await deps.store.marcarPostFallido(pageId);
    return { publicada: false };
  }

  const ok = await deps.store.marcarPostPublicado(pageId, resultado.url);
  if (!ok) {
    log(`[publicar-post] ${pageId}: publicado externamente pero la confirmación no pisó ninguna fila`);
  }
  return { publicada: ok };
}

export function crearFuncionPublicarPost(deps: Deps) {
  return inngest.createFunction(
    {
      id: "publicar-post-blog",
      retries: REINTENTOS_PUBLICAR_POST,
    },
    { event: "posts/publicacion.solicitada" },
    async ({ event, step }) =>
      step.run("publicar", () => publicarPost(deps, event.data.pageId, console.log)),
  );
}

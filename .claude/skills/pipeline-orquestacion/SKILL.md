---
name: pipeline-orquestacion
description: Usar al tocar orchestrator/ — Inngest, steps durables y sus fronteras, reintentos, concurrencia, la compuerta humana con waitForEvent, el composition root que une los tres módulos, y la regla de que un evento no porta autoridad. Cubre por qué la idempotencia real vive en la base y no en Inngest.
---

# El orquestador de AMG OS

`orchestrator/` es el pegamento durable entre el research (M2) y la publicación (M1): ejecuta el
workflow, sobrevive a los fallos, y **duerme siete días esperando que un humano apruebe** sin ningún
proceso vivo.

**Está partido en dos a propósito:**

| Archivo | Qué es | Cómo se prueba |
|---|---|---|
| [`workflow.ts`](../../../orchestrator/src/workflow.ts) | La **LÓGICA**: qué pasos, en qué orden, con qué autoridad | Contra PGlite, **sin levantar Inngest** |
| [`functions.ts`](../../../orchestrator/src/functions.ts) | El **adaptador** a Inngest: concurrencia, reintentos, `idempotency`, `onFailure` | Sus constantes se extraen para poder testearlas |

Separarlos es lo que permite testear los caminos de fallo **y los de seguridad** con una base real y
sin red. Y tiene una consecuencia que ya mordió: **los tests corren `workflowResearch`, no la función
de Inngest.** Un typo silencioso en la config (`event.data.ctx.tenantId`, un campo inexistente)
desactivó la equidad entre tenants sin que ningún test lo notara. Por eso `CLAVE_TENANT` y
`CONCURRENCIA` son constantes exportadas: **lo que vive inline en la config de Inngest no está
probado.**

Si el cambio puede costar dinero, cargá también **`pipeline-gasto`**.

## Un evento no porta autoridad. Nunca.

Es un invariante de arquitectura (ADR-18) y acá es donde se hace cumplir.

La versión anterior de `research/solicitado` llevaba `tenantId` y `clientId` **elegidos por quien
emitía el evento**, y el workflow los convertía en contexto de servicio. La FK garantizaba que el
cliente pertenecía al tenant; **nadie garantizaba que el humano perteneciera al tenant**. O sea:
conocer dos UUID ajenos y conseguir que se emitiera el evento bastaba para que el orquestador
**pagara un research de otra agencia con autoridad de servicio**.

Hoy:

1. **La API crea la fila del run bajo RLS, como `app_user`**, con la identidad del humano. Si no
   tiene membresía en ese tenant, Postgres rechaza el insert. **La autorización ocurre ahí.**
2. **El evento lleva solo `runId` y `tenantId`** — y el `tenantId` no es una autoridad, es una
   **coordenada**: si no cuadra con el run, la fila no aparece bajo RLS y el workflow aborta **sin
   gastar un centavo**.
3. **El orquestador lee el prompt, el cliente y el mercado de la FILA**, jamás del mensaje.

Lo mismo con `research/aprobado`: **solo despierta** al workflow. Lo que se publica se vuelve a
preguntar a la base (`getPublishablePages`, compuerta doble —run aprobado **Y** página aprobada—,
bajo RLS). Si el evento fuera la autoridad, cualquiera capaz de emitirlo publicaría contenido que
ningún humano miró.

**El destino de publicación también sale de la base**, no de una variable de entorno:
`clients.storyblok_space_id` leído bajo el contexto del tenant. Ver `pipeline-publicacion` para lo que
pasaba cuando no.

Si agregás un evento o un campo, la pregunta es una sola: **¿esto decide algo, o solo localiza algo?**
Si decide, no va en el evento.

## Las fronteras de gasto son las fronteras de los steps

**Un step que falla se reintenta ENTERO.** De ahí sale el corte:

- **`cargar-run` está separado de `research`** porque es la comprobación de autorización y gasta
  cero. Si la fila no existe, se aborta antes de tocar DataForSEO.
- **`research`, `guardar-paginas` y `cerrar-run` son tres steps**: si el research revienta a mitad, el
  reintento no crea un segundo run ni vuelve a abrir la cuenta.
- **Dentro del research, el checkpoint `onKeywords` guarda lo pagado apenas existe**, en el mismo
  step. Si el paso revienta después (clustering, LLM de contenido), lo que ya se le pagó a DataForSEO
  queda en la base y en la cache: el reintento **no lo vuelve a comprar**.

Cuando agregues un step, la pregunta es: **si esto se reintenta entero, ¿qué se paga dos veces y qué
se duplica?** Si la respuesta no es "nada", el corte está en el lugar equivocado.

## La idempotencia real vive en la base, no en Inngest

`idempotency: "event.data.runId"` deduplica eventos repetidos… **solo durante 24 h**. Y la compuerta
humana espera **7 días**.

Pasadas las 24 h, un evento duplicado arrancaba una ejecución nueva con los steps en blanco → **volvía
a pagar el LLM y reescribía las páginas** sobre un run ya cerrado. Por eso la fase durable es **la
fila**: si `run.status !== "running"`, el research ya se hizo y se reanuda desde la compuerta. La
ventana de Inngest es una comodidad; **la verdad está en Postgres**.

Y el `runId` viene **en el evento**, no se genera dentro: Inngest re-ejecuta todo lo que está fuera de
un step en cada replay, así que un `randomUUID()` en el workflow daría un id distinto cada vez.

## Concurrencia y reintentos: las dos son decisiones de dinero

```ts
export const CONCURRENCIA = [
  { limit: 3 },                        // GLOBAL: protege la CUENTA de DataForSEO
  { key: CLAVE_TENANT, limit: 1 },     // equidad entre tenants
];
retries: 1
```

- **El tope duro es GLOBAL porque el rate limit de DataForSEO es por cuenta**, y la cuenta es UNA
  para toda la agencia. Un "2 por tenant" con diez tenants activos son veinte corridas simultáneas
  contra la misma cuenta: el proveedor devuelve `40202` y las corridas fallan (o se reintentan y se
  pagan dos veces). El segundo límite, ese sí por tenant, es de **equidad**: impide que un cliente con
  veinte negocios acapare la cola.
- **`retries: 1`, no el default de 4.** El step de research le paga a DataForSEO y al LLM. Lo de
  DataForSEO (81%) lo absorbe la cache; **lo del LLM no está cacheado y se vuelve a pagar**. Con 4
  reintentos, un fallo persistente del LLM multiplica esa parte del gasto por cinco. Los fallos
  transitorios de red ya los reintenta el cliente HTTP de `kr-service`, mucho más barato.

Los dos son **defaults de producción**: cambiarlos sin un test que los fije es una decisión sin dueño.

## La compuerta humana

`paso.esperarEvento("esperar-aprobacion", { evento: "research/aprobado", timeout: PLAZO_APROBACION,
runId })` — acá el workflow **se duerme**. No hay proceso esperando siete días: Inngest lo revive
cuando llega el evento. Es la razón principal de que esto sea un orquestador durable y no un script.

El `if: 'async.data.runId == "…"'` **no es opcional**: sin el match, la aprobación de un run
despertaría a todos los que estén esperando.

**El silencio no es un sí.** Vencido el plazo **no se publica**: el run se queda en
`pending_approval`, visible en el portal, y alguien lo retoma cuando quiera
(`estado: "sin_respuesta"`).

Y al volver del sueño se vuelve a comprobar todo: `getPublishablePages` puede devolver cero (→
`nada_que_publicar`), el cliente puede no ser visible para ese tenant (→ error, no se publica).

## `onFailure`: cerrar el run sin deshacer el mundo

Agotados los reintentos, el run no puede quedarse colgado en `running` para siempre. Pero `failRun()`
**solo toca los runs que SIGUEN en `running`**: si el fallo ocurrió después de que un humano aprobara
—o después de publicar en Storyblok—, el error se registra y el estado **no se pisa**. **Un fallo del
workflow no puede deshacer un hecho del mundo.**

Lo mismo, del otro lado: solo se marca publicado lo que el proveedor **confirma**. Registrar las
publicadas sigue siendo imprescindible aunque el camino de vuelta falle, porque **Storyblok ya creó
las stories y eso es irreversible**: sin la marca, el run quedaba en `failed` con las páginas
publicadas y visibles.

## El composition root

[`deps.ts`](../../../orchestrator/src/deps.ts) es **el único punto del sistema que conoce a los tres
módulos a la vez**. `kr-service` sigue sin saber que existe una base de datos, y `web-builder` sigue
sin importar nada de `kr-service`: la frontera M2→M1 es **el brief JSON validado con Zod, no un
`import`** (ADR-06/07).

**Dos conexiones, una por credencial** (ADR-17), y eso es la mitad del modelo de seguridad:

- `DATABASE_URL_ORQUESTADOR` → login `amg_orquestador`, autorizado **solo** a `app_service`.
- `DATABASE_URL_CACHE` → login `amg_cache`, que **solo** ve las caches y el registro de tareas: sin
  acceso a ninguna tabla de tenant.

Antes había un `DATABASE_URL` y el código elegía con qué rol vestirse (`set local role`). Postgres
autoriza `SET ROLE` según el `session_user` **sin contraseña**: era una frontera de código disfrazada
de frontera de credenciales. Si agregás una dependencia que toca la base, **preguntate con qué login
entra**, no con qué rol.

El perfil del cliente se valida con el **mismo Zod** que usa el M1 para el perfil de archivo: un
perfil corrupto tiene que fallar ruidosamente, no disfrazarse de "este cliente no tiene perfil" y
publicar un JSON-LD mutilado.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| Poner un dato que **decide** algo en el evento | Escalada de privilegios: quien emite el evento elige a nombre de quién se gasta |
| Confiar en `idempotency` de Inngest para la fase durable | Dura 24 h; la compuerta espera 7 días. Se vuelve a pagar y se reescriben páginas |
| Un `randomUUID()` fuera de un step | Inngest re-ejecuta eso en cada replay: id distinto cada vez |
| Meter dos operaciones que gastan en el mismo step | El reintento paga las dos |
| Quitar el `if:` del `waitForEvent` | Una aprobación despierta a todos los runs que esperan |
| Escribir la config de Inngest inline | Los tests no la ven. Es el typo que desactivó la equidad |
| Pisar el estado del run en `onFailure` | Se deshace en la base un hecho que ocurrió en Storyblok |
| Subir `retries` "para que sea más robusto" | Multiplica el gasto de LLM de un fallo persistente |

## Verificación

```bash
npm test -w orchestrator   # el workflow REAL contra PGlite, con deps inyectadas. Sin red
npm run typecheck
```

`workflow.test.ts` y `config.test.ts`. Los caminos que hay que mantener cubiertos: run inexistente
(aborta sin gastar), run ya no `running` (no re-paga), timeout sin aprobación (no publica), nada
publicable, cliente no visible, y `published: false` (no se marca).

**Verificación por mutación.** Los tests de seguridad de acá son justo los que pueden pasar siempre
sin probar nada: quitá la comprobación de la fila, dejá que el evento traiga el `clientId`, sacá el
`if:` del `waitForEvent` — y confirmá que cae *exactamente* su test.

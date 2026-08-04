---
name: pipeline-gasto
description: Usar SIEMPRE que un cambio en kr-service/, orchestrator/ o web-builder/ pueda costar dinero — presupuesto y preflight, medición de costo, cache de respuestas, idempotencia de peticiones facturables, reintentos, sandbox vs producción. Cubre por qué el pipeline prefiere abortar de más antes que gastar de más, y las trampas que ya hicieron pagar dos veces.
---

# El gasto en el pipeline de AMG OS

Esto es transversal a los tres paquetes porque el gasto lo es. Un research cuesta **~$0.31** y
**DataForSEO es el 81%**; el LLM, el 19% restante.

**La asimetría de la que sale todo lo demás:** sobreestimar un costo **aborta de más** —molesto, y
gratis—. Subestimarlo **deja gastar de más** —caro, e irreversible—. No son errores simétricos, así
que ninguna decisión de este archivo los trata como si lo fueran. Ante la duda, se sobreestima, se
detiene, se pide permiso.

## Las dos cosas que se miden, y no son la misma

| | Qué es | Dónde |
|---|---|---|
| **`CostMeter`** | El costo **REAL**. DataForSEO lo reporta en `cost` por task; el del LLM se calcula desde los tokens reportados por una tarifa | [`lib/cost.ts`](../../../kr-service/src/lib/cost.ts) |
| **`Budget`** | La **ESTIMACIÓN** previa. Solo sirve para decidir si arrancar una fase | [`lib/budget.ts`](../../../kr-service/src/lib/budget.ts) |

Todo en **micros de USD** (millonésimas, enteros) — coma flotante para dinero, no.

**El medidor es POR RUN, propagado con `AsyncLocalStorage`** (`withCostMeter`). Antes era un
singleton de módulo que `runResearch()` reseteaba: con dos runs concurrentes en el mismo proceso, el
`reset()` de uno borraba el gasto del otro, un presupuesto veía consumo ajeno y abortaba de más, y
los briefs salían con totales cruzados. Si escribís un proveedor nuevo, su costo va a
`currentMeter()`, nunca a un medidor que te pasen por constructor desde un módulo.

**Un modelo sin tarifa no inventa un costo: suma 0 y se anota en `unpricedModels`.** Eso hace que el
total quede marcado como incompleto en vez de mentir — pero también significa que **el presupuesto lo
ve gratis y el tope queda desactivado en silencio**. Por eso, si hay tope activo, `run.ts` aborta
antes de la primera llamada cuando algún modelo facturable no tiene tarifa
(el `BudgetExceededError` de `modelosFacturables()` en
[`run.ts`](../../../kr-service/src/pipeline/run.ts)). Y mira los modelos del proveedor
**realmente activo**: antes miraba siempre los de OpenAI, así que con `LLM_PROVIDER=anthropic` el
chequeo pasaba mientras se gastaba con modelos de Claude sin tarifa.

## El preflight: antes de cada fase, y antes de cada llamada dentro de la fase

`assertCanSpend(estimado, fase)` **antes**; `assertNotExceeded(fase)` al final por si la estimación
se quedó corta. Las estimaciones (`DEFAULT_ESTIMATES`) se recalibraron contra una corrida real: las
anteriores estaban **~50× por debajo** ($0.005 para enriquecer *cualquier* cantidad de keywords), así
que el preflight siempre daba "entra" y el tope no protegía nada.

Dos reglas que salieron de eso:

1. **La estimación de una fase que escala con N tiene que escalar con N.** `estimateEnrichment()`
   suma base + por-keyword. Una estimación fija no protege en runs grandes.
2. **En un bucle, el chequeo va también DENTRO.** Si la estimación de la fase se queda corta, el
   bucle sigue gastando hasta terminar. Por eso la expansión re-chequea por seed y `applyPageContent`
   recibe un `beforeEach` que corta a mitad.

Si agregás una fase que gasta: agregá su estimación a `PhaseEstimates`, su `assertCanSpend` antes, y
**un test que fije el default**. Un default de producción sin test es una decisión sin dueño.

## Idempotencia: dos garantías distintas, según el endpoint

[`task-log.ts`](../../../kr-service/src/dataforseo/task-log.ts) registra **el 100% de la superficie
facturable**. La reserva se escribe **ANTES de enviar**: si el proceso muere en el medio, queda la
huella y el siguiente intento sabe que puede haber pagado ya.

Hay **dos caminos**, y no son intercambiables (ADR-14):

- **SERP y Search Volume (46%) → método Standard**, `postStandard()`. El `task_post` cobra y
  devuelve un `task_id`; el `task_get` recupera el resultado **gratis** durante 30 días. Una
  respuesta perdida **deja de ser dinero perdido**. Dos capas de recuperación: el id anotado en la
  reserva, y —si se murió antes de anotarlo— buscarlo por `tag` en `tasks_ready`.
- **Labs: `keyword_suggestions` y `bulk_keyword_difficulty` (54%) → live-only**, `post()`. No existe
  `task_post` para Labs. Ahí una respuesta perdida **detiene el run** (`PeticionAmbiguaError`) en vez
  de arriesgar un doble cobro.

`modoGet` **no es cosmético**: SERP usa `task_get/advanced/{id}`, Search Volume usa `task_get/{id}`.
La ruta equivocada da 404 y rompe el endpoint entero **en producción**, donde no hay test que lo vea.

Cuatro estados de reserva, y el que importa es el cuarto:

| Estado | Qué significa | Qué se hace |
|---|---|---|
| `listo` | Ya se pagó y el resultado está guardado | Se devuelve. Gasto cero |
| `nueva` | Nadie la pidió, o la anterior falló **con respuesta** (no cobró) | Adelante |
| `en_progreso` | **Otro proceso la está pidiendo AHORA** | Se **espera** su resultado |
| `huerfana` | El lease venció: el proceso murió y **pudo cobrar** | Standard: recuperar. Live: **detenerse** |

`en_progreso` es el estado que faltaba y era el doble cobro: la reserva se commiteaba antes del POST,
un segundo proceso veía `pending`, lo declaraba huérfano al instante y salía a pagar lo mismo.
Medido: **de 2 reservas simultáneas, 2 autorizaban el POST**.

Y tres cosas que parecen detalles y no lo son:

- **`completar()` y `fallar()` hacen CAS por `attemptId`.** Una respuesta tardía no puede pisar el
  resultado de un intento posterior.
- **`reservar` no cuenta un envío; `contarEnvio` sí.** Consultar una huérfana o recuperar por
  `task_get` no cuesta un envío — antes sí lo contaba y agotaba `MAX_INTENTOS` con consultas que
  nunca postearon nada.
- **El hash canoniza los arrays.** Para DataForSEO, `["pizza","pasta"]` y `["pasta","pizza"]` son la
  misma consulta y el mismo cobro, pero hasheaban distinto: dos procesos no veían la reserva del
  otro y se pagaba dos veces. `jsonEstable()` ordena claves **y** arrays. Lo que **sigue abierto**:
  dos lotes que se **solapan** (`[a,b]` y `[b,c]`) pagan `b` dos veces — anotado en ADR-14.

**En producción, el registro tiene que ser DURABLE.** `getProvider()` lo exige y falla cerrado
(`taskLog?.durable`): `Noop`/`Mem` mueren con el proceso y no cubren el caso que cuesta dinero, que
es el crash + re-run. Lo inyecta quien es composition root: el orquestador (`PgTaskLog`) y el CLI.

## Reintentos: la distinción no es "pago vs gratis"

Es **si el proveedor llegó a procesar** ([`lib/http.ts`](../../../kr-service/src/lib/http.ts)):

- **429** → rechazo **antes** de ejecutar. No cobró. **Siempre** se reintenta.
- **Timeout, error de red, 5xx** → **ambiguo**. Con `billable: true` **no se reintenta**: se propaga
  y el pipeline degrada (la métrica queda `null`, que el informe reporta como `n/d`).

Un dato faltante cuesta $0 y se ve en el informe. Un cobro duplicado cuesta plata y es invisible.

Y una trampa propia de DataForSEO: **reporta sus rate limits como código `40202` dentro de un HTTP
200**, así que el retry de nivel HTTP nunca los veía. Por eso existe `DataForSeoTaskError.esRateLimit`
y `postConReintentos`.

## La cache: dónde está el ahorro y dónde el veneno

[`cache.ts`](../../../kr-service/src/dataforseo/cache.ts) ·
[`cached-provider.ts`](../../../kr-service/src/dataforseo/cached-provider.ts)

- **Se cachea por keyword, no por lote.** Si se cacheara el lote entero, una sola keyword nueva
  invalidaría las otras 51 y se pagarían todas de nuevo — que es el caso habitual, porque cada
  research comparte casi todas sus keywords con el anterior del mismo rubro.
- **La ausencia se cachea, con TTL corto** (`TTL.negative`, 7 días). DataForSEO devolvió KD `null`
  para 41 de 60 keywords en la corrida real: sin cachear el null se vuelve a pagar por preguntar lo
  mismo. Corto, porque una keyword sin datos hoy puede tenerlos en un mes.
- **Se clasifica por si HAY VOLUMEN, no por si hay fila.** Un `SearchVolumeRow` con
  `search_volume: null` es un objeto **no nulo**: con el filtro viejo caía en el TTL largo, 30 días
  declarando "sin datos" algo que podía ganar volumen.
- **La clave lleva TODO lo que cambia la respuesta**, y el **entorno va primero**. Omitirlo fue un
  bug de corrección: una corrida de sandbox dejó 217 entradas con `volume: null`, y al cambiar la URL
  base a producción —un renglón del `.env`— se servían como **aciertos**. Corrida "de producción"
  barata, sin volúmenes, con un brief basura que parecía legítimo.
- **Un fallo al persistir la cache nunca hace fallar la llamada.** Ya tiró a la basura datos frescos
  ya pagados.
- **Guardar la cache no espera al final del run**: `setMany` persiste en el momento. Si el run se
  cae, lo pagado queda guardado. Misma lección que el checkpoint del dataset.

## Sandbox vs producción

`config.dataforseo.isSandbox` sale de que la baseUrl contenga `sandbox`. **Cambiar de uno a otro es
un renglón del `.env`,** y por eso todo lo que distingue los dos mundos está escrito en el código:

- El sandbox **no se registra** en el task-log (es gratis, y ensuciaría la auditoría del gasto real).
- El sandbox **no se cachea**. Beneficio cero, riesgo de envenenar producción: ver arriba.
- El sandbox devuelve **ficción**: 0% de cobertura de volumen por diseño. Por eso el corte duro por
  cobertura 0 solo aplica cuando `mode === "live" && !isSandbox` — abortar en sandbox rompería el
  loop de desarrollo gratis sin proteger nada.
- **Tras correr en producción, se vuelve a sandbox** (`kr-service/.env`). Es una regla de AGENTS.md,
  no una sugerencia: el `.env` que queda es el que va a usar la próxima corrida distraída.

## Lo que NUNCA corre un agente

```bash
npm run spike            # con el .env en producción, ESTO ES una corrida paga (~$0.31)
npm run demo -w renderer # Storyblok REAL con credencial real
npm run reseed:demo      # sin --dry-run, siembra de verdad en Supabase
npm run env:sync         # reescribe los .env de todos los paquetes
DFS_PERMITIR_REPAGO=1    # autoriza pagar dos veces. Lo decide un humano, mirando el panel
```

Si el trabajo **solo se puede terminar pagando**, se hace todo lo gratis y se devuelve el control con
tres datos: **qué falta, cuánto cuesta, y qué se compra con eso.**

## Un test que arranca el pipeline entero puede gastar. Cuatro cerrojos

Es el riesgo que no se ve venir: `kr-service/src/config.ts` empieza con `import "dotenv/config"`, así
que **cargar el módulo lee `kr-service/.env`** —donde puede haber keys reales y una baseUrl de
producción— sin que el test lo haya pedido. Un test que llame a `runResearch()` con ese entorno
**gasta de verdad**. Los cuatro cerrojos, en orden:

1. **`process.env.DOTENV_CONFIG_PATH` a un archivo inexistente**, antes de importar nada del paquete.
   Dotenv no carga nada y el `.env` real ni se abre.
2. **Borrar `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`** y forzar `LLM_PROVIDER=mock`,
   `DATAFORSEO_MODE=mock`.
3. **Un test aparte que compruebe que la config quedó 100% mock.** Si el cerrojo se rompe, falla ahí
   en vez de correr — un guard que nadie verifica es una intención.
4. **Romper `globalThis.fetch`.** Cualquier intento de salir a la red revienta con un error claro en
   vez de con una factura.

El orden importa: 1 y 2 van **antes** del primer `import` del paquete, porque `config` se congela al
cargarse.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| Estimar una fase con un número fijo cuando escala con N | El tope no protege en runs grandes. Es el bug de las estimaciones 50× |
| `assertCanSpend` solo antes del bucle | Si la estimación se queda corta, el bucle sigue pagando hasta el final |
| Reintentar un timeout de una operación facturable | Puede pagar dos veces, y el medidor solo ve el cobro que respondió |
| Marcar `failed` una task que **sí cobró** | Declara "no cobró": el reintento paga otra vez. Solo `failed` con `cobro === 0` |
| Cachear sin el entorno en la clave | Ficción del sandbox servida como dato real de producción |
| Tratar `null` y `undefined` como lo mismo en el destino de publicación | Ver `pipeline-publicacion`: es un cruce entre clientes |
| Un modelo nuevo sin tarifa en `DEFAULT_PRICES` | Suma 0: el tope queda desactivado en silencio (hoy aborta, pero solo si hay tope) |
| Tocar `sim_threshold`, `MAX_INTENTOS` o `LEASE_MS` sin test | Son defaults de producción. Sin test, la decisión no tiene dueño |

## Verificación

`npm test -w kr-service -w orchestrator -w web-builder` — todo con providers mock, cero red, cero
credenciales. Los tests que cubren esto: `budget.test.ts`, `cost.test.ts`, `http.test.ts`,
`task-log.test.ts`, `cached-provider.test.ts`, `getprovider-guard.test.ts`, `client.test.ts`.

**Verificación por mutación, obligatoria acá.** Un test de idempotencia que siempre pasa te deja
pagando dos veces con el verde puesto: reintroducí el bug (quitá el CAS, sacá el entorno de la clave,
devolvé `nueva` en vez de `en_progreso`) y confirmá que cae *exactamente* su test.

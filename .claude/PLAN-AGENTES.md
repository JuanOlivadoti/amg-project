# Plan: los tres agentes que faltan

> **Qué es esto.** El detalle de ejecución para escribir los agentes `pipeline`, `datos` y `render`
> con sus skills, **una etapa por sesión**. Vive acá y no en `docs/` porque describe el arnés, no el
> producto: quien lo va a ejecutar trabaja en `.claude/`.
>
> **Qué NO es.** No es un roadmap. Cuando este documento y
> [`09-estado-y-roadmap.md`](../docs/proyecto/09-estado-y-roadmap.md) se contradigan sobre el estado
> del proyecto, **gana el `09`**. Acá solo se decide el orden y el contenido de estas tres piezas.
>
> Escrito el 2026-08-02, después de que el agente `front` y el `revisor` quedaran cerrados.

## Por qué una sesión por etapa

Cada agente con sus skills es una etapa que se cierra sola: se escribe, se estrena con trabajo real,
pasa por el `revisor` y se commitea. Las tres en una sola sesión producen exactamente el drift que
este repo ya pagó una vez —quince cifras desincronizadas en ocho archivos— porque el ritual de
cierre se hace una vez al final, cansado, en vez de tres veces.

**La regla que hace que esto no sea papeleo:** una skill escrita leyendo el código es una
**hipótesis** hasta que un agente la usa. Por eso cada etapa de abajo tiene un *trabajo real que la
estrena*, y la etapa no se cierra sin él. Escribir tres agentes que nadie probó es escribir ficción
con formato de instrucción.

## El criterio, para no reabrir la discusión en cada sesión

**Un área es un agente cuando tiene su propio modo de verificar y sus propias trampas.** No cuando
tiene su propia carpeta. Por eso `db/` y `api/` son **un** agente (comparten PGlite y comparten el
cuerpo de conocimiento: RLS, roles, `Tx`), y por eso `renderer/` es un agente entero con 3.395
líneas mientras `datos` cubre 10.320.

**El agente es delgado; el conocimiento vive en las skills.** El agente dice *cuál es tu ámbito, qué
no hacés nunca, cómo verificás y cómo devolvés el trabajo*. Las convenciones concretas van a skills
que se cargan por tema, y que la sesión principal también puede cargar sin delegar en nadie.

**Las skills se parten por cuerpo de conocimiento, no por paquete.** `pipeline-gasto` cruza tres
paquetes porque el gasto es un solo tema; `datos-testing` existe porque PGlite es su propio mundo.

## El formato, medido contra lo que ya existe

| Archivo | Líneas | Frontmatter |
| --- | --- | --- |
| [`agents/front.md`](agents/front.md) | 79 | `name`, `description` |
| [`agents/revisor.md`](agents/revisor.md) | 103 | `name`, `description`, `tools` |
| [`skills/portal-angular/SKILL.md`](skills/portal-angular/SKILL.md) | 188 | `name`, `description` |
| [`skills/portal-estilos/SKILL.md`](skills/portal-estilos/SKILL.md) | 116 | `name`, `description` |
| [`skills/portal-testing/SKILL.md`](skills/portal-testing/SKILL.md) | 144 | `name`, `description` |

Un agente de área **no** declara `tools` (hereda todas) ni `model` (hereda el de la sesión: la
selección manual del usuario manda sobre la plantilla). El `revisor` sí declara `tools` porque su
límite —no editar— es parte de su definición.

Las secciones de `front.md` que conviene replicar, porque cada una nació de un problema real:

1. **Tu ámbito, y dónde se corta** — qué hacer cuando el trabajo necesita un cambio en otra área
   (terminar lo propio y devolver el control diciendo qué falta afuera).
2. **Lo que no hacés nunca** — commitear, tocar `.env`, agregar dependencias sin justificarlo.
3. **El mapa en diez líneas** — la estructura de carpetas con una frase por carpeta.
4. **Qué skill cargar antes de escribir** — tabla `vas a tocar → skill`.
5. **Verificar antes de decir que está listo** — los comandos exactos, con su costo en segundos.
6. **Cómo devolvés el trabajo** — y el recordatorio de que un verde sin output es una afirmación sin
   respaldo.

---

## Etapa A — `pipeline` · `kr-service/` + `orchestrator/` + `web-builder/`

11.198 líneas, 20 archivos de test. Tres paquetes y un agente porque el hilo que los une es real:
**es el trabajo que corre sin nadie mirando, gasta dinero y tiene que ser idempotente.** El
orquestador es el pegamento entre los otros dos.

Es el candidato más probable a partirse más adelante. Si pasa, el corte natural es research /
publicación —no orquestador aparte, que es justamente lo que los une—.

| Skill | Qué lleva | Anclajes verificados en el código |
| --- | --- | --- |
| `pipeline-gasto` | La más importante, y transversal a los tres paquetes. Presupuesto preflight; `CostMeter`; idempotencia por `payload_hash` (ADR-14); cache de respuestas; sandbox vs producción y **la regla de volver a sandbox**; providers mock | [`budget.ts`](../kr-service/src/lib/budget.ts) documenta que las estimaciones viejas estaban ~50× por debajo, así que el preflight *siempre* daba "entra"; se recalibraron contra una corrida real. La asimetría a explicar: sobreestimar aborta de más (gratis), subestimar deja gastar de más (irreversible) |
| `pipeline-research` | `kr-service`: clustering, intent, embeddings, el brief como frontera M2→M1, DataForSEO Standard (`task_post`/`task_get`) con su doble capa de recuperación | La 6ª review externa encontró 4 bugs en la primera versión de Standard. `dedupe` canónico (`Madrid` vs `madrid`) y `n/d` en vez de "0 búsquedas/mes" salieron de la corrida real, no del sandbox |
| `pipeline-publicacion` | `web-builder`: Storyblok **Management** API; el space viaja como argumento, no por variable de entorno; generación de HTML; `uid` | [`publisher.ts`](../web-builder/src/publish/publisher.ts): `published` responde *"¿el proveedor confirma que lo está?"*, no *"¿lo mandamos?"* — existía porque el publisher mandaba drafts y la base escribía `published_at` igual. Y sin `spaceId` **no hay publisher live**: es preferible detenerse a escribir en el space de otro cliente |
| `pipeline-orquestacion` | `orchestrator`: Inngest, steps durables, reintentos, leases (migración `0005`), compuerta humana con `waitForEvent`, y que **un evento no porta autoridad** (ADR-18: la fila primero, el evento después) | ADR-12 y ADR-18 |

**Lo que el agente tiene que prohibirse explícitamente:** correr DataForSEO en producción, `npm run demo -w renderer` y `reseed:demo` sin `--dry-run`. Es el único agente cuyo ámbito **gasta dinero real**, y AGENTS.md ya prohíbe que un subagente corra eso.

**Cómo se verifica el área:** `npm test -w kr-service -w orchestrator -w web-builder`, todo con
providers mock y sin red. Ningún test toca una credencial.

**El trabajo real que lo estrena:** **KR-1 y KR-3** del
[`09` § 2.b](../docs/proyecto/09-estado-y-roadmap.md) — recuperar o regenerar el dataset crudo, y las
tres mejoras de calidad del research (`is_local` por señales del SERP, `score_confidence` que ordene,
volumen normalizado por percentiles). Es puro `kr-service`, y KR-1 ejercita justo la parte peligrosa
del ámbito: decidir si se paga una corrida.

---

## Etapa B — `datos` · `db/` + `api/`

10.320 líneas, 14 archivos de test, 12 migraciones. **Van juntos y no separados**, aunque sea el
bloque más grande: [`api/src/app.ts`](../api/src/app.ts) es casi una fachada HTTP sobre el store, y
ADR-22 dice que la seguridad vive en Postgres. Partirlos crearía dos agentes escribiendo las dos
mitades de un contrato en el caso más frecuente —un endpoint nuevo casi siempre necesita un método
del store—.

| Skill | Qué lleva | Anclajes verificados en el código |
| --- | --- | --- |
| `datos-postgres` | RLS y por qué se escribe **bajo `app_user`**, no con la service-role; los cuatro logins `NOINHERIT` (ADR-17); `Tx` y por qué no existe un `query()` suelto; cómo se numera y se aplica una migración; columnas generadas usadas como allowlist | [`store.ts`](../db/src/store.ts) abre con las tres decisiones de fondo: `kr-service` no conoce la capa; todo bajo RLS *("un bug de aplicación no puede cruzar tenants: lo frena Postgres")*; toda query por conexión reservada porque `set local` es local a la transacción. Y `TenantContext` **no tiene rol**: el rol se deriva de `memberships` (ADR-15) |
| `datos-api` | Hono; el preflight CORS **antes** de exigir token; verificación contra el JWKS del emisor (ADR-23); el comando compuesto fila-primero-evento-después (ADR-18); `ApiDeps` inyectado; y qué **nunca** puede venir en un body (`role`, `tenant_id`) | [`app.ts`](../api/src/app.ts): las deps inyectadas son lo que permite correr la API entera contra PGlite sin red ni Supabase. El default de CORS `*` es seguro **porque autentica por header y no por cookies** — el razonamiento va en la skill, o alguien lo "arregla" |
| `datos-testing` | PGlite: cómo se levanta (`testdb.ts`, `testing.ts`); el patrón del test de RLS —probar que el **otro** tenant *no* ve—; mutación aplicada a seguridad; tests de migración | La disciplina de AGENTS.md, aterrizada: un test de seguridad que siempre pasa es peor que no tenerlo |

**Cómo se verifica el área:** `npm test -w db -w api` sobre PGlite (Postgres real en WASM, sin
Docker ni red). Para ver el portal contra la API real: `npm run dev:server -w api`.

**El trabajo real que lo estrena:** **KR-2** — el informe legible en el portal. Tiene una decisión
técnica abierta y anotada en el `09` (¿la API importa `kr-service`, se extrae un paquete compartido,
o el portal lo renderiza?), y la recomendación registrada es la (b). Es además el primer trabajo que
cruza tres áreas, así que estrena de paso la regla de **fijar el contrato antes de repartir**.

---

## Etapa C — `render` · `renderer/`

3.395 líneas, 5 archivos de test. El paquete más chico y el de mayor riesgo: **la única superficie
expuesta a internet anónimo.** Dos skills bastan.

| Skill | Qué lleva | Anclajes verificados en el código |
| --- | --- | --- |
| `render-seguridad` | El dominio **es** la autorización; `app_render`, el rol más pobre del sistema; la allowlist `business_profile_publico` **y su trampa: agregás un campo al perfil y se filtra en silencio si no lo agregás a la allowlist**; escape y validación de todo lo que va a `<style>`, `<img src>` o el HTML; revalidación como defensa en profundidad; preview y webhook, ambos con secreto; la pregunta de diseño *"si me lo toman, ¿qué se llevan?"* | [`renderer/src/app.ts`](../renderer/src/app.ts) documenta el **orden** como la seguridad: `Host` → dominio canónico (si no, 404) → sitio bajo RLS como `app_render` (si no, 404) → ¿preview autorizado? → cache → CDA. Y por qué acá filtrar por tenant *sería teatro*: del otro lado no hay usuario |
| `render-cda-cache` | Content Delivery API y **nunca** la Management API; cache en proceso, cache negativa, coalescing, semáforo de saturación; invalidación por webhook — y por qué con más de una instancia deja de funcionar | ADR-19 y el `09` § 3: el webhook llega a una sola instancia; las demás sirven viejo hasta el TTL |

**El cruce que hay que declarar en el agente:** la generación de HTML vive en
`web-builder/src/render/html.ts` y el renderizador la importa. Es territorio de `pipeline`, no de
`render`.

**Cómo se verifica el área:** `npm test -w renderer` (Hono con interfaces inyectadas: se prueba el
404 de un dominio desconocido y el rechazo de un webhook sin firma, sin salir a internet). ⚠️ `npm
run demo -w renderer` **pega contra el Storyblok real con credencial real** — el agente no lo corre.

**El trabajo real que lo estrena:** no hay uno en el camino corto. Lo que le queda al renderizador
—CDN en el borde, cache compartida entre instancias— es decisión de despliegue, no código. **Por eso
va último**, y por eso es razonable que espere a que aparezca trabajo real en vez de escribirlo por
completitud.

---

## Lo que decidimos NO crear

Tres huecos que son decisiones, no olvidos. Si en una sesión futura parece buena idea llenarlos,
leer esto primero.

**No una skill transversal de TypeScript ni de tests.** ESM strict, `noUncheckedIndexedAccess`,
import por nombre de paquete, `tsx` sin build, verificación por mutación, nombres de dominio en
español — todo eso ya está en [`AGENTS.md`](../AGENTS.md), que se carga **siempre**. Duplicarlo en
una skill crea dos copias que se desincronizan. Las skills llevan lo que AGENTS.md no puede: el
detalle operativo demasiado largo para el contexto permanente.

**No un agente de documentación.** Es tentador, porque el paso 3 del ritual es donde más drift hubo.
Pero un subagente de docs no sabe qué pasó en la sesión: habría que contárselo, y eso es el
teléfono descompuesto que el protocolo evita. El drift de **cifras** es mecánico y va a
`scripts/verificar.sh` como chequeo, no a un agente. El drift de **criterio** lo tiene que arreglar
quien hizo el trabajo.

**No un agente de infra/despliegue.** Supabase, Hostinger, Railway, `env:sync`, `reseed:demo`. Es
justo el trabajo que AGENTS.md prohíbe delegar en un subagente. Que un área quede deliberadamente
sin agente es una decisión de seguridad.

## El orden, y qué lo puede cambiar

`pipeline` → `datos` → `render`. **El orden lo manda el trabajo real, no este documento**: sale de
que KR-1 y KR-3 son puro `kr-service`, KR-2 necesita la API, y lo del renderizador es despliegue. Si
el trabajo próximo cambia —lo dirá el `09`, no esto—, el orden cambia con él.

## El cierre de cada etapa

El ritual completo está en [`AGENTS.md`](../AGENTS.md) y los checkpoints en
[`CHECKPOINTS.md`](../CHECKPOINTS.md). Lo específico de estas tres etapas:

1. Escribir el agente y sus skills.
2. **Estrenarlos con el trabajo real de la etapa.** Delegar de verdad en el agente nuevo y ver dónde
   la skill no alcanza. Lo que falte se corrige antes de cerrar: es el único momento en que la
   distancia entre lo escrito y lo cierto se ve gratis.
3. Correr **`npm run verificar`** y pegar el output.
4. Pasar el diff por el **`revisor`**. Quien implementa no se autoaprueba.
5. Actualizar la tabla de agentes de [`AGENTS.md`](../AGENTS.md): el área pasa de *planificado* a
   *existe*, y las skills dejan de decir *(por escribir)*. **Y tachar la etapa acá.**
6. Anotar en [`progress/history.md`](../progress/history.md) qué enseñó estrenarlo.
7. Commit + push, que los pide el usuario directamente.

### Estado

| Etapa | Agente | Skills | Estado |
| --- | --- | --- | --- |
| — | `front` | `portal-angular`, `portal-estilos`, `portal-testing` | ✅ escrito · ⚪ **sin estrenar todavía** |
| — | `revisor` | `codex-review` | ✅ escrito y estrenado (dos rondas, 5 hallazgos reales) |
| A | `pipeline` | `pipeline-gasto`, `pipeline-research`, `pipeline-publicacion`, `pipeline-orquestacion` | ⚪ sin empezar |
| B | `datos` | `datos-postgres`, `datos-api`, `datos-testing` | ⚪ sin empezar |
| C | `render` | `render-seguridad`, `render-cda-cache` | ⚪ sin empezar |

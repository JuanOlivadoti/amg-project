# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión (2026-09-10):** sin desarrollo — se recorrió con Juan, decisión por decisión, el checklist de
[`16-pendientes-juan.md`](../docs/proyecto/16-pendientes-juan.md) y se fijó el orden de trabajo
siguiente. Arrancó con la pregunta "qué falta para completar la plataforma que no dependa de la
aprobación de Google".

## Lo que se decidió

| Ítem | Decisión |
|---|---|
| **#4 `CACHE_TTL_MS`** | **60 s** (`CACHE_TTL_MS=60000`) |
| **#5 Dominios custom de Railway** | **Esperar**, con disparador escrito: subir el plan el día que se firme un **tercer** cliente con dominio propio. La CDN se saca a propósito de esta decisión |
| **#6 OBS-04** | **(a) edita solo la agencia**; **(c) desde el portal** como único camino de crecimiento, **(b) un seat en Storyblok** descartado. **Cierra OBS-04** |
| **#7 Salida gestionada** | **Pago único + cuota mensual**, con mínimo alto explícito. **Faltan los dos importes** |
| **#2 Business Profile API** | **En pausa** — no se manda la solicitud por ahora |
| **Roadmap** | **Lote corto de cierre** (guardarraíl de «Conectar Google» en mock · reescribir ADR-11 · verificar el snapshot estático) y después **comparativas de seguros** |

## Los dos hallazgos que salieron de decidir

1. **El TTL no era lo que la documentación creía.** El webhook de invalidación lo dispara **solo
   Storyblok**, pero la home, `/menu`, la nav y el pie se sintetizan desde `clients.business_profile`
   (Postgres) y se **hornean dentro del HTML cacheado** (`renderer/src/app.ts:373-404`) — así que **un
   cambio hecho desde el portal no invalida nada** y aparece sólo al vencer el TTL. El TTL era el
   tiempo de respuesta del editor, no sólo el techo de propagación entre instancias. De ahí el 60 s.
2. **⚠️ Trampa armada en producción.** `crearFuncionPollingResenas` está registrada
   **incondicionalmente** (`orchestrator/src/server.ts:63`). El día que alguien pulse «Conectar
   Google» estando en `GOOGLE_REVIEWS_MODO=mock`: dos **reseñas inventadas** en la base **real**
   (`orchestrator/src/google/mock-provider.ts`), una **alerta de Telegram de verdad** (2★,
   `TELEGRAM_MODO=live`) y una **llamada real a OpenAI** (borrador de la 5★). Acotado —el
   `googleReviewId` del mock es determinista— pero permanente. Como el trámite quedó en pausa, **no
   caduca solo**: el guardarraíl encabeza el roadmap.

También se anotó, leyendo ADR-11 para la pregunta del precio, que **la variante (b1) «el cliente lo
hostea» no es posible** tal como está redactada: se escribió para un frontend Next.js entregable, y hoy
el renderizador es multi-tenant y lee de la base de AMG. La reescritura del ADR tiene que resolverlo.

## En vuelo (sin commitear)

Nada — todo commiteado al cerrar la sesión.

## Próximo paso

1. **Lo que espera de Juan** (no es desarrollo): los **dos importes** de la salida gestionada; poner
   **`CACHE_TTL_MS=60000`** en Railway; y comprobar si hay algún cliente con conexión de Google en
   producción.
2. **El lote corto de cierre**, en este orden: (a) guardarraíl de «Conectar Google» cuando el modo es
   `mock` y el entorno es producción — misma doctrina que `verificarPublicacion()` con `PIPELINE_MODO`;
   (b) reescribir **ADR-11** con OBS-04 cerrada, resolviendo el hallazgo de (b1) y dejando el hueco de
   los importes; (c) verificar el **snapshot estático** como entregable, que sale de `renderStory()`.
3. **Después: comparativas de seguros.** Falta el `writing-plans` sobre la spec aprobada
   (`docs/superpowers/specs/2026-09-04-comparativas-seguros-design.md`). Dos cosas a mirar con lupa al
   planificar: el **preflight de presupuesto** del provider real (llamada facturable nueva) y el
   **parsing de formato libre** — un LLM interpretando columnas arbitrarias es donde un test que prueba
   la implementación en vez del contrato se ve verde sin probar nada.

## Decisiones tomadas

- **La CDN se separó de la decisión de dominios a propósito.** El límite de Railway es un síntoma, no
  la razón para construirla: se justifica sola por el borde (ADR-19) y por el colchón de
  disponibilidad. Anotado para su diseño futuro: **la clave de cache tiene que incluir el `Host`** —
  el dominio ES la autorización, y una cache que lo ignore serviría la web de un cliente bajo el
  dominio de otro.
- **Se nombró (c) como camino de crecimiento de OBS-04 con la decisión fría**, para que el día de la
  presión nadie elija (b) por ser la de una tarde. Y se midió lo que (c) cuesta de verdad: el rol
  `cliente` no puede escribir nada en `clients` (`app.puede_escribir()`, `0001_init.sql:387-390`), así
  que es una migración de escritura por columna con tests de aislamiento, no un flag.
- **Candidato de roadmap NO decidido:** invalidar la cache del renderizador desde `PATCH
  /clients/:id/*`. Con eso el TTL volvería a ser red de seguridad y no el mecanismo principal.

## Callejones sin salida

— Ninguno: no hubo desarrollo.

## Archivos calientes

- `docs/proyecto/16-pendientes-juan.md` — el checklist, ahora cerrado salvo los dos importes del § 7.
- `docs/decisiones-arquitectura.md` — OBS-04 cerrada; ADR-11 con la nota de desbloqueo y el hallazgo (b1).
- `docs/proyecto/15-plan-plataforma.md` — bloques F, G y H actualizados + el orden vigente.
- `docs/proyecto/09-estado-y-roadmap.md` — resumen ejecutivo, riesgos, roadmap y costo de Storyblok.

## Verificaciones

- **`npm run verificar -- --rapido`** — corrido tras los cambios (solo tocan `docs/` y `progress/`):
  entorno, arnés y higiene de secretos, más typecheck. Sin cambios de código, así que no aplica la
  tanda completa de tests.

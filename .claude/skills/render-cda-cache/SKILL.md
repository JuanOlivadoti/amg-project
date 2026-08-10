---
name: render-cda-cache
description: Usar al tocar la lectura de Storyblok o cualquier cache del renderizador (renderer/) — el cliente de la Content Delivery API, el TTL y el desalojo de la cache de páginas, la cache negativa, el coalescing, el semáforo de saturación y la invalidación por webhook. Cubre por qué la Management API no entra acá y por qué la invalidación deja de funcionar en cuanto hay más de una instancia.
---

# Leer Storyblok desde el proceso más expuesto

`renderer/` sirve la web de cada cliente **en vivo** (ADR-19): dominio → space → story → HTML. Esta
skill cubre las dos mitades de que "en vivo" no signifique lento ni caro: **cómo se lee el origen** y
**qué se recuerda para no volver a leerlo**. Lo otro del paquete —el dominio como autorización,
`app_render`, la allowlist del perfil, la firma del preview— es de `render-seguridad`.

## La Content Delivery API, y NUNCA la Management API

Las dos APIs de Storyblok **no se cruzan**, y eso es seguridad, no estilo. Son incluso dos hosts
distintos, lo cual hace la regla comprobable con un `grep`:

| Quién | API | Host | Credencial |
|---|---|---|---|
| `orchestrator` / `web-builder` | Management | `mapi.storyblok.com` | token que **escribe y borra** |
| `renderer` | Content Delivery | `api.storyblok.com/v2/cdn` (`CDA_BASE`) | tokens de **lectura** (`publicToken`, `previewToken`) |

El renderizador es la única pieza expuesta a internet anónimo. Si alguien "resuelve" un problema acá
importando la Management API, el radio de explosión pasa de *leer lo que ya es público* a *reescribir
la web de todos los clientes*. El razonamiento vive en la cabecera de
[`cda.ts`](../../../renderer/src/cda.ts): es la línea que no se cruza. Los tres endpoints que se usan
son todos de lectura — `cdn/stories/{slug}` (`traerStory`), `cdn/links` (`traerNav`) y
`cdn/stories?filter_query[schema_type][in]=Article` (`traerBlog`).

## "No está" y "se rompió" no son lo mismo

Es el contrato de `Cda`, y de él dependen todas las caches de abajo: **404 → `null`** (o `[]` en
nav/blog: un space sin páginas no es un error), y **cualquier otro fallo LANZA `ErrorCda`** con su
status — 4xx/5xx del origen tal cual, **504** si vence el plazo o falla la red, **502** si el cuerpo
excede el tope o no es JSON.

Confundirlos tiene una consecuencia concreta: un fallo del origen convertido en `null` se anota en la
cache negativa y **borra la web del cliente hasta que venza**. Por eso el `catch` de
[`app.ts`](../../../renderer/src/app.ts) responde **503 y no cachea nada**, y solo el `html === null`
—un "no está" legítimo— llama a `faltantes.anotar()`. Dos defensas más que mantener en `cda.ts`:

- **`conPlazo` cubre la respuesta COMPLETA, cuerpo incluido.** Un `signal` abortado no interrumpe un
  `res.json()` en curso: lo que garantiza el plazo es el `Promise.race`, no la señal. La versión
  anterior cortaba al recibir los headers, y un origen que mandaba `200 OK` y dejaba el body abierto
  colgaba la petición para siempre.
- **El cuerpo del error NUNCA se propaga al mensaje.** Puede traer el token, y de acá va a un log.

## Las seis memorias del proceso, y ninguna sobrevive a un reinicio

Todo es **en proceso**: no hay Redis ni borde — la CDN que pide ADR-19 es despliegue, no código.

| Memoria | Dónde | TTL | Tope | Qué la vacía |
|---|---|---|---|---|
| Páginas renderizadas | `CacheRender` ([`cache.ts`](../../../renderer/src/cache.ts)) | 5 min | 500 entradas **y** 64 MB | webhook (`invalidarSpace`) |
| Resolución dominio → sitio | `sitios` (Map en `createApp`) | 60 s | 1.000 | nada: solo el TTL |
| Nav por space | `navCache` | 60 s | — | webhook |
| Blog por space | `blogCache` | 60 s | — | webhook |
| 404 recientes | `CacheNegativa` | 30 s | 2.000 | webhook (`olvidarTodo`) |
| Entregas del webhook ya vistas | `CacheNegativa` | 5 min | 500 | nada |

Tres cosas que no son obvias mirando la tabla:

1. **La clave de páginas lleva la longitud del space delante** (`${spaceId.length}:${spaceId}:${slug}`).
   Con `${spaceId} ${slug}`, `("11", "1 menu")` y `("11 1", "menu")` colapsaban en la misma entrada —y
   el slug lo elige quien pide—. Tiene que ser **inyectiva**: el mismo motivo por el que
   `invalidarSpace("11")` no se lleva por delante al 111.
2. **El tope de entradas no acota la memoria.** 500 páginas de 2 MB son 1 GB, y con ADR-19 un proceso
   sin memoria son *todas* las webs caídas a la vez. De ahí el tope de bytes, y que una página que por
   sí sola no entra **no se guarde** (si no, el desalojo vaciaría la cache haciéndole lugar a algo que
   igual no cabe). Desaloja LRU: `get()` reinserta para mover la clave al final del `Map`.
3. **La cache de resolución no es una optimización.** El orden era `resolver dominio (DB) → mirar
   cache`, así que una base colgada dejaba pendiente **hasta una página ya cacheada**. Hoy la
   resolución se mira primero, y su `null` también se cachea: enumerar hosts deja de salir gratis.

**El preview no toca ninguna de estas caches** —ni lee, ni escribe, ni coalesce— y pide `cv=Date.now()`
para saltarse la CDN de Storyblok. Un borrador en la cache pública es cómo un borrador se publica solo.

## Los tres límites del camino anónimo

Están en [`limites.ts`](../../../renderer/src/limites.ts) y nacieron de la 10ª review: el servicio no
tenía **ni un solo límite superior**. No hacía falta ninguna vulnerabilidad ingeniosa — alcanzaba un
`for` con `curl`, y lo pagaba la cuenta de Storyblok.

| Pieza | Contra qué | Qué hace exactamente |
|---|---|---|
| `Coalescedor` | *cache stampede* | N peticiones al mismo `space:slug` → **una** llamada al origen |
| `CacheNegativa` | enumerar `/a-1`, `/a-2`… | recuerda el 404 30 s: el segundo intento no sale a la red |
| `Semaforo` | un pico sin techo | pasado el cupo lanza `Saturado` → **503 + `retry-after: 2`** |

- **El `Coalescedor` limpia con `finally`, no con `then`.** Si no, una promesa rechazada quedaría en
  el mapa y **todas** las visitas siguientes recibirían el mismo fallo.
- **El `Semaforo` envuelve al `Coalescedor`, no al revés.** Cuenta **peticiones en vuelo**, no
  llamadas al origen: diez visitas coalescidas ocupan diez cupos y hacen una sola llamada. Y rechaza
  en vez de encolar — una cola infinita convierte un pico en latencia creciente hasta quedarse sin
  memoria; un 503 rápido deja el proceso vivo **para las páginas que ya están en cache**.
- **La nav y el blog nunca dan 503.** Son mejoras: si la Links API falla, o el `Cda` ni implementa
  `traerNav`, la página sale sin barra. Un enhancement con permiso para tumbar la página que
  enriquece le regala al origen un modo de tirar todas las webs a la vez.

⚠️ **El cupo de producción es 64 y no lo fija ningún test ni ninguna variable de entorno.**
`leerConfig()` no lee `maxConcurrencia` (ni `maxConexiones`): esos campos de `ConfigRenderer` solo son
alcanzables llamando a `crearDeps` a mano. Y el único test del semáforo pasa `maxConcurrencia: 2`:
**elige el parámetro en vez de fijar el de producción** — el mismo falso verde que `cache.test.ts` ya
cazó con `maxEntradas`. Si tocás el semáforo, ese test es el que falta.

## La invalidación por webhook, y dónde deja de funcionar

`POST /_webhook/storyblok`, en este orden y por este motivo:

1. **Sin `webhookSecret` → 503.** Fail-closed: una config incompleta no abre la puerta.
2. **`content-length` > 256 KB → 413, antes de leer nada** (y de nuevo sobre los bytes reales, porque
   el header lo declara quien pide). Verificar la firma exige el cuerpo entero: sin el corte previo un
   anónimo *sin* el secreto nos hace bufferear lo que quiera y la firma lo rechaza **después**.
3. **`firmaValida` sobre el cuerpo CRUDO**, HMAC-SHA1 con `timingSafeEqual`. Parsear y re-serializar
   cambia el JSON y rompe una firma legítima: **verificar primero, parsear después**.
4. **Dedupe por `sha256` del cuerpo, ventana de 5 min.** La firma autentica el cuerpo y nada más —sin
   timestamp ni id de entrega—, así que una entrega capturada se repite para siempre sin conocer el
   secreto, y repetirla en bucle es cache busting gratis. No es perfecto (dos entregas distintas se
   pueden alternar), pero convierte "infinitas invalidaciones" en "una por ventana".
5. **Se invalida el space ENTERO**, no la story del evento: un cambio en el nombre del negocio toca el
   JSON-LD de todas las páginas. Invalidar de más cuesta unos renders; de menos deja la web vieja. Se
   vacían también la nav y el blog del space, y la cache negativa **completa** (una página nueva tiene
   que verse aunque su 404 esté anotado).

> **Con más de una instancia, la invalidación deja de funcionar.** El webhook llega a **una sola**;
> las demás siguen sirviendo contenido viejo **hasta que venza el TTL**.

Está dicho en `invalidarSpace()` y registrado como deuda en
[`09` § 3 "Lo que ADR-19 dejó a medias"](../../../docs/proyecto/09-estado-y-roadmap.md). Con una
instancia —el despliegue de hoy en Railway— no pasa; con dos, **el TTL de 5 minutos deja de ser una
red de seguridad y pasa a ser EL mecanismo**. Antes de escalar hay dos salidas y ninguna es gratis:
cache compartida, o bajar el TTL a sabiendas. Vale igual para las otras cinco memorias de la tabla.

## Qué de esto no es tuyo

El HTML lo genera `web-builder` (`renderStory`, `renderHome`, `renderMenu`, `renderBlogIndex`): si el
problema es el marcado, es de `pipeline`. `Sitio` y `PgSitios` son de `db`. Y `fromStoryblokContent`
—también de `web-builder`— es **la costura**: la CDA devuelve el contenido **aplanado** (`seo_title`),
que no es la forma que consume `renderStory` (`seo` anidado); sin deshacerlo daba TypeError → 500.

## Desarrollo: verlo en un navegador

```bash
npm run dev:server -w renderer   # http://localhost:8080
```

Levanta **el servicio real** (`createApp` de verdad) sobre **PGlite en memoria** con las migraciones
aplicadas y cuatro clientes sembrados, y un **`MockCda`** en lugar de Storyblok: cero credenciales,
cero red. Como los dominios se sirven por `Host` y `localhost` no es ninguno, el harness arranca con
`confiarEnProxy: true` y acepta `?_host=bellanapoli.es`, que **vive envolviendo la app desde afuera y
solo ahí** — dentro de `app.ts` sería un parámetro de query que elige qué web se sirve. Al arrancar
imprime las URLs de las landings, del preview firmado y un `node -e` que dispara un webhook firmado.

⚠️ **`npm run demo -w renderer` pega contra el Storyblok REAL con credencial real.** No es el
equivalente local de `dev:server`: no lo corras para ver qué pasa.

## Errores frecuentes

| Error | Qué pasa |
|---|---|
| Importar la Management API "para arreglar algo" | El proceso anónimo pasa a poder reescribir la web de todos los clientes |
| Convertir un 5xx del origen en `null` | Se anota como faltante y la web del cliente desaparece hasta que venza el TTL |
| Propagar el cuerpo del error de Storyblok | El token puede venir ahí, y el mensaje termina en un log |
| Un separador que puede aparecer en el slug | Dos claves colapsan: un cliente sirviendo la página de otro |
| Tope de entradas sin tope de bytes | 500 × 2 MB = 1 GB, y el proceso caído son todas las webs a la vez |
| Cachear el preview, o coalescerlo | Un borrador servido a un anónimo, o el de un editor mostrado a otro |
| Parsear o leer el webhook antes de la firma y del tope | Una firma legítima deja de validar; y un anónimo sin el secreto nos hace bufferear lo que quiera |
| Hacer que la nav o el blog puedan dar 503 | Un enhancement con permiso para tumbar la página que enriquece |
| Levantar una segunda instancia sin tocar la cache | La invalidación deja de funcionar en silencio (ver arriba) |

## Verificación

```bash
npm test -w renderer   # 143 tests, ~1,5 s. Sin red y sin credenciales
npm run typecheck
```

Medido el 2026-08-10: `app.test.ts` 45, `perfil.test.ts` 35, `cda.test.ts` 27, `cache.test.ts` 12,
`dominio.test.ts` 12, `fuentes-servidas.test.ts` 8, `tres-fronteras.test.ts` 4. Si vas a citar una
cifra, volvé a medirla — el `README.md` del paquete todavía dice 94.

Lo que hay que mantener cubierto: el 500 que **lanza** en vez de devolver `null`, el timeout que vence
**con el cuerpo colgado** (no solo con los headers), la respuesta enorme que corta en 502, el webhook
sin firma / con otro secreto / sin secreto / repetido / con cuerpo enorme, el de un space que no vacía
el de otro, la enumeración que deja de golpear el origen, las N visitas simultáneas que son una
llamada, y el pico que da 503.

**Verificación por mutación**, obligatoria acá porque casi todo esto puede pasar siempre sin probar
nada: quitá el tope de bytes, devolvé `null` en el 5xx, sacá el `finally` del `Coalescedor`, cambiá
`timingSafeEqual` por `===`, borrá el prefijo de longitud de la clave — y confirmá que cae *exactamente*
su test. Y manejá la app además de leer el código: el bug del contenido aplanado lo cazó la demo.

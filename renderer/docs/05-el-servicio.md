# El renderizador como servicio

Un proceso, N dominios (ADR-19). Es **la única pieza expuesta a internet anónimo** de todo el sistema.

Este documento es el mapa; el detalle operativo vive en las skills
[`render-seguridad`](../../.claude/skills/render-seguridad/SKILL.md) y
[`render-cda-cache`](../../.claude/skills/render-cda-cache/SKILL.md).

## El orden de comprobaciones ES la autorización

[`renderer/src/app.ts`](../src/app.ts). No hay usuario, ni sesión, ni token del otro lado: **el
dominio es la credencial**.

```text
Host  →  dominio canónico   (si no, 404)
      →  sitio bajo RLS como app_render   (si no, 404)
      →  ¿preview autorizado?
      →  cache
      →  Storyblok CDA
```

Dos cosas que parecen detalles y son la seguridad:

- **Los 404 no dicen por qué.** Un 404 que distinguiera "ese dominio no existe" de "existe pero está
  archivado" es un oráculo para enumerar la cartera de clientes de la agencia.
- **Filtrar por tenant acá sería teatro.** El renderizador derivaría el tenant del mismo dominio que
  ya usó para encontrar el sitio: estaría comprobando su propia respuesta contra sí misma.

## `app_render`, el rol más pobre del sistema

| Tiene | No tiene |
| --- | --- |
| `select` sobre **5 columnas de una sola tabla** (`clients`) | `insert`/`update`/`delete` en ninguna tabla |
| `usage` en `public` y `app` | `execute` sobre las funciones de `app` |
| la política `client_render_select` | acceso a `kr_*`, `memberships`, `tenants` ni las caches del proveedor |

La pregunta que justifica cada línea de esa tabla: **"si me lo toman, ¿qué se llevan?"**.

## Storyblok: dos APIs que no se cruzan

| Quién | API | Host | Credencial |
| --- | --- | --- | --- |
| `orchestrator` / `web-builder` | Management | `mapi.storyblok.com` | token que **escribe y borra** |
| `renderer` | **Content Delivery** | `api.storyblok.com/v2/cdn` | tokens de **lectura** |

Importar la Management API desde acá convierte el proceso anónimo en uno que puede reescribir la web
de todos los clientes. Es la línea que no se cruza.

## "No está" y "se rompió" no son lo mismo

Un 404 de la CDA significa que la página no existe: se puede cachear como faltante. Un 5xx significa
que Storyblok tuvo un problema, y convertirlo en `null` **haría desaparecer la web del cliente** hasta
que venza el TTL. Los dos casos se tratan distinto a propósito.

## Las seis memorias del proceso

Ninguna sobrevive a un reinicio, y ninguna se comparte entre instancias:

| Memoria | TTL | Tope | Qué la vacía |
| --- | --- | --- | --- |
| Páginas renderizadas (`CacheRender`) | 5 min | 500 entradas **y** 64 MB | webhook |
| Resolución dominio → sitio | 60 s | 1.000 | solo el TTL |
| Nav por space | 60 s | — | webhook |
| Blog por space | 60 s | — | webhook |
| 404 recientes (`CacheNegativa`) | 30 s | 2.000 | webhook |
| Entregas del webhook ya vistas | 5 min | 500 | nada |

## Los tres límites del camino anónimo

| Pieza | Contra qué | Qué hace |
| --- | --- | --- |
| `Coalescedor` | *cache stampede* | N peticiones al mismo `space:slug` → **una** llamada al origen |
| `CacheNegativa` | enumeración (`/a-1`, `/a-2`…) | recuerda el 404 30 s: el segundo intento no sale a la red |
| `Semaforo` | picos sin techo | pasado el cupo, **503 con `retry-after: 2`** |

## La limitación que hay que decir en voz alta

**La invalidación por webhook deja de funcionar con más de una instancia.** El webhook llega a una
sola; las demás siguen sirviendo contenido viejo hasta que expire su TTL (5 minutos para páginas).

No es un bug pendiente de arreglar: es una consecuencia conocida de tener la cache **en proceso**, y
está anotada en ADR-19 y en el `09`. Arreglarla es una decisión de despliegue (cache compartida o CDN
en el borde), no de código.

## Verlo en un navegador

```bash
npm run dev:server -w renderer
```

Levanta el renderizador **real** sobre PGlite y una CDA de mentira: sin red, sin credenciales, sin
Storyblok del otro lado. Los dominios se sirven por la cabecera `Host`, y como `localhost` no es
ninguno de ellos, este arnés acepta `?_host=`:

```text
http://localhost:8080/?_host=borcelle.es                          cliente con manual de marca y fotos
http://localhost:8080/menu?_host=borcelle.es
http://localhost:8080/?_host=barpepe.es                           ficha LEGACY {color, font}
http://localhost:8080/?_host=noexiste.es                          404, sin fallback
```

⚠️ **`npm run demo -w renderer` es otra cosa: pega contra el Storyblok REAL con credencial real.** No
es verificación y no lo corre ningún subagente.

## Deuda conocida

Tres cosas que salieron al documentar el servicio (2026-08-10) y que **no se arreglaron en esa
sesión**, porque el trabajo en curso era otro. Están acá para que no haya que redescubrirlas.

**1. El cupo del semáforo en producción no tiene dueño.** `leerConfig()` no lee `maxConcurrencia` ni
`maxConexiones`, así que en producción valen siempre 64 y 10 — y el único test del semáforo pasa
`maxConcurrencia: 2`. O sea que **el test elige el parámetro en vez de fijar el de producción**, que
es justo el falso verde que este repo persigue: *un default de producción sin test es una decisión sin
dueño*. Ya se cazó una vez igual, con `maxEntradas` de la cache.

**2. El `Semaforo` envuelve al `Coalescedor`, no al revés.** Cuenta peticiones **en vuelo**, no
llamadas al origen: diez visitas coalescidas ocupan diez cupos y hacen una sola llamada. El comentario
del código dice "trabajo externo en vuelo", que se lee como lo contrario.

**3. `renderer/.env.example` documenta solo las variables del `demo-server`**, no las que
`leerConfig()` exige en producción (`DATABASE_URL_RENDER`, `STORYBLOK_WEBHOOK_SECRET`,
`PREVIEW_SECRET`, `TRUST_PROXY`, `CACHE_TTL_MS`). Ésas sí están en el README y en
`scripts/auditar-railway.mts`. No es un bug, pero el `.env.example` se lee como el contrato del
paquete y no lo es del todo.

## Qué de esto no es del agente `render`

- Los **roles, políticas y migraciones** —incluida la columna generada que hace de allowlist— son de
  `datos`.
- La **publicación** en Storyblok (Management API, `_uid`, upsert) es de `pipeline`.
- El **despliegue** (Railway, variables, CDN) no tiene agente a propósito: es trabajo que
  `AGENTS.md` prohíbe delegar.

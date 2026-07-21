# `renderer` — el que sirve las webs de cliente (etapa 6, ADR-19)

**Un servicio, N dominios.** Lee el contenido de Storyblok en vivo, lo pasa por `renderStory()` y lo
sirve. Es la pieza que faltaba desde que ADR-16 quitó Next del stack: hasta ahora se publicaba
contenido en Storyblok y **nada lo servía en un dominio** (OBS-03).

```
   Editor toca Storyblok  ──▶  (contenido)
                                   │
   navegante  ──▶  RENDERIZADOR  ──▶  HTML + JSON-LD
                        │  Host → dominio → space del cliente
                        └─ reutiliza renderStory() de web-builder
```

## La decisión de fondo: el dominio ES la autorización

ADR-15 dice que el rol se **deriva de `memberships`**. Este es el primer servicio que atiende a
alguien **sin membresía** — un navegante anónimo—, así que `app.current_role()` le devuelve NULL y
no puede leer nada. Correcto, pero no cubría este caso.

La respuesta no es usar la service-role "porque es más fácil". Es un login propio, `amg_render` →
rol `app_render`, **el más pobre del sistema**:

| | |
|---|---|
| **Ve** | `clients`, y solo las columnas `id, domain, storyblok_space_id, *_token, business_profile, market_language` — y solo de clientes **con dominio publicado y sin archivar** |
| **No ve** | `kr_runs`, `kr_pages`, `kr_keywords`, `memberships`, `tenants`, ni las caches del proveedor |
| **No escribe** | nada, en ninguna tabla |

La pregunta de diseño no fue "¿qué necesita?" sino **"si me lo toman, ¿qué se llevan?"**. Se llevan
el mapa dominio→space y el NAP, que ya está impreso en cada página pública. Ver
`db/migrations/0007_render_publico.sql` para el razonamiento completo — incluido **por qué la
política no filtra por tenant** (un filtro que el propio renderizador rellenaría no controla nada).

> **Precisión que costó una review (#9):** decía que este rol "no puede ejecutar las funciones de
> `app`". **Es falso** — el schema tiene `USAGE` y las funciones son ejecutables por defecto:
> `app.current_tenant_id()` devuelve `null` y `app.es_servicio()` devuelve `false`, sin error. Lo
> que protege no es el permiso de ejecución, es que son **`SECURITY INVOKER`**: corren con los
> privilegios de quien llama, así que no alcanzan nada que el llamador no alcance por su cuenta.
> `app.current_role()` falla, pero **porque su cuerpo lee `memberships`**, no por falta de EXECUTE.
> El mecanismo real es mejor que el que yo había escrito; la frase estaba mal igual.

> **Lo que encontró el test, no yo:** `client_select` de 0001 no tenía cláusula `to`, así que aplicaba
> a PUBLIC — incluido un rol que no existía cuando se escribió. Las políticas se combinan con OR,
> pero **si cualquiera lanza, la query entera muere**. Si le hubiera dado `execute on schema app`
> por inercia, habría funcionado **en silencio**, leyendo `memberships` en cada visita a la web de un
> restaurante. Una política sin `to` es una política que aplica a roles futuros.

## Lo que hay

- **Resolución de dominio** (`dominio.ts`) — el `Host` lo escribe quien pide, así que se normaliza y
  valida antes de llegar a la base. **No hay dominio por defecto**: host desconocido → 404 sin
  explicación (un 404 que dice *por qué* es un oráculo para enumerar la cartera).
- **Cache** (`cache.ts`) — TTL + tope + invalidación por webhook. La clave lleva el **space**: `/menu`
  es el slug de todos los restaurantes.
- **Webhook firmado** (`webhook.ts`) — HMAC en tiempo constante. Sin firma sería un botón público
  para tirar la cache de cualquier cliente y hacer que paguemos la CDA en cada visita.
- **Preview firmado + Bridge** (`preview.ts`) — atado al dominio y con vencimiento. Es *la razón* por
  la que ADR-19 eligió runtime, y sin firma cualquiera leería los borradores del cliente.
- **Validación del perfil** (`perfil.ts`) — ver abajo.
- **Límites** (`limites.ts`) — coalescing, cache negativa y semáforo. Ver "el camino anónimo".

## El camino anónimo, acotado (10ª review)

El servicio estaba escrito para el camino feliz y **no tenía un solo límite superior**. Cada path
aleatorio provocaba un lookup de Postgres *y* una llamada a la CDA; los 404 no se cacheaban, así que
`/a-1`, `/a-2`, `/a-3`… amplificaban indefinidamente; y N visitas al mismo slug frío disparaban N
llamadas al origen. Nada de eso requiere ingenio: es un bucle con `curl`, y lo paga nuestra cuenta.

| Límite | Contra qué | Default |
|---|---|---|
| Plazo de la respuesta **completa** | un origen que manda headers y deja el cuerpo abierto | 5 s |
| Tope de bytes de la CDA | un JSON sin fin → 502 | 4 MB |
| Tope de bytes de la cache | 500 entradas de 2 MB son 1 GB | 64 MB |
| Cuerpo del webhook, **antes** de leerlo | verificar la firma exige el cuerpo entero | 256 KB |
| `Coalescedor` | *cache stampede* tras una invalidación | — |
| `CacheNegativa` | enumerar paths inexistentes | 30 s |
| `Semaforo` | un pico abriendo sockets sin techo → **503**, no cola infinita | 64 |
| Timeouts del pool de Postgres | una base que acepta y no responde | 2 s |

> **Rechazar es mejor que encolar.** Una cola infinita no protege de nada: convierte un pico en
> latencia creciente hasta que el proceso muere. Un 503 rápido deja el proceso vivo para **las
> páginas que ya están en cache** — que es lo que mantiene en pie a la mayoría de las webs durante
> el pico.

> **Y la cache de resolución no es una optimización.** El orden era `resolver dominio (DB) → mirar
> cache`, así que una base colgada dejaba pendiente **incluso una página cacheada**, mientras
> `/_health` seguía devolviendo 200. Ahora la resolución se cachea 60 s y el health check reporta
> presión interna (bytes, trabajo en vuelo) en vez de solo `ok: true`.

Nada de esto sustituye a un **rate limit en el borde**. Es el piso que el servicio trae puesto
*antes* de que ese borde exista.

## Config

| Variable | |
|---|---|
| `DATABASE_URL_RENDER` | login `amg_render` (**obligatoria**) |
| `STORYBLOK_WEBHOOK_SECRET` | firma del webhook (**obligatoria**: sin ella el Visual Editor solo *casi* funciona) |
| `PREVIEW_SECRET` | enlaces de preview. Sin ella no hay borradores, ni con firma |
| `TRUST_PROXY=1` | confiar en `X-Forwarded-Host`. **Default: no** |
| `CACHE_TTL_MS` | default 5 min |

```bash
npm test -w renderer        # 75 tests, sin red ni credenciales
npm run dev:server -w renderer   # el servicio real sobre PGlite + Storyblok de MENTIRA (verificar)
npm run demo -w renderer         # el servicio real sobre PGlite + Storyblok REAL (demo a Frank)
npm run serve -w renderer        # producción
```

> **`demo` vs `dev:server`:** los dos corren el servicio real sobre PGlite en memoria (cero
> credenciales de base). La diferencia es la CDA: `dev:server` usa un mock para verificar
> comportamiento; **`demo` lee tu space de Storyblok de verdad** para enseñar la web viva. Necesita
> `renderer/.env` con el token de LECTURA de la CDA — ver `.env.example` y la
> [acción 06](../docs/acciones/06-corrida-final-demo.md).

## Lo que el navegador encontró y los tests no

`renderStory()` **lanza** si `business_profile` trae `address` como texto plano en vez de un
`PostalAddress` — y en este servicio eso significa **503: la web entera de ese cliente caída porque
alguien cargó mal el NAP en su ficha**. La columna es `jsonb`: Postgres garantiza JSON válido y nada
más.

Los tests no lo vieron porque todos usaban `businessProfile: null`. Y en `app.ts` yo había escrito
que un perfil mal formado "degrada la página en vez de romperla" — **era falso**, el
`typeof p === "object"` que tenía deja pasar `{address: "Calle Mayor 1"}` sin pestañear. La
afirmación estaba en un comentario, que es donde las afirmaciones no se ejecutan.

Ahora `perfilValido()` descarta lo irreconocible y la página sale sin bloque de contacto. **Una
página sin dirección es mucho mejor que ninguna página.**

## Las garantías que había escrito y no impuesto (10ª review)

Cinco de los nueve hallazgos fueron **afirmaciones mías que nada hacía cumplir**. No bugs de
implementación: prosa que yo daba por ejecutada. Vale la pena listarlas juntas porque es el patrón, no
el incidente:

| Yo había escrito | La verdad | Ahora lo impone |
|---|---|---|
| "un space de Storyblok por cliente" (ADR-04/11) | nada lo impedía → dos clientes con el mismo space **comparten entradas de cache**: la web de B servía el HTML de A | `unique` en `clients.storyblok_space_id` (`0008`) |
| "timeout de 5 s contra la CDA" | cortaba al recibir los **headers**; el cuerpo podía colgar para siempre | el plazo cubre la respuesta completa (`Promise.race`) |
| "lo que se llevan es el NAP, que ya era público" | el grant daba el `jsonb` **entero**: notas internas, emails, lo que hubiera | columna generada con allowlist (`0008`) |
| "no puede ejecutar las funciones de `app`" | sí puede; lo que protege es que son `SECURITY INVOKER` | corregido acá arriba |
| la clave de cache aisla clientes | el separador era un **espacio**, que puede aparecer en un slug → `("11","1 menu")` y `("11 1","menu")` colisionaban | clave con longitud prefijada |

**La lección, otra vez:** una garantía en un comentario es una garantía que no se ejecuta. La hace
cumplir una constraint, un test que la mute, o nada.

## Riesgo aceptado, dimensionado

ADR-19 lo anota: **el renderizador es una pieza de disponibilidad — si se cae, se caen todas las
webs de cliente a la vez.** Un sitio estático no tiene ese modo de fallo. Lo que se hizo al respecto:

- El **health check no toca ni la base ni Storyblok**. Si dependiera, el orquestador de despliegue
  mataría el servicio justo cuando el caído es Storyblok, cambiando una degradación (servir de
  cache) por una caída total.
- **Timeout de 5 s** contra la CDA: una petición colgada no puede bloquear al proceso.
- Un fallo del origen es **503, y no se cachea**: cachear un "no existe" borraría la web del cliente
  hasta que venza el TTL.

**Lo que NO está y hay que saberlo antes de vender un SLA:**

- La cache es **en proceso**. ADR-19 dice "cache en el borde", y el borde es una **decisión de
  despliegue** (una CDN delante), no código de este repositorio. Las dos hacen falta; solo una está.
- Con **más de una instancia**, cada una tiene su cache y el webhook llega a UNA. Las demás sirven
  contenido viejo hasta que venza el TTL. Con una instancia no pasa; antes de correr dos hay que
  mover la cache a una compartida o bajar el TTL a sabiendas.
- **No hay despliegue todavía** (etapa 5.3 sigue abierta, host sin decidir).

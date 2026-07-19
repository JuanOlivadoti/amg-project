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
| **No ve** | `kr_runs`, `kr_pages`, `kr_keywords`, `memberships`, `tenants`, las caches del proveedor, ni las funciones de `app` |
| **No escribe** | nada, en ninguna tabla |

La pregunta de diseño no fue "¿qué necesita?" sino **"si me lo toman, ¿qué se llevan?"**. Se llevan
el mapa dominio→space y el NAP, que ya está impreso en cada página pública. Ver
`db/migrations/0007_render_publico.sql` para el razonamiento completo — incluido **por qué la
política no filtra por tenant** (un filtro que el propio renderizador rellenaría no controla nada).

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

## Config

| Variable | |
|---|---|
| `DATABASE_URL_RENDER` | login `amg_render` (**obligatoria**) |
| `STORYBLOK_WEBHOOK_SECRET` | firma del webhook (**obligatoria**: sin ella el Visual Editor solo *casi* funciona) |
| `PREVIEW_SECRET` | enlaces de preview. Sin ella no hay borradores, ni con firma |
| `TRUST_PROXY=1` | confiar en `X-Forwarded-Host`. **Default: no** |
| `CACHE_TTL_MS` | default 5 min |

```bash
npm test -w renderer        # 60 tests, sin red ni credenciales
npm run dev:server -w renderer   # el servicio real sobre PGlite + Storyblok de mentira
npm run serve -w renderer        # producción
```

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

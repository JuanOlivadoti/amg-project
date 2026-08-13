# Módulo de reseñas de Google (Bloque F) — fase 1: monitoreo + alerta

**Fecha:** 2026-08-13
**Alcance:** `db/` (tabla + rol + migración), `orchestrator/` (polling), `api/` (endpoints), `portal/`
(tab `/clientes/:id/resenas`, botón "Conectar Google" en la ficha).
**Origen del pedido:** Bloque F del plan de plataforma
([`15-plan-plataforma.md`](../../proyecto/15-plan-plataforma.md#bloque-f--módulo-3-respondedor-de-reseñas-de-google)) —
la única pieza del alcance base del PRD sin ni una línea de código ni de spec. El portal ya tiene el
tab reservado como placeholder
([`cliente-resenas.ts`](../../../portal/src/app/pages/clientes/cliente-resenas.ts)).

---

## El problema

El PRD ([`A_PRD_AMG_Madrid_v1_Ilustrado.md`](../../historia/A_PRD_AMG_Madrid_v1_Ilustrado.md)) describe
un "Gestor de Reseñas" (RF-016 a RF-018): monitoriza Google Business Profile, clasifica por estrellas,
redacta borrador para 4-5★ y alerta de inmediato ante 1-3★. Pero antes de escribir una línea hacían
falta cuatro decisiones que nadie había tomado: qué alcance construir primero, si AMG ya tiene acceso a
la API de Google, cómo se conecta cada cliente sin mezclar sus credenciales entre tenants, y por dónde
llega la alerta. Esta sesión las resuelve.

## La decisión

Cuatro decisiones tomadas con el usuario, en orden:

| Decisión | Elegido | Descartado, y por qué |
| --- | --- | --- |
| Alcance de esta primera vuelta | **Solo monitoreo + alerta**, sin borrador de IA ni publicación | El loop completo (borrador 4-5★ + cola de aprobación + publicar) es la Fase 2 que el propio PRD ya distingue ("Nota de implementación: entra en el MVP (alertas) y se completa en Fase 2"). Construirlo todo junto sin haber visto una reseña real todavía es exactamente el riesgo que este proyecto evita en todos sus módulos |
| Acceso a la API de Google | **Mock-first** — AMG todavía no pidió acceso a la Business Profile API | Esperar la aprobación de Google para empezar a construir. El resto del proyecto corre sin credenciales (providers mock + PGlite); este módulo sigue el mismo molde |
| Cómo se conecta cada cliente | **OAuth por cliente**, refresh token en la fila del cliente bajo RLS | Una cuenta de agencia con acceso delegado a todas las ubicaciones: más simple de operar, pero la separación entre clientes pasaría a depender de cómo filtremos la respuesta de Google, no de RLS — exactamente la garantía que este proyecto impone en Postgres y no en código de aplicación |
| Cómo se detecta una reseña nueva | **Polling periódico**, mismo patrón que el barrido de runs colgados | Push real vía Google Pub/Sub: es el mecanismo de "tiempo real" de verdad, pero exige un tema de Pub/Sub y un endpoint receptor — infraestructura nueva antes de tener siquiera acceso a la API |
| Canal de la alerta | **Solo el portal** (el tab ya reservado, con las 1-3★ destacadas) | Email o WhatsApp: ninguno de los dos existe hoy en el proyecto como integración; sumar uno para la primera vuelta de este módulo sería resolver dos problemas nuevos a la vez |

---

## Arquitectura

**No hay paquete nuevo.** El trabajo cae en los tres lugares que ya existen, siguiendo patrones que el
proyecto ya tiene resueltos:

```
orchestrator/          nueva función Inngest programada (polling), mismo molde que el barrido
    └── GoogleReviewsProvider   interfaz con impl mock/live (como DataForSEO/Storyblok)
db/                     tabla resenas_google + 3 columnas nuevas en clients + rol app_resenas
api/                    endpoints de conexión OAuth + listado de reseñas, bajo app_user/RLS
portal/                 cliente-resenas.ts deja de ser placeholder; botón "Conectar" en cliente-ficha.ts
```

La alternativa considerada — un paquete propio tipo `kr-service`, dedicado a Google — queda anotada
como camino futuro si el módulo crece (posts, preguntas y respuestas, insights de Maps), no como parte
de esta fase: es sobre-ingeniería para "leer reseñas y avisar".

---

## Modelo de datos

### `clients` gana tres columnas (migración `0021`)

Mismo patrón que las columnas de Storyblok por cliente
([`0007_render_publico.sql:88-95`](../../../db/migrations/0007_render_publico.sql)):

```sql
alter table clients add column if not exists google_location_id    text;
alter table clients add column if not exists google_refresh_token  text;
alter table clients add column if not exists google_conectado_en   timestamptz;
```

`google_location_id` identifica la ficha de Google Business Profile del cliente.
`google_refresh_token` es lo que permite pedir un access token nuevo en cada polling sin volver a pasar
por el consentimiento. `google_conectado_en` es lo único de los tres que el portal necesita LEER — para
mostrar "conectado desde…" o el CTA de conectar si es `null`.

### Tabla nueva: `resenas_google`

Mismo esqueleto que `ideas` ([`0013_ideas.sql:73-90`](../../../db/migrations/0013_ideas.sql)):
`tenant_id` + `client_id` con la FK compuesta que impide que un cliente apunte a un tenant ajeno, RLS
con `app.ve_cliente(client_id)` para lectura y `app.puede_escribir(client_id)` para lo poco que escribe
el usuario (marcar como vista).

```sql
create table resenas_google (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  client_id        uuid not null,

  google_review_id text not null,        -- idempotencia: no duplicar en el próximo polling
  puntuacion       smallint not null check (puntuacion between 1 and 5),
  autor            text not null,
  texto            text,                 -- una reseña de solo estrellas no trae texto
  publicada_en     timestamptz not null, -- la fecha que dice Google, no la del polling
  vista_en         timestamptz,          -- null = todavía nadie la vio en el portal

  creada_en        timestamptz not null default now(),

  foreign key (tenant_id, client_id) references clients (tenant_id, id) on delete cascade,
  unique (client_id, google_review_id)
);
```

`puntuacion` decide el orden de la pantalla, no un campo de "clasificación" separado: 1-3★ sin ver
primero, el resto por fecha. `google_review_id` es de Google, no nuestro — es la clave de idempotencia
del polling, y va con `unique (client_id, google_review_id)` para que un segundo polling con la misma
reseña no inserte una fila más (mutación esperada del test: correr el polling dos veces seguidas con el
mismo fixture y confirmar que la tabla no crece la segunda vez).

**Sin `force row level security` propio a decidir**: sigue el patrón de `ideas` — RLS normal, ni
`app_render` (ADR-19: esto es material interno de la agencia, no llega nunca al renderizador) ni el
rol `cliente` gana un privilegio de escritura (mismo verbo-no-visibilidad de ADR-20: el cliente puede
**ver** sus reseñas — igual que ve sus otros tabs — pero no marca nada como vista ni gestiona la
conexión; eso es de `maestro`/`equipo`).

---

## Seguridad: el refresh token entra por un lado y sale por el otro

Esta es la pieza que el proyecto trata distinto de una columna cualquiera, porque un refresh token de
Google **es** una llave de acceso continuo a la cuenta del cliente — más parecido a una credencial
nuestra que a un dato de negocio.

- **`app_user` (la API, bajo RLS) puede ESCRIBIR `google_refresh_token`** — el callback de OAuth lo
  recibe y lo guarda, y ese tramo corre con la identidad del usuario que hizo el click.
- **`app_user` NO puede LEERLO de vuelta.** Grant por columna, no por tabla: `grant update
  (google_refresh_token) on clients to app_user` sin el `grant select` correspondiente. El portal jamás
  puede filtrar un refresh token ajeno —ni por bug de la API, ni por un endpoint mal armado— porque el
  dato no es alcanzable con ese rol, no porque el código prometa no pedirlo.
- **Solo el polling puede leerlo, y solo el polling escribe reseñas cruzando tenants.** Mismo mecanismo
  que el barrido de runs colgados
  ([`0018_barrido_runs_colgados.sql`](../../../db/migrations/0018_barrido_runs_colgados.sql)): un rol
  nuevo `app_resenas`, **sin login** (`create role app_resenas nologin`), dueño de dos funciones
  `security definer`:

  ```sql
  -- Cross-tenant: solo los clientes conectados, y solo las columnas que el polling necesita.
  create function app.clientes_conectados_google()
    returns table (client_id uuid, tenant_id uuid, location_id text, refresh_token text)
    security definer set search_path = pg_catalog, public ...

  -- Cross-tenant: inserta bajo el tenant_id que el polling ya trae, no el que decida el llamador.
  create function app.registrar_resena_google(
    p_client_id uuid, p_tenant_id uuid, p_google_review_id text,
    p_puntuacion smallint, p_autor text, p_texto text, p_publicada_en timestamptz
  ) returns void
    security definer set search_path = pg_catalog, public ...
  ```

  `execute` de las dos se revoca de `public` y se concede **solo a `app_service`** — el rol que ya
  asume `amg_orquestador`. No hace falta un login nuevo ni un cuarto proceso: el orquestador ya es
  quien corre el barrido, y esta es la misma clase de privilegio (cross-tenant, confinado a lo que la
  función hace y nada más), no un login adicional. ADR-17 sigue intacto.

  La comparación exacta con `app_barrido` importa: ahí el owner-role tampoco tiene login, y lo único
  que lo vuelve alcanzable es el `grant execute` a un rol que sí lo tiene (`app_service`). Acá es
  idéntico. La migración `0021` va a repetir, punto por punto, la secuencia de `alter … owner to` con
  los dos grants temporales que `0018` documenta (`grant app_resenas to current_user` / `grant create on
  schema app to app_resenas`, revocados al final) — es la única forma medida de que el cambio de dueño
  funcione en Supabase alojado y no solo en PGlite (ver el comentario largo de `0018` para el porqué).

- **`app_render` no gana nada de esto.** Ni las columnas de `clients`, ni `resenas_google`: es material
  interno de la agencia y el rol expuesto a internet anónimo no lo necesita.

---

## El flujo de conexión (OAuth)

1. Desde `cliente-ficha.ts`, visible para `maestro`/`equipo` (no para el rol `cliente`), un botón
   "Conectar Google" pega a `POST /clients/:id/google/conectar`.
2. La API arma la URL de consentimiento de Google (`client_id` de nuestra app, `redirect_uri` propio,
   `scope` de Business Profile, y `state` = el `client_id` nuestro, firmado, para atar el callback al
   cliente correcto) y la devuelve; el portal redirige el navegador ahí.
3. Quien está del otro lado de esa pantalla (el dueño del restaurante, o el CM si tiene las
   credenciales) autoriza. Google no nos pregunta nada más — esa pantalla es enteramente suya.
4. Google redirige a `GET /clients/:id/google/callback?code=…&state=…`. La API valida el `state`,
   intercambia el `code` por tokens con Google, y guarda `google_refresh_token` +
   `google_location_id` + `google_conectado_en` en la fila del cliente — bajo RLS, con la identidad de
   quien inició el flujo.
5. `POST /clients/:id/google/desconectar` limpia las tres columnas. Desconectar no borra las reseñas ya
   guardadas: son historial, no la credencial.

**Mock-first también acá.** Sin acceso real, el flujo completo (botón → "consentimiento" simulado →
callback → columnas escritas) se prueba con un `GoogleOAuthProvider` mock que nunca sale a internet —
mismo criterio que el resto del pipeline.

---

## El polling

Una función Inngest nueva en `orchestrator/`, mismo molde que
[`crearFuncionBarrido`](../../../orchestrator/src/functions.ts) (cron, `concurrency: [{ limit: 1 }]`,
`retries: 0`, la lógica vive en una función de TypeScript aparte para que los tests la ejerciten sin
pasar por `createFunction`):

```
crearFuncionPollingResenas(deps):
  cron: cada 15-30 min (constante a calibrar, como CRON_BARRIDO)
  1. clientes = llamar app.clientes_conectados_google()
  2. para cada cliente (con su propio try/catch — uno que falla no frena a los demás,
     mismo criterio que las tres fuentes independientes del dashboard):
       access_token = provider.refrescarToken(cliente.refresh_token)
       reseñas = provider.listarResenas(access_token, cliente.location_id)
       para cada reseña nueva:
         app.registrar_resena_google(cliente.client_id, cliente.tenant_id, reseña...)
  3. log: cuántos clientes se recorrieron, cuántas reseñas nuevas entraron, qué clientes fallaron
```

`GoogleReviewsProvider` es la interfaz que separa esto de si hay o no credenciales reales — impl `mock`
(fixtures fijas, deterministas) e impl `live` (la Business Profile API), gateada por una variable de
modo igual que `PIPELINE_MODO`. El día que llegue el acceso real, es un swap de provider, no una
reescritura del polling.

Un cliente con el refresh token revocado (el dueño desconectó desde el lado de Google, no del nuestro)
no debe tirar abajo la corrida entera ni quedar reintentando para siempre: el error se loguea, y
`google_conectado_en` se limpia para que el portal muestre "reconectar" en vez de seguir mintiendo que
está conectado.

---

## El portal

`cliente-resenas.ts` deja el placeholder y pasa a tener cuatro estados, ninguno un hueco en blanco:

| Estado | Qué se ve |
| --- | --- |
| Sin conectar | CTA "Conectar Google" (solo si el rol puede: `maestro`/`equipo`) |
| Conectado, sin reseñas todavía | Vacío real: "Todavía no hay reseñas" — no un error |
| Conectado, con reseñas | Lista ordenada: 1-3★ sin ver primero, después el resto por fecha. Marcar como vista al abrir la pantalla |
| Token revocado/vencido | Aviso de reconectar, no una pantalla rota — mismo criterio que la caída de API del dashboard |

`GET /clients/:id/resenas` alimenta la lista; `POST /clients/:id/resenas/:resenaId/marcar-vista` (o un
PATCH equivalente) registra `vista_en` — la decide la API bajo RLS con `app.puede_escribir`, y el rol
`cliente` no la tiene disponible (puede ver, no marcar).

---

## Testing

- **RLS**: cliente A no ve reseñas de cliente B, mismo patrón que el resto de las tablas de tenant
  (contra Postgres real, no PGlite-only para la parte de rol).
- **Credenciales**: `app_resenas` no tiene login concedido (`pg_has_role(..., 'SET')` en falso, como el
  test que ya existe para `app_barrido`), y `app_user` no puede `select` sobre
  `clients.google_refresh_token` (mutación: agregar el grant a mano y confirmar que el test que lo
  prohíbe cae).
- **Idempotencia del polling**: correr `registrar_resena_google` dos veces con el mismo
  `google_review_id` no duplica la fila.
- **Fallo independiente**: un cliente con token inválido no impide que el polling procese a los demás
  (mutación: forzar el fallo del primero de tres clientes mock y confirmar que los otros dos igual
  escriben sus reseñas).
- **Provider mock respeta el contrato** que el `live` va a implementar después — mismo criterio que
  `MockPublisher`/`StoryblokDryRunPublisher`.
- **Portal**: los cuatro estados de la tabla de arriba, más que el rol `cliente` no ve el botón de
  conectar ni el de marcar-vista.
- **Verificación en navegador**: conectar (mock) → ver la lista con datos sembrados → abrir con una
  1-3★ sin ver y confirmar que queda arriba → refrescar y confirmar que ya no cuenta como "sin ver".

---

## Lo que este trabajo NO hace

- **No genera ningún borrador de respuesta con IA.** Ni para 4-5★ ni para 1-3★ — eso es la Fase 2 que
  el propio PRD distingue, y el PRD además exige que las negativas **siempre** las redacte un humano,
  nunca la IA.
- **No publica nada de vuelta a Google.** Esta vuelta es de solo lectura contra la Business Profile
  API.
- **No agrega WhatsApp ni email.** La alerta vive únicamente en el portal.
- **No pide acceso real a la API de Google.** Ese es un paso de Juan, fuera de este spec, y el diseño
  entero está armado para no bloquearse esperándolo (mock-first de punta a punta).
- **No toca `contrato/`, `web-builder/` ni `renderer/`.** Es material interno de la agencia; ADR-19 no
  se toca.

## Documentación a actualizar al cerrar

Por el ritual del [`AGENTS.md`](../../../AGENTS.md), paso 3:

- [`docs/proyecto/09-estado-y-roadmap.md`](../../proyecto/09-estado-y-roadmap.md) — el Bloque F deja de
  estar "sin ni una línea de código ni spec".
- [`docs/proyecto/15-plan-plataforma.md`](../../proyecto/15-plan-plataforma.md) — Bloque F, con el
  alcance de fase 1 cerrado y la Fase 2 (borrador IA + publicar) anotada como lo que sigue.
- [`progress/history.md`](../../../progress/history.md) — la entrada del día.

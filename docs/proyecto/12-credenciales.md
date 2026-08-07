# 12. Credenciales y despliegue

> **Esto no estaba documentado, y peor: estaba documentado MAL.** ADR-15 afirmaba que la autoridad
> del orquestador era "una credencial de base de datos". Era falso — había un solo `DATABASE_URL` y
> el código elegía con qué rol vestirse. Este documento describe cómo es de verdad, ahora que lo es.

---

## El principio

**Un proceso, un login, un rol.** La separación entre "la API" y "el orquestador" no es una
convención del código: es una frontera que **hace cumplir Postgres**.

| Login | Rol que asume | Qué puede | Qué NO puede |
|---|---|---|---|
| `amg_api` | `app_user` | Leer/escribir datos de tenant **bajo RLS**, con el rol derivado de `memberships` | **Asumir `app_service`.** Tocar las caches. |
| `amg_orquestador` | `app_service` | Escribir los resultados del research bajo RLS | **Asumir `app_user`.** Tocar las caches. |
| `amg_cache` | (ninguno) | Solo `kr_metrics_cache`, `kr_serp_cache`, `kr_provider_tasks` | **Ver una sola fila de un tenant.** |
| `amg_render` | `app_render` | **7 columnas de `clients`**, y solo de clientes con dominio publicado y sin archivar | **Escribir nada. Ver `kr_*`, `memberships`, `tenants`, las caches, ni las funciones de `app`.** |

Los cuatro son **`NOINHERIT`**, y esa palabra es la mitad del mecanismo.

> **`amg_render` es el más pobre a propósito.** Es el único proceso expuesto a internet **anónimo**
> (la API exige un JWT; el orquestador no atiende a nadie de afuera), así que la pregunta de diseño
> fue *"si me lo toman, ¿qué se llevan?"*. Se llevan el mapa dominio→space y el NAP del negocio —que
> ya está impreso en cada página pública—, **y el token de preview de Storyblok**, que sí es un
> secreto y es el costo declarado de ADR-19. Ver `0007_render_publico.sql`.

### Por qué `NOINHERIT` no es opcional

Sin él, un login tiene los privilegios de sus roles concedidos **sin necesidad de `SET ROLE`** — y
`RESET ROLE` se los devuelve. Con `NOINHERIT`, el login por sí solo no puede nada: únicamente lo que
le da el rol que asume explícitamente, y **solo puede asumir el suyo**.

### El error que esto corrige

`SET ROLE` **no pide contraseña**. Postgres lo autoriza según el `session_user`. Con un único login
concedido a los dos roles, el código podía ponerse `app_user` **o** `app_service` a voluntad — y
`RESET ROLE` volvía a los privilegios originales. Era una **frontera de código disfrazada de
frontera de credenciales**. Exactamente la "autoridad declarada" que ADR-15 presumía de haber
eliminado: cerrada en la puerta de los humanos, abierta en la del servicio.

Hay un test que lo comprueba contra `pg_auth_members` (la fuente de verdad, no el código):
`db/src/store.test.ts` → *"credenciales: el login de la API NO puede asumir el rol del servicio"*.

---

## Dónde viven: una fuente, reparto por paquete

Los valores se escriben **en un solo archivo**, `docs/private/credenciales.env` (gitignoreado), y
`npm run env:sync` los reparte a los `.env` de cada paquete. Los `.env` de los paquetes son
**generados**: editarlos a mano no sirve, el próximo sync los pisa.

```bash
npm run env:sync    # docs/private/credenciales.env → api/.env, db/.env, kr-service/.env, …
```

**Por qué no un único `.env` en la raíz que carguen todos.** Sería más simple y borraría la
duplicación igual, pero le daría a cada proceso el entorno completo: el renderizador —el único
expuesto a internet anónimo (ADR-19)— tendría a mano la password de `amg_api` y el token de escritura
de Storyblok. **El reparto ES la compartimentación**, y es la misma pregunta de siempre: *si me lo
toman, ¿qué se llevan?*

Quién recibe qué lo decide `MAPA` en [`scripts/env-sync.mts`](../../scripts/env-sync.mts), y **lo
impone su test**, no un comentario:

- el `MAPA` debe coincidir **exactamente** con el `.env.example` de cada paquete, en las dos
  direcciones — agregar una clave a un `.env.example` rompe el test hasta que alguien decida quién
  puede verla;
- el renderizador nunca recibe `STORYBLOK_MANAGEMENT_TOKEN` ni ninguna `DATABASE_URL_*`;
- la API nunca recibe `DATABASE_URL_ADMIN` (es lo de arriba: si la tuviera en el entorno, el
  `NOINHERIT` sería decorativo).

Si dos paquetes necesitan la **misma clave con distinto valor** —`BUSINESS_PROFILE_PATH` es relativa
y se resuelve desde cwd distintos; dos servicios pueden querer API keys separadas para rotarlas
aparte— se usa un override `PAQUETE__CLAVE` (`WEB_BUILDER__OPENAI_API_KEY`), que gana sobre el valor
global. El override tampoco se filtra a otro paquete: hay un test de eso.

> **`DATABASE_URL_ADMIN` es la excepción de todo esto.** No es de ningún proceso: la usan solo
> `migrate:deploy` y el seed, a mano, una vez. Vive en `db/.env` y **nunca** se carga en Railway.
>
> **Nunca la pases por la línea de comandos**: el comando queda en el historial de la shell con la
> password de admin adentro. `migrate:deploy` lee `db/.env` solo (`tsx --env-file-if-exists=.env`), y
> para sembrar hay `npm run reseed:demo` desde la raíz, que lee las tres variables del seed
> **directamente de este archivo** y las pasa al proceso hijo por su entorno. Es a propósito que no
> use `db/.env`: ese archivo es GENERADO y puede estar desincronizado de la fuente si alguien editó
> acá y no corrió `env:sync` — y una escritura en producción no se apuesta a eso. Con `--dry-run`
> valida y muestra a qué base iría (usuario y host, password tapada) sin tocar nada.

> **La API no tiene ningún secreto de Supabase.** Verifica los tokens contra el **JWKS público** del
> proyecto (`<iss>/.well-known/jwks.json`), derivado de `SUPABASE_JWT_ISS`. La clave privada de la
> firma nunca sale de Supabase y la pública es pública por definición: no hay nada que rotar ni que
> filtrar **en el JWKS**.
>
> Lo que se eliminó el 2026-07-26 es el `SUPABASE_JWT_SECRET` compartido **del contrato de la API**:
> ya no lo lee, ya no lo acepta, ya no confía en HS256. Eso **no** lo vuelve inerte: el secreto sigue
> siendo válido en el proyecto de Supabase hasta que se revoque **ahí**, y un HS256 firmado con él
> puede acuñar un token `service_role` que **bypassea RLS por completo** contra la base — un radio de
> daño que no depende de si nuestra API lo acepta.

### ⛔ No revoques el secreto legacy sin migrar antes el portal

Una versión anterior de este documento decía, sin más, "pendiente: revocar `SUPABASE_JWT_SECRET` en
Supabase". **Seguir esa instrucción rompe el login del portal**, y conviene saber por qué antes de
tocar nada.

El `anon key` que el portal manda como header `apikey` en cada login, refresh y logout **es un JWT
legacy firmado con ese mismo secreto**. Comprobado decodificándolo:

```text
header alg: HS256 · claims role: anon · iss: supabase
```

Revocar o rotar el secreto invalida ese `anon key` — y con él, todas las llamadas del portal a
GoTrue. Sería reintroducir exactamente la caída que la pieza A vino a arreglar.

**Cerrar esto es su propia pieza de trabajo**, en este orden:

1. Generar las claves nuevas de Supabase (*publishable* / *secret*), que son las que reemplazan a
   `anon` / `service_role` desde la migración a claves asimétricas.
2. Cambiar `supabaseAnonKey` en `portal/src/environments/environment.prod.ts` por la *publishable*, y
   desplegar el portal.
3. Verificar el login **en el navegador** con la clave nueva.
4. **Recién ahí** revocar el secreto legacy en Supabase.

Hasta que eso pase, el secreto sigue vivo y es una credencial con alcance `service_role`: tratalo
como tal — no va al chat, ni a un commit, ni a un ticket.

> **Regla general que se ganó dos veces en esta pieza:** una credencial no está muerta porque
> nosotros dejemos de usarla. Está muerta cuando el emisor la revoca — y antes de revocarla hay que
> saber **qué más cuelga de ella**. Acá colgaba el `anon key`; en Railway colgaba el arranque del
> proceso viejo (ver [el runbook](14-runbook-despliegue.md), bloque de actualización).

---

## Variables de entorno

```bash
# El orquestador. Rol app_service.          ← LA LEE EL CÓDIGO HOY
DATABASE_URL_ORQUESTADOR=postgres://amg_orquestador:...@host/db

# Caches y registro de tareas. Sin acceso a NINGUNA tabla de tenant.
DATABASE_URL_CACHE=postgres://amg_cache:...@host/db     # ← LA LEE EL CÓDIGO HOY

# La API (portal). Rol app_user: RLS + rol derivado de memberships.
DATABASE_URL_API=postgres://amg_api:...@host/db         # ← LA LEE EL CÓDIGO HOY

# El renderizador público (ADR-19). Rol app_render: el más pobre del sistema.
DATABASE_URL_RENDER=postgres://amg_render:...@host/db   # ← LA LEE EL CÓDIGO HOY
```

> ✅ **`DATABASE_URL_API` ya se usa.** La API (etapa 5.1) la lee en `api/src/deps.ts` y construye su
> `PgStore` con el rol `app_user`. El rol `amg_api` existe desde `0003_credenciales.sql`, y un test
> verifica contra `pg_auth_members` que **no puede** asumir el rol del servicio (ADR-17). Si falta la
> variable, la API **no arranca**.
>
> La API necesita además `SUPABASE_JWT_ISS` (obligatoria en producción): ver
> [`api/README.md`](../../api/README.md).

> ✅ **`DATABASE_URL_CACHE` ya se usa.** `kr-service/src/cli/spike.ts` (`registroDurable()`) la exige
> para cualquier corrida `live`+producción (ADR-14): sin ella, aborta antes de gastar. **Usá el
> transaction pooler (puerto 6543), no el session pooler (5432)**: la primera conexión de un rol
> recién creado puede darte `password authentication failed` por el pooler (Supavisor), no por la
> password — visto en vivo el 2026-07-30 con `amg_cache`, mientras `amg_api` seguía conectando bien
> por el mismo host. El transaction pooler solo sirve para código que hace transacciones
> autocontenidas (sin `SET LOCAL` de sesión ni `LISTEN` entre llamadas) — es el caso de `PgTaskLog`.
>
> ✅ **Resuelto para `amg_render` (2026-08-01): va por el 6543, y no es opcional.** Al desplegar el
> renderizador, el session pooler (5432) **aceptó una conexión y rechazó la siguiente con la misma
> password**. El transaction pooler fue estable, y además es el correcto: el renderizador solo hace
> `pool.transaction()` con `set local role`, que es autocontenido. Para `amg_orquestador` sigue sin
> verificarse. La forma de distinguir el pooler de una credencial mala: **probar los dos puertos** —
> si fallan los dos, es la password.
>
> ✅ **`DATABASE_URL_RENDER` ya se usa, y está en producción.** El renderizador (etapa 6) la lee en
> `renderer/src/deps.ts`, y desde el 2026-08-01 corre en Railway con ella. Necesita además
> **`STORYBLOK_WEBHOOK_SECRET`** (obligatoria: sin ella la invalidación de cache queda cerrada y el
> Visual Editor solo *casi* funciona) y **`PREVIEW_SECRET`** (sin ella no se sirven borradores, ni con
> firma). Las dos se generaron con `openssl rand -hex 32` y viven en la fuente única.
> Ver [`renderer/README.md`](../../renderer/README.md) y el
> [runbook](14-runbook-despliegue.md#desplegar-el-renderizador-fase-2).
>
> ⚠️ **Hueco conocido del reparto:** `env:sync` **no** le pasa estas tres al `renderer/.env` — su
> `.env.example` solo declara las de la demo local (tokens de Storyblok y `DEMO_DOMAIN`). En
> producción no molesta, porque las variables se cargan en Railway; pero para correr el servidor
> **real** en local hay que pasarlas a mano
> (`npx tsx --env-file=docs/private/credenciales.env renderer/src/server.ts`). Si alguna vez se quiere
> que `env:sync` las reparta, hay que tocar el MAPA y el `.env.example` juntos: un test los ata.
>
> Ojo con una que **no** es de Postgres: los tokens de la Content Delivery API viven **por cliente en
> la base** (`clients.storyblok_public_token` / `storyblok_preview_token`), no en el entorno. Tienen
> que ser así porque hay uno por space y ADR-04 da **un space por cliente**.

> **Sin ninguna de las cuatro**, el sistema arranca igual con **PGlite en memoria** — **fuera de
> producción**. Es deliberado: todo el proyecto corre sin una sola credencial. Lo que **no** es
> deliberado es que eso siga pasando en un servidor desplegado, donde una variable mal escrita
> arrancaría un proceso que se declara sano y trabaja contra una base efímera, sin un solo error. Por
> eso en producción la caída a PGlite está prohibida y el arranque falla ruidoso (tramo A, 2026-08-07).

### Las dos claves de Inngest

```bash
# La API: autentica el ENVÍO de eventos (`research/solicitado`, `research/aprobado`).
INNGEST_EVENT_KEY=...

# El orquestador: verifica que quien le pega a /api/inngest es Inngest de verdad.
INNGEST_SIGNING_KEY=...
```

**No son intercambiables y cada proceso lleva la suya**, por el mismo principio de compartimentación
que separa los cuatro DSN: quien solo emite no necesita poder verificar, y al revés.

En Railway van al entorno del servicio, que es de donde el SDK las toma por defecto. Pero **la event key
también se puede pasar por parámetro**, y eso importa: `eventKey` es opción pública de `ClientOptions`
(`node_modules/inngest/types.d.ts:639`) y **tiene precedencia sobre el entorno**
(`components/Inngest.js:187`). La API lo aprovecha: `leerConfig()` la lee y valida, y `crearDeps` se la
pasa explícita al cliente, para que **lo que se valida y lo que se usa sean la misma lectura** — si
fueran dos, podrían discrepar.

> *(Una versión anterior de este documento afirmaba que el SDK las leía "únicamente de `process.env`,
> sin dónde pasarlas por parámetro". Estaba escrito sin medirlo, y era falso. Lo corrigió quien fue a
> ejecutarlo.)*

> ⚠️ **Hueco conocido del reparto — igual que el del renderizador, y por el mismo motivo.** `env:sync`
> **no** reparte `INNGEST_EVENT_KEY` (api) ni `INNGEST_SIGNING_KEY` / `PIPELINE_MODO` (orquestador): no
> están en el `MAPA` de `scripts/env-sync.mts`, y `orchestrator/` **no tiene `.env.example`** — es el
> único de los seis paquetes sin plantilla. En producción no molesta, porque las variables se cargan en
> Railway; sí molesta para correr el orquestador real en local.
>
> Cerrarlo exige tocar el `MAPA` y el `.env.example` **juntos** (`scripts/env-sync.test.mts` los ata en
> las dos direcciones), y quedó pendiente porque el `permissions.deny` del arnés cubre `.env*` y bloqueó
> a los agentes incluso para **leer** la plantilla. Está anotado acá y no solo en `progress/current.md`
> a propósito: ese archivo se vacía al cerrar la etapa siguiente, y éste es donde alguien busca qué
> variable necesita un proceso.

> 🔴 **Ninguna de las dos existe todavía, y eso rompe `POST /runs` en producción.** Medido el
> 2026-08-07 leyendo el SDK: `components/Inngest.js:563` lanza en `send()` cuando el modo es **cloud** y
> no hay event key, y el modo se infiere como cloud por `RAILWAY_GIT_BRANCH` o `NODE_ENV=production`
> (`helpers/env.js`, `getMode`). La API corre en Railway. Ver el
> [runbook del orquestador](14-runbook-despliegue.md#desplegar-el-orquestador-fase-2--la-última-pieza),
> que **empieza por la API** justamente por esto.

**Las contraseñas no van en el repositorio, ni en las migraciones, ni en un mensaje.** Se ponen al
desplegar:

```sql
alter role amg_api           with password '…';
alter role amg_orquestador   with password '…';
alter role amg_cache         with password '…';
alter role amg_render        with password '…';
```

---

## Al desplegar en Supabase

1. Correr las migraciones (`db/migrations/*.sql`, en orden). Crean los roles **sin contraseña**.
2. Ponerles contraseña con los `alter role` de arriba.
3. Cargar las tres `DATABASE_URL_*` como secretos del entorno.

**El rol que corre las migraciones NO debe usarse en runtime.** Es dueño de las tablas y salta RLS:
usarlo en la aplicación anularía el aislamiento entre tenants de un plumazo.

---

## Lo que NO cubre esto

- **La contraseña de `amg_orquestador` da acceso de servicio.** Es lo esperado: quien tiene la
  contraseña de Postgres ya ganó. Lo que se impide es que un **bug de aplicación** —una ruta que
  construya el store equivocado, un endpoint que acepte un rol del body— escale privilegios.
- **`amg_cache` puede leer el registro de tareas entero**, que revela qué keywords se investigaron
  (aunque no de quién: esas tablas no tienen `tenant_id` a propósito). Es un dato de mercado, no de
  un cliente.

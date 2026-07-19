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
> La API necesita además `SUPABASE_JWT_SECRET` (y, en producción, `SUPABASE_JWT_ISS`): ver
> [`api/README.md`](../../api/README.md).

> ✅ **`DATABASE_URL_RENDER` ya se usa.** El renderizador (etapa 6) la lee en `renderer/src/deps.ts`.
> Necesita además **`STORYBLOK_WEBHOOK_SECRET`** (obligatoria: sin ella la invalidación de cache queda
> cerrada y el Visual Editor solo *casi* funciona) y **`PREVIEW_SECRET`** (sin ella no se sirven
> borradores, ni con firma). Ver [`renderer/README.md`](../../renderer/README.md).
>
> Ojo con una que **no** es de Postgres: los tokens de la Content Delivery API viven **por cliente en
> la base** (`clients.storyblok_public_token` / `storyblok_preview_token`), no en el entorno. Tienen
> que ser así porque hay uno por space y ADR-04 da **un space por cliente**.

> **Sin ninguna de las cuatro**, el sistema arranca igual con **PGlite en memoria**. Es deliberado:
> todo el proyecto corre sin una sola credencial.

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

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

Los tres son **`NOINHERIT`**, y esa palabra es la mitad del mecanismo.

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
# La API (portal). Rol app_user: RLS + rol derivado de memberships.
DATABASE_URL_API=postgres://amg_api:...@host/db

# El orquestador. Rol app_service.
DATABASE_URL_ORQUESTADOR=postgres://amg_orquestador:...@host/db

# Caches y registro de tareas. Sin acceso a NINGUNA tabla de tenant.
DATABASE_URL_CACHE=postgres://amg_cache:...@host/db
```

> **Sin ninguna de las tres**, el sistema arranca igual con **PGlite en memoria**. Es deliberado:
> todo el proyecto corre sin una sola credencial. Ver ADR-09.

**Las contraseñas no van en el repositorio, ni en las migraciones, ni en un mensaje.** Se ponen al
desplegar:

```sql
alter role amg_api           with password '…';
alter role amg_orquestador   with password '…';
alter role amg_cache         with password '…';
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

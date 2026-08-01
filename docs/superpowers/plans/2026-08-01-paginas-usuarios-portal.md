# Pieza 2 — Las páginas de usuarios en el portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **Leé primero el [programa](2026-08-01-portal-agencia-programa.md).** Ahí están el orden de las
> piezas, la lista de qué no se toca, la reserva de números de migración y la regla de seguridad de la
> allowlist. Este plan asume todo eso.

**Goal:** que el equipo de la agencia pueda ver quién tiene acceso al tenant, con qué rol, y cambiar
ese rol desde el portal — en vez de editarlo a mano en Supabase. Origen:
`dashboard-project/src/app/pages/{users,user-create,user-profile}` (570 líneas) más `users-table` y
las cinco cards de `shared/components/user-profile/`.

**Rama:** `feature/paginas-usuarios`. **Depende de:** pieza 1 (clientes), porque un rol `cliente`
exige un `client_id` y sin clientes que asignar la mitad del formulario no se puede probar.

## El choque de fondo, y cómo se resuelve

El origen modela al usuario así: un documento con `role: 'super_admin' | 'editor' | 'cliente' | 'new'`
y un objeto `permissions` con **20 flags booleanos** (`verTodosLosClientes`, `aprobarIdeas`,
`asignarRoles`…), editables desde la UI (`user-permissions-card` tiene `isEditing`, `isSaving` y
guarda con `usersService`).

**AMG OS hace lo contrario, y es una decisión de seguridad, no un detalle:** el rol **se deriva de
`memberships` dentro de Postgres** (ADR-15) y la autorización la hacen las **políticas RLS**. Un
endpoint que acepte `rol` del body es una escalada de privilegios. Veinte booleanos en una fila que la
UI edita serían una segunda fuente de verdad que RLS ignora: la pantalla diría "no puede eliminar
clientes" y la base lo dejaría igual.

**Resolución (decidida):**

1. La pantalla gestiona **membresías**: `rol` (`maestro | equipo | cliente | servicio`) y `client_id`
   cuando el rol es `cliente`. Nada más.
2. **No hay altas.** Crear un usuario es crearlo en **Supabase Auth**, y la API no recibe ninguna
   credencial de Supabase — recibe cuatro claves y ninguna es una service key
   (`scripts/env-sync.mts:26`: `DATABASE_URL_API`, `SUPABASE_JWT_ISS`, `CORS_ORIGINS`,
   `SUPABASE_JWT_AUD`). La pantalla trabaja sobre usuarios que ya existen en Auth.
3. La tarjeta de permisos se reescribe como **derivada y de solo lectura**: una tabla de capacidades
   por rol, calculada, que dice *lo que RLS realmente permite*.
4. El rol `'new'` del origen **no se porta**: en AMG, un usuario sin fila en `memberships` no ve nada.
   Eso *es* `new`, y no necesita representación en la base — solo en la UI ("sin acceso al tenant").

### Mapeo de roles

| Origen | AMG OS | Nota |
|---|---|---|
| `super_admin` | `maestro` | |
| `editor` | `equipo` | |
| `cliente` | `cliente` + `client_id` | La constraint `cliente_exige_client_id` (`0001_init.sql:78`) lo exige: un `cliente` sin cliente asignado queda en un limbo que la política vieja resolvía mostrándole toda la cartera |
| `new` | (sin membresía) | No se persiste. La UI lo muestra como "sin acceso" |
| — | `servicio` | Existe en AMG y **no es una persona**: es la identidad de los jobs del orquestador (`0001_init.sql:61-64`). La pantalla lo muestra pero **no permite asignarlo** desde la UI |

### ⛔ La trampa del rol `servicio`

`user_role` incluye `servicio` para que el orquestador escriba resultados sin privilegios de
`maestro`. Un `<select>` que liste el enum completo dejaría a un `maestro` convertir a una persona en
`servicio` (o a sí mismo), con los permisos de un proceso automático. **El endpoint valida contra una
allowlist de roles asignables (`maestro | equipo | cliente`), no contra el enum**, y hay un test que
manda `servicio` y espera un rechazo.

## Architecture

```text
portal/  pages/usuarios/*  ──►  services/usuarios.ts (signals)  ──►  core/api-core.ts
                                                                          ▼
api/     GET /members · PATCH /members/:userId  ──►  db/  membresias.ts (bajo RLS)
                                                                          ▼
db/      memberships (ya existe) + auth.users (solo lectura, para email y nombre)
```

**De dónde sale el email y el nombre:** `memberships` guarda solo `user_id`. El email vive en
`auth.users`, el esquema de Supabase. Dos caminos y la decisión importa:

- **Elegido:** la API lee `auth.users` con un `join` acotado a **los usuarios que ya son miembros del
  tenant del contexto**, y expone solo `email` y el nombre de `raw_app_meta_data`. Requiere un `grant
  select` acotado a `app_user` sobre `auth.users` — **una migración (`0012`) que hay que escribir con
  cuidado**: `auth.users` es de Supabase y tiene columnas sensibles (`encrypted_password`,
  `confirmation_token`, `recovery_token`). El grant es **por columna** (`select (id, email,
  raw_app_meta_data)`), nunca sobre la tabla entera, y la vista que lo expone filtra por membresía.
- **Descartado:** duplicar el email en `memberships`. Se desincroniza el día que alguien lo cambie en
  Supabase, y nadie se enteraría.

Si el `grant` acotado sobre `auth.users` resulta imposible o incómodo en Supabase, **la alternativa es
mostrar solo el `user_id`** y decirlo en la UI, no inventar un email. Anotarlo como hallazgo y
preguntar antes de duplicar datos.

## Global Constraints

Las del [programa](2026-08-01-portal-agencia-programa.md#cómo-no-interrumpir-la-demo), más:

- **El rol no se declara: se deriva** (ADR-15). El endpoint de cambio de rol autoriza por RLS, no por
  un `if` en TypeScript.
- **Nadie se cambia el rol a sí mismo.** Un `maestro` que se degrada a `equipo` por error se queda
  fuera de la pantalla que arreglaría el error. El endpoint rechaza que el `sub` del token sea el
  usuario objetivo, con su test.
- **No se puede quedar el tenant sin `maestro`.** Degradar al último `maestro` deja un tenant que
  nadie puede administrar. Se impone en la base (constraint o trigger), no en la UI, y el test lo
  verifica por mutación.
- **`auth.users` es de Supabase.** Se lee lo mínimo, por columna, y nunca se escribe.
- Los datos de usuario **no entran en la allowlist pública** (regla 5 del programa).

## Etapa 1 — Acceso de lectura a los miembros (`db`)

- [ ] **Rojo primero** en `db/src/membresias.test.ts` (nuevo): `listarMiembros` devuelve solo los del
      tenant del contexto; un `equipo` los ve; un `cliente` **no** ve la lista de miembros (o ve solo
      su propia fila — decidir y fijarlo con un test, no dejarlo implícito).
- [ ] Escribir `db/migrations/0012_membresias_perfil.sql`:
      - `grant select (id, email, raw_app_meta_data) on auth.users to app_user` — **por columna**.
      - Una vista o función que cruce `memberships` con `auth.users` **filtrando por el tenant del
        contexto**, para que el `join` no sea una puerta a listar todos los usuarios del proyecto de
        Supabase.
      - Verificar en PGlite que el esquema `auth` existe en los tests; si no, el helper de test tiene
        que crearlo mínimamente (es lo que hace Supabase en producción).
- [ ] Implementar `db/src/membresias.ts` con el patrón de `db/src/store.ts` (`withTenant`, `Tx`,
      nunca un `query()` suelto).
- [ ] **Test de fuga:** un miembro del tenant A no puede ver, por ningún camino, el email de un
      usuario que no es miembro de A. Mutación: quitar el filtro por tenant de la vista y confirmar
      que cae.

## Etapa 2 — Cambiar el rol (`db` + `api`)

- [ ] **Rojo primero**: `cambiarRol` de un usuario de otro tenant no afecta filas; poner `cliente` sin
      `client_id` falla por la constraint; poner `cliente` con un `client_id` de **otro** tenant falla;
      quitar el último `maestro` falla; cambiarse el rol a sí mismo falla.
- [ ] Implementar la garantía "siempre queda un `maestro`" **en la base**. Un `check` no alcanza
      (mira una fila); va con un trigger `after update/delete` o una constraint diferida. Elegir y
      **explicar por qué en un comentario**, y verificar por mutación: quitar el trigger y confirmar
      que el test del último `maestro` cae.
- [ ] `api/src/app.ts`: `GET /members` y `PATCH /members/:userId`. El `rol` se valida contra la
      allowlist `maestro | equipo | cliente` — **`servicio` se rechaza** (400, con test).
- [ ] Tests de la API, uno por vector: sin token → 401; token de otro tenant → no ve ni modifica;
      `rol: 'servicio'` → 400; auto-degradación → 403; `client_id` de otro tenant → 400; un `equipo`
      intentando cambiar roles → 403 (¿o se permite? **decidir y fijarlo**: si `equipo` puede repartir
      roles, `maestro` deja de significar algo).
- [ ] `api/src/dev-server.ts`: que los endpoints nuevos funcionen sobre PGlite sin credenciales, con
      un par de miembros de ejemplo. Es lo que permite manejar la pantalla en el navegador.

## Etapa 3 — Las capacidades por rol (derivadas)

- [ ] Escribir `portal/src/app/core/capacidades.ts`: una tabla `rol → capacidades` con las etiquetas
      en español. **Es documentación ejecutable de lo que RLS permite**, así que cada fila lleva un
      comentario apuntando a la política o constraint que la respalda.
- [ ] **El test que le da valor** (`capacidades.test.ts`): la tabla no puede contradecir a la base.
      Como mínimo, afirmar que las capacidades declaradas para `cliente` son un subconjunto de las de
      `equipo`, y las de `equipo` de las de `maestro`; y que ninguna capacidad declarada corresponde a
      una acción que la API rechaza para ese rol (cruzar contra los tests de la etapa 2).
- [ ] Si una capacidad no se puede respaldar con una política concreta, **no se declara**. Una lista
      que promete más de lo que RLS hace es peor que no tener la pantalla.

## Etapa 4 — Las pantallas

- [ ] **`/usuarios` (listado).** Portar `users.page` + `users-table`. El origen viene con código a
      limpiar: un `console.log('Users from store:')`, un `users$` reasignado **dentro** de un
      `subscribe` (que es lo que el port a signals elimina de raíz), un `allIdeas` que no se usa y un
      `import { Idea }` que no corresponde a esta pantalla. Se reescribe con signals y `computed`, no
      se copia.
- [ ] **`/usuarios/:id` (perfil).** Portar `user-profile.page` con sus cards: `user-info-card`,
      `user-meta-card`, `user-activity-card`, `user-client-assignment-card`, y
      `user-permissions-card` **reescrita como derivada y read-only** (sin `isEditing`, sin
      `isSaving`, sin guardar).
      - `user-activity-card`: AMG no registra actividad por usuario. O se alimenta de algo real
        (`auth.users.last_sign_in_at`, si el grant lo permite) o **no se porta**. No mostrar ceros.
- [ ] El cambio de rol vive en el perfil (un `<select>` con los tres roles asignables + el selector de
      cliente cuando es `cliente`), con confirmación explícita: es una acción de privilegios.
- [ ] **NO** se porta `user-create`: no hay altas (decidido). Si la UI necesita un botón "invitar",
      que enlace a Supabase o muestre las instrucciones — nunca un formulario que finja crear.
- [ ] `header/user-dropdown` del origen: se trae acá (perfil + logout, que ya existe en el portal).
- [ ] Tests de componente (Karma) del listado y del cambio de rol.

## Etapa 5 — Rutas, navegación y cierre

- [ ] Rutas `loadComponent` bajo `authGuard` dentro del `AppShellComponent`. **Sin tocar** el
      `redirectTo: 'runs'`.
- [ ] Un item nuevo en `ITEMS_NAV` de `app-sidebar.ts` (aditivo) + su `.spec.ts`. ¿Debería verlo un
      `equipo`? Si la pantalla es solo para `maestro`, el item se oculta por rol **y** la ruta se
      protege en el servidor: ocultar el link no es autorización.
- [ ] **Navegador** (MCP chrome-devtools) contra `npm run dev:server -w api`: ver la lista, abrir un
      perfil, cambiar un rol, intentar cambiarse el propio (debe fallar con un mensaje claro),
      intentar dejar el tenant sin `maestro` (idem). **En tema claro y oscuro.** Consola sin errores.
- [ ] Confirmar `/runs`, `/runs/:id` y `/cartera` intactas.
- [ ] `npm test` + `npm run typecheck` desde la raíz, `npm test -w portal`,
      `npm run test:components -w portal`. Comparar con la línea base.
- [ ] Auto-revisión adversarial del diff, actualización de `09-estado-y-roadmap.md` y
      `11-plan-fase-2.md`, cifras sincronizadas, y marcar la pieza en el
      [programa](2026-08-01-portal-agencia-programa.md).

## Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| El `grant` sobre `auth.users` expone más de lo que debe | Grant **por columna** + vista filtrada por tenant + test de fuga con mutación |
| Alguien se convierte (o convierte a otro) en `servicio` | Allowlist de roles asignables en el endpoint, con test que manda `servicio` |
| El tenant queda sin `maestro` y nadie puede administrarlo | Garantía en la base (trigger/constraint), no en la UI, verificada por mutación |
| Un `maestro` se auto-degrada y se queda afuera | El endpoint rechaza que el objetivo sea el `sub` del token |
| La lista de capacidades promete lo que RLS no cumple | Cada fila apunta a su política; el test cruza contra los tests de la API |
| Se porta la card de actividad con datos inventados | Regla: no mostrar ceros. O sale de `auth.users`, o no se porta |

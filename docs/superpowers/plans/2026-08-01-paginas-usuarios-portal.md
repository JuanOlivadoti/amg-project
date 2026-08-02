# Pieza 2 — Las páginas de usuarios en el portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
>
> **Leé primero el [programa](2026-08-01-portal-agencia-programa.md).** Ahí están el orden de las
> piezas, la lista de qué no se toca, la reserva de números de migración y la regla de seguridad de la
> allowlist. Este plan asume todo eso.
>
> ---
>
> ## ⛔ Enmendado el 2026-08-02 — NO ejecutar sin leer esto
>
> Una revisión externa de los cinco planes abiertos encontró tres cosas en este, verificadas contra el
> código. Las tres están corregidas más abajo, pero conviene saberlas antes de abrir una etapa:
>
> 1. **El `grant select` sobre `auth.users` era una fuga cross-tenant, no una lectura acotada**
>    (Critical). El plan concedía `select (id, email, raw_app_meta_data)` a `app_user` y confiaba en
>    que la vista filtrara por membresía. **El grant es independiente de la vista:** con él, cualquier
>    consulta como `app_user` hace `select email from auth.users` y lee todos los usuarios del
>    proyecto Supabase, de todos los tenants. Es la misma clase de error que una garantía escrita en
>    un comentario. Ver Etapa 1, reescrita.
> 2. **Cambiar el rol desde `app_user` contradecía la `0001`**, que dice que las membresías no se
>    escriben desde la app y que eso va "por el backend con service-role". Ese backend nunca existió
>    —la API no recibe credenciales de Supabase, a propósito—, así que hoy no hay ningún camino.
>    Resuelto por **[ADR-24](../../decisiones-arquitectura.md)** 🟡 *propuesta*: se escriben desde
>    `app_user` bajo RLS, con grant por columna y policy de `maestro`. **Esta pieza no se ejecuta
>    hasta que ADR-24 esté aceptada.**
> 3. **La UI toma el rol de `app_metadata`, no de `memberships`.** `Sesion.rol`
>    (`portal/src/app/core/models.ts`) lo lee del token. Como la API no puede escribir ese metadata,
>    cambiar una membresía dejaría la UI mostrando el rol viejo para siempre. No es escalada (RLS
>    manda), es desincronización permanente. Ver Etapa 3.
>
> Y una cuarta, que es trabajo **añadido** a esta pieza: la pieza 1 dejó `asignado_a` como un
> `<input type="text" placeholder="uuid del usuario responsable">`. Esta pieza construye justamente
> el listado de miembros que lo arregla. Ver Etapa 5.

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
- [ ] Escribir `db/migrations/0012_membresias_perfil.sql`. **Sin ningún `grant` sobre `auth.users`**
      (ver la enmienda del 2026-08-02 arriba: el grant es independiente de la vista y sería una fuga
      cross-tenant). En su lugar, **un único accessor de privilegio mínimo**:
      - `create function app.miembros_del_tenant() returns table (user_id uuid, email text, nombre
        text, rol text, client_id uuid)`, **`security definer`**, que deriva el tenant del contexto,
        une `memberships` con `auth.users` y **devuelve columnas escalares explícitas** — nunca
        `raw_app_meta_data` entero, que es un jsonb con lo que Supabase quiera meter adentro.
      - **`set search_path = pg_catalog, public, auth`** en la función. Una `security definer` sin
        `search_path` fijo se puede secuestrar redefiniendo un nombre en un esquema anterior.
      - **`revoke execute on function app.miembros_del_tenant() from public`** y después
        `grant execute … to app_user`. En Postgres una función nace con `execute` a `PUBLIC`, y
        `app_render` tiene `usage` sobre el esquema `app` (`0007_render_publico.sql`): sin el
        `revoke`, el rol anónimo del renderizador puede llamarla. **Este `revoke` es la tarea, no un
        detalle de estilo.**
      - **Test de que `app_render` no puede ejecutarla**, afirmando `permission denied` (no "devuelve
        cero filas"). Mutación: quitar el `revoke` y confirmar que el test cae.
      - Verificar en PGlite que el esquema `auth` existe en los tests; si no, el helper de test tiene
        que crearlo mínimamente (es lo que hace Supabase en producción).
- [ ] **Verificar dónde vive el nombre antes de escribir la función.** El plan asumía
      `raw_app_meta_data`; en Supabase, lo que el usuario aporta al registrarse suele ir a
      `raw_user_meta_data` y `raw_app_meta_data` es lo que controla la aplicación. Mirar una fila real
      antes de elegir, y si no hay nombre en ninguna, **mostrar el email** — no inventar uno a partir
      de la parte local de la dirección.
- [ ] Implementar `db/src/membresias.ts` con el patrón de `db/src/store.ts` (`withTenant`, `Tx`,
      nunca un `query()` suelto).
- [ ] **Test de fuga:** un miembro del tenant A no puede ver, por ningún camino, el email de un
      usuario que no es miembro de A. Mutación: quitar el filtro por tenant de la vista y confirmar
      que cae.

## Etapa 2 — Cambiar el rol (`db` + `api`)

> **Precondición: [ADR-24](../../decisiones-arquitectura.md) aceptada.** Hoy `app_user` tiene solo
> `grant select on memberships` (`0001_init.sql`), y esa migración declara por escrito que los roles
> se cambian "por el backend con service-role". Esta etapa **cambia esa decisión**; no la ignora.

- [ ] **Rojo primero**: `cambiarRol` de un usuario de otro tenant no afecta filas; poner `cliente` sin
      `client_id` falla por la constraint; poner `cliente` con un `client_id` de **otro** tenant falla;
      quitar el último `maestro` falla; cambiarse el rol a sí mismo falla; **un `equipo` que intenta
      cambiar un rol no afecta filas**; **`servicio` no se puede asignar**.
- [ ] En la misma `0012`, la autoridad para escribir — cada punto con su test, y **ninguno es
      opcional** (son las condiciones que ADR-24 pone a la decisión):
      - `grant update (rol, client_id) on memberships to app_user`. **Por columna.** Sin `insert` ni
        `delete`. `tenant_id` y `user_id` son la identidad de la fila: si se pudieran editar, cambiar
        un rol y mover a alguien de tenant serían la misma operación.
      - Policy `membership_update` con **`using` Y `with check`**, las dos, exigiendo `maestro` del
        tenant del contexto. Solo `using` autoriza a leer la fila para escribirla, pero no filtra el
        valor nuevo — un `maestro` podría escribir `rol = 'servicio'` y la policy lo dejaría pasar.
      - La auto-edición se rechaza **en la base**, no solo en el endpoint.
      - **Corregir por escrito el comentario de la `0001`** en esta migración (no editando la `0001`,
        que ya está aplicada): hoy afirma que las membresías no se escriben desde la app. Una decisión
        derogada que sigue escrita como vigente hace que el próximo la use de premisa.
- [ ] Implementar la garantía "siempre queda un `maestro`" **en la base**. Un `check` no alcanza
      (mira una fila); va con un trigger `after update/delete` o una constraint diferida. **Tiene que
      cubrir dos degradaciones concurrentes**: dos transacciones que degradan a dos maestros distintos
      pueden ver cada una "queda otro" y dejar el tenant sin ninguno. Bloquear una fila estable del
      tenant, o usar un mecanismo que serialice. Elegir y **explicar por qué en un comentario**, y
      verificar por mutación: quitar el trigger y confirmar que el test del último `maestro` cae.
- [ ] `api/src/app.ts`: `GET /members` y `PATCH /members/:userId`. El `rol` se valida contra la
      allowlist `maestro | equipo | cliente` — **`servicio` se rechaza** (400, con test).
- [ ] Tests de la API, uno por vector: sin token → 401; token de otro tenant → no ve ni modifica;
      `rol: 'servicio'` → 400; auto-degradación → 403; `client_id` de otro tenant → 400; un `equipo`
      intentando cambiar roles → 403 (¿o se permite? **decidir y fijarlo**: si `equipo` puede repartir
      roles, `maestro` deja de significar algo).
- [ ] `api/src/dev-server.ts`: que los endpoints nuevos funcionen sobre PGlite sin credenciales, con
      un par de miembros de ejemplo. Es lo que permite manejar la pantalla en el navegador.

## Etapa 3 — Las capacidades por rol (derivadas)

- [ ] **Antes que la tabla: arreglar de dónde sale el rol.** Hoy `Sesion.rol`
      (`portal/src/app/core/models.ts`) lo lee de `app_metadata.rol` del token. Como la API no tiene
      credenciales de Supabase, **cambiar una membresía no actualiza ese metadata**: en cuanto esta
      pieza permita cambiar roles, la UI mostraría el rol viejo indefinidamente. No es una escalada
      —RLS manda, y el comentario del tipo ya lo dice— pero sí una pantalla que miente.
      El bootstrap de sesión pasa a resolver la **membresía efectiva** (un `GET /members/me` o
      equivalente) y **ese** valor alimenta la UI. El JWT aporta identidad; `memberships`, el rol y el
      `client_id`. Es ADR-15 aplicado también al front.
- [ ] Test: con un token cuyo `app_metadata.rol` diga `equipo` y una membresía que diga `maestro`, la
      UI tiene que ofrecer las capacidades de `maestro`. Hoy ofrecería las de `equipo`.
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

## Etapa 6 — Integración de retorno con la pieza 1 (clientes)

> Añadida el 2026-08-02. La pieza 1 se cerró pidiéndole a la agencia que escriba el UUID del
> responsable a mano (`cliente-crear.ts`: `<input type="text" placeholder="uuid del usuario
> responsable">`), porque no existía el listado de miembros. Esta pieza lo construye, así que le toca
> volver sobre clientes y cerrarlo. **El grafo es `1 → 2 → integración`, no un ciclo.**

- [ ] Reemplazar el input de texto de `asignado_a` por un **selector de miembros del tenant**, con
      nombre y email, alimentado por `GET /members`.
- [ ] Mostrar **nombre/email en vez del UUID** en el perfil del cliente y en la tabla de clientes.
- [ ] El filtro por responsable pasa a usar ids reales, no texto libre.
- [ ] **La FK compuesta `(tenant_id, asignado_a) → memberships` sigue siendo la autoridad final.** El
      selector es comodidad de la UI; que no se pueda asignar a alguien de otro tenant lo sigue
      garantizando la base, y su test no se toca.
- [ ] Verificar en el navegador: dar de alta un cliente eligiendo responsable de la lista, y que el
      perfil lo muestre por nombre.

## Riesgos y cómo se cierran

| Riesgo | Cómo se cierra |
|---|---|
| **`app_render` puede ejecutar la función de miembros** (tiene `usage` sobre el esquema `app`, y en Postgres `execute` nace público) | `revoke execute … from public` + `grant` solo a `app_user`, con test que afirma `permission denied` para `app_render` y mutación que lo confirma |
| Un `select` directo sobre `auth.users` esquiva la vista y lista todo el proyecto Supabase | **No hay grant sobre `auth.users`**: el único camino es la función `security definer` con `search_path` fijo |
| Dos degradaciones concurrentes dejan el tenant sin `maestro` | El trigger serializa (bloqueo de una fila estable del tenant); test con dos transacciones |
| Se escribe `rol = 'servicio'` esquivando el endpoint | Policy con `with check`, no solo `using` — la base lo rechaza aunque el endpoint falle |
| La UI muestra un rol distinto del que RLS aplica | El bootstrap resuelve la membresía efectiva; test con token y membresía discordantes |
| Alguien se convierte (o convierte a otro) en `servicio` | Allowlist de roles asignables en el endpoint, con test que manda `servicio` |
| El tenant queda sin `maestro` y nadie puede administrarlo | Garantía en la base (trigger/constraint), no en la UI, verificada por mutación |
| Un `maestro` se auto-degrada y se queda afuera | El endpoint rechaza que el objetivo sea el `sub` del token |
| La lista de capacidades promete lo que RLS no cumple | Cada fila apunta a su política; el test cruza contra los tests de la API |
| Se porta la card de actividad con datos inventados | Regla: no mostrar ceros. O sale de `auth.users`, o no se porta |

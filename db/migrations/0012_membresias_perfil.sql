-- =============================================================================
-- AMG OS — Etapa 1 de la pieza 2 (Usuarios): lectura de membresías + email
--
-- Plan: docs/superpowers/plans/2026-08-01-paginas-usuarios-portal.md ("De dónde sale el email y el
-- nombre"). `memberships` (0001) guarda solo `user_id` -- el email vive en `auth.users`, el esquema
-- de SUPABASE, no nuestro. Esta migración NO lo crea (no es nuestro): asume que YA EXISTE, como pasa
-- en producción. El helper de test (`db/src/testdb.ts`) crea un stand-in MÍNIMO antes de aplicar
-- migraciones, precisamente para que esta suposición sea cierta también en PGlite.
--
-- Dos piezas, las dos con el mismo espíritu que ya usan `app.es_staff()`/`app.ve_cliente()` para
-- `clients` (0001/0011): la garantía vive en SQL, no en un `if` de TypeScript que un caller futuro
-- pueda rodear.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) El grant: POR COLUMNA, nunca la tabla entera.
--
-- `usage` sobre el esquema hace falta aparte del `select`: a diferencia de `public`, un esquema
-- nuevo (`auth`) NO tiene `usage` concedido a `PUBLIC` por default -- sin esta línea, CUALQUIER
-- referencia a `auth.users` (aunque sea a una columna permitida) falla con "permission denied for
-- schema auth" antes de llegar a mirar columnas. Es justo lo que atrapó el test de este mismo
-- archivo (`membresias.test.ts`) al escribirse: sin el `usage`, hasta el camino LEGÍTIMO fallaba.
--
-- `auth.users` real de Supabase tiene columnas sensibles (`encrypted_password`,
-- `confirmation_token`, `recovery_token`, ...) que ningún proceso de este sistema debe poder leer,
-- ni siquiera indirectamente. `grant select on auth.users to app_user` a secas expondría esas
-- columnas en cuanto alguien agregara un `select *` en el futuro -- con el grant por columna, ESE
-- `select *` directamente falla (permission denied), no filtra datos de más.
-- -----------------------------------------------------------------------------
grant usage on schema auth to app_user;
grant select (id, email, raw_app_meta_data) on auth.users to app_user;

-- -----------------------------------------------------------------------------
-- 2) La vista: `memberships` cruzado con `auth.users`, YA filtrado por tenant y por rol.
--
-- Por qué la visibilidad se resuelve ACÁ y no en TypeScript: `TenantContext` (db/src/store.ts) no
-- tiene un campo `rol` -- el rol se DERIVA de `memberships` (ADR-15), nunca se declara. La única
-- forma de que "un cliente ve solo su propia fila" sea una garantía real (no una convención que
-- alguien puede olvidar) es que la propia consulta la imponga.
--
--   - staff (maestro/equipo/servicio, `app.es_staff()`) ve TODAS las membresías del tenant.
--   - un rol `cliente` ve SOLO su propia fila -- decisión ya cerrada (ver el plan de la pieza 2):
--     NUNCA la lista completa de miembros del tenant, aunque `membership_select` (0001) ya la
--     aislara por tenant -- ese aislamiento es por TENANT, no por rol, y esta vista añade la
--     segunda dimensión.
--   - un rol NULL o desconocido (sin membresía en el tenant) no matchea ninguna fila: ni siquiera
--     entra en el `or`, porque el `where` de tenant ya lo excluye antes de llegar ahí.
--
-- Por qué el `join` NO es una puerta a listar `auth.users` completo: nace de `memberships`, ya
-- restringido por `m.tenant_id = app.current_tenant_id() and (staff u own row)`. `auth.users` solo
-- aporta columnas para las filas de MEMBERSHIPS que ese `where` ya dejó pasar -- no hay ninguna rama
-- que lea `auth.users` sin pasar antes por ese filtro.
-- -----------------------------------------------------------------------------
create view membresias_perfil as
  select
    m.id,
    m.tenant_id,
    m.user_id,
    m.rol,
    m.client_id,
    m.created_at,
    u.email,
    u.raw_app_meta_data
  from memberships m
  join auth.users u on u.id = m.user_id
  where m.tenant_id = app.current_tenant_id()
    and (app.es_staff() or m.user_id = app.current_user_id());

comment on view membresias_perfil is
  'Lectura de memberships + auth.users (email, metadata), YA filtrada por tenant y por rol: staff '
  've todo el tenant, un rol cliente ve solo su propia fila. Ver PgMembresias.listarMiembros '
  '(db/src/membresias.ts) y el test de fuga verificado por mutación en membresias.test.ts.';

grant select on membresias_perfil to app_user;

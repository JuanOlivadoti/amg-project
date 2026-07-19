-- =============================================================================
-- AMG OS — 10ª review: dos garantías que estaban ESCRITAS pero no IMPUESTAS
--
-- El patrón se repite y conviene nombrarlo. En la 0006 el problema fue "un space por cliente"
-- afirmado y no aplicado. Acá son otras dos afirmaciones mías:
--
--   · ADR-04/ADR-11: "**un space de Storyblok por cliente**"  → nada lo impedía.
--   · 0007: "lo que se llevan es el NAP, **que ya era público**" → el grant daba el jsonb ENTERO.
--
-- Escribir la garantía en un ADR no la hace cumplir. La hace cumplir una constraint.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- #1 — Un space, un cliente. Ahora sí.
--
-- El agujero, tal como lo reprodujo la review:
--
--   1. cliente A (a.example) y cliente B (b.example) con el MISMO storyblok_space_id
--   2. una visita a a.example/menu cachea el HTML de A bajo (space, "menu")
--   3. una visita a b.example/menu da **cache hit** y devuelve el HTML de A
--
--   B nunca llega a consultar su propio token. Es una fuga cross-client servida desde memoria, y
--   no requiere ningún ataque: alcanza con cargar mal una ficha.
--
-- La clave de cache se arregló por su lado (`renderer/src/cache.ts`), pero eso trata el síntoma:
-- mientras dos clientes puedan compartir space, **comparten contenido** en Storyblok también, que
-- es exactamente lo que 0006 vino a impedir del lado de la escritura. El invariante es de datos.
--
-- `unique` deja pasar varios NULL (un cliente sin space todavía), que es lo que se quiere.
-- -----------------------------------------------------------------------------
create unique index if not exists clients_storyblok_space_key
  on clients (storyblok_space_id);

comment on index clients_storyblok_space_key is
  'ADR-04/ADR-11: UN space por cliente. Sin esto, dos clientes con el mismo space se pisan el '
  'contenido en Storyblok y comparten entradas de cache en el renderizador (10a review, #1).';

-- Un space vacío o con espacios no es un space: sería una clave de cache y de publicación con
-- forma de dato válido. Se rechaza en la puerta.
alter table clients
  drop constraint if exists clients_space_no_vacio;

alter table clients
  add constraint clients_space_no_vacio
  check (storyblok_space_id is null
         or (length(trim(storyblok_space_id)) > 0 and storyblok_space_id !~ '\s'));

-- -----------------------------------------------------------------------------
-- #8 — El renderizador ve el NAP, no la ficha del cliente
--
-- 0007 concedía `select (business_profile)`, que es una columna `jsonb` **sin forma declarada**.
-- Yo escribí que lo que se llevaría un atacante es "el NAP, que ya está impreso en cada página
-- pública". No era verdad: si alguien guarda `{"name": ..., "notas_internas": "no paga hace 3
-- meses", "email_dueño": ...}`, todo eso queda al alcance del rol más expuesto del sistema.
--
-- `perfilValido()` en el renderizador filtra las claves ANTES de renderizar, pero eso protege el
-- HTML, no la lectura: un proceso comprometido bajo `app_render` consulta la columna directamente.
-- Una defensa que vive en el cliente de la base no es una defensa de la base.
--
-- Ahora hay una columna GENERADA con la allowlist —incluidas las claves de `address`, que también
-- es un objeto libre— y el grant apunta a ella. La afirmación de 0007 pasa a ser cierta **por
-- construcción**: aunque alguien agregue campos privados al perfil, esta columna no los tiene.
-- -----------------------------------------------------------------------------
-- La allowlist va en una función porque una columna generada exige una expresión IMMUTABLE, y
-- `jsonb_build_object` está marcada STABLE (por los tipos de salida que puede tener que invocar).
-- Declararla inmutable acá es correcto: la función solo lee claves de su argumento `jsonb` y
-- construye otro `jsonb`. No mira tablas, ni la hora, ni ninguna configuración de sesión. Mismo
-- `input` → mismo `output`, siempre.
create or replace function app.nap_publico(perfil jsonb) returns jsonb
language sql immutable as $$
  select case
    when perfil is null or jsonb_typeof(perfil) <> 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'name',          perfil -> 'name',
      'telephone',     perfil -> 'telephone',
      'priceRange',    perfil -> 'priceRange',
      'url',           perfil -> 'url',
      'image',         perfil -> 'image',
      'opening_hours', perfil -> 'opening_hours',
      -- `address` es un objeto libre y también se recorta: si no, bastaría con esconder algo
      -- adentro para saltarse la allowlist de arriba.
      --
      -- La condición es POSITIVA (`= 'object'`) a propósito. Escrita como `<> 'object'` no funciona:
      -- si no hay `address`, `jsonb_typeof(null)` es NULL, y `NULL <> 'object'` es **NULL, no true**
      -- — así que el CASE se iba al ELSE y devolvía un `address` vacío. Lógica de tres valores; la
      -- cazó el test que comparaba el perfil entero.
      'address', case
        when jsonb_typeof(perfil -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'streetAddress',   perfil -> 'address' -> 'streetAddress',
          'addressLocality', perfil -> 'address' -> 'addressLocality',
          'postalCode',      perfil -> 'address' -> 'postalCode',
          'addressRegion',   perfil -> 'address' -> 'addressRegion',
          'addressCountry',  perfil -> 'address' -> 'addressCountry'
        ))
        else null
      end
    ))
  end
$$;

comment on function app.nap_publico(jsonb) is
  'Allowlist del NAP publicable. Es la proyeccion que ve app_render; la ficha cruda del cliente '
  'puede tener campos privados y no se le concede (10a review, #8).';

alter table clients
  add column if not exists business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'Proyeccion del NAP con allowlist de claves. Es lo UNICO que ve app_render: la columna cruda '
  'business_profile puede tener campos privados y no se le concede (10a review, #8).';

-- El grant se mueve: fuera la columna cruda, dentro la proyeccion.
revoke select (business_profile) on clients from app_render;
grant  select (business_profile_publico) on clients to app_render;

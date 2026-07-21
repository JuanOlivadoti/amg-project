-- =============================================================================
-- AMG OS — La marca del negocio, dentro de la allowlist del renderizador
--
-- El tema por tenant (color, fuente, logo) vive en `business_profile.brand`. Pero el renderizador
-- NO lee `business_profile` crudo: lee `business_profile_publico`, la columna generada con allowlist
-- que introdujo la 0008 (10ª review, #8). Esa allowlist enumera claves explícitas — y `brand` no
-- estaba, así que el tema **se filtraría en silencio** y toda web saldría con el rojo por defecto.
--
-- Es exactamente el modo de fallo que la 0008 buscó: una columna que crece, y un default de "no
-- visible". Acá se agrega `brand` a la allowlist a propósito, con su propia sub-allowlist (color /
-- font / logo), igual que `address`. La marca NO es secreta —está en cada página pública—, así que
-- exponerla al rol del renderizador es correcto.
--
-- Se REEMPLAZA `app.nap_publico` (la 0008 la creó con `create or replace`, así que esto es la
-- evolución natural) y se re-materializa la columna generada para que tome la nueva definición.
-- =============================================================================

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
      'address', case
        when jsonb_typeof(perfil -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'streetAddress',   perfil -> 'address' -> 'streetAddress',
          'addressLocality', perfil -> 'address' -> 'addressLocality',
          'postalCode',      perfil -> 'address' -> 'postalCode',
          'addressRegion',   perfil -> 'address' -> 'addressRegion',
          'addressCountry',  perfil -> 'address' -> 'addressCountry'
        ))
        else null
      end,
      -- NUEVO: la marca. Sub-allowlist propia — un campo privado escondido en `brand` no pasa.
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', perfil -> 'brand' -> 'color',
          'font',  perfil -> 'brand' -> 'font',
          'logo',  perfil -> 'brand' -> 'logo'
        ))
        else null
      end
    ))
  end
$$;

-- Re-materializar la columna generada: una columna STORED no se recalcula porque cambie la función.
-- Se recrea para que use la definición nueva. `if exists` la hace idempotente.
alter table clients drop column if exists business_profile_publico;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'Proyeccion del perfil con allowlist (NAP + marca). Es lo UNICO que ve app_render. La columna '
  'cruda business_profile puede tener campos privados y no se le concede (0008/0009).';

-- El grant se perdió al hacer drop column: se vuelve a conceder sobre la columna recreada.
grant select (business_profile_publico) on clients to app_render;

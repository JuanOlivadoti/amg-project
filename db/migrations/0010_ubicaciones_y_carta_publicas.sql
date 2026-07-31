-- =============================================================================
-- AMG OS — Los locales y la carta, dentro de la allowlist del renderizador
--
-- La navegación del sitio del cliente (footer NAP multi-local + página /menu) necesita `locations` y
-- `menu` del business_profile. Pero el renderizador NO lee `business_profile` crudo: lee
-- `business_profile_publico`, la columna generada con allowlist que introdujo la 0008. Esa allowlist
-- enumera claves explícitas — y ni `locations` ni `menu` estaban, así que se filtrarían en silencio:
-- el footer saldría sin locales y `/menu` daría 404, exactamente como le pasó a `brand` antes de la 0009.
--
-- Se REEMPLAZA `app.nap_publico` (mismo mecanismo que la 0009) y se re-materializa la columna.
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
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', perfil -> 'brand' -> 'color',
          'font',  perfil -> 'brand' -> 'font',
          'logo',  perfil -> 'brand' -> 'logo'
        ))
        else null
      end,
      -- NUEVO: los locales. Un array de objetos, cada uno con su propia sub-allowlist — la misma
      -- forma que ya exige `renderer/src/perfil.ts` (Task 6), para que lo que sobrevive acá sea
      -- exactamente lo que ese validador espera recibir.
      'locations', case
        when jsonb_typeof(perfil -> 'locations') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', loc -> 'name',
            'address', case
              when jsonb_typeof(loc -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'streetAddress',   loc -> 'address' -> 'streetAddress',
                'addressLocality', loc -> 'address' -> 'addressLocality',
                'postalCode',      loc -> 'address' -> 'postalCode',
                'addressRegion',   loc -> 'address' -> 'addressRegion',
                'addressCountry',  loc -> 'address' -> 'addressCountry'
              ))
              else null
            end,
            'telephone',     loc -> 'telephone',
            'opening_hours', loc -> 'opening_hours'
          )))
          from jsonb_array_elements(perfil -> 'locations') as loc
        )
        else null
      end,
      -- NUEVO: la carta. `price` es texto libre a propósito (ver web-builder/src/types.ts) — no se
      -- fuerza a número acá tampoco.
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    item -> 'category',
            'name',        item -> 'name',
            'description', item -> 'description',
            'price',       item -> 'price'
          )))
          from jsonb_array_elements(perfil -> 'menu') as item
        )
        else null
      end
    ))
  end
$$;

-- Re-materializar la columna generada: una columna STORED no se recalcula porque cambie la función.
alter table clients drop column if exists business_profile_publico;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'NAP público del negocio (allowlist): name, telephone, priceRange, url, image, opening_hours, '
  'address, brand, locations, menu. Generada — nunca se escribe directo. Ver 0008/0009/0010.';

grant select (business_profile_publico) on clients to app_render;

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

-- Solo strings sobreviven la allowlist como texto. Un objeto/array escondido en un campo que se
-- declara "de texto" (ej. menu[].price = {"secreto":"x"}) no pasa: la allowlist restringe NOMBRES
-- de clave, esto restringe FORMA de valor — las dos hacen falta (hallazgo de revisión externa).
create or replace function app.texto_publico(v jsonb) returns text
language sql immutable as $$
  select case when jsonb_typeof(v) = 'string' then v #>> '{}' else null end
$$;

create or replace function app.nap_publico(perfil jsonb) returns jsonb
language sql immutable as $$
  select case
    when perfil is null or jsonb_typeof(perfil) <> 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'name',          app.texto_publico(perfil -> 'name'),
      'telephone',     app.texto_publico(perfil -> 'telephone'),
      'priceRange',    app.texto_publico(perfil -> 'priceRange'),
      'url',           app.texto_publico(perfil -> 'url'),
      'image',         app.texto_publico(perfil -> 'image'),
      'opening_hours', app.texto_publico(perfil -> 'opening_hours'),
      'address', case
        when jsonb_typeof(perfil -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'streetAddress',   app.texto_publico(perfil -> 'address' -> 'streetAddress'),
          'addressLocality', app.texto_publico(perfil -> 'address' -> 'addressLocality'),
          'postalCode',      app.texto_publico(perfil -> 'address' -> 'postalCode'),
          'addressRegion',   app.texto_publico(perfil -> 'address' -> 'addressRegion'),
          'addressCountry',  app.texto_publico(perfil -> 'address' -> 'addressCountry')
        ))
        else null
      end,
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', app.texto_publico(perfil -> 'brand' -> 'color'),
          'font',  app.texto_publico(perfil -> 'brand' -> 'font'),
          'logo',  app.texto_publico(perfil -> 'brand' -> 'logo')
        ))
        else null
      end,
      -- Los locales: cada uno con su propia sub-allowlist, y un tope de 20 (ver hallazgo 3 más
      -- abajo) aplicado ACÁ, antes de que Postgres materialice más de eso — `with ordinality`
      -- numera los elementos y el `where i <= 20` corta la fuente, no el resultado.
      'locations', case
        when jsonb_typeof(perfil -> 'locations') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', app.texto_publico(loc -> 'name'),
            'address', case
              when jsonb_typeof(loc -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'streetAddress',   app.texto_publico(loc -> 'address' -> 'streetAddress'),
                'addressLocality', app.texto_publico(loc -> 'address' -> 'addressLocality'),
                'postalCode',      app.texto_publico(loc -> 'address' -> 'postalCode'),
                'addressRegion',   app.texto_publico(loc -> 'address' -> 'addressRegion'),
                'addressCountry',  app.texto_publico(loc -> 'address' -> 'addressCountry')
              ))
              else null
            end,
            'telephone',     app.texto_publico(loc -> 'telephone'),
            'opening_hours', app.texto_publico(loc -> 'opening_hours')
          )))
          from jsonb_array_elements(perfil -> 'locations') with ordinality as t(loc, i)
          where jsonb_typeof(loc) = 'object' and i <= 20
        )
        else null
      end,
      -- La carta: mismo criterio, tope de 200 (ver hallazgo 3).
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    app.texto_publico(item -> 'category'),
            'name',        app.texto_publico(item -> 'name'),
            'description', app.texto_publico(item -> 'description'),
            'price',       app.texto_publico(item -> 'price')
          )))
          from jsonb_array_elements(perfil -> 'menu') with ordinality as t(item, i)
          where jsonb_typeof(item) = 'object' and i <= 200
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

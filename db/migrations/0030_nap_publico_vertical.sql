-- =============================================================================
-- AMG OS — app.nap_publico gana un segundo parámetro: `vertical`
--
-- Hasta acá la allowlist no sabía nada del rubro del cliente. Con multi-vertical, dos cosas cambian:
--
--   1. Las claves restaurante-only de `menu` (`video`, `alergenos`, `etiquetas`, `nutricion`) SOLO se
--      exponen si `vertical = 'restauracion'` — aunque el jsonb las tuviera cargadas (un dato dormido
--      de una vertical incorrecta no debe filtrarse; hallazgo de la revisión de Codex al spec).
--   2. Nueva clave `seguros` (numeroLicencia, anosExperiencia, redAfiliacion), SOLO expuesta si
--      `vertical = 'correduria_seguros'`.
--
-- El resto de la allowlist (name, telephone, address, locations, brand, menu/menu_categorias con sus
-- claves base, bienvenida, destacados, testimonios, etc.) no cambia: es genérico para cualquier
-- vertical, como ya lo era.
--
-- Se REEMPLAZA `app.nap_publico` y se re-materializa la columna generada, porque una columna STORED no
-- se recalcula porque cambie la función. Mismo mecanismo que la 0009/0010/0014/0020/0023.
--
-- `app.nap_publico` sigue siendo SQL `immutable`, nunca fue `security definer` (corrección de un
-- error de caracterización en el spec de este subproyecto) — la frontera real de seguridad es el grant
-- de columna a `app_render`, que esta migración restaura como las anteriores.
-- =============================================================================

set lock_timeout = '5s';

-- La columna generada depende de app.nap_publico(jsonb): hay que soltarla A ELLA primero, o el DROP
-- FUNCTION de abajo falla con "cannot drop function ... because other objects depend on it". Mismo
-- motivo por el que las migraciones anteriores (0009/0010/0014/0020/0023) usaban CREATE OR REPLACE en
-- vez de DROP+CREATE: mantenían la firma. Acá la firma cambia (1 parámetro → 2), así que CREATE OR
-- REPLACE no alcanza — sería declarar una segunda función sobrecargada, no reemplazar la primera.
alter table clients drop column if exists business_profile_publico;

drop function if exists app.nap_publico(jsonb);

create function app.nap_publico(perfil jsonb, vertical app.vertical_cliente) returns jsonb
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
      'portada', app.foto_publica(perfil -> 'portada'),
      'fotos', case
        when jsonb_typeof(perfil -> 'fotos') = 'array' then (
          select jsonb_agg(app.foto_publica(f))
          from jsonb_array_elements(perfil -> 'fotos') with ordinality as t(f, i)
          where app.foto_publica(f) is not null and i <= 30
        )
        else null
      end,
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', app.texto_publico(perfil -> 'brand' -> 'color'),
          'font',  app.texto_publico(perfil -> 'brand' -> 'font'),
          'logo',  app.texto_publico(perfil -> 'brand' -> 'logo'),
          'plantilla', app.texto_publico(perfil -> 'brand' -> 'plantilla'),
          'colores', case
            when jsonb_typeof(perfil -> 'brand' -> 'colores') = 'object' then nullif(
              jsonb_strip_nulls(jsonb_build_object(
                'primario',   app.texto_publico(perfil -> 'brand' -> 'colores' -> 'primario'),
                'secundario', app.texto_publico(perfil -> 'brand' -> 'colores' -> 'secundario'),
                'titulo',     app.texto_publico(perfil -> 'brand' -> 'colores' -> 'titulo'),
                'texto',      app.texto_publico(perfil -> 'brand' -> 'colores' -> 'texto'),
                'fondo',      app.texto_publico(perfil -> 'brand' -> 'colores' -> 'fondo'),
                'fondoAlt',   app.texto_publico(perfil -> 'brand' -> 'colores' -> 'fondoAlt')
              )),
              '{}'::jsonb
            )
            else null
          end,
          'fuentes', case
            when jsonb_typeof(perfil -> 'brand' -> 'fuentes') = 'object' then nullif(
              jsonb_strip_nulls(jsonb_build_object(
                'titulo',     app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'titulo'),
                'texto',      app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'texto'),
                'decorativa', app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'decorativa')
              )),
              '{}'::jsonb
            )
            else null
          end
        ))
        else null
      end,
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
            'opening_hours', app.texto_publico(loc -> 'opening_hours'),
            'foto',          app.foto_publica(loc -> 'foto')
          )))
          from jsonb_array_elements(perfil -> 'locations') with ordinality as t(loc, i)
          where jsonb_typeof(loc) = 'object' and i <= 20
        )
        else null
      end,
      -- La carta/catálogo: tope 200. Las claves base (category/name/description/price/nota/foto/
      -- precios) valen para CUALQUIER vertical. video/alergenos/etiquetas/nutricion SOLO si
      -- `vertical = 'restauracion'` — es lo que cierra el hallazgo de "campos dormidos" de la revisión.
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    app.texto_publico(item -> 'category'),
            'name',        app.texto_publico(item -> 'name'),
            'description', app.texto_publico(item -> 'description'),
            'price',       app.texto_publico(item -> 'price'),
            'nota',        app.texto_publico(item -> 'nota'),
            'foto',        app.foto_publica(item -> 'foto'),
            'precios', case
              when jsonb_typeof(item -> 'precios') = 'array' then (
                select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'etiqueta',   app.texto_publico(p -> 'etiqueta'),
                  'importe',    app.texto_publico(p -> 'importe'),
                  'comensales', app.texto_publico(p -> 'comensales')
                )))
                from jsonb_array_elements(item -> 'precios') with ordinality as tp(p, i)
                where jsonb_typeof(p) = 'object'
                  and app.texto_publico(p -> 'etiqueta') is not null
                  and app.texto_publico(p -> 'importe')  is not null
                  and i <= 3
              )
              else null
            end,
            'video',     case when vertical = 'restauracion' then app.video_publico(item -> 'video') else null end,
            'alergenos', case when vertical = 'restauracion' then app.lista_texto_publica(item -> 'alergenos', 14) else null end,
            'etiquetas', case when vertical = 'restauracion' then app.lista_texto_publica(item -> 'etiquetas', 7) else null end,
            'nutricion', case
              when vertical = 'restauracion' and jsonb_typeof(item -> 'nutricion') = 'object' then nullif(
                jsonb_strip_nulls(jsonb_build_object(
                  'calorias',        app.numero_publico(item -> 'nutricion' -> 'calorias'),
                  'proteinas_g',     app.numero_publico(item -> 'nutricion' -> 'proteinas_g'),
                  'carbohidratos_g', app.numero_publico(item -> 'nutricion' -> 'carbohidratos_g'),
                  'grasas_g',        app.numero_publico(item -> 'nutricion' -> 'grasas_g')
                )),
                '{}'::jsonb
              )
              else null
            end
          )))
          from jsonb_array_elements(perfil -> 'menu') with ordinality as t(item, i)
          where jsonb_typeof(item) = 'object' and i <= 200
        )
        else null
      end,
      'menu_categorias', case
        when jsonb_typeof(perfil -> 'menu_categorias') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'nombre', app.texto_publico(cat -> 'nombre'),
            'foto',   app.foto_publica(cat -> 'foto'),
            'orden',  app.numero_publico(cat -> 'orden')
          )))
          from jsonb_array_elements(perfil -> 'menu_categorias') with ordinality as t(cat, i)
          where jsonb_typeof(cat) = 'object' and i <= 20
        )
        else null
      end,
      -- NUEVO: extensión de perfil de correduría de seguros. Mismo criterio que el resto — SOLO si la
      -- vertical corresponde, aunque el jsonb tuviera la clave cargada por error.
      'seguros', case
        when vertical = 'correduria_seguros' and jsonb_typeof(perfil -> 'seguros') = 'object' then nullif(
          jsonb_strip_nulls(jsonb_build_object(
            'numeroLicencia',   app.texto_publico(perfil -> 'seguros' -> 'numeroLicencia'),
            'anosExperiencia',  app.numero_publico(perfil -> 'seguros' -> 'anosExperiencia'),
            'redAfiliacion',    app.texto_publico(perfil -> 'seguros' -> 'redAfiliacion')
          )),
          '{}'::jsonb
        )
        else null
      end,
      'bienvenida', app.texto_publico(perfil -> 'bienvenida'),
      'destacados', case
        when jsonb_typeof(perfil -> 'destacados') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'titulo', app.texto_publico(d -> 'titulo'),
            'texto',  app.texto_publico(d -> 'texto')
          )))
          from jsonb_array_elements(perfil -> 'destacados') with ordinality as t(d, i)
          where jsonb_typeof(d) = 'object'
            and app.texto_publico(d -> 'titulo') is not null
            and i <= 6
        )
        else null
      end,
      'testimonios', case
        when jsonb_typeof(perfil -> 'testimonios') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'texto', app.texto_publico(t2 -> 'texto'),
            'autor', app.texto_publico(t2 -> 'autor')
          )))
          from jsonb_array_elements(perfil -> 'testimonios') with ordinality as t(t2, i)
          where jsonb_typeof(t2) = 'object'
            and app.texto_publico(t2 -> 'texto') is not null
            and i <= 12
        )
        else null
      end
    ))
  end
$$;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile, vertical)) stored;

comment on column clients.business_profile_publico is
  'Perfil publico del negocio (allowlist, por vertical): name, telephone, priceRange, url, image, '
  'opening_hours, address, brand, locations, menu/menu_categorias (video/alergenos/etiquetas/nutricion '
  'SOLO si vertical=restauracion), seguros (SOLO si vertical=correduria_seguros), portada, fotos, '
  'bienvenida, destacados y testimonios. Generada — nunca se escribe directo. Es lo UNICO que ve '
  'app_render. Ver 0008/0009/0010/0014/0020/0023/0030.';

grant select (business_profile_publico) on clients to app_render;

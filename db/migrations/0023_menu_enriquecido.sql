-- =============================================================================
-- AMG OS — El menú digital enriquecido, dentro de la allowlist
--
-- Cuatro campos nuevos por plato: `video`, `alergenos`, `etiquetas`, `nutricion`, y `comensales`
-- dentro de cada entrada de `precios`. Esta es la FRONTERA 2 de las cuatro que cruza un campo del
-- perfil para llegar al HTML (junto con el Zod de `web-builder/src/contract.ts`, `perfilValido` del
-- renderizador y el render). Un campo que falte acá no da error: no aparece — el mismo modo de fallo
-- silencioso que ya tuvieron `brand` (0009), `locations`/`menu` (0010) y las fotos (0014).
--
-- ## Lo que esta migración NO valida, y por qué
--
-- Igual que la 0014 y la 0020: acá se restringen NOMBRES de clave (`jsonb_build_object` enumera) y
-- FORMA de valor (`app.texto_publico` / `app.numero_publico` / string vs objeto vs array). El
-- CONTENIDO —¿es "gluten" uno de los 14 alérgenos reales?— lo validan las fronteras que emiten (el Zod
-- y `perfilValido`). Meter esa regla acá daría una falsa sensación de defensa y dejaría que alguien
-- quitara la de las otras dos creyendo que Postgres cubre.
--
-- Se REEMPLAZA `app.nap_publico` y se re-materializa la columna generada, porque una columna STORED
-- no se recalcula porque cambie la función. Mismo mecanismo que la 0009, la 0010, la 0014 y la 0020.
-- =============================================================================

set lock_timeout = '5s';

-- Un array de strings, con tope. La usan `alergenos` (14) y `etiquetas` (7): las dos son listas de
-- valores de una taxonomía fija, y el contenido —¿es un valor real de la taxonomía?— no lo valida
-- esta capa (ver cabecera). El tope corta sobre la POSICIÓN EN LA FUENTE, igual que los 200 platos de
-- la 0010: un elemento que no es string gasta su cupo igual, así que esta rama nunca depende de
-- cuánta basura traiga la ficha.
create or replace function app.lista_texto_publica(v jsonb, tope int) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'array' then (
      select jsonb_agg(app.texto_publico(el))
      from jsonb_array_elements(v) with ordinality as t(el, i)
      where jsonb_typeof(el) = 'string' and i <= tope
    )
    else null
  end
$$;

-- Un video: forma de objeto, `src` de texto y `poster` con la MISMA sub-allowlist que cualquier otra
-- foto (`app.foto_publica`, de la 0014). Sin `src` no hay video que mostrar — y la condición se pone
-- sobre la PRESENCIA de `src`, no sobre si el objeto resultante quedó vacío: un `nullif(…, '{}')`
-- después de `jsonb_strip_nulls` no alcanza, porque un `poster` sin `src` deja `{"poster": {...}}`,
-- que no es `'{}'` y sobrevive a medias (se midió al escribir esta migración: el test de "video sin
-- src" fallaba con el poster colgado solo).
create or replace function app.video_publico(v jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'object' and app.texto_publico(v -> 'src') is not null then
      jsonb_strip_nulls(jsonb_build_object(
        'src', app.texto_publico(v -> 'src'),
        'poster', app.foto_publica(v -> 'poster')
      ))
    else null
  end
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
      -- La carta: tope de 200 (0010). NUEVO en la 0023: `video`, `alergenos`, `etiquetas`,
      -- `nutricion`, y `comensales` dentro de `precios`.
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
            -- NUEVO (0023): el video del plato.
            'video', app.video_publico(item -> 'video'),
            -- NUEVO (0023): alérgenos y etiquetas, cada uno con el tope de SU taxonomía.
            'alergenos', app.lista_texto_publica(item -> 'alergenos', 14),
            'etiquetas', app.lista_texto_publica(item -> 'etiquetas', 7),
            -- NUEVO (0023): nutrición de la ración de referencia. `orden` de menu_categorias ya probó
            -- el patrón de un campo numérico (`app.numero_publico`, de la 0014).
            'nutricion', case
              when jsonb_typeof(item -> 'nutricion') = 'object' then nullif(
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

alter table clients drop column if exists business_profile_publico;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'Perfil publico del negocio (allowlist): name, telephone, priceRange, url, image, opening_hours, '
  'address, brand, locations (con foto), menu (con precios/comensales/nota/foto/video/alergenos/'
  'etiquetas/nutricion), menu_categorias, portada, fotos, bienvenida, destacados y testimonios. '
  'Generada — nunca se escribe directo. Es lo UNICO que ve app_render. Ver 0008/0009/0010/0014/0020/0023.';

-- ⚠️ `drop column` borra el grant de columna. Sin esto, app_render pierde el select y caen las webs
-- de todos los clientes a la vez (ya pasó en la 0009).
grant select (business_profile_publico) on clients to app_render;

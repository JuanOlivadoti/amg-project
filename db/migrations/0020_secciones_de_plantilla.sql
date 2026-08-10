-- =============================================================================
-- AMG OS — Las tres secciones de plantilla, dentro de la allowlist
--
-- El rediseño de la plantilla base (bloque K) replica del template de referencia tres secciones que
-- hasta ahora no tenían de dónde sacar el dato: la bienvenida, los motivos para venir y las reseñas.
-- Los campos son `bienvenida` (texto), `destacados` (lista) y `testimonios` (lista).
--
-- Esta es la FRONTERA 2 de las cuatro que cruza un campo del perfil para llegar al HTML. Las otras
-- tres son el Zod de `web-builder/src/contract.ts`, `perfilValido` en el renderizador, y el render.
-- Un campo que falte en una de las cuatro **no da error: no aparece** — el mismo modo de fallo
-- silencioso que ya tuvieron `brand` (0009), `locations`/`menu` (0010) y las fotos (0014).
--
-- Se REEMPLAZA `app.nap_publico` y se re-materializa la columna generada, porque una columna STORED
-- no se recalcula porque cambie la función. Mismo mecanismo que la 0009, la 0010 y la 0014.
--
-- ## Lo que esta migración NO valida, y por qué
--
-- Igual que la 0014: acá se restringen **NOMBRES de clave** (`jsonb_build_object` enumera) y **FORMA
-- de valor** (`app.texto_publico`). El CONTENIDO lo validan las fronteras que emiten. Meter reglas de
-- contenido acá daría una falsa sensación de defensa y dejaría que alguien quitara las de las otras
-- tres creyendo que Postgres cubre.
--
-- La excepción que sí es de esta capa: **no existe una clave de puntuación en `testimonios`**. Una
-- allowlist enumera, así que es acá donde queda impuesto que la web de un negocio no publique su
-- propia valoración numérica aunque alguien la escriba en `business_profile` a mano.
-- =============================================================================

-- Mismo criterio que la 0014: fallar rápido y visible en vez de colgar el despliegue con un lock.
set lock_timeout = '5s';

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
      -- NUEVO (0014): la foto del hero. Sin ella el hero es tipográfico, nunca un hueco.
      'portada', app.foto_publica(perfil -> 'portada'),
      -- NUEVO (0014): la galería, con tope de 30 aplicado sobre la FUENTE — mismo criterio que los
      -- 20 locales y los 200 platos de la 0010. Sin tope, un import mal hecho renderiza 50.000
      -- imágenes en cada visita fría, y no hace falta mala intención. El `is not null` del `where`
      -- descarta los elementos que no son fotos: `jsonb_agg` produciría `[null]` en su lugar.
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
          -- El LEGACY se conserva: todas las fichas sembradas hasta hoy tienen esta forma, y
          -- quitarla de la allowlist les cambiaría el aspecto de golpe a todas las webs publicadas.
          -- Cuál gana cuando vienen las dos formas lo decide el renderizador, no Postgres.
          'color', app.texto_publico(perfil -> 'brand' -> 'color'),
          'font',  app.texto_publico(perfil -> 'brand' -> 'font'),
          'logo',  app.texto_publico(perfil -> 'brand' -> 'logo'),
          -- NUEVO (0014): qué juego de recetas usa el sitio. Un valor desconocido cae a `base` en el
          -- renderizador; acá es un string más.
          'plantilla', app.texto_publico(perfil -> 'brand' -> 'plantilla'),
          -- NUEVO (0014): la paleta. Cada token termina literalmente dentro de un `<style>`, así que
          -- es la superficie de inyección más directa del sistema — pero ver la cabecera: quien
          -- valida que sea hex son las fronteras 1, 3 y 4. Acá se decide QUÉ SEIS claves existen.
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
          -- NUEVO (0014): los tres roles tipográficos. La ficha elige un NOMBRE de rol de una
          -- allowlist del código, nunca una familia ni un stack CSS — un stack en la ficha sería
          -- texto libre entrando a un `<style>`.
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
      -- Los locales: sub-allowlist propia y tope de 20 (0010). NUEVO en la 0014: `foto`.
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
      -- La carta: tope de 200 (0010). NUEVO en la 0014: `precios`, `nota` y `foto`.
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    app.texto_publico(item -> 'category'),
            'name',        app.texto_publico(item -> 'name'),
            'description', app.texto_publico(item -> 'description'),
            'price',       app.texto_publico(item -> 'price'),
            'nota',        app.texto_publico(item -> 'nota'),
            'foto',        app.foto_publica(item -> 'foto'),
            -- Varios importes del mismo plato ("Media" 9 €, "Ración" 15 €). Tope de 3: una carta con
            -- seis columnas de precio deja de ser legible.
            --
            -- Una entrada a la que le falte `etiqueta` o `importe` se descarta **ella sola**, no el
            -- plato: un dato mal cargado en el portal no puede borrar comida de la carta pública. Y
            -- el `i <= 3` va sobre la posición en la FUENTE, así que una entrada inválida gasta su
            -- cupo — es la misma semántica que el `where i <= 20` de los locales, y lo que garantiza
            -- que esta rama nunca dependa de cuántas entradas basura traiga la ficha.
            'precios', case
              when jsonb_typeof(item -> 'precios') = 'array' then (
                select jsonb_agg(jsonb_build_object(
                  'etiqueta', app.texto_publico(p -> 'etiqueta'),
                  'importe',  app.texto_publico(p -> 'importe')
                ))
                from jsonb_array_elements(item -> 'precios') with ordinality as tp(p, i)
                where jsonb_typeof(p) = 'object'
                  and app.texto_publico(p -> 'etiqueta') is not null
                  and app.texto_publico(p -> 'importe')  is not null
                  and i <= 3
              )
              else null
            end
          )))
          from jsonb_array_elements(perfil -> 'menu') with ordinality as t(item, i)
          where jsonb_typeof(item) = 'object' and i <= 200
        )
        else null
      end,
      -- NUEVO (0014): las categorías de la carta, con su foto. Tope de 20. Sin esto la carta se
      -- agrupa por el `category` de cada plato, como hasta ahora: un cliente que solo tiene la lista
      -- de platos conserva su carta entera.
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
      -- NUEVO (0020): el párrafo de bienvenida de la home. Texto y nada más — el titular de la
      -- sección lo pone el nombre del negocio, que ya está arriba en esta misma allowlist.
      'bienvenida', app.texto_publico(perfil -> 'bienvenida'),
      -- NUEVO (0020): los motivos para venir. Tope de 6, aplicado sobre la FUENTE igual que los 20
      -- locales y los 200 platos de la 0010: una entrada inválida gasta su cupo, así que esta rama
      -- nunca depende de cuánta basura traiga la ficha.
      --
      -- El `where` exige `titulo`: una entrada sin él no es un motivo a medias, es una tarjeta sin
      -- rótulo que el render tendría que decidir si dibujar. Mismo criterio que `precios`.
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
      -- NUEVO (0020): las reseñas. Tope de 12.
      --
      -- ⚠️ **`autor` es la ÚNICA clave que acompaña al texto, y que no haya una tercera es el punto.**
      -- Una allowlist enumera nombres de clave, así que es exactamente acá donde se decide que la web
      -- de un cliente no pueda publicar una puntuación: un `estrellas` en la ficha no llega al
      -- renderizador porque esta lista no lo nombra. La regla vive en `Testimonio` (types.ts) y en el
      -- Zod, pero esta es la capa que la sostiene cuando el dato entra a `business_profile` sin pasar
      -- por ninguno de los dos — que es el caso real, porque nadie valida un `jsonb` al escribirlo.
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

-- Re-materializar la columna generada: una columna STORED no se recalcula porque cambie la función.
alter table clients drop column if exists business_profile_publico;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'Perfil publico del negocio (allowlist): name, telephone, priceRange, url, image, opening_hours, '
  'address, brand (color/font/logo legacy + plantilla/colores/fuentes), locations (con foto), '
  'menu (con precios/nota/foto), menu_categorias, portada, fotos, bienvenida, destacados y '
  'testimonios. Generada — nunca se escribe directo. Es lo UNICO que ve app_render. '
  'Ver 0008/0009/0010/0014/0020.';

-- ⚠️ EL RIESGO REAL DE ESTA MIGRACIÓN, y es una sola línea: `drop column` **borra el grant de
-- columna**. Sin esto, `app_render` pierde el select sobre la columna pública y caen las webs de
-- todos los clientes a la vez. Ya pasó en la 0009 ("el grant se perdió al hacer drop column"). Lo
-- verifica un test conectando COMO app_render después de aplicar todas las migraciones: no basta con
-- que la línea esté escrita.
grant select (business_profile_publico) on clients to app_render;

-- =============================================================================
-- AMG OS — Las fotos, la carta con categorías y el manual de marca, dentro de la allowlist
--
-- Las plantillas de landing necesitan del `business_profile` tres bloques que hoy NO existen del lado
-- público: las fotos (`portada`, `fotos`, y una `foto` en cada local, plato y categoría), la carta
-- ampliada (`menu_categorias`, y `precios`/`nota` por plato) y el manual de marca
-- (`brand.plantilla`, `brand.colores`, `brand.fuentes`).
--
-- Pero el renderizador NO lee `business_profile` crudo: lee `business_profile_publico`, la columna
-- generada con allowlist que introdujo la 0008. Esa allowlist enumera claves explícitas, así que un
-- campo que no esté acá **no da error: no aparece** — el mismo modo de fallo silencioso que ya
-- tuvieron `brand` (0009) y `locations`/`menu` (0010). Esta es la FRONTERA 2 de las cuatro que tiene
-- que cruzar un campo del perfil para llegar al HTML
-- (`docs/superpowers/specs/2026-08-01-plantillas-landings-design.md`, §Las cuatro fronteras); las
-- otras tres son Zod en la puerta del web-builder, `perfilValido` en el renderizador, y el render.
--
-- Se REEMPLAZA `app.nap_publico` (mismo mecanismo que la 0009 y la 0010) y se re-materializa la
-- columna generada, porque una columna STORED no se recalcula porque cambie la función.
--
-- ## Numeración: por qué 0014 y no 0020
--
-- El número estaba RESERVADO para esta migración desde antes de que se escribieran la 0015-0019
-- (`docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` §4). Consecuencia medida, y es la
-- razón por la que hay un test dedicado: en una base NUEVA esta migración corre ANTES de la
-- 0015-0019 (orden alfabético, `db/src/migrate.ts`), y en una base ya desplegada corre DESPUÉS
-- (`migrarConRegistro` saltea las ya registradas, `db/src/deploy.ts`). Las dos cosas tienen que dar
-- el mismo esquema.
--
-- Es cierto: las cinco posteriores tocan `kr_pages`, `kr_informes` y `kr_runs`, y esta solo toca
-- `clients` y `app.nap_publico`. Pero eso hasta hoy estaba afirmado en un comentario de cada una de
-- ellas, y una garantía en un comentario es una intención. `db/src/fotos-publicas.test.ts` aplica las
-- migraciones sobre DOS bases —una con la 0014 en su sitio y otra con la 0014 al final— y exige que
-- el esquema, el grant y la proyección de la allowlist salgan idénticos.
--
-- ## Lo que esta migración NO valida, y por qué
--
-- No valida que un color sea hex, ni que un `src` sea https, ni que un host esté en la allowlist del
-- renderizador. La allowlist SQL restringe **NOMBRES de clave** (`jsonb_build_object` enumera) y
-- **FORMA de valor** (`app.texto_publico` / `app.numero_publico` / `app.foto_publica`) — las dos
-- hacen falta, es un hallazgo de revisión externa ya documentado en la 0010. El CONTENIDO lo validan
-- las fronteras 1, 3 y 4, que son las que emiten. Meter la validación de hex acá daría una falsa
-- sensación de defensa y dejaría que alguien quitara la de las otras tres creyendo que Postgres cubre.
-- =============================================================================

-- Barato, y evita que un lock inesperado sobre `clients` deje el despliegue colgado en vez de fallar
-- rápido y visible.
--
-- No es `set local`, y no es una preferencia de estilo: está MEDIDO (PGlite 16.4, 2026-08-08).
-- `aplicarMigraciones` ejecuta este archivo FUERA de una transacción, y ahí
-- `set local lock_timeout = '9s'` deja `current_setting('lock_timeout')` en `0` — no aplica nada, y
-- el lock_timeout sería pura decoración. Con `set` a secas queda puesto de verdad (`5s` al terminar
-- de migrar), y que persista en la sesión del despliegue para las migraciones siguientes es deseable,
-- no un efecto colateral. Lo fija un test, porque una línea que no hace nada no se distingue a ojo de
-- una que sí.
set lock_timeout = '5s';

-- `app.texto_publico` (0010) solo deja pasar strings, y `Foto` es un OBJETO: necesita su propia
-- sub-allowlist, igual que `address` y `brand`. Una foto que venga como string, como número o como
-- array sale **ausente** — nunca cruda y nunca a medias, que es lo que la frontera 3 espera.
--
-- El `nullif` contra `'{}'` es lo que convierte "objeto sin ninguna clave conocida" en ausencia: sin
-- él, `{"credito": "x"}` saldría como `{}` y el renderizador tendría que distinguir entre una foto
-- vacía y ninguna foto. No se exige `src` acá porque eso ya es contenido, no forma: descartar una
-- foto sin URL es trabajo de `perfilValido` (frontera 3), que es quien decide si se puede dibujar.
create or replace function app.foto_publica(v jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'object' then nullif(
      jsonb_strip_nulls(jsonb_build_object(
        'src', app.texto_publico(v -> 'src'),
        'alt', app.texto_publico(v -> 'alt')
      )),
      '{}'::jsonb
    )
    else null
  end
$$;

-- `menu_categorias[].orden` es el único campo NUMÉRICO de todo el perfil público. Pasarlo por
-- `app.texto_publico` lo mataría (solo sobrevive `jsonb_typeof = 'string'`), y dejarlo crudo con
-- `->` reabriría el agujero de forma que la 0010 cerró: un objeto escondido en un campo declarado
-- numérico pasaría intacto. Devuelve `jsonb` y no `numeric` para que el número viaje como número
-- hasta el JSON — casteando a texto, el portal recibiría "3" y un `>` empezaría a comparar strings.
create or replace function app.numero_publico(v jsonb) returns jsonb
language sql immutable as $$
  select case when jsonb_typeof(v) = 'number' then v else null end
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
  'menu (con precios/nota/foto), menu_categorias, portada y fotos. Generada — nunca se escribe '
  'directo. Es lo UNICO que ve app_render. Ver 0008/0009/0010/0014.';

-- ⚠️ EL RIESGO REAL DE ESTA MIGRACIÓN, y es una sola línea: `drop column` **borra el grant de
-- columna**. Sin esto, `app_render` pierde el select sobre la columna pública y caen las webs de
-- todos los clientes a la vez. Ya pasó en la 0009 ("el grant se perdió al hacer drop column"). Lo
-- verifica un test conectando COMO app_render después de aplicar todas las migraciones: no basta con
-- que la línea esté escrita.
grant select (business_profile_publico) on clients to app_render;

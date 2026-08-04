-- =============================================================================
-- AMG OS — 0015: el ORDEN del brief, persistido en una columna (KR-3)
--
-- ## Lo que se perdía en el viaje a Postgres
--
-- `kr-service` ordena las páginas propuestas en DOS niveles (`pipeline/cluster-map.ts`): primero la
-- evidencia —una página `sin_validar` no se presenta NUNCA por encima de una respaldada por datos de
-- mercado— y dentro de cada grupo por un score efectivo que pondera `score_confidence`. Ese orden
-- gobierna QUÉ PÁGINAS EXISTEN: el corte a `maxPages` es irreversible y ocurre dentro del pipeline.
--
-- Pero el orden no era un DATO: era la posición en un array. En cuanto el brief pasaba por acá,
-- `getRunPages` y `getPublishablePages` lo deshacían con `order by opportunity_score desc` — así que
-- la columna "Confianza" del portal no ordenaba nada, que era justo el motivo de la mejora.
--
-- La lección, más general que este caso: **cualquier criterio de orden que no esté persistido en una
-- columna se pierde al pasar por Postgres.** Esta columna es ese dato.
--
-- ## Por qué una columna, y no la fórmula repetida en SQL
--
-- La alternativa era duplicar el criterio (evidencia primero, después una expresión que pondere
-- `score_confidence`) en el `order by` de dos queries y otra vez en el portal: TRES fuentes de verdad
-- del mismo criterio, desincronizándose sin que ningún test lo vea — el modo de fallo que este repo
-- ya conoce. El orden lo decide quien tiene el contexto (el pipeline); la base lo TRANSPORTA.
--
-- ## `0` = primera
--
-- Es el índice del array `brief.paginas_propuestas`, no un ranking 1..N ni un peso. Se escribe desde
-- `PgStore.savePages`, que es el único punto por el que el brief entra a la base.
--
-- Las filas anteriores a esta migración (el seed ya sembrado, la base desplegada) quedan en NULL, y
-- eso es correcto: NULL = "esta fila se escribió cuando el orden no se guardaba". Por eso el
-- `order by` de las lecturas es `orden_brief asc nulls last, opportunity_score desc, url_slug asc`:
-- las viejas caen al final con el criterio anterior, y el desempate final es TOTAL (`url_slug` ya es
-- único por run). Un `order by` no determinista es un test intermitente esperando a pasar.
--
-- Precisión sobre `nulls last`, porque es fácil creer que hace más de lo que hace: **ya es el default
-- de Postgres para `asc`** (medido, no supuesto: `order by n asc` sobre `1, null, 0` da `0, 1, null`).
-- Está escrito explícito para no depender de un default, pero quitarlo NO cambia el resultado y no
-- tumba ningún test. Lo que sí lo tumba es `nulls first`. Ver el comentario de `ORDEN_DEL_BRIEF` en
-- `db/src/store.ts`.
--
-- ## Por qué NO lleva `unique (run_id, orden_brief)`
--
-- Parece la constraint natural del invariante "no hay dos páginas en la misma posición", y no está
-- por una razón medida, no por descuido: `savePages` reordena TODAS las páginas de un run en UNA sola
-- sentencia, y una permutación (la que estaba en 0 pasa a 1 y la de 1 a 0) viola un índice único NO
-- diferible a mitad de sentencia — Postgres lo comprueba fila por fila, no al final. Tenerlo exigiría
-- una constraint `deferrable` más un `set constraints`, y no compraría nada: las posiciones las
-- escribe una única sentencia desde el array del brief, y el `order by` de arriba es determinista
-- incluso si dos filas empataran.
--
-- Lo que SÍ podía producir una posición repetida o un hueco era un `url_slug` duplicado en el array del
-- brief: `update … from unnest(...)` matchea la misma fila dos veces y Postgres elige una de las dos
-- filas de origen sin garantizar cuál. Eso ya no llega hasta acá — `PgStore.savePages` rechaza el brief
-- entero antes de abrir transacción, con su test. Ver el comentario de la precondición en ese método.
--
-- ## Por qué tampoco lleva índice
--
-- Un run tiene decenas de páginas (la corrida real: 14). Ordenar eso en memoria es gratis; un índice
-- solo agregaría costo de escritura. `kr_pages (tenant_id, run_id)` de la 0001 ya acota el filtro.
--
-- ## Numeración: por qué 0015 y no 0014
--
-- La tabla de reserva de `docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` (§4) reserva
-- `0013_ideas.sql` (pieza 3 del portal) y `0014_fotos_publicas.sql` (spec de plantillas de landing).
-- Las dos están sin escribir, y las dos se ejecutan en otra rama/máquina: **un número libre en el
-- disco no es un número libre**, que es exactamente el error que ya pisó una vez la migración de
-- usuarios. Esta toma el primer número libre DESPUÉS de esa reserva.
--
-- No depende de ninguna de sus hermanas reservadas (toca solo `kr_pages`; la `0013` crea una tabla
-- nueva y la `0014` toca `app.nap_publico`), así que da igual en qué orden se apliquen — que es la
-- condición que el programa exige declarar antes de mergear.
-- =============================================================================

alter table kr_pages
  -- Sin `not null`: las filas que ya existen no tienen posición y no se les puede inventar una. Un
  -- default tampoco serviría —todas quedarían empatadas en el mismo puesto— y sería peor que NULL,
  -- porque mentiría en vez de declarar que no se sabe.
  add column if not exists orden_brief integer
    -- Una posición negativa no es un dato raro, es un dato roto. Se decide mirando UNA fila, así que
    -- va en un check. NULL pasa (es el estado legítimo de las filas viejas).
    check (orden_brief is null or orden_brief >= 0);

-- -----------------------------------------------------------------------------
-- Una página RETIRADA no tiene posición en el brief, y lo dice el ESQUEMA.
--
-- `PgStore.savePages` ya anula `orden_brief` en la misma sentencia que pone `retirada = true`, así que
-- el invariante se cumple hoy. Pero eso lo sostiene UN sitio del código: cualquier `update` futuro que
-- retire una página por otra vía —una purga, un endpoint de "descartar"— lo rompería sin que nada
-- avisara, y el síntoma sería una fila retirada ocupando el puesto de una página viva.
--
-- Va en un `check` porque se decide mirando UNA fila, igual que el `>= 0` de arriba. Con nombre, para
-- que el error diga qué invariante se violó y el test pueda exigirlo (23514 -> 400 en la API).
--
-- Se escribe aparte y no en el `add column` porque esa cláusula lleva `if not exists`: si la columna ya
-- existiera, el check se saltaría en silencio junto con ella.
-- -----------------------------------------------------------------------------
alter table kr_pages
  drop constraint if exists retirada_sin_posicion;

alter table kr_pages
  add constraint retirada_sin_posicion check (orden_brief is null or not retirada);

comment on column kr_pages.orden_brief is
  'Posicion de la pagina en el brief que produjo el M2 (0 = primera). Es el UNICO orden con el que '
  'se muestran las paginas de un run: el pipeline ordena por evidencia y despues por score_confidence, '
  'y ese criterio no se puede reconstruir desde opportunity_score. NULL = fila escrita antes de la '
  '0015 (se ordena al final, por opportunity_score). No es material: cambiar SOLO el orden NO revoca '
  'la aprobacion de la compuerta (ver PgStore.savePages).';

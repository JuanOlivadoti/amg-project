-- =============================================================================
-- AMG OS — Reconciliación de páginas y estado de publicación
--
-- ## El agujero: una página aprobada que YA NO EXISTE seguía siendo publicable
--
-- `savePages()` hacía upsert solo de las páginas presentes. Si una recalibración del clustering
-- hacía desaparecer una página, o le cambiaba el slug, **la fila vieja se quedaba en la base con su
-- aprobación intacta** — y `getPublishablePages()` la devolvía. Se publicaba una página que el
-- research ya no propone, aprobada para una versión anterior del brief.
--
-- ## El otro: `onFailure` podía marcar `failed` un run YA PUBLICADO
--
-- El estado del research y el de la publicación eran uno solo. Si Storyblok publicaba y la
-- respuesta se perdía, el reintento fallaba y `onFailure` ponía el run en `failed` — con las
-- páginas ya publicadas y visibles. El estado mentía sobre el mundo real.
-- =============================================================================

-- `published_at` y `storyblok_story_id` YA EXISTÍAN en 0001… y no los escribía nadie. Estaban ahí
-- desde el principio, vacías, mientras el estado de publicación se deducía del estado del run — que
-- es justo lo que causaba el bug. Ahora se usan.
alter table kr_pages
  -- La página ya no la propone el research actual. No se borra (es evidencia de lo que se pagó y de
  -- lo que alguien aprobó en su momento), pero deja de ser publicable.
  add column retirada boolean not null default false,

  -- Estrategia de la página (`single`, `hub`, `spoke`). El M2 la calcula y la capa de datos la
  -- TIRABA: se perdía en el viaje a la base y el brief reconstruido no la llevaba.
  add column page_strategy text;

-- Las publicables: aprobadas, del run aprobado, y NO retiradas.
create index on kr_pages (run_id) where approved and not retirada;

comment on column kr_pages.retirada is
  'La pagina ya no la propone el research actual (cambio el slug, o el clustering la disolvio). '
  'Conserva la fila como evidencia, pero deja de ser publicable aunque estuviera aprobada.';

comment on column kr_pages.published_at is
  'Cuando se publico de verdad. Separa el estado de PUBLICACION del estado del research: un fallo '
  'del workflow no puede marcar failed algo que ya existe en Storyblok.';

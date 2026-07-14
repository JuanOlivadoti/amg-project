-- 0006 — El destino de publicación vive en el CLIENTE, no en una variable de entorno.
--
-- El agujero que cierra esto (review 5, HIGH #1):
--
--   `clients.storyblok_space_id` existía desde 0001 y NO LO LEÍA NADIE. Todas las publicaciones
--   usaban el único `STORYBLOK_SPACE_ID` del proceso. Con dos clientes en el mismo space, dos
--   páginas con el mismo slug (`/menu`, `/contacto` — o sea, TODAS) colisionan:
--
--     1. el cliente B ya tiene `/menu` en el space global
--     2. el cliente A aprueba su propia `/menu`
--     3. findStoryId("/menu") encuentra la story de B
--     4. updateStory() la PISA con el contenido de A
--
--   El aislamiento entre tenants estaba impecable en Postgres y se perdía al salir por la puerta:
--   la fuga no era de lectura, era de ESCRITURA, y en el sistema de otro.
--
-- Lo mismo pasaba con el perfil del negocio (NAP: nombre, dirección, teléfono), que salía de un
-- `BUSINESS_PROFILE_PATH` global: el JSON-LD de todos los clientes llevaba los datos del mismo
-- restaurante. Ahora el perfil es del cliente y se lee BAJO RLS, así que un tenant no puede ni
-- nombrar el destino de otro.

alter table clients
  add column if not exists business_profile jsonb;

comment on column clients.storyblok_space_id is
  'Space de Storyblok de ESTE cliente (ADR-04: uno por cliente → offboarding limpio, ADR-11). '
  'Sin él NO se publica: es preferible detenerse a escribir en el space de otro.';

comment on column clients.business_profile is
  'Perfil NAP del negocio (nombre, dirección, teléfono, horario) → enriquece el JSON-LD. '
  'Antes salía de un archivo global y todos los clientes compartían los datos del mismo negocio.';

-- ---------------------------------------------------------------------------------------------
-- La compuerta de ADR-06 dice "revisa Y EDITA". Lo de editar NO EXISTÍA: solo aprobar o rechazar.
--
-- Si una página estaba casi bien, la única salida era tirarla — y volver a pagar un research.
-- Ahora se puede corregir el slug, la keyword, el SEO y el brief de contenido antes de aprobar.
--
-- Editar REVOCA la aprobación (lo hace `PgStore.editPage`). La compuerta certifica que un humano
-- miró ESTO; si `esto` cambió después, la certificación no vale nada. Estas dos columnas dejan el
-- rastro de quién tocó qué, que es lo que hace auditable la revocación.

alter table kr_pages
  add column if not exists edited_by uuid,
  add column if not exists edited_at timestamptz;

comment on column kr_pages.edited_by is
  'Quién editó la página por última vez. Editar pone approved=false: ver PgStore.editPage.';

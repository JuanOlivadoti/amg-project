-- =============================================================================
-- AMG OS — 0028: ClientRow expone archived_at
--
-- Task 2 de desacoplar-kr-web: ClientRow (la interfaz que devuelve getClient)
-- ahora incluye archived_at para que Task 6 (workflowDecision) pueda abortar la
-- publicación si el cliente fue archivado.
--
-- La columna archived_at existe desde la 0001; la FK de 0022 no la cubre:
-- se le pasó a app_service EXACTAMENTE id, nombre, storyblok_space_id, business_profile.
-- Ahora que getClient() la necesita, extendemos el grant.
-- =============================================================================

grant select (archived_at) on clients to app_service;

-- =============================================================================
-- AMG OS — clients.vertical: el rubro del cliente (restauración, correduría de seguros)
--
-- Deliberadamente NO es la columna `tipo` que ya existe (0011_clientes_crm.sql): esa es clasificación
-- CRM de forma jurídica/comercial (empresa/autonomo/particular), enmascarada al rol `cliente` y
-- editable. `vertical` es un atributo de PRODUCTO — determina qué campos de perfil, qué catálogo y qué
-- plantilla de render tiene el cliente — y el rol `cliente` lo necesita sin enmascarar para que su
-- propio portal sepa qué mostrarle.
--
-- Sin default a propósito, mismo criterio que PIPELINE_MODO: una vertical que cae en un valor por
-- omisión es una decisión sin dueño. Backfill EXPLÍCITO para los clientes existentes (todos
-- restaurantes hoy) antes de exigir NOT NULL.
--
-- INMUTABLE tras el alta: no entra a COLUMNAS_EDITABLES (db/src/clientes.ts) ni al tipo CambiosCliente
-- — ver Task 3. Es la forma más simple de que cambiar la vertical de un cliente ya publicado no pueda
-- exponer campos dormidos del otro rubro a través de la allowlist (app.nap_publico, Task 2): si el
-- cambio no existe, no hace falta modelar una transición validada.
-- =============================================================================

set lock_timeout = '5s';

create type app.vertical_cliente as enum ('restauracion', 'correduria_seguros');

alter table clients add column vertical app.vertical_cliente;

-- Backfill explícito, no inferido: todos los clientes de hoy son restaurantes.
update clients set vertical = 'restauracion' where vertical is null;

alter table clients alter column vertical set not null;

-- app_service (orquestador) y app_render (renderizador público) tienen grants de columna CERRADOS
-- desde 0022/0007 — agregar una columna a la tabla no la suma a un grant ya angosto. Sin esto, Task 4
-- (ClientRow.vertical bajo app_service) y Task 5 (Sitio.vertical bajo app_render) fallan en runtime
-- con "permission denied for table clients", un error que PGlite con rol superusuario NO reproduce —
-- por eso el test del Step 2 corre explícitamente `set local role`.
grant select (vertical) on clients to app_service, app_render;

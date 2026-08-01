-- =============================================================================
-- AMG OS — Etapa 1 del CRM de clientes: el esquema (SOLO Postgres, nada de API/Angular)
--
-- Puerta al portar la gestión de clientes del Angular viejo (Firestore) a este sistema. Antes de
-- agregar una sola columna, tres unificaciones deliberadas para no duplicar lo que YA existe:
--
--   1. `branches` del dashboard viejo ES `business_profile.locations`. La 0010 ya expone
--      `locations` en la allowlist pública y el renderizador ya las sirve (footer NAP, `/menu`).
--      NO se crea una tabla `branches`.
--   2. `status: activo|inactivo` ES `archived_at` (existe desde la 0001). `archived_at is null` =
--      activo. NO se agrega una columna `status` redundante.
--   3. `assignedTo` referencia `memberships.user_id`, no un string libre: FK COMPUESTA
--      `(tenant_id, asignado_a) → memberships (tenant_id, user_id)`, el mismo mecanismo que ya usa
--      `kr_runs` para no poder referenciar datos de otro tenant (ver 0001, comentario de esa FK).
--      `memberships` ya tiene `unique (tenant_id, user_id)` — no hace falta agregar nada ahí.
--
-- ⛔ RESTRICCIÓN DE SEGURIDAD QUE DOMINA EL DISEÑO (ADR-19): estas columnas son datos INTERNOS de
-- la agencia (teléfono/email de contacto, notas, estado del contrato, scoring, quién lleva la
-- cuenta). Esta migración NO toca `app.nap_publico`, NO re-materializa `business_profile_publico`
-- y NO concede ningún grant nuevo a `app_render` — el rol más expuesto del sistema no gana ni una
-- columna con esta pieza. El aislamiento lo da, simplemente, que estas columnas nunca aparecen en
-- el grant por-columna de `app_render` (0007/0008), que sigue siendo
-- `select (business_profile_publico)` a secas.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columna vs. jsonb: lo que se filtra/ordena/indexa va en columna; lo de forma libre que solo se
-- MUESTRA (emails, teléfonos, persona de contacto, redes, Google Maps/Places, notas, logo, portada)
-- va en `contacto jsonb`. Mezclar los dos criterios en columnas sueltas habría hecho crecer el
-- esquema cada vez que la agencia quisiera guardar un dato de contacto más.
-- -----------------------------------------------------------------------------
alter table clients
  add column tipo text
    check (tipo is null or tipo in ('empresa', 'autonomo', 'particular')),
  add column industria text,
  -- `not null default '{}'`: un cliente sin etiquetas es el caso normal al darlo de alta, no un
  -- dato faltante. Un array vacío, no NULL, evita que cada lectura tenga que hacer coalesce.
  add column etiquetas text[] not null default '{}',
  add column nivel_actividad text
    check (nivel_actividad is null or nivel_actividad in ('bajo', 'medio', 'alto')),
  -- `sin_contrato` por default: el alta de un cliente nuevo no implica que ya haya contrato firmado.
  add column estado_contrato text not null default 'sin_contrato'
    check (estado_contrato in ('sin_contrato', 'vigente', 'vencido')),
  add column contrato_vence_en date,
  -- El rango se impone en la base, no confiando en que la API valide antes de escribir: un score
  -- fuera de 0–100 no es un dato raro, es un dato roto.
  add column score int
    check (score is null or score between 0 and 100),
  -- Sin `not null`: un cliente puede no tener a nadie asignado todavía. La integridad de A QUIÉN
  -- apunta (nunca a un usuario de otro tenant) la da la FK compuesta de abajo, no esta columna sola.
  add column asignado_a uuid,
  -- `check (jsonb_typeof = 'object')`: la allowlist del renderizador restringe qué NOMBRES de clave
  -- salen; esto restringe la FORMA de lo que entra. Son dos garantías distintas y las dos hacen
  -- falta (lección de una review externa anterior en este proyecto — ver 0009/0010, `texto_publico`
  -- vs. la allowlist de claves). Sin este check, `contacto` podría guardar un array o un string
  -- suelto y romper a cualquier lector que asuma un objeto.
  add column contacto jsonb not null default '{}'::jsonb
    check (jsonb_typeof(contacto) = 'object'),
  add column origen text;

comment on column clients.tipo is
  'empresa | autonomo | particular. Del CRM portado del Angular viejo (Firestore).';
comment on column clients.etiquetas is
  'Etiquetas libres del CRM. Array, no jsonb: se filtra y se busca por elemento.';
comment on column clients.estado_contrato is
  'sin_contrato | vigente | vencido. Reemplaza el "status" del dashboard viejo, que en realidad '
  'siempre fue archived_at (activo/inactivo) mezclado con esto — son dos preguntas distintas.';
comment on column clients.score is
  'Scoring 0-100 del CRM. El rango lo impone la base: un valor fuera de rango es un dato roto, no '
  'uno raro.';
comment on column clients.asignado_a is
  'Quién de la agencia lleva la cuenta. Referencia memberships.user_id (FK compuesta con '
  'tenant_id) — NO un string libre como en el Angular viejo (`assignedTo`).';
comment on column clients.contacto is
  'Datos de contacto de forma libre (emails, teléfonos, persona de contacto, redes sociales, '
  'Google Maps/Places, notas, logo, portada): se MUESTRAN, no se filtran ni se ordenan por ellos. '
  'Es interno — NUNCA entra en business_profile_publico (ver cabecera del archivo).';

-- -----------------------------------------------------------------------------
-- FK compuesta: `asignado_a` no puede apuntar a un usuario de OTRO tenant.
--
-- Mismo mecanismo que la FK de kr_runs → clients (0001): RLS controla QUIÉN VE QUÉ FILA, no la
-- integridad de las referencias entre tablas. Sin esta FK, un tenant podría asignar un cliente a un
-- user_id que en realidad es miembro de la agencia de al lado — un dato roto que además, mezclado
-- con cualquier futura lectura que haga JOIN a memberships sin filtrar tenant, podría filtrar cross-
-- tenant qué usuario "lleva" cada cuenta.
--
-- `on delete set null`: si la membresía de quien está asignado desaparece, el cliente queda sin
-- asignar, no bloquea el delete de la membresía ni arrastra al cliente con ella.
-- -----------------------------------------------------------------------------
alter table clients
  add constraint clients_asignado_a_del_mismo_tenant
  foreign key (tenant_id, asignado_a) references memberships (tenant_id, user_id)
  on delete set null;

-- -----------------------------------------------------------------------------
-- Índices para lo que la tabla filtra (no para lo que solo se muestra).
-- -----------------------------------------------------------------------------
create index on clients (tenant_id, estado_contrato);
create index on clients (tenant_id, asignado_a);

-- NADA MÁS. Ningún grant a app_render, ningún cambio en app.nap_publico ni en
-- business_profile_publico — ver la cabecera de este archivo.

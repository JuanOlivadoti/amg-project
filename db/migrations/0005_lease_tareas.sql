-- =============================================================================
-- AMG OS — Lease en el registro de tareas: el doble cobro concurrente
--
-- ## El agujero (medido, no teórico)
--
-- `reservar()` abría transacción, insertaba `pending`, y **hacía COMMIT antes de que el POST
-- saliera**. Dos procesos concurrentes con la misma petición:
--
--   1. A crea `pending`, commitea, empieza el POST.
--   2. B ve `pending`, lo declara "huérfano" al instante… y empieza OTRO POST.
--   3. Los dos cobran.
--
-- El test que escribí comprobaba "solo una reserva es `nueva`". Era cierto — y era irrelevante: la
-- otra salía `huerfana`, **y `huerfana` también autoriza gastar**. El test pasaba con el bug dentro.
-- Medido: de 2 reservas simultáneas, 2 autorizaban el POST.
--
-- ## El arreglo
--
-- Una reserva viva es un LEASE con vencimiento. Mientras no venza, la petición está `en_progreso`:
-- el segundo proceso espera el resultado del primero, no paga otra vez. Solo cuando el lease vence
-- (el proceso murió de verdad) se considera huérfana.
--
-- Y `completar`/`fallar` van con CAS por `attempt_id`: una respuesta TARDÍA del intento 1 no puede
-- pisar el resultado del intento 2.
-- =============================================================================

alter table kr_provider_tasks
  -- Quién tiene la reserva ahora. Cambia con cada intento: es el token del CAS.
  add column attempt_id  uuid not null default gen_random_uuid(),
  -- Hasta cuándo se le cree al que la tiene. Vencido esto, asumimos que el proceso murió.
  add column lease_until timestamptz;

comment on column kr_provider_tasks.attempt_id is
  'Token del intento en curso. completar()/fallar() hacen CAS contra el: una respuesta tardia del '
  'intento anterior NO puede pisar el resultado del actual.';

comment on column kr_provider_tasks.lease_until is
  'Vencimiento del lease. Mientras no venza, la peticion esta EN PROGRESO y otro proceso debe '
  'esperar, no volver a pagarla. Solo al vencer se considera huerfana (= el proceso murio y pudo '
  'haber cobrado).';

create index on kr_provider_tasks (status, lease_until);

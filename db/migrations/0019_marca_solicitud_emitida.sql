-- =============================================================================
-- AMG OS — 0019: un run solo se puede aprobar si alguien está esperando la aprobación
--
-- ## El bug que esto cierra, y es alcanzable en producción HOY
--
-- La compuerta humana es un `paso.esperarEvento("research/aprobado")` **dentro** del workflow
-- (`orchestrator/src/workflow.ts`), y el workflow lo dispara `research/solicitado`. **No hay ningún
-- listener suelto de `research/aprobado`**: si nadie está durmiendo sobre ese run, el evento se emite
-- y no lo consume nadie.
--
-- Un run que se insertó DIRECTO en la base —`sembrarDemo`, una importación, un `insert` a mano—
-- nunca tuvo un workflow durmiendo sobre él. `approveRun` imponía dos condiciones (al menos una
-- página aprobada, y que el `update` tocara fila) y **ninguna sobre eso**: aprobarlo dejaba el run en
-- `approved` para siempre, la API devolvía 200, y no se publicaba nada. Un botón que parece funcionar
-- y no hace nada es peor que no tenerlo.
--
-- Hasta el 2026-08-07 no mordía porque el flag del portal estaba apagado. Se encendió, y el run
-- sembrado de la demo está en `pending_approval` en producción. Lo encontró la 15ª review externa
-- (bloque C0 del plan).
--
-- ## Por qué una columna y no preguntarle a Inngest
--
-- Preguntarle al proveedor en el momento de aprobar metería un tercero en el camino de la
-- aprobación: una caída de Inngest impediría aprobar algo que ya está en NUESTRA base, y una
-- respuesta ambigua (¿reintentando? ¿archivado?) habría que interpretarla. **El dato tiene que ser
-- nuestro**, y el hecho que hay que registrar es exactamente uno: *la API consiguió emitir
-- `research/solicitado` para este run*. Eso lo sabe la API y nadie más.
--
-- El orden de ADR-18 se mantiene y se EXTIENDE: **fila → evento → marca**. La marca se escribe
-- después de que `send()` haya tenido éxito (`api/src/solicitar.ts`), nunca antes: si se escribiera
-- primero, un `send()` fallido dejaría un run marcado como "tiene workflow" sin tenerlo — o sea, el
-- mismo bug con más pasos.
--
-- ## Nullable A PROPÓSITO, y sin relleno
--
-- Las filas que ya existen en producción se insertaron sin esta columna y **tienen que quedar
-- nulas**: eso es la verdad sobre ellas. Rellenarlas con `now()` o con `created_at` convertiría en
-- publicable, en silencio, exactamente lo que esta migración existe para frenar.
--
-- Y por eso tampoco lleva `not null` con default: un default haría que cualquier `insert` futuro
-- —incluido el del seed— naciera marcado, que es el mismo relleno disfrazado de esquema. Que un run
-- sembrado la deje nula **por construcción**, sin que nadie tenga que acordarse de nada en el seed,
-- es justamente la propiedad que se busca.
--
-- ## Dónde queda impuesta la garantía, para no confundirla con lo que hace este archivo
--
-- Esta columna es el DATO. La regla ("no se aprueba sin marca") la impone `PgStore.approveRun`
-- (`db/src/store.ts`), que lanza `RunSinWorkflowError` y la API traduce a 409 `RUN_SIN_WORKFLOW`.
-- No es un `check`: no se puede decidir mirando la fila de `kr_runs` en el momento del `update`
-- sin bloquear también el `rejected`, el `failed` y el barrido, que sí tienen que poder mover un run
-- sin marca. El invariante es de UNA transición (`→ approved`), no del estado de la fila.
--
-- ## Grants: no hay ninguno que tocar, y eso hay que comprobarlo, no suponerlo
--
--   · `app_user` y `app_service` tienen `grant select, insert, update, delete on kr_runs` a nivel de
--     TABLA (0001:413, 0002:93), y un grant de tabla cubre las columnas que se agreguen después.
--   · `app_barrido` los tiene **por columna** (0018:86-87) y esta columna NO entra: el barrido marca
--     `failed` runs colgados y no tiene nada que hacer con la marca de solicitud.
--   · `app_render` no tiene ningún grant sobre `kr_runs` (0007:35, explícito).
--
-- ## Numeración: por qué 0019
--
-- `0013_ideas.sql` y `0014_fotos_publicas.sql` siguen RESERVADAS y sin escribir, en ramas que corren
-- en otra máquina (`docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` §4): un número
-- libre en el disco no es un número libre. Ésta toma el primero libre después de la 0018.
--
-- No depende de ninguna de sus hermanas reservadas: agrega UNA columna a `kr_runs`, mientras la 0013
-- crea una tabla nueva y la 0014 toca `app.nap_publico`. Da igual en qué orden se apliquen — que es
-- la condición que el programa exige declarar antes de mergear.
-- =============================================================================

-- `if not exists` para que la migración sea re-ejecutable sobre una base que ya la tenga (mismo
-- criterio que el `drop constraint if exists` de la 0017 y el `create index if not exists` de la 0018).
alter table kr_runs add column if not exists solicitud_emitida_at timestamptz;

comment on column kr_runs.solicitud_emitida_at is
  'Cuando la API consiguio emitir research/solicitado para este run: la unica prueba, y nuestra, de que '
  'hay una ejecucion durable esperando el evento research/aprobado. La escribe la API DESPUES del send() '
  'exitoso (fila -> evento -> marca, ADR-18 extendido); si el send() falla no se escribe y el run se '
  'marca failed ahi mismo. NULL = el run se inserto directo en la base (seed, importacion, insert a mano) '
  'y NADIE esta durmiendo sobre el: approveRun se niega con RunSinWorkflowError y la API responde 409 '
  'RUN_SIN_WORKFLOW. Nullable y sin relleno a proposito: las filas viejas tienen que quedar nulas, que es '
  'la verdad sobre ellas (migracion 0019).';

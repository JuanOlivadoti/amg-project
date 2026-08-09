-- =============================================================================
-- AMG OS — Pieza 3 del portal: el módulo de IDEAS (Etapa 1, SOLO Postgres)
--
-- Una "idea" es un audio que el dueño del restaurante le manda a la agencia por WhatsApp: alguien lo
-- transcribe, un LLM lo analiza, y la agencia lo revisa y decide. O sea que esta tabla guarda **la
-- voz de un cliente real y lo que un modelo dedujo de ella** — el dato más sensible que va a haber en
-- este esquema después de las credenciales.
--
-- Plan: docs/superpowers/plans/2026-08-01-modulo-ideas-portal.md (con la enmienda del 2026-08-02).
--
-- ⛔ TRES RESTRICCIONES QUE DOMINAN EL DISEÑO
--
--   1. **ADR-19 — nada de esto llega al renderizador.** Esta migración NO toca `app.nap_publico`, NO
--      re-materializa `business_profile_publico` y **NO concede un solo grant a `app_render`**. Una
--      transcripción es material interno de la agencia; el rol expuesto a internet anónimo no gana ni
--      una columna con esta pieza. El test que lo fija exige `permission denied` (fallo de ACL) y no
--      "cero filas": con `force row level security` y sin policy para `app_render`, un `select`
--      devuelve cero filas AUNQUE exista el grant, así que un test que mirara el conteo no podría
--      fallar nunca.
--
--   2. **ADR-20 — la agencia revisa, el cliente no.** Los permisos van por VERBO, no por
--      visibilidad: que un rol `cliente` VEA su idea no implica que pueda editarla, aprobarla ni
--      rechazarla. Un `grant` amplio con una policy de solo `using` habría dejado exactamente eso
--      abierto (lo encontró una revisión externa del plan, 2026-08-02). Ver el bloque de GRANTS.
--
--   3. **ADR-15/ADR-17 — la autorización vive acá, no en TypeScript.** `app.ve_cliente()` y
--      `app.puede_escribir()` son las mismas funciones que ya usan `clients`, `kr_runs` y sus hijos:
--      derivan el rol de `memberships` dentro de Postgres. La capa de datos (`db/src/ideas.ts`) no
--      decide nada.
--
-- 📌 INDEPENDENCIA DE ORDEN (lo pide el programa del portal, §4). El número 0013 estaba RESERVADO
-- para esta pieza, pero se escribe cuando la 0014-0019 ya están aplicadas en producción: en una base
-- nueva esta migración corre en su sitio (entre la 0012 y la 0014) y en producción correrá al final.
-- Es indiferente, y se puede afirmar: esta migración solo CREA un tipo, una tabla, dos funciones y
-- sus triggers; no altera ninguna tabla, función, política ni grant preexistente. Lo único que
-- consume del pasado son piezas ≤ 0012 (`clients (id, tenant_id)` de la 0001, `app.ve_cliente` /
-- `app.puede_escribir` de la 0001, `app.current_tenant_id` de la 0001, el rol `app_user` de la 0001)
-- y ninguna de la 0014-0019 toca `ideas`, que hasta hoy no existía.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El estado es una MÁQUINA, no un texto libre
--
-- `nueva → en_revision → aprobada | rechazada`. Va como enum de Postgres y no como `text` porque un
-- `text` acepta 'aprovada' y nadie se entera hasta que la pantalla filtre por 'aprobada' y no
-- encuentre nada. El typo no da error: da una idea invisible.
--
-- El ORDEN de los valores del enum es el del ciclo de vida a propósito: `order by estado` ordena por
-- posición en el enum, no alfabéticamente, así que un listado agrupado por estado sale en el orden
-- en que la agencia trabaja y no en el que caiga.
-- -----------------------------------------------------------------------------
create type idea_estado as enum ('nueva', 'en_revision', 'aprobada', 'rechazada');

comment on type idea_estado is
  'Ciclo de vida de una idea: nueva → en_revision → aprobada | rechazada. Las transiciones válidas '
  'las impone el trigger ideas_transicion_estado, no la aplicación.';

-- -----------------------------------------------------------------------------
-- La tabla
--
-- COLUMNA vs. JSONB, el mismo criterio que en `clients` (0011): columna para lo que se filtra y
-- ordena (`estado`, `client_id`, `titulo`, `creada_en`), `jsonb` para el bloque que produce el LLM y
-- que solo se MUESTRA. La tabla de ideas filtra por estado y por cliente; el análisis no se filtra
-- nunca.
--
-- Todos los campos que produce hoy el flujo de n8n tienen su sitio aunque el portal todavía no los
-- escriba (transcripción, análisis, checklist, ideas complementarias): el hueco del ingreso real
-- queda preparado para no tener que rehacer la tabla cuando se conecte.
--
-- `audio_url` / `carpeta_url` son URLs a donde el audio YA vive. AMG OS no tiene storage y esta pieza
-- no lo inventa: no se sube nada.
-- -----------------------------------------------------------------------------
create table ideas (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  -- Sin FK simple a `clients(id)`: la ata la FK COMPUESTA de abajo, que además impide que apunte a
  -- un cliente de otro tenant. Mismo patrón que `kr_keywords`/`kr_pages` (0001).
  client_id      uuid not null,

  titulo         text not null,
  resumen        text,
  -- El default de PRODUCCIÓN: una idea que entra por el flujo de audio nace en `nueva`. Tiene su
  -- propio test, que inserta SIN estado (si el test lo pasara como parámetro, estaría fijando el
  -- valor que elige el test, no el que corre en producción).
  estado         idea_estado not null default 'nueva',

  -- Lo que dijo el cliente, tal cual salió del audio. Es una SUPERFICIE DE INYECCIÓN: llega con lo
  -- que sea. Se guarda como texto y se renderiza como texto (nunca como HTML); si algún día
  -- alimentara al renderizador, pasa por `esc()` como todo lo demás.
  transcripcion  text,
  audio_url      text,
  carpeta_url    text,
  -- Quién mandó el audio (el nombre de WhatsApp, normalmente). No es un `user_id`: la persona que
  -- graba un audio no tiene por qué tener cuenta en el portal.
  mensaje_de     text,

  -- El bloque del LLM: audiencia_objetivo, canales_comunicacion, intencion, materiales_formatos,
  -- observaciones, checklist_interpretacion, ideas_complementarias, tipo_accion.
  --
  -- El `check` restringe la FORMA del valor, no el nombre de las claves — son dos garantías distintas
  -- y esta es la barata (misma lección que `clients.contacto` en la 0011). Sin él, `analisis` podría
  -- guardar un array o un string suelto y romper a cualquier lector que asuma un objeto.
  analisis       jsonb not null default '{}'::jsonb
                   check (jsonb_typeof(analisis) = 'object'),

  creada_en      timestamptz not null default now(),
  -- La mantiene el trigger `ideas_actualizada_en`, no el llamador: una marca de tiempo que hay que
  -- acordarse de escribir es una marca de tiempo que algún camino va a olvidar.
  actualizada_en timestamptz not null default now(),

  /*
   * FK COMPUESTA — RLS controla QUÉ FILAS VES; la integridad entre tablas la controla esto.
   *
   * La política de `ideas` comprueba `tenant_id = mi tenant`. Sin esta FK, nada impediría crear una
   * idea marcada como del tenant propio pero apuntando al `client_id` de OTRO tenant: la fila pasa el
   * `with check` (el tenant_id es correcto) y queda referenciando datos ajenos. Mismo mecanismo que
   * usa `kr_runs` desde la 0001 — ver el comentario largo de esa FK.
   */
  foreign key (client_id, tenant_id) references clients (id, tenant_id) on delete cascade,

  /*
   * TOPES DE TAMAÑO, en la base y no en un comentario.
   *
   * Van acá y no en el endpoint por el mismo motivo que los escribió `0016_informe_kr.sql:50-56`:
   * **ésta es la tabla y éste es el único punto de escritura**. Con las constraints puestas, ni el
   * endpoint de la Etapa 3 ni la pantalla necesitan lógica de tamaño — no pueden recibir algo que no
   * entró. Y van AHORA porque la 0013 todavía no está aplicada en ningún lado: después haría falta
   * una migración nueva con todo su ceremonial.
   *
   * `octet_length` y no `length`: el techo se mide en BYTES. Con `length`, 200 caracteres acentuados
   * serían 400 bytes y la fila ocuparía el doble de lo previsto. Hay un test que lo fija con 'ñ'.
   *
   * DE DÓNDE SALE CADA NÚMERO (elegidos acá, no por el plan — son revisables mientras la 0013 no se
   * aplique, y cambiarlos después es una migración):
   *
   *   · `transcripcion` 64 KiB — es el único que se calculó sobre el dato real. Se habla a ~150
   *     palabras por minuto y una palabra española con su espacio ronda los 6 bytes en UTF-8: ~0,9 KiB
   *     por minuto de audio. 64 KiB son más de **una hora** de habla continua, y un audio de WhatsApp
   *     dura minutos. O sea que el tope solo lo toca algo patológico, que es exactamente lo que un
   *     tope tiene que atrapar.
   *   · `analisis` 32 KiB, medido sobre `analisis::text`. El bloque del LLM son ocho claves con listas
   *     cortas; 32 KiB es más de un orden de magnitud por encima de lo que produce, y ataja al modelo
   *     que devuelve una `checklist_interpretacion` de dos megas.
   *   · `titulo` y `mensaje_de` 200 B — un título es una línea de una tabla y `mensaje_de` es un
   *     nombre de contacto de WhatsApp. Si no entra en 200 bytes no es un título, es un resumen.
   *   · `resumen` 2 KiB — un párrafo largo.
   *   · las dos URL 2 KiB — el límite práctico de una URL en la web (lo que aguanta un navegador viejo).
   *
   * Lo que estos checks NO hacen, y sigue siendo de la Etapa 3 según el plan: validar que las URL sean
   * http(s) y de un host admitido, y restringir QUÉ CLAVES admite `analisis`. Acá está el tamaño y la
   * forma (`jsonb_typeof`), no el vocabulario.
   */
  constraint idea_titulo_razonable        check (octet_length(titulo) <= 200),
  constraint idea_resumen_razonable       check (resumen is null or octet_length(resumen) <= 2048),
  constraint idea_transcripcion_razonable check (transcripcion is null or octet_length(transcripcion) <= 65536),
  constraint idea_mensaje_de_razonable    check (mensaje_de is null or octet_length(mensaje_de) <= 200),
  constraint idea_url_razonable           check (
    (audio_url   is null or octet_length(audio_url)   <= 2048)
    and (carpeta_url is null or octet_length(carpeta_url) <= 2048)
  ),
  constraint idea_analisis_razonable      check (octet_length(analisis::text) <= 32768)
);

comment on table ideas is
  'Ideas que el cliente manda por audio; la agencia las revisa y las aprueba o rechaza (ADR-20). '
  'El INGRESO REAL (flujo de audio en n8n) NO existe todavía: hoy las crea el seed de ejemplo o la '
  'infraestructura. Cuando exista será un endpoint autenticado con secreto propio (HMAC), separado '
  'del token de usuario — n8n no es una persona y no debería llevar el JWT de nadie.';

comment on column ideas.transcripcion is
  'Texto del audio del cliente. INTERNO: ningún grant a app_render, nunca (ADR-19). Es además una '
  'superficie de inyección — se renderiza como texto, jamás como HTML.';

comment on column ideas.analisis is
  'Bloque del LLM (audiencia, canales, intención, materiales, observaciones, checklist, ideas '
  'complementarias, tipo de acción). jsonb porque solo se MUESTRA: no se filtra ni se ordena por él.';

comment on column ideas.audio_url is
  'URL a donde el audio YA vive. AMG OS no tiene storage y esta pieza no lo inventa: no se sube nada.';

-- Índices para lo que la tabla FILTRA (no para lo que solo se muestra): la pantalla de ideas filtra
-- por estado y por cliente.
create index on ideas (tenant_id, estado);
create index on ideas (tenant_id, client_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================
alter table ideas enable row level security;
alter table ideas force  row level security;   -- sin FORCE, el DUEÑO de la tabla salta las políticas

-- -----------------------------------------------------------------------------
-- GRANTS: por VERBO y ENUMERADOS, nunca `all`
--
-- Esta es la enmienda del 2026-08-02, y es el punto más importante del archivo. La versión anterior
-- del plan describía los permisos por VISIBILIDAD ("app_user puede con ideas") y enumeraba quién ve
-- qué. Con un grant amplio y una policy de solo `using`, **un rol `cliente` podría editar, aprobar o
-- rechazar su propia idea** — que es exactamente lo contrario del producto (la agencia revisa) y
-- contradice ADR-20.
--
--   · select  → sí. Quién ve qué lo decide `idea_select` (staff: todo el tenant; `cliente`: solo su
--                negocio).
--   · update  → sí, pero POR COLUMNA y con `app.puede_escribir()` en la política. El rol `cliente` es
--                de solo lectura desde la 0001 y acá no se le hace una excepción.
--   · insert  → NO. El ingreso real (audio/n8n) está fuera de alcance; hasta que exista, una idea la
--                crea el seed o la infraestructura, no una pantalla. Un grant "por si acaso" es un
--                endpoint de creación que nadie diseñó.
--   · delete  → NO. Si algún día hace falta, se decide entonces.
--   · app_service (el orquestador) → NADA. Sin privilegios especulativos: si el ingreso futuro los
--                necesita, se los da el plan que lo construya.
--   · app_render → NADA. Ver la cabecera del archivo.
--
-- El grant de UPDATE es por COLUMNA a propósito: `tenant_id` y `client_id` quedan fuera, así que
-- mover una idea a otro tenant o a otro cliente da 42501 **desde la base**, no porque una allowlist
-- de TypeScript se acuerde de filtrarlos. `id`, `creada_en` y `actualizada_en` tampoco: el id no se
-- reescribe, y las dos marcas de tiempo las gobierna la tabla (default + trigger).
-- -----------------------------------------------------------------------------
grant select on ideas to app_user;
grant update (titulo, resumen, estado, transcripcion, audio_url, carpeta_url, mensaje_de, analisis)
  on ideas to app_user;

-- -----------------------------------------------------------------------------
-- Las políticas. Con cláusula `to app_user` EXPLÍCITA.
--
-- Una política sin `to` aplica a PUBLIC — o sea, también a roles que todavía no existen. Eso ya costó
-- un incidente en este esquema: `client_select`/`client_write` (0001) se escribieron sin `to`, y
-- cuando apareció `app_render` (0007) el renderizador evaluaba políticas pensadas para usuarios
-- autenticados y moría con `permission denied for table memberships`. Nombrar el rol no es
-- verbosidad: es acotar el alcance.
-- -----------------------------------------------------------------------------

-- SELECT: staff ve todas las ideas del tenant; un rol `cliente`, SOLO las de su negocio. Lo resuelve
-- `app.ve_cliente()`, que ya es la misma función que gobierna `clients`, `kr_runs`, `kr_keywords` y
-- `kr_pages` — el aislamiento no se hereda del padre, pero la REGLA sí se comparte.
create policy idea_select on ideas
  for select to app_user
  using (tenant_id = app.current_tenant_id() and app.ve_cliente(client_id));

/*
 * UPDATE: solo `equipo`/`maestro` (`app.puede_escribir()` — el rol `cliente` es de solo lectura).
 *
 * `using` vs `with check`, elegido a propósito (la diferencia decide el código HTTP que va a ver el
 * usuario en la Etapa 3):
 *
 *   · La condición de rol va en **`using`** → un `cliente` que intente editar/aprobar su idea NO
 *     alcanza la fila: **0 filas afectadas, en silencio**. Es lo que el plan pide explícitamente
 *     ("un `cliente` que hace `update` de su propia idea no afecta filas"), y la API lo traducirá
 *     como 404.
 *   · La MISMA condición se repite en **`with check`** para cerrar la fuga por UPDATE: que una fila
 *     alcanzable no pueda quedar apuntando a otro tenant. Lo que sigue está MEDIDO (PGlite 16.4), no
 *     supuesto, porque la primera redacción de este comentario se atribuía la garantía entera y la
 *     verificación por mutación la desmintió dos veces:
 *
 *       · con el grant de update ampliado a toda la tabla y este `with check` abierto a `true`, el
 *         update SIGUE rechazándose (42501) — lo frena `idea_select`, porque Postgres exige que la
 *         fila NUEVA de un UPDATE pase las políticas de SELECT cuando la tabla tiene alguna (igual
 *         con `returning` y sin él);
 *       · con `idea_select` abierta a `true` y este `with check` intacto, TAMBIÉN se rechaza — ahora
 *         lo frena el `with check`;
 *       · hacen falta las DOS mutaciones a la vez para que la idea se pueda mudar de tenant.
 *
 *     O sea: son dos redes independientes y cada una alcanza sola, que es lo que significa defensa en
 *     profundidad — y también la razón de que ninguna mutación individual tumbe el test que lo fija.
 *     Antes de las dos está el grant por columna, que ni siquiera deja NOMBRAR `tenant_id`.
 *
 * Nota para quien venga después: si el producto decide que el rechazo debe ser 403 ("no tenés
 * permiso") en vez de 404 ("no existe"), lo que hay que mover es `app.puede_escribir()` del `using`
 * al `with check` — y hay que cambiar el test que hoy afirma "0 filas". No es un detalle de la API.
 */
create policy idea_update on ideas
  for update to app_user
  using (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id))
  with check (tenant_id = app.current_tenant_id() and app.puede_escribir() and app.ve_cliente(client_id));

comment on policy idea_update on ideas is
  'ADR-20: la agencia revisa, el cliente no. app.puede_escribir() va en el USING a propósito (un rol '
  'cliente no afecta filas, en silencio → 404), y se repite en el WITH CHECK para cerrar la fuga por '
  'UPDATE. No hay política de insert ni de delete: tampoco hay grants.';

-- =============================================================================
-- LA MÁQUINA DE ESTADOS, IMPUESTA EN LA BASE
--
-- `nueva → en_revision → aprobada | rechazada`, y nada más. `aprobada → nueva` NO es una transición.
--
-- Por qué un trigger y no solo la capa de datos: `db/src/ideas.ts` valida antes de escribir para
-- poder devolver un error limpio (y que la API conteste 400 y no 500), pero eso es ERGONOMÍA, no la
-- garantía. `app_user` tiene grant de update sobre la columna `estado`; cualquier sentencia que no
-- pase por `cambiarEstado` —un `update` a mano, un endpoint futuro, un script— podría retroceder el
-- estado. La garantía la impone esto.
--
-- Que haya DOS declaraciones de la misma máquina (acá y en `TRANSICIONES_IDEA`, en TypeScript) es un
-- riesgo real de desincronización, y por eso hay un test que las ata: recorre los 12 pares de estados
-- distintos, intenta cada uno contra la base y exige que el veredicto coincida EXACTAMENTE con el de
-- `esTransicionValida()`. Si alguien cambia una de las dos copias, ese test cae.
--
-- El `when (old.estado is distinct from new.estado)`: un update que NO toca el estado (editar el
-- título, corregir la transcripción) no es una transición y no dispara nada. Sin esa cláusula,
-- editar una idea ya aprobada sería imposible.
--
-- Lo que este trigger NO gobierna es el INSERT, y es deliberado: una fila nueva no tiene "estado
-- anterior", el default ya es `nueva`, y el seed de ejemplo necesita poder poblar los cuatro estados
-- de una. Como no hay grant de insert para ningún rol de aplicación, la única vía es la
-- infraestructura — que es la que siembra.
-- =============================================================================
create or replace function app.idea_transicion_valida() returns trigger
language plpgsql as $$
begin
  if not (
       (old.estado = 'nueva'       and new.estado = 'en_revision')
    or (old.estado = 'en_revision' and new.estado in ('aprobada', 'rechazada'))
  ) then
    raise exception 'Transición de estado inválida para la idea %: % → %', old.id, old.estado, new.estado
      using errcode = '23514';  -- check_violation: el onError de la API ya lo mapea a 400, no a 500.
  end if;
  return new;
end;
$$;

comment on function app.idea_transicion_valida() is
  'Máquina de estados de las ideas: nueva → en_revision → aprobada | rechazada. Su copia en '
  'TypeScript (TRANSICIONES_IDEA, db/src/ideas.ts) está atada a esta por un test que recorre los 12 '
  'pares posibles. Lanza 23514 para que la API responda 400 y no 500.';

create trigger ideas_transicion_estado
  before update on ideas
  for each row
  when (old.estado is distinct from new.estado)
  execute function app.idea_transicion_valida();

-- -----------------------------------------------------------------------------
-- `actualizada_en`, mantenida por la tabla
--
-- Podría escribirla cada `update` de la capa de datos. No lo hace a propósito: sería una garantía que
-- depende de que TODOS los caminos de escritura se acuerden, y basta con que uno se olvide para que
-- la pantalla ordene por una fecha que miente. `now()` es el instante de la transacción, así que dos
-- updates de la misma transacción comparten marca — que es lo correcto: es un solo cambio.
--
-- Se dispara SIEMPRE (sin `when`), incluido cuando el update solo cambia el estado: aprobar una idea
-- también es tocarla.
-- -----------------------------------------------------------------------------
create or replace function app.idea_marcar_actualizada() returns trigger
language plpgsql as $$
begin
  new.actualizada_en := now();
  return new;
end;
$$;

create trigger ideas_actualizada_en
  before update on ideas
  for each row
  execute function app.idea_marcar_actualizada();

-- NADA MÁS. Ningún grant a app_render, ningún cambio en app.nap_publico ni en
-- business_profile_publico, ninguna política tocada — ver la cabecera de este archivo.

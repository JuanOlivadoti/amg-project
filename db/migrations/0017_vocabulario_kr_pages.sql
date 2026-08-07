-- =============================================================================
-- AMG OS — 0017: el vocabulario de `kr_pages` es el del contrato, y lo impone la base
--
-- ## El bug que esto cierra
--
-- `sembrarDemo` (`db/src/seed-demo.ts`) escribía en `kr_pages` cuatro campos con el vocabulario del
-- SEED en vez del vocabulario del CONTRATO:
--
--   · `page_strategy` <- el PAPEL de la página (`hub`/`spoke`), que el contrato colapsa a `hub_spoke`;
--   · `intencion`     <- en español (`comercial`/`navegacional`/`informacional`);
--   · `seo`           <- `{title, description}` en vez de `{meta_title, meta_description, schema_type,
--                          canonical}`;
--   · `content_brief` <- `{schema_type}` en vez de `{h1, secciones_sugeridas, word_count_objetivo,
--                          enlazado_interno}`.
--
-- El mismo archivo YA construía las formas correctas 130 líneas más arriba (`aPaginaPropuesta()`, con
-- los mapas `ESTRATEGIA_DEL_CONTRATO` e `INTENCION_DEL_CONTRATO`) para armar el brief del informe. El
-- insert simplemente no las usaba: dos verdades del mismo dato, en el mismo archivo.
--
-- **Nada avisó, y el motivo es esta migración.** `tipo`, `intencion`, `page_strategy` y `evidencia`
-- eran `text not null` PELADO (`0001_init.sql:225-236`): la columna aceptaba cualquier palabra. El
-- síntoma no salía en `db` ni en `api` — salía en el M1, cuando el orquestador reconstruye el brief
-- desde la base (`briefDesdeLaBase`, `orchestrator/src/workflow.ts`) y `parseBrief` lo rechaza. O sea,
-- en producción, con el research ya pagado.
--
-- Medido antes de escribir esto: sembrar la demo en PGlite, reconstruir el brief y pasarlo por
-- `parseBrief` lanzaba con `intencion` fuera del enum y los cuatro campos de `seo` faltando (y los
-- cuatro de `content_brief`, que no se veían solo porque `formatIssues` corta el mensaje en 5 issues).
--
-- ## Por qué un `check` y no "arreglar el seed y ya"
--
-- Arreglar el seed cierra el caso conocido. El `check` cierra la CLASE: cualquier escritura futura
-- —otro seed, un `insert` a mano en una consola, un endpoint nuevo, un fixture de test— que meta una
-- palabra fuera del vocabulario falla en el acto y con el nombre del invariante, en vez de dejar una
-- fila que revienta semanas después en el otro extremo del sistema. Es la diferencia entre una
-- garantía escrita en un comentario y una impuesta.
--
-- Se decide mirando UNA fila, así que va en un `check` — el mismo criterio con el que la 0015 razona su
-- `>= 0` y su `retirada_sin_posicion`.
--
-- ## Lo que este `check` NO cubre, dicho con nombre
--
-- **La forma de `seo` y `content_brief` (los dos `jsonb`) queda sin constraint, a propósito.** Un check
-- de forma sobre jsonb tendría que codificar en la base la lista exacta de claves obligatorias de cada
-- objeto, y esa lista NO es la misma en los dos validadores del contrato: `emisionM2` endurece `seo`
-- (`meta_title`/`meta_description` con `.min(1)`) y `content_brief` (`h1` no vacío,
-- `word_count_objetivo` entero positivo) por encima de lo que `consumoM1` exige. Escribir uno de los
-- dos en un `check` sería que la base tomara partido en una decisión que nadie tomó, y hacerlo
-- silenciosamente rígida frente a briefs históricos que hoy se publican.
--
-- Lo que SÍ cubre esa mitad es un test: `db/src/seed-contrato.test.ts` reconstruye el brief desde lo
-- sembrado y lo pasa por `parseBrief`, que es el validador que corre de verdad en el M1. Es más ancho
-- que un check (mira los dos jsonb enteros) y más estrecho (solo las filas que el test siembra). Queda
-- como deuda con nombre: **la forma de los dos jsonb de `kr_pages` no está impuesta por la base.**
--
-- ## Las filas jsonb YA SEMBRADAS no las arregla esta migración
--
-- El `update` de abajo repara `page_strategy` e `intencion`, que son traducciones deterministas de un
-- valor a otro. `seo` y `content_brief` **no**: reconstruirlas exigiría inventar los campos que faltan
-- (`schema_type`, `h1`, `word_count_objetivo`), y un dato inventado en una migración es peor que un
-- dato incompleto. Las filas de producción se arreglan **re-sembrando** (`npm run reseed:demo`), que
-- ahora escribe las formas del contrato.
--
-- ## Numeración: por qué 0017
--
-- `0013_ideas.sql` y `0014_fotos_publicas.sql` están RESERVADAS y sin escribir, en ramas que corren en
-- otra máquina (`docs/superpowers/plans/2026-08-01-portal-agencia-programa.md` §4): un número libre en
-- el disco no es un número libre. Ésta toma el primer número libre después de la 0016.
--
-- No depende de ninguna de sus hermanas reservadas: toca solo `kr_pages`, mientras la 0013 crea una
-- tabla nueva y la 0014 toca `app.nap_publico`. Da igual en qué orden se apliquen — que es la condición
-- que el programa exige declarar antes de mergear.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PRIMERO las filas que ya existen. Sin esto el `add constraint` NO SE PUEDE aplicar: producción tiene
-- las 14 páginas del seed de la demo, y todas violan los checks de abajo.
--
-- Idempotente: el `where` excluye las filas ya correctas, así que re-ejecutar no toca nada. (El runner
-- de producción no re-aplica una migración registrada, pero `aplicarMigraciones` de los tests corre
-- sobre una base nueva y esto tiene que ser cierto igual.)
--
-- El mapeo es determinista y sale de los dos mapas que el propio seed ya tenía escritos
-- (`ESTRATEGIA_DEL_CONTRATO` e `INTENCION_DEL_CONTRATO` en `db/src/seed-demo.ts`), no de una conjetura.
--
-- Y NO hay un `else` que salve valores desconocidos: si quedara alguna fila con una palabra que este
-- mapeo no cubre, el `add constraint` de más abajo **falla y el despliegue se detiene**. Eso es lo
-- correcto — inventarle una traducción a un valor que nadie escribió a propósito taparía el hallazgo
-- justo cuando el sistema por fin lo puede ver.
-- -----------------------------------------------------------------------------

-- `hub` y `spoke` son los dos PAPELES de una misma estrategia hub-and-spoke; el contrato tiene un solo
-- valor para ella. La información de qué papel jugaba la página se pierde, y se pierde de todos modos:
-- el contrato nunca la tuvo, así que ninguna fila escrita por `savePages` la llevó jamás.
update kr_pages
   set page_strategy = 'hub_spoke'
 where page_strategy in ('hub', 'spoke');

-- `transaccional` no lo escribe el seed de HOY, pero lo escribió hasta `f0c1387` (2026-08-01) y las
-- filas de producción se re-sembraron dos veces desde entonces, así que hoy no queda ninguna. Está en
-- el mapeo igual: el `update` corre contra una base que persiste desde julio, y comprobar que no queda
-- ninguna cuesta más que traducirla. Traducir un valor que no existe no toca ninguna fila.
update kr_pages
   set intencion = case intencion
                     when 'comercial'     then 'commercial'
                     when 'navegacional'  then 'navigational'
                     when 'informacional' then 'informational'
                     when 'transaccional' then 'transactional'
                   end
 where intencion in ('comercial', 'navegacional', 'informacional', 'transaccional');

-- -----------------------------------------------------------------------------
-- Y AHORA los cuatro checks.
--
-- El vocabulario está escrito acá Y en `contrato/src/esquema.ts`, o sea en dos sitios — exactamente lo
-- que `contrato/src/una-sola-fuente.test.ts` existe para impedir. No hay forma de que un `.sql` importe
-- un enum de TypeScript, así que la copia es inevitable; lo que no es inevitable es que se
-- desincronice en silencio. Lo ata `db/src/seed-contrato.test.ts`, que EXTRAE estas listas del texto de
-- este archivo y las compara contra las de `emisionM2` introspeccionadas en runtime. Si agregás un
-- valor a un lado y no al otro, cae ahí.
--
-- Cada `drop constraint if exists` antes del `add` es para que la migración sea re-ejecutable sobre una
-- base que ya la tenga (mismo patrón que la 0015 con `retirada_sin_posicion`).
--
-- Los nombres son los que el test y la API leen del error: un 23514 con `intencion_del_contrato` dentro
-- dice QUÉ invariante se violó, que es lo que un `check` anónimo no dice.
-- -----------------------------------------------------------------------------

alter table kr_pages drop constraint if exists tipo_del_contrato;
alter table kr_pages
  add constraint tipo_del_contrato
  check (tipo in ('servicio', 'landing_local', 'blog', 'institucional'));

alter table kr_pages drop constraint if exists intencion_del_contrato;
alter table kr_pages
  add constraint intencion_del_contrato
  check (intencion in ('transactional', 'commercial', 'local', 'informational', 'navigational'));

-- La ÚNICA de las cuatro que admite NULL, y no por descuido: la columna nació nullable en la 0004 y
-- `PgStore.savePages` escribe `p.page_strategy ?? null`. Exigirla acá haría fallar toda escritura de un
-- brief que no la traiga — que es la mayoría de los que el M1 sabe consumir, porque `consumoM1` ni
-- siquiera valida este campo.
alter table kr_pages drop constraint if exists estrategia_del_contrato;
alter table kr_pages
  add constraint estrategia_del_contrato
  check (page_strategy is null
         or page_strategy in ('single', 'hub_spoke', 'merge', 'backlog'));

alter table kr_pages drop constraint if exists evidencia_del_contrato;
alter table kr_pages
  add constraint evidencia_del_contrato
  check (evidencia in ('datos_mercado', 'sin_validar'));

comment on column kr_pages.intencion is
  'Intencion de busqueda, con el vocabulario del CONTRATO (SearchIntent, en ingles): lo impone el check '
  'intencion_del_contrato, no una convencion. El seed de la demo escribia esto en espanol y el brief '
  'reconstruido desde la base era rechazado por parseBrief en el M1 (migracion 0017).';

comment on column kr_pages.page_strategy is
  'Estrategia de la pagina segun el contrato (PageStrategy): single | hub_spoke | merge | backlog. NO es '
  'el PAPEL de la pagina en el hub: hub y spoke son dos papeles de UNA estrategia y los dos colapsan a '
  'hub_spoke. NULL = el brief no la traia (consumoM1 no valida este campo).';

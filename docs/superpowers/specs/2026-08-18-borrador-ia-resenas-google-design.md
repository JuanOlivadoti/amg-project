# Borrador de respuesta con IA (Bloque F, fase 2 — primera pieza)

**Fecha:** 2026-08-18
**Alcance:** `db/` (2 columnas + función `security definer` nueva, migración `0024`), `orchestrator/`
(provider de IA + polling), `api/` (PATCH extendido), `portal/` (tab de reseñas, borrador editable).
**Origen del pedido:** Bloque F, fase 2
([`15-plan-plataforma.md`](../../proyecto/15-plan-plataforma.md#bloque-f--módulo-3-respondedor-de-reseñas-de-google)),
"lo que sigue siendo fase 2, sin empezar": borrador de respuesta con IA para 4-5★. La fase 1
(monitoreo + alerta) está completa y mergeada (`c0947cb`).

---

## El problema

El PRD exige que el "Gestor de Reseñas" redacte un borrador de respuesta para reseñas de 4-5★ — las
de 1-3★ las responde siempre un humano, sin asistencia de IA. Fase 1 dejó el monitoreo funcionando
(polling, conexión OAuth, el tab `/clientes/:id/resenas`) pero **ninguna reseña tiene respuesta
todavía**: hoy el staff redacta a mano y a mano, publicaría a mano en Google, fuera de la app.

## La decisión

Cinco decisiones tomadas con el usuario, en orden:

| Decisión | Elegido | Descartado, y por qué |
| --- | --- | --- |
| Alcance de esta pieza | **Solo el borrador**, editable por el staff. Publicar de vuelta a Google es la próxima pieza | Construir borrador + publicar juntos repite el riesgo que fase 1 ya evitó: no se ha visto un borrador real todavía |
| Disparador | **Automático**, dentro del mismo polling que ya detecta la reseña | Un botón "Generar" a demanda: más simple y más barato de partida, pero el usuario prefirió que el staff ya lo encuentre listo al entrar |
| Proveedor de IA | **OpenAI**, mismo que ya redacta la prosa de las páginas (`web-builder/src/llm/content.ts`) | Anthropic (que ya usa `kr-service` para los seeds): un tercer proveedor en el mismo proceso sin necesidad — OpenAI ya está integrado y facturado en el mismo composition root |
| Fallo de un borrador puntual | **Se guarda sin borrador**, no frena el polling ni reintenta en caliente | Reintentar 2-3 veces dentro del mismo ciclo: más resiliente a fallos transitorios, pero la reseña ya insertada no vuelve a pasar por el polling (`insertada` da `false` la próxima vez), así que no hay una segunda pasada automática que aproveche el reintento — la mitigación real es que el staff completa el campo a mano (ver "El portal") |
| Tope de gasto | **Solo se loguea el costo por ahora**, sin preflight ni límite | Un preflight tipo `kr-service` que aborte por presupuesto: más seguro, pero el volumen esperado es bajo y el eje entero corre en mock hasta que se cargue `OPENAI_API_KEY` — se agrega si el volumen real lo justifica |

**Por qué NO se ataca "editar" como pieza separada de "generar":** el usuario pidió que el staff
pueda ajustar el texto ya en esta etapa (no solo lectura), así que el PATCH y el grant de columna se
construyen junto con la generación — separar los dos habría significado tocar la misma fila dos veces
en dos entregas distintas sin que la segunda agregue una decisión nueva.

---

## Arquitectura

Mismos tres lugares que fase 1, sin paquete nuevo:

```
orchestrator/
  src/borrador/            interfaz BorradorProvider, mock + OpenAI — mismo molde que google/provider.ts
  src/functions.ts         pollearResenas: genera el borrador inline, después de registrar la reseña
db/
  migrations/0024_...sql   2 columnas + app.guardar_borrador_resena() (security definer, owner app_resenas)
  src/store.ts             PgStore.guardarBorradorResena — cross-tenant, mismo molde que registrarResenaGoogle
  src/resenas.ts           PgResenas.editarBorrador — bajo RLS app_user, mismo molde que marcarVista
api/
  src/app.ts               PATCH /clients/:id/resenas/:resenaId acepta una segunda forma fija
portal/
  cliente-resenas.ts       card con borrador editable + botón Guardar
```

---

## Modelo de datos (migración `0024`)

### Dos columnas nuevas en `resenas_google`

```sql
alter table resenas_google add column if not exists borrador_respuesta   text;
alter table resenas_google add column if not exists borrador_generado_en timestamptz;
```

`borrador_respuesta` es `null` hasta que se genera (o si la generación falló). `borrador_generado_en`
es cuándo se generó — no cuándo se editó por última vez; no hace falta un segundo timestamp para eso,
la fila no distingue "generado por IA intacto" de "editado por el staff" porque no hay ninguna regla
de producto que dependa de esa distinción hoy.

### Grant de columna para `app_user`

```sql
grant update (borrador_respuesta) on resenas_google to app_user;
```

Aditivo sobre el `grant update (vista_en)` que ya existe desde `0021` — no hace falta revocar ni
reotorgar ese. La política `resena_marcar_vista` (`0021`) ya exige `app.puede_escribir()` en su
`using`/`with check`; RLS es por fila, no por columna, así que la misma política gobierna también este
`UPDATE` sin necesitar una policy nueva. El rol `cliente` sigue sin poder escribir nada acá (ADR-20).

### La función cross-tenant que escribe el borrador

Mismo mecanismo que `app.registrar_resena_google` (`0022`): el polling corre como `app_service`, que
no tiene ningún grant directo sobre `resenas_google` (lo cross-tenant vive en funciones
`security definer`, no en el rol del orquestador). Se agrega una función más, propiedad de
`app_resenas`, y una policy de `UPDATE` para ese rol (hoy `app_resenas` solo tiene `INSERT` y
`SELECT` sobre la tabla, de `0022`):

```sql
grant update (borrador_respuesta, borrador_generado_en) on resenas_google to app_resenas;

create policy resena_actualizar_borrador_app_resenas on resenas_google
  for update to app_resenas
  using (true) with check (true);
-- using(true) es seguro acá por el mismo motivo que en 0022: app_resenas no tiene login,
-- así que solo se alcanza vía una función security definer con `execute` acotado a app_service.
-- El aislamiento NO lo da esta policy (no hay contexto de tenant que mirar): lo da el `where`
-- de la función de abajo, que es la superficie real.

create or replace function app.guardar_borrador_resena(
  p_client_id        uuid,
  p_tenant_id         uuid,
  p_google_review_id  text,
  p_borrador          text
) returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  update resenas_google
    set borrador_respuesta = p_borrador, borrador_generado_en = now()
    where client_id = p_client_id and tenant_id = p_tenant_id and google_review_id = p_google_review_id
      and puntuacion between 4 and 5
      and borrador_respuesta is null
    returning id into v_id;
  return v_id is not null;
end;
$$;

-- mismo baile de owner que 0022: grant app_resenas to current_user / grant create on schema app to
-- app_resenas / alter function ... owner to app_resenas / revoke execute from public / grant execute
-- to app_service / revoke create / revoke membership. Ver 0022 líneas 197-217 para la secuencia exacta.
```

**El `where` lleva `puntuacion between 4 and 5` y `borrador_respuesta is null`, y no es cosmético**
(hallazgo de la revisión externa). Sin esas dos condiciones, la función acepta cualquier
`(client_id, tenant_id, google_review_id)` que le pase quien tenga `execute` — hoy solo el
orquestador, pero "hoy solo" es exactamente la clase de garantía que vive en un comentario y no en el
código: un bug o una llamada repetida del lado TypeScript podría sobrescribir una edición del staff
ya guardada, o escribir un borrador de IA sobre una reseña de 1-3★ que el PRD prohíbe tocar con IA. La
condición la impone Postgres, no la disciplina del llamador — mismo principio que el resto del
proyecto ya aplica en todos lados (`AGENTS.md`: "una garantía en un comentario es una intención, no
una garantía").

Identificar la fila por `(client_id, tenant_id, google_review_id)` — la misma clave natural que ya usa
`registrar_resena_google` — evita tener que hacer viajar el `id` interno desde el `insert` hasta el
punto donde se genera el borrador; `registrarResenaGoogle` sigue devolviendo solo `boolean`, sin
cambiar su contrato.

---

## El polling (`orchestrator/src/functions.ts`)

Dentro de `pollearResenas`, en el loop `for (const r of crudas)`, inmediatamente después de
`registrarResenaGoogle`:

```
si insertada Y r.puntuacion >= 4:
  try:
    borrador = borradorProvider.generar(r)
    store.guardarBorradorResena({ clientId, tenantId, googleReviewId: r.googleReviewId, borrador })
  catch (e):
    log(`[borrador-ia] reseña ${r.googleReviewId} (cliente ${cliente.clientId}) falló: ${e.message}`)
    // no incrementa `fallidos` -- ese contador es de CLIENTES con el token roto, no de
    // borradores puntuales. La reseña queda guardada sin borrador; el próximo polling (30 min)
    // no la reintenta porque `insertada` ya da `false` la segunda vez -- el staff la edita a mano.
```

**Reseñas de 1-3★ nunca llaman al provider**, ni siquiera para loguear un intento — el PRD exige
respuesta humana siempre para esas, así que no hay "borrador que el staff descarta": no se genera.

**Por qué el `try/catch` es propio y no el del cliente entero.** El `try/catch` que ya existe en
`pollearResenas` envuelve `refrescarToken` + `listarResenas` + el loop de inserción — un fallo ahí
significa que ESE cliente no se pudo pollear en absoluto. Un fallo de OpenAI generando UN borrador es
un problema de esa reseña, no de la conexión con Google: si el `try/catch` externo lo atrapara, una
reseña 5★ con mala suerte en OpenAI dejaría sin guardar el resto de las reseñas nuevas de ese mismo
cliente en esa misma corrida.

**Nota sobre reintento:** como se decidió no reintentar en caliente, una reseña que falló su borrador
queda con `borrador_respuesta = null` hasta que alguien escribe algo — no hay botón "generar" en el
portal (ver la sección de Portal), pero SÍ hay un textarea vacío editable para el staff, que es la vía
real de recuperación manual. Queda anotado como deuda conocida (no hay reintento automático de IA), no
una omisión silenciosa.

---

## El provider (`orchestrator/src/borrador/`)

Mismo molde que `orchestrator/src/google/provider.ts`:

```ts
// borrador/provider.ts
export interface BorradorProvider {
  generar(reseña: ReseñaCruda): Promise<string>;
}

export function getBorradorProvider(modo: ModoBorrador = leerConfig().borradorResenas): BorradorProvider {
  return modo === "openai" ? new OpenAIBorradorProvider() : new MockBorradorProvider();
}
```

`MockBorradorProvider` devuelve un texto determinista de fixture, con un prefijo inconfundible
(`"[BORRADOR MOCK — no generado por IA] ..."`) — así un borrador mock nunca se puede confundir con uno
real de OpenAI cuando alguien lo edita en el portal (hallazgo de la revisión externa: `/_health` avisa
al operador que el proceso corre en modo mock, pero no le dice nada a quien edita el borrador en el
portal, y el dato que esta pieza guarda es exactamente lo que la próxima pieza —publicar— mandaría a
un cliente real de la agencia). El prefijo cierra ese hueco sin construir una máquina de coherencia
nueva (ver la nota en "Config", abajo).

`OpenAIBorradorProvider` arma un prompt corto: agradece la reseña, menciona algo concreto si `texto`
no es null, tono cercano y profesional, con la misma instrucción "no prometas resultados garantizados
ni hagas claims prohibidos" que ya usa la prosa de `web-builder/src/llm/content.ts:66-72` — pero, igual
que ahí, es una instrucción al modelo, **no una garantía dura** (otro hallazgo de la revisión): la
garantía real es que ningún borrador sale de esta pieza sin pasar antes por revisión humana — esta
pieza no publica nada, y cualquier validación adicional del texto, si hiciera falta, es decisión de la
pieza que sí publique.

`OpenAIBorradorProvider` además loguea el costo estimado de cada llamada, a partir del `usage` que
devuelve la respuesta de OpenAI — mismo criterio de "costo conocido, no medido" que
`kr-service/src/lib/cost.ts` — sin cambiar la firma de `generar` (sigue siendo `Promise<string>`): es
una línea de log, consistente con la decisión de "loguear, sin tope todavía". `MockBorradorProvider`
no loguea costo, porque no gasta nada.

### Config (`orchestrator/src/config.ts`)

Nueva variable `BORRADOR_RESENAS_MODO` (`mock` | `openai`), **opcional, con default derivado** — mismo
criterio que `PROSE_MODE` en `web-builder/src/config.ts:40`: `openai` si hay `OPENAI_API_KEY`, si no
`mock`. Se valida en los dos entornos (typo no cae en silencio a mock), y **no es obligatoria en
producción** — a diferencia de `PIPELINE_MODO`, no hay ningún despliegue donde "olvidarla" impida
arrancar o gaste plata sin que nadie lo haya decidido: sin key, es mock, y `/_health` lo dice.

**Lo que sí podía pasar sin el ajuste de "El provider"** (hallazgo de la revisión externa): a
diferencia de `PIPELINE_MODO`, un despliegue en modo mock acá nunca produce un research falso
presentado como real — pero SÍ podía producir un borrador de relleno indistinguible de uno de OpenAI
para quien lo edita en el portal. Mismo riesgo de fondo, aplicado a un dato distinto. No hace falta
replicar `verificarCoherencia`/`verificarPublicacion` para cerrarlo: alcanza con que el texto del mock
sea reconocible a simple vista.

```ts
export type ModoBorrador = "mock" | "openai";

function leerModoBorrador(): ModoBorrador {
  const crudo = process.env["BORRADOR_RESENAS_MODO"]?.trim();
  if (crudo) return validarModoBorrador(crudo);
  return process.env["OPENAI_API_KEY"]?.trim() ? "openai" : "mock";
}
```

**`/_health` lo reporta**, con el mismo aviso que `prosa` (`server.ts:88`:
`"⚠️  GASTA DINERO al publicar"` → acá `"⚠️  GASTA DINERO al generar borradores"`) — es el eje que
factura, y tiene que poder auditarse sin entrar al panel de Railway. *(Nota al margen, no parte de esta
pieza: `GOOGLE_REVIEWS_MODO` hoy NO se reporta en `/_health` pese a que su `.env.example` dice que sí
— gap preexistente de fase 1, no se toca acá.)*

### Credenciales

`OPENAI_API_KEY` ya existe en `docs/private/credenciales.env` (la usan `kr-service` y `web-builder`).
Se agrega `orchestrator` a la lista de paquetes que la reciben en `scripts/env-sync.mts` (`MAPA`) y a
`orchestrator/.env.example` — mismo valor compartido, no una key nueva.

---

## La API (`api/src/app.ts`, `db/src/resenas.ts`)

`PATCH /clients/:id/resenas/:resenaId` pasa de aceptar **una** forma fija a aceptar **dos**, mismo
criterio de "forma fija, no allowlist de columnas" que ya documenta el handler — pero **exactamente
una** de las dos, sin claves adicionales ni las dos juntas (hallazgo de la revisión externa: un
`if/else if` dejaría que `{"vista": true, "borrador_respuesta": "..."}` ignorara el borrador en
silencio, en vez de rechazar el body):

```ts
const claves = body && typeof body === "object" ? Object.keys(body) : [];
if (claves.length === 1 && body.vista === true) { ... marcarVista ... }
else if (claves.length === 1 && typeof body.borrador_respuesta === "string") { ... editarBorrador ... }
else return 400
```

`{"vista": true, "borrador_respuesta": "..."}`, `{"vista": true, "otraCosa": 1}` y `{}` caen los tres
en el mismo `400` que hoy ya cubre "ninguna de las formas conocidas".

`PgResenas.editarBorrador(ctx, clientId, resenaId, texto)` — mismo molde exacto que `marcarVista`
(`db/src/resenas.ts:89-99`): `update ... where id = $1 and client_id = $2 returning id`, `false` sin
lanzar si no matchea ninguna fila (otro tenant, no existe, o `puede_escribir()` da falso para el rol
`cliente`). El mismo 404 del handler cubre los tres casos, sin distinguirlos — mismo motivo que ya
explica el comentario de la línea 526.

---

## El portal (`cliente-resenas.ts`)

`ResenaGoogle` (en `portal/core/models.ts`, que espeja el de `db/src/resenas.ts` campo por campo —
ADR-21) gana `borradorRespuesta: string | null`.

En cada card de reseña con `puntuacion >= 4` (dos hallazgos de la revisión externa cerrados acá: la
UI antes solo mostraba el textarea cuando ya había borrador, dejando sin vía de recuperación manual a
una reseña que falló; y no distinguía staff de cliente):

- **Staff (`membresia.esEquipo()`)** — mismo gate que ya usan "Conectar Google"/"Desconectar Google"
  en este tab: un `<textarea>` con el texto del borrador, **vacío si `borradorRespuesta` es `null`**, y
  un botón "Guardar" que dispara `PATCH { borrador_respuesta: texto }` y actualiza la fila local (mismo
  patrón optimista que `verla()` ya usa para `vistaEn`). El textarea vacío es la vía real de completar
  a mano una reseña cuya generación falló (ver "Nota sobre reintento" del polling) — sin él, "sin
  borrador todavía" sería un callejón sin salida.
- **Rol `cliente`**: el texto del borrador se muestra de solo lectura si existe, o "sin borrador
  todavía" si no — nunca un control editable. RLS ya le niega la escritura (`app.puede_escribir()`
  en `with check`), pero mostrarle un textarea que la API rechazaría en silencio sería una interfaz que
  miente sobre lo que se puede hacer.

**Sin botón "Regenerar" en esta pieza** (YAGNI): editar a mano ya cubre "no me gustó el borrador", y
regenerar sería una segunda llamada facturada por reseña que nadie pidió todavía. Si el volumen de
ediciones manuales lo justifica, se agrega después.

**No hay botón "Publicar"** — esta pieza no manda nada de vuelta a Google. El borrador guardado (y
editado) queda ahí, disponible para copiar a mano hasta que exista la próxima pieza.

---

## Testing

- **`orchestrator`**: `pollearResenas` con `BorradorProvider` mock — genera borrador para 4-5★, NO para
  1-3★, no frena el resto del cliente si el provider tira error (mutación: forzar el fallo del
  provider en la segunda de tres reseñas 5★ y confirmar que las otras dos sí guardan su borrador), y no
  vuelve a llamar al provider para una reseña que el polling ya había visto antes (`insertada = false`).
  `OpenAIBorradorProvider` loguea una línea de costo estimado por llamada (verificado contra una
  respuesta fixture con `usage` conocido).
- **`db`**: `app_resenas` puede `UPDATE` `borrador_respuesta`/`borrador_generado_en` solo vía la función
  (la policy `using(true)` está bien porque el rol no tiene login — mismo test que ya existe para
  `app_barrido`/`app_resenas` sin `SET`); `app_user` de otro tenant no puede editar el borrador de un
  cliente ajeno (RLS); el rol `cliente` no puede editar (`puede_escribir()` en `with check` da falso).
  **Elegibilidad de `app.guardar_borrador_resena`** (defensa en profundidad, hallazgo de la revisión
  externa): llamarla sobre una reseña de 1-3★ no escribe nada (mutación: quitar
  `puntuacion between 4 and 5` del `where` y confirmar que ESE test cae); llamarla sobre una reseña que
  ya tiene `borrador_respuesta` no la pisa (mutación: quitar `borrador_respuesta is null` del `where` y
  confirmar que una edición humana ya guardada se sobrescribiría).
- **`api`**: PATCH con `{"borrador_respuesta": "..."}` guarda el texto y responde `200`; con las dos
  llaves a la vez, con una clave desconocida sumada a una válida, o sin ninguna de las dos, responde
  `400`; sin `puede_escribir()` (rol cliente) responde `404`.
- **`portal`**: para staff, la card muestra el textarea editable (vacío si no hay borrador todavía) y
  el botón Guardar dispara el PATCH; para el rol `cliente`, el mismo campo se muestra de solo lectura,
  sin textarea ni botón; una reseña de 1-3★ nunca muestra ninguno de los dos.
- **Verificación en navegador**: sembrar una reseña 5★ sin borrador, correr el polling (mock),
  confirmar que aparece el texto MOCK con su prefijo en el tab; editarlo, guardar, refrescar y
  confirmar que el cambio persiste; simular un fallo del provider y confirmar que el staff puede
  escribir el borrador a mano desde el textarea vacío.

---

## Lo que este trabajo NO hace

- **No publica nada de vuelta a Google.** Sigue siendo de solo lectura contra la Business Profile API
  (que además sigue sin acceso real — `GOOGLE_REVIEWS_MODO` no cambia con esta pieza).
- **No genera borrador para 1-3★**, nunca — el PRD lo prohíbe explícitamente.
- **No agrega un tope de gasto ni un preflight.** Se loguea el costo estimado por llamada; el límite
  se agrega si el volumen real lo justifica.
- **No agrega un botón "Regenerar".** Editar a mano cubre el caso por ahora.
- **No agrega WhatsApp ni email.** Sigue siendo Fase 2, pieza siguiente.
- **No pide acceso real a la Business Profile API.** Eso sigue siendo un paso de Juan, fuera de este
  spec.

## Documentación a actualizar al cerrar

Por el ritual del [`AGENTS.md`](../../../AGENTS.md), paso 3:

- [`docs/proyecto/09-estado-y-roadmap.md`](../../proyecto/09-estado-y-roadmap.md) — el Bloque F pasa de
  "sin empezar" a "fase 2, primera pieza cerrada".
- [`docs/proyecto/15-plan-plataforma.md`](../../proyecto/15-plan-plataforma.md) — la fila de Bloque F,
  con lo que sigue de fase 2 (publicar, alertas, limpiar conexión revocada).
- [`progress/history.md`](../../../progress/history.md) — la entrada del día.

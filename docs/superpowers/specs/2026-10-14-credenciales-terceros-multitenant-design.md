# Dónde viven las credenciales de terceros en un sistema multi-tenant — diseño para ADR-25

> **Estado: PROPUESTA, no aceptada.** Este documento existe para ser revisado antes de escribir una
> línea de código. Si sobrevive a la revisión, su sección «Decisión» se convierte en el ADR-25 de
> `docs/decisiones-arquitectura.md` y este archivo queda como el razonamiento largo.

## El problema

La migración `0021` puso la credencial de Google en **tres columnas de `clients`**, una fila por
ficha, y lo hizo bien para la premisa que tenía delante. Esa premisa está escrita en el propio
comentario de la columna:

> *"Credencial OAuth de acceso continuo a la cuenta de Google **del cliente**."*

Es decir: **cada restaurante conecta su propia cuenta de Google**. Bajo esa premisa, una credencial
por ficha no es sólo razonable: es exactamente el modelo correcto.

**La premisa resultó ser falsa, y en dos escalones.**

1. **AMG no trabaja así.** Gestiona las fichas de sus clientes **desde su propia cuenta**, como suele
   trabajar una agencia. O sea: una cuenta de Google, N fichas.
2. **Y la plataforma se va a vender.** DinamicSEO quiere ofrecerla a otras agencias, cada una con sus
   cuentas y sus fichas. El patrón del punto 1 **se repite por cada cliente que se dé de alta**, para
   siempre.

Esto no es un giro de producto: `AGENTS.md` describe AMG OS como *"plataforma SaaS multi-tenant"*
desde el principio, y ADR-19 ya razona en multi-tenant. Lo que falta es que el **modelo de
credenciales de terceros** acompañe a esa premisa — y hoy no hay **ningún ADR** que diga dónde viven.

## Qué pasa hoy si no se cambia nada

El sistema **funciona**. Conviene decirlo primero, porque el argumento no es "está roto":

La misma cuenta de la agencia consiente N veces, una por ficha, y se guardan N refresh tokens
distintos del mismo usuario. Funciona porque la URL de consentimiento lleva `prompt=consent`
(`api/src/google-oauth-live.ts`), que fuerza a Google a emitir un refresh token nuevo en cada
consentimiento. Sin ese parámetro, el segundo consentimiento devolvería `code` pero no token, y el
cliente quedaría conectado sin credencial — en silencio.

Lo que sí trae son cuatro costes que crecen con cada agencia:

1. **N flujos de consentimiento por agencia**, en vez de uno. Fricción de alta que se paga una vez
   por ficha y no una vez por cliente de la plataforma.
2. **El tope de refresh tokens vivos por par (cliente OAuth, usuario).** Google revoca los más
   antiguos al pasarse, **sin avisar**. ⚠️ **No está verificado**: lo señalo como riesgo a confirmar,
   no como dato. Pero si existe, es un fallo diferido y mudo — la clase que ya nos costó cara esta
   misma semana con el polling.
3. **Reconectar es N operaciones.** Si una agencia revoca el acceso desde su cuenta de Google, hay
   que rehacer el consentimiento ficha por ficha.
4. **La detección de revocación, cuando se construya, se disparará N veces por un solo evento.**
   Un acceso revocado es un hecho de la cuenta, no de la ficha.

## Lo que NO puede cambiar

La `0021` y la `0022` establecieron una propiedad de seguridad que este rediseño **no relaja**, y
conviene nombrarla antes de proponer nada:

- **`app_user` puede ESCRIBIR la credencial pero nunca LEERLA de vuelta.** La `0021` revoca el
  `select` de tabla sobre `clients` y lo vuelve a conceder columna por columna, dejando
  `google_refresh_token` deliberadamente afuera — es la única columna de `clients` que `app_user` no
  puede leer, y hay un test que lo fija.
- **El único lector es `app_resenas`**, un rol cross-tenant sin login, a través de una función
  `security definer` que devuelve sólo lo que el polling necesita.

Cualquier modelo nuevo que pierda esa asimetría es peor que el actual, por mucho que resuelva los
cuatro costes de arriba.

## Decisión propuesta

> **Revisión 3 (2026-10-15), tras la 18ª review externa.** La revisión 2 simplificó el modelo al
> saberse que cada agencia conecta una sola cuenta; ésta cierra los seis hallazgos de Codex, de los
> cuales **el más grave fue una regresión introducida al simplificar**: la revisión 2 perdió la
> condición de RLS que sí traía la revisión 1. Está restituida abajo como condición 1.
>
> **Alcance acotado a la conexión de Google por agencia.** Storyblok queda explícitamente FUERA: sus
> dos tokens son por cliente y no por agencia (ADR-04, ADR-19 distingue público de preview y exige un
> space por cliente), así que la cardinalidad de este documento no les aplica.

**La credencial deja de vivir en la fila del cliente y pasa a una tabla con UNA fila por tenant.**

```
google_conexiones
  tenant_id      uuid primary key references tenants(id) on delete cascade
  refresh_token  text not null          -- la credencial. NADIE con login la lee
  cuenta_email   text not null          -- la cuenta que consintió, obtenida del id_token
  conectada_en   timestamptz not null
  creada_por     uuid

clients
  google_location_id   text             -- se queda. NULL = esta ficha no está vinculada
  (google_refresh_token: se retira en una migración posterior)
```

`tenant_id` **es** la clave primaria: así "exactamente una conexión por agencia" lo impide Postgres y
no lo recuerda quien escriba el próximo endpoint. Si algún día hicieran falta dos cuentas, se quita
esa restricción; no se rediseña.

### Condiciones, ninguna opcional

**1. RLS forzada y políticas POR OPERACIÓN.** *(Restituida tras el hallazgo H1: la revisión anterior
de este documento se la había comido.)*

- `enable row level security` **y** `force row level security`.
- `app_user`, con el molde de `client_write` (`0001_init.sql:432-435`):
  - **insert**: `with check (tenant_id = app.current_tenant_id() and app.puede_escribir())`
  - **update**: `using (...)` **y** `with check (...)`, las dos. Sólo `using` autoriza a leer la fila
    para escribirla, no filtra el valor nuevo — es lo que **hace inmutable el `tenant_id`**: sin el
    `with check`, actualizar una conexión y moverla a otro tenant serían la misma operación.
  - **delete**: `using (tenant_id = app.current_tenant_id() and app.puede_escribir())`
- **La asimetría es POR COLUMNA, no por tabla**, y esto resuelve también el H4:
  `grant select (tenant_id, cuenta_email, conectada_en) on google_conexiones to app_user` —
  `refresh_token` deliberadamente afuera, igual que la `0021` hizo con `clients`. Así el portal puede
  saber que hay conexión y con qué cuenta, sin que nadie con login pueda leer la credencial.
- `app_resenas` conserva el acceso cross-tenant, **sólo** por función `security definer` con
  `search_path` fijo, y **ningún login lo asume** (ADR-17).
- Tests obligatorios, en la forma que ya usa `db/`: el tenant A no puede insertar una conexión para
  B, ni mover la suya a B, ni borrar la de B; y un usuario con rol `cliente` no puede ninguna de las
  tres **en su propio tenant**.

**2. "Conectado" es una conjunción, y se proyecta en la consulta, no en TypeScript.**
Una ficha está conectada si su tenant tiene conexión **y** ella tiene `google_location_id`. La
consulta que arma el cliente hace el join y devuelve ese booleano ya resuelto; el portal deja de
derivarlo de `google_conectado_en`. El rol `cliente` tiene que seguir viéndolo (hoy
`db/src/clientes.ts` expone `google_conectado_en` sin enmascarar justamente por eso), y sigue sin ver
el token.

**3. Desvincular una ficha no toca la tabla de conexiones.** Es `google_location_id = null` y nada
más. El error de "desconectar un cliente deja sin credencial a los demás" deja de ser una regla que
haya que recordar y pasa a ser **inexpresable**.

**4. Reconectar la agencia REACTIVA automáticamente sus fichas** *(decisión del usuario, 2026-10-15)*.
La credencial y la vinculación son dos hechos distintos: desconectar dice "ya no tengo acceso", no
"olvidá qué ficha es de quién". Obligar a revincular N fichas sería tirar información que nadie pidió
borrar. Esto cubre también el caso de un consentimiento abierto antes de una desconexión y terminado
después: recrea la conexión, que es justo lo que se decidió que pase.

**5. Reconectar con una cuenta DISTINTA no puede pasar en silencio.** Si el `cuenta_email` del nuevo
consentimiento difiere del guardado, el portal lo dice. No se bloquea —sería fricción contra el caso
normal—, pero deja de ser un cambio mudo: a partir de ese momento el sistema publica respuestas en
todas las fichas de la agencia **como esa otra cuenta**. Esta condición **depende de la 6**: sólo
sirve si el email es fiable.

**6. `cuenta_email` es identidad REAL, obtenida del consentimiento** *(decisión del usuario,
2026-10-15)*. Se añaden los scopes `openid` y `email`, Google devuelve un `id_token` junto al refresh
token, y el `email` sale de ahí. **No es una etiqueta escrita a mano**, y la diferencia importa: ese
campo existe para que alguien sepa con qué cuenta reconectar el día que algo falle — meses después,
quizá cuando quien lo escribió ya no esté.

- `intercambiarCode` pasa a devolver un tercer campo. Hoy devuelve `{ refreshToken, locationId }`
  (`api/src/google-oauth-live.ts:68-71`).
- **A decidir al implementar, y hay que dejarlo escrito:** si se verifica la firma del `id_token` o
  se parsea el payload sin verificar. El token llega por TLS directo del endpoint de Google como
  respuesta a una petición nuestra autenticada, y el campo es informativo, así que parsear es
  defendible; verificar es cinturón y tirantes. Lo que no vale es no decidirlo.
- ⚠️ **Momento:** tocar la lista de scopes es barato AHORA, que se están configurando de todos modos,
  y caro después de publicar la app. Confirmar en la consola que añadir `openid`/`email` —scopes no
  sensibles— no altera el trámite de verificación. **No verificado**, sólo esperado.

**7. `clients.google_refresh_token` se retira en una migración POSTERIOR**, no en la misma que crea la
tabla. Una columna que ya nadie lee pero sigue ahí invita a que alguien la vuelva a usar; retirarla en
el mismo cambio mezcla dos riesgos.

## Por qué no las alternativas

- **Tres columnas en `tenants`.** La alternativa obvia con una sola cuenta por agencia. Se descarta
  por una razón **verificada**: la `0001` concede `grant select on tenants` a nivel de TABLA a
  `app_user` (`:412`) y la `0002` a `app_service` (`:92`). Meter ahí una columna que nadie debe leer
  obliga a revocar y reconceder **columna por columna, para dos roles**, en la tabla más leída del
  esquema. Una tabla aparte tiene grants triviales porque no existe para nada más. *(Codex confirmó
  el argumento y añadió el matiz de que revocar el privilegio de una columna no elimina el de tabla.)*
- **Una tabla de conexiones N-por-tenant** (revisión 1 de este documento). Descartada al confirmarse
  que cada agencia conecta una cuenta. Diseñar para N cuando el dominio dice una es pagar complejidad
  por una hipótesis.
- **Dejarlo como está, una credencial por ficha.** Funciona hoy, y aplazar cuesta poco porque los
  refresh tokens son desechables. Pero el coste se multiplica por cada agencia, y el momento barato
  es antes del segundo tenant.
- **Una credencial global de la plataforma.** Rompe el aislamiento entre tenants. Descartada.

## Qué cuesta, medido

`google_refresh_token` / `google_location_id` aparecen en **seis migraciones** (`0021`, `0022`,
`0025`, `0026`, `0031`, `0034`) y **seis archivos de código** fuera de tests.

⚠️ **Hay DOS lectores del token, no uno** — lo encontró Codex y la revisión anterior de este documento
decía "la pieza delicada" en singular:

1. `app.clientes_conectados_google()` (`0022`), que usa el polling.
2. `app.resena_para_publicar()` (`0025:93-96`), que lee `c.google_location_id, c.google_refresh_token`
   con un join a `clients` — **y es la que escribe de vuelta en Google**.

Las dos son `security definer`, las dos hacen el join nuevo, y las dos tienen que seguir devolviendo
**exactamente los mismos campos**: ni uno más de lo que `app_resenas` ya ve. El contrato vigente de la
primera son **cinco** campos, incluido `nombre`, desde `0026:356-366`.

## Qué NO mejora, para que nadie lo lea de más

Consolidar **no reduce** el alcance cross-tenant del orquestador ni el alcance OAuth. Hoy
`app_service` obtiene, por función autorizada, los tokens de todos los clientes activos; con el join
seguirá obteniendo las conexiones de todos los tenants con fichas activas. Y bajo la premisa fijada,
cada token antiguo **ya** autorizaba la cuenta entera de la agencia, no sólo la ficha donde estaba
guardado. Lo que mejora es la duplicación y el modelo; la respuesta a *"si me lo toman, ¿qué se
llevan?"* es la misma. *(Observación de Codex, incorporada.)*

## Cuándo

**Después** de que el módulo complete un ciclo real en producción con un cliente, y **antes** de dar
de alta al segundo tenant.

## Plan de migración — no se copia ningún token

*(Reescrito tras el hallazgo H5.)* La versión anterior copiaba el token "de cualquiera" de los
clientes conectados del tenant. **Eso era una suposición injustificada**: compartir usuario de Google
no implica compartir vigencia, y Google invalida refresh tokens antiguos sin aviso al emitir nuevos
(Codex lo confirmó contra la documentación oficial —tope de 100 por cuenta y cliente OAuth—; **no
verificado por mí**, se anota como confirmación de tercero). Copiar el equivocado convertiría una
conexión parcialmente operativa en una caída de todas las fichas.

Y hay un atajo que lo vuelve irrelevante: **hoy no hay ningún cliente conectado en producción**
(verificado el 2026-09-28; la única conexión que había era de mock y se desconectó). Así que:

1. Migración que crea `google_conexiones` con su RLS, políticas y grants. No copia nada.
2. Cada agencia **reconsiente una vez**. Con el modelo nuevo eso es un solo consentimiento por
   agencia, no uno por ficha — es justamente lo que el cambio viene a conseguir.
3. Si al implementarlo hubiera clientes conectados, **no se copia igual**: se pide reconsentimiento.
   Un token que no se puede demostrar operativo no se promueve a credencial de toda la agencia.
4. Migración posterior, aparte: retirar `clients.google_refresh_token`.

## Preguntas abiertas

1. ~~¿Una agencia conecta una cuenta o varias?~~ — **una** (2026-10-15).
2. ~~El tope de refresh tokens~~ — confirmado por Codex contra la documentación oficial: 100 por
   cuenta y cliente OAuth, con invalidación silenciosa del más antiguo. Con el modelo nuevo deja de
   importar (un token por agencia, no uno por ficha), pero sostiene el cambio del plan de migración.
3. ~~¿El ADR cubre Storyblok?~~ — **no**: acotado a Google. ADR-19 distingue token público de preview
   y exige un space por cliente, así que la cardinalidad "una por agencia" no les aplica.
4. **Abierta, y es de implementación:** si se verifica la firma del `id_token` o se parsea sin
   verificar (ver condición 6).
5. **Abierta, y es de trámite:** confirmar que añadir los scopes `openid`/`email` no altera la
   verificación de la app. Conviene hacerlo ANTES de publicar.

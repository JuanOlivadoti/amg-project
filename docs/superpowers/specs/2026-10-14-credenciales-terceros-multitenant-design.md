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

**La credencial deja de vivir en la fila del cliente y pasa a una tabla de CONEXIONES por tenant.**
El cliente deja de guardar una credencial y pasa a *apuntar* a una.

```
google_conexiones
  id             uuid primary key
  tenant_id      uuid not null references tenants(id) on delete cascade
  refresh_token  text not null          -- la credencial; nadie con login la lee
  cuenta_email   text not null          -- QUÉ cuenta consintió
  conectada_en   timestamptz not null
  creada_por     uuid                   -- quién hizo el consentimiento
  unique (tenant_id, id)                -- para la FK compuesta de abajo

clients
  google_conexion_id   uuid             -- NULL = no conectado
  google_location_id   text             -- se queda donde está
  foreign key (tenant_id, google_conexion_id)
    references google_conexiones (tenant_id, id)
```

Ninguna de estas condiciones es opcional:

1. **La asimetría del grant sobrevive intacta.** `app_user` puede `insert` sobre `google_conexiones`
   (el callback de OAuth corre con su identidad) y **no tiene `select` sobre `refresh_token`**.
   Columna por columna, igual que la `0021`. El único lector sigue siendo `app_resenas` por función
   `security definer`.
2. **Un cliente sólo puede apuntar a una conexión de SU tenant, y lo impide Postgres.** Con la **FK
   compuesta** `(tenant_id, google_conexion_id) → (tenant_id, id)`, que ya es patrón de la casa
   (`0011` con `memberships`, `0021` y `0033` con `clients`). No es un `if` en la API ni una política
   que haya que acordarse de escribir: es la forma de la clave.
3. **`google_location_id` se queda en `clients`.** La ficha es una propiedad del cliente; la
   credencial no. Separarlas es justamente el punto.
4. **Desconectar un cliente NO borra la conexión.** Desvincular una ficha pone
   `google_conexion_id = null` y nada más. Si borrara la conexión, desconectar un cliente dejaría sin
   credencial a los otros N-1 — el fallo más fácil de introducir en este rediseño, y el más difícil
   de notar.
5. **`cuenta_email` no es decorativo.** Sin él, "reconectá" es una instrucción incompleta: nadie sabe
   con qué cuenta de Google hay que volver a consentir. Es el mismo defecto que acabamos de corregir
   en el mensaje del 409.
6. **`clients.google_refresh_token` se marca como obsoleta y se retira en una migración posterior**,
   no en la misma. Una columna que ya nadie lee pero sigue existiendo es una invitación a que alguien
   la vuelva a usar; borrarla en el mismo cambio que mueve los datos mezcla dos riesgos.

## Por qué no las alternativas

- **Una credencial por tenant (una columna en `tenants`).** Es más simple y resuelve los cuatro
  costes. La descarto porque **una agencia puede legítimamente tener fichas consentidas desde varias
  cuentas de Google**: unos clientes le dieron acceso de gestor con una cuenta, otros con otra. Una
  sola columna obliga a reconsentirlo todo bajo una cuenta única, que puede no ser posible — el
  acceso a una ficha lo concede su dueño, no la agencia. **⚠️ Esta es la suposición más frágil del
  diseño: ver la pregunta abierta al final.**
- **Dejarlo como está, una credencial por ficha.** Funciona hoy y el coste de aplazar es bajo, porque
  los refresh tokens son **desechables**: no hay histórico que preservar, se reconecta y listo. Pero
  el coste no desaparece, se multiplica por cada agencia que se dé de alta, y el momento barato para
  cambiarlo es **antes del segundo tenant**, no después.
- **Una credencial global de la plataforma.** Rompe el aislamiento entre tenants de raíz: una
  credencial que ve las fichas de todos los clientes de todas las agencias. Pregunta de ADR-19 — *si
  me lo toman, ¿qué se llevan?* — la respuesta sería "todo". Descartada sin discusión.

## Qué cuesta, medido

No es un cambio de una tabla. `google_refresh_token` / `google_location_id` aparecen en:

- **Seis migraciones**: `0021` (columnas y grants), `0022` (el rol `app_resenas` y la función
  cross-tenant `app.clientes_conectados_google()`), `0025` (publicar respuesta), `0026` (alertas de
  Telegram), `0031` (posts de blog) y `0034`.
- **Seis archivos de código** fuera de tests: `db/src/clientes.ts`, `db/src/resenas.ts`,
  `api/src/app.ts`, `api/src/google-oauth-live.ts`, `api/src/oauth-state.ts`,
  `orchestrator/src/google/live-provider.ts` — más el portal y todos los tests asociados.

La pieza más delicada no es ninguna de ésas: es **`app.clientes_conectados_google()`**, la función
`security definer` que el polling usa para recorrer todos los tenants. Hoy devuelve una fila por
cliente conectado con su token; con el modelo nuevo tiene que hacer el join y seguir devolviendo
exactamente lo mismo, sin ampliar ni un campo lo que ese rol puede ver.

## Cuándo

**Después** de que el módulo complete un ciclo real en producción con un cliente, y **antes** de dar
de alta al segundo tenant.

El orden importa en las dos direcciones. Hacerlo antes significa depurar dos incógnitas a la vez
sobre un módulo que **todavía no ha funcionado nunca de punta a punta en producción** — y esta misma
semana se vio lo caro que sale un fallo mudo cuando no se sabe cuál de las piezas falla. Hacerlo
después del segundo tenant significa migrar datos de varias agencias en vez de una.

## Plan de migración

Los refresh tokens son **desechables**, y eso simplifica todo: no hay histórico que preservar.

1. Migración que crea `google_conexiones` y agrega `clients.google_conexion_id`, sin tocar los datos.
2. Para cada fila con `google_refresh_token` no nulo: crear una conexión por fila y enlazarla. **Sin
   deduplicar por valor del token**, aunque sean el mismo: deduplicar exigiría leer la credencial, y
   el único beneficio sería cosmético. La consolidación real ocurre sola en la siguiente reconexión.
   La migración corre como dueño de la tabla, así que puede; la cuestión es que no hace falta.
3. `cuenta_email` queda en `null` para las filas migradas: no sabemos con qué cuenta se consintió, y
   **inventarlo sería peor que dejarlo vacío**. El campo es `not null` sólo para las conexiones
   nuevas — o se admite `null` y se documenta por qué. **Decisión abierta, ver abajo.**
4. Migración posterior, aparte: retirar `clients.google_refresh_token`.

## Preguntas abiertas que esta propuesta NO puede cerrar sola

1. **¿Una agencia conecta UNA cuenta de Google, o varias?** Es la pregunta de la que depende todo el
   diseño. Si la respuesta es siempre una, la tabla de conexiones es ceremonia y basta una columna en
   `tenants`; la condición 2 (FK compuesta) sobraría. Si pueden ser varias, la tabla es obligatoria.
   **Hoy no está contestada.**
2. **El tope de refresh tokens por par (cliente OAuth, usuario).** Es el argumento cuantitativo más
   fuerte a favor del cambio y **no está verificado**. Conviene confirmarlo en la documentación de
   Google antes de usarlo como justificación.
3. **`cuenta_email` en las filas migradas**: ¿se admite `null` con un comentario que explique por
   qué, o se exige completarlo a mano antes de migrar?
4. **¿Esto es sólo Google?** `clients` también guarda `storyblok_public_token` /
   `storyblok_preview_token` (ADR-04, migración `0007`), que son credenciales de tercero con el mismo
   patrón. Si el ADR-25 va a decir "dónde viven las credenciales de terceros", tiene que decidir si
   habla de Google o de todas — y si es de todas, el alcance es mayor que lo que describe este
   documento.

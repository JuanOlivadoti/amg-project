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

> **Simplificada el 2026-10-15**, al contestarse la pregunta abierta que sostenía todo el diseño:
> **cada agencia conecta UNA cuenta de Google**. La versión anterior proponía una tabla de conexiones
> N-por-tenant con una FK compuesta desde `clients`. Con una sola cuenta por agencia eso era
> ceremonia, y el propio documento lo advertía. Lo que sigue es lo que queda cuando se quita.

**La credencial deja de vivir en la fila del cliente y pasa a una tabla con UNA fila por tenant.**

```
google_conexiones
  tenant_id      uuid primary key references tenants(id) on delete cascade
  refresh_token  text not null          -- la credencial; nadie con login la lee
  cuenta_email   text not null          -- QUÉ cuenta consintió
  conectada_en   timestamptz not null
  creada_por     uuid

clients
  google_location_id   text             -- se queda donde está. NULL = esta ficha no está conectada
  (google_refresh_token: se retira)
```

**`tenant_id` ES la clave primaria.** No es un detalle de implementación: es la forma de decir
"exactamente una conexión por agencia" de modo que Postgres lo impida, en vez de que lo recuerde
quien escriba el próximo endpoint. Si algún día una agencia necesitara dos cuentas, el cambio es
quitar esa restricción y agregar un id propio — no rediseñar.

Ninguna de estas condiciones es opcional:

1. **La asimetría del grant sobrevive intacta.** `app_user` puede escribir la conexión y **no tiene
   `select` sobre `refresh_token`**. El único lector sigue siendo `app_resenas` por función
   `security definer`. Es la propiedad que estableció la `0021` y este rediseño no la relaja.
2. **"Conectado" pasa a ser una conjunción:** el tenant tiene conexión **y** el cliente tiene
   `google_location_id`. Desconectar una ficha es poner su `location_id` en `null`; desconectar la
   agencia entera es borrar su fila de `google_conexiones`.
3. **Desvincular un cliente NO puede dejar sin credencial a los demás** — y con esta forma deja de
   ser una regla que haya que recordar: desconectar una ficha ni siquiera toca la tabla de
   conexiones. La versión anterior necesitaba una condición explícita para esto; acá el error es
   inexpresable.
4. **`cuenta_email` no es decorativo.** Sin él, "reconectá" es una instrucción incompleta: nadie sabe
   con qué cuenta hay que volver a consentir.
5. **`clients.google_refresh_token` se marca obsoleta y se retira en una migración POSTERIOR**, no en
   la misma que mueve los datos. Una columna que ya nadie lee pero sigue existiendo invita a que
   alguien la vuelva a usar; retirarla en el mismo cambio mezcla dos riesgos.

## Por qué no las alternativas

- **Tres columnas en `tenants`.** Es la alternativa obvia una vez que hay una sola cuenta por
  agencia, y se descarta por una razón **verificada, no estética**: la `0001` concede
  `grant select on tenants, memberships to app_user` **a nivel de tabla**, y la `0002` hace lo mismo
  para `app_service`. Meter ahí una columna que nadie debe leer obliga a revocar ese grant y
  reconcederlo **columna por columna, para dos roles**, sobre la tabla más leída del esquema — el
  mismo trabajo invasivo que la `0021` tuvo que hacer en `clients`, repetido en un sitio más
  delicado. Una tabla aparte tiene grants triviales porque no existe para nada más.
- **Una tabla de conexiones N-por-tenant** (la versión anterior de este documento). Descartada al
  contestarse la pregunta abierta: cada agencia conecta una cuenta. Diseñar la tabla para N cuando el
  dominio dice una es pagar complejidad por una hipótesis.
- **Dejarlo como está, una credencial por ficha.** Funciona hoy, y el coste de aplazar es bajo porque
  los refresh tokens son desechables. Pero el coste no desaparece: se multiplica por cada agencia que
  se dé de alta, y el momento barato para cambiarlo es antes del segundo tenant.
- **Una credencial global de la plataforma.** Rompe el aislamiento entre tenants de raíz. Pregunta de
  ADR-19 —*si me lo toman, ¿qué se llevan?*— la respuesta sería "todo". Descartada sin discusión.

## Qué cuesta, medido

`google_refresh_token` / `google_location_id` aparecen en **seis migraciones** (`0021`, `0022`,
`0025`, `0026`, `0031`, `0034`) y **seis archivos de código** fuera de tests (`db/src/clientes.ts`,
`db/src/resenas.ts`, `api/src/app.ts`, `api/src/google-oauth-live.ts`, `api/src/oauth-state.ts`,
`orchestrator/src/google/live-provider.ts`), más el portal y sus tests.

La pieza delicada sigue siendo **`app.clientes_conectados_google()`** (migración `0022`), la función
`security definer` que el polling usa para recorrer todos los tenants. Con el modelo nuevo hace un
join entre `clients` y `google_conexiones` y tiene que seguir devolviendo **exactamente los mismos
campos**: ni uno más de lo que `app_resenas` ya puede ver.

## Cuándo

**Después** de que el módulo complete un ciclo real en producción con un cliente, y **antes** de dar
de alta al segundo tenant. Hacerlo antes es depurar dos incógnitas a la vez sobre un módulo que
todavía no funcionó nunca de punta a punta; hacerlo después es migrar datos de varias agencias.

## Plan de migración

Los refresh tokens son **desechables**: no hay histórico que preservar, y eso simplifica todo.

1. Migración que crea `google_conexiones` y no toca nada más.
2. Por cada tenant con al menos un cliente conectado: crear **una** fila tomando el `refresh_token` de
   cualquiera de sus clientes conectados. Con una cuenta por agencia, todos son tokens del mismo
   usuario de Google, así que cuál se elija es indistinto — y el primer reconsentimiento los sustituye.
3. `cuenta_email` queda vacío en las filas migradas: no sabemos con qué cuenta se consintió, e
   **inventarlo sería peor que dejarlo vacío**. Admite `null` sólo para ese caso, con el comentario
   que lo explique, y el endpoint lo exige para las conexiones nuevas.
4. Migración posterior, aparte: retirar `clients.google_refresh_token`.

## Preguntas abiertas

1. ~~¿Una agencia conecta UNA cuenta de Google o varias?~~ — **Contestada el 2026-10-15: una.** Es lo
   que simplificó el diseño entero.
2. **El tope de refresh tokens por par (cliente OAuth, usuario)**, que el modelo actual multiplica.
   Era el argumento cuantitativo a favor del cambio y **sigue sin verificar**. Conviene confirmarlo en
   la documentación de Google antes de usarlo como justificación — aunque con el modelo nuevo deja de
   importar, porque se acuña un token por agencia y no uno por ficha.
3. **¿Esto es sólo Google?** `clients` también guarda `storyblok_public_token` /
   `storyblok_preview_token` (ADR-04, migración `0007`): credenciales de tercero con el mismo patrón,
   pero **por cliente y no por agencia**, así que el modelo de arriba no les aplica tal cual. Si el
   ADR-25 va a titularse "dónde viven las credenciales de terceros", o las cubre con su propia
   respuesta o acota el título a Google y lo dice.

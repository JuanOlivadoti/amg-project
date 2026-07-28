# Verificación de JWT con ES256 (JWKS) — diseño

> **Estado:** aprobado el 2026-07-26. Es la **pieza A** de cuatro (ver §Contexto).
> **Bloquea todo lo demás:** hoy ningún login funciona contra la API en producción.
>
> **Revisado el 2026-07-26** tras una revisión externa (Codex) del spec y del plan. Los cambios de
> diseño que salieron de ahí están incorporados abajo y marcados con *(revisión)*. Los tres de fondo:
> el emisor se valida como ancla de confianza y no solo como `https`; el verificador distingue
> *"token inválido"* de *"no pude comprobarlo"*; y la lista de algoritmos se fija con un test de
> **ES384**, porque se midió que el de HS256 no cae bajo mutación.

---

## El problema

Desde el despliegue de Fase 1, cualquier login termina en `401 Token inválido o expirado`
(`api/src/auth.ts:92`).

No es un error de configuración del deploy: **el proyecto de Supabase firma los tokens con `ES256`**
y la API solo acepta `HS256`. Comprobado contra el JWKS público del proyecto, que declara una única
clave `{"alg":"ES256","kty":"EC","crv":"P-256","use":"sig"}`.

Supabase migró a claves asimétricas; el proyecto se creó el 2026-07-25 y nació con el esquema nuevo.
El "Legacy JWT Secret" del panel sigue existiendo, pero **ya no es con lo que se firman los tokens de
usuario**. El código se escribió cuando Supabase firmaba en HS256: es deuda de contexto, no un bug de
lógica.

## Qué se decide acá

Verificar contra el **JWKS público** de Supabase en vez de un secreto compartido.

Se descartaron dos alternativas:

- **Volver el proyecto a HS256.** Cero código, pero rema contra la dirección del producto, conserva
  un secreto compartido en Railway y puede no estar disponible en proyectos nuevos. Deuda a seis
  meses.
- **Aceptar ambos algoritmos.** Dos caminos en el borde de seguridad más crítico del sistema. Este
  proyecto lleva diez reviews **eliminando** opcionalidad ahí: `algorithms: ["HS256"]` existe porque
  la 9ª review encontró que sin esa línea entraba un HS512 firmado con el mismo secreto. Reabrirlo
  sería desandar ese camino.

La razón de fondo para elegir JWKS **no es que sea lo moderno**: es que `SUPABASE_JWT_SECRET`
desaparece del sistema. Hoy ese secreto vive en las variables de Railway, en `docs/private/` y quedó
en el transcript de una sesión de trabajo. Con JWKS no hay secreto compartido que filtrar — la clave
privada nunca sale de Supabase y la pública es pública por definición. Es **menos superficie**, no
solo código más nuevo.

---

## Paso 0 — ✅ HECHO (2026-07-26): el diseño está validado contra el proyecto real

Antes de escribir código se verificó un token de producción **de verdad**, no se asumió. Resultado:

| Qué se comprobó | Resultado |
| --- | --- |
| `header.alg` | **`ES256`** |
| `header.kid` | `2e9e5796-…` — **coincide** con la única clave del JWKS del proyecto |
| `claims.iss` | `https://<ref>.supabase.co/auth/v1` — como se esperaba |
| `claims.aud` | **`authenticated`** — `AUD_SUPABASE` **no cambia** |
| `app_metadata` | trae `tenant_id` y `rol` — el portal sigue teniendo lo que necesita |
| **Verificación contra el JWKS remoto** | **✔ verifica**, con las opciones exactas que usará la API |
| Contraprueba `algorithms: ["HS256"]` | **✔ rechazado** (`"alg" Header Parameter value not allowed`) |

La prueba corrió `createRemoteJWKSet` contra el JWKS real y `jwtVerify` con
`algorithms:["ES256"]`, `requiredClaims:["exp","sub"]`, `audience:"authenticated"` e `issuer` — es
decir, **la configuración final del diseño**, sobre un token real, y funcionó.

Esto elimina el riesgo principal del cambio: no hay que descubrir en la implementación que la
audiencia cambió o que el `iss` no es el que se cree. Lo que queda es escribirlo bien y testearlo.

> **Nota de seguridad del proceso:** el token de prueba llegó dentro de una sesión completa, con su
> `refreshToken`. Un refresh token no caduca y permite acuñar access tokens hasta que se revoque.
> Para inspeccionar un token alcanza con el **payload decodificado**, que no sirve como credencial.
> La sesión usada acá se revocó desde el panel de Supabase.

### Hallazgo colateral: el logout no revoca nada

Al verificar lo anterior salió a la luz que `AuthService.logout()`
(`portal/src/app/services/auth.ts:43`) **solo borra el `localStorage`**: no llama a Supabase, así que
**el refresh token sigue válido del lado del servidor** después de "cerrar sesión".

Un logout que no revoca es una promesa a medias: si a Frank le roban el equipo y cierra sesión desde
otro lado, el token robado sigue acuñando access tokens. Y el refresh token **no caduca solo**.

Entra en el alcance de esta pieza: es el mismo archivo, el mismo tema y el mismo borde de
autenticación. El arreglo es llamar al endpoint de logout de Supabase (`POST /auth/v1/logout` con el
access token) y limpiar el estado local **igual aunque la llamada falle**: si la red está caída, el
usuario tiene que quedar deslogueado en su navegador de todas formas. Un logout que falla y deja la
sesión abierta en pantalla es peor que uno que no revoca.

**El orden es al revés de lo que parece natural** *(revisión)*. El diseño original decía "revocar y
después limpiar en un `finally`". Eso deja la UI autenticada mientras el `fetch` está en vuelo — y
`fetch` no tiene timeout propio, así que puede colgar indefinidamente. Se limpia **primero**, de
forma síncrona, y la revocación viaja después con el token ya capturado.

**Y hay cuatro carreras que ningún `finally` cubre** *(revisión, en dos vueltas)*:

- Un **refresh en vuelo** que resuelve *después* del logout escribe una sesión válida: el portal
  queda autenticado sin que nadie lo pidiera.
- Una **revocación lenta** que termina después de que el usuario volvió a entrar borraría la sesión
  **nueva**.
- Un **login en vuelo** que resuelve después de un logout reabre la sesión.
- Un **refresh de la sesión vieja disparado después de arrancar un login** sobrescribe la sesión
  nueva con la anterior.

Se cierran con **dos guardas, y hacen falta las dos**:

- **Identidad de la sesión capturada.** El refresh recibe la sesión a refrescar por parámetro y, antes
  de escribir, comprueba que siga siendo la viva. Cubre los tres casos de una vez: tras un logout
  `_sesion()` es `null`, tras otro login es otro objeto, y en el caso normal es el mismo.
- **Época.** Un contador que cambia en cada login y cada logout. Es para el **login**, la única
  operación que no tiene sesión previa contra la cual compararse porque crea una nueva.

*Por qué no alcanza solo la época* — y este fue el hallazgo de la segunda revisión: la época cambia
al **iniciar** una operación, así que un refresh disparado *después* de arrancar un login comparte su
época, pasa la guarda y escribe la sesión vieja encima de la nueva. Solo la identidad lo frena.

*Y por qué no alcanza solo la identidad:* el login no tiene con qué compararse.

Además, la promesa de refresh compartida (`refrescoEnVuelo`, que existe para no disparar N refrescos)
se comparte **solo dentro de la misma sesión**. Compartirla entre sesiones hacía que el refresh de la
sesión nueva devolviera el resultado de la vieja —normalmente `false`—, y el cliente propagara un 401
que no correspondía.

**Alcance de la revocación:** global — el default de `POST /auth/v1/logout` sin `scope`. Es el que
corresponde al caso que motiva la función (el equipo robado): revoca los refresh tokens de todas las
sesiones del usuario. **Lo que no hace**, y hay que decirlo: los access tokens ya emitidos siguen
siendo válidos hasta su `exp` (una hora). La API los verifica localmente contra el JWKS y no consulta
a Supabase en cada request, así que la revocación corta la **renovación**, no el acceso en curso.
Cortarlo de inmediato exigiría comprobar la sesión contra el servidor en cada llamada; ese costo no se
justifica acá.

> ### ⚠️ Actualización (2026-07-27) — el alcance pasó a `local`, y con eso desapareció una carrera
>
> Decisión del dueño del producto, no un hallazgo técnico: el botón dice "Salir", no "Salir de todos
> los dispositivos" — cierra ESTA sesión, no las de todos los dispositivos del usuario (una acción de
> ese tipo necesitaría ser explícita y separada, y hoy no existe). `cerrarSesion` pasa `?scope=local`.
>
> Eso **le quitó la razón de existir** a una de las dos guardas de esta sección: la "revocación
> lenta" que arriba se describe como una de las cuatro carreras (línea 100-101) solo podía matar una
> sesión nueva porque el alcance era GLOBAL — una revocación tardía de la sesión vieja alcanzaba
> también al refresh token de la sesión que se acababa de crear. Con `local`, una revocación tardía
> solo puede tocar el refresh token de la sesión que la originó, que ya está muerta localmente: la
> carrera desaparece por construcción, no por una guarda nueva. El mecanismo que la cerraba
> (`revocacionEnVuelo`, que `AuthService.login()` esperaba antes de pedir un token nuevo) se **borró**
> junto con la razón de que existiera. Las otras tres carreras de esta sección siguen vivas y sus
> guardas (identidad de sesión, época) se mantienen sin cambios.

---

## Diseño

### Arquitectura

`verificadorSupabase` deja de recibir un secreto y pasa a recibir un **resolvedor de claves**
(`JWTVerifyGetKey` de `jose`). Esa inversión es lo que hace testeable el cambio:

- **Producción** lo arma con `createRemoteJWKSet(new URL(jwksUrl))` — cachea, refresca solo y
  soporta rotación de claves sin redeploy.
- **Tests** inyectan un JWKS **local** (`createLocalJWKSet`) con una clave generada en el propio
  test. La suite sigue **sin red**, como el resto del proyecto.

Las **comprobaciones** del verificador no cambian: `requiredClaims: ["exp","sub"]`, el chequeo de
`aud`, el de `iss` y el rechazo de `sub` en blanco quedan igual. Sigue siendo un fix acotado.

`algorithms` pasa de `["HS256"]` a `["ES256"]`. Sigue siendo una lista cerrada de un solo algoritmo:
la lección de la 9ª review se conserva, solo cambia cuál.

Lo que **sí** cambia además de la firma *(revisión)*:

- El emisor se canoniza y valida en una función pura (`emisorSupabase`), y de ese **único** valor
  salen el `iss` que se exige y la URL del JWKS. Ver §Configuración.
- El resultado deja de ser binario: se agrega `NO_DISPONIBLE` para los fallos que no hablan del
  token. Ver §Errores.

### Configuración

| Variable | Antes | Después |
| --- | --- | --- |
| `SUPABASE_JWT_SECRET` | obligatoria | **eliminada** |
| `SUPABASE_JWT_ISS` | opcional | **obligatoria** |
| `SUPABASE_JWT_AUD` | opcional | opcional (sin cambios) |

El JWKS **se deriva** de `SUPABASE_JWT_ISS` (`<iss>/.well-known/jwks.json`). No se agrega ninguna
variable nueva.

Que `iss` pase a obligatoria tiene un efecto de seguridad deseado: hoy es opcional, así que un token
emitido por **otro** proyecto de Supabase entraría si compartiera el secreto. Al volverse obligatoria,
el proyecto emisor queda amarrado por construcción, no por convención.

**El emisor es el ancla de confianza, y se valida como tal** *(revisión)*. Si de `SUPABASE_JWT_ISS`
sale la clave con la que se comprueba **toda** la autenticación, entonces esa variable no es un dato
de configuración más: es la raíz de confianza del sistema. Se canoniza y se valida **una sola vez**,
al arrancar, en una función pura (`emisorSupabase`):

- **`https`**, host de `supabase.co`, ruta `/auth/v1`, sin puerto, credenciales, query ni fragment.
- Exigir solo `https` **no alcanzaba**: `https://atacante.example/auth/v1` es https y válido, y
  habría sustituido el emisor de confianza entero — a partir de ahí, cualquier token que ese host
  firmara entra. No es una petición saliente indeseada, es un cambio de dueño de la autenticación.
- **Una sola canonización, para los dos usos.** Si se le quitara la barra final solo para armar la
  URL del JWKS, el `iss` que se le exige al token quedaría *con* la barra, no coincidiría con el que
  emite Supabase y **ningún token verificaría** — exactamente el 401 total que este cambio arregla.

*Limitación aceptada:* un dominio de auth propio (Supabase lo permite) no pasa esta validación.
Ampliarla sería una decisión deliberada; mientras tanto el fallo es ruidoso y al arrancar, no
silencioso y en cada login.

Hay que actualizar, en este orden: `api/src/deps.ts` (validación de obligatorias),
`api/.env.example`, el `MAPA` de `scripts/env-sync.mts`, `docs/private/credenciales.env` y las
variables del servicio en Railway.

> El test `api: MAPA coincide EXACTAMENTE con su .env.example` **va a fallar** hasta que el `MAPA` y
> el `.env.example` se actualicen juntos. Eso es el test funcionando: obliga a decidir explícitamente
> qué claves recibe la API.

### Errores: fallar cerrado, pero sin mentir *(revisión)*

Si el JWKS no se puede obtener —Supabase caído, DNS roto, timeout—, la verificación **falla**. Nunca
"dejar pasar porque no se pudo comprobar".

Pero fallar cerrado **no obliga a responder siempre lo mismo**. Devolver `401` en ese caso tiene una
consecuencia concreta: el portal interpreta cualquier `401` como *token vencido*, así que dispara un
refresh, lo quema y termina cerrando la sesión. Una caída del JWKS —una dependencia de red que este
cambio **introduce**— desloguearía a todo el mundo y se vería como un problema de credenciales.

Por eso el verificador tiene tres resultados en vez de dos:

| Resultado | Significa | La API responde |
| --- | --- | --- |
| `{ userId }` | el token es válido | sigue |
| `null` | el token es inválido | **401** |
| `NO_DISPONIBLE` | no se pudo comprobar | **503** |

Los dos últimos **deniegan igual**: no es una relajación del borde, es información. Y el 503 le dice
al portal que no toque la sesión.

**Cómo se clasifica, y por qué así.** Con una *allowlist de códigos de token* de `jose`
(`ERR_JWT_EXPIRED`, `ERR_JWS_SIGNATURE_VERIFICATION_FAILED`, `ERR_JOSE_ALG_NOT_ALLOWED`, …); todo lo
demás cuenta como infraestructura. La dirección importa y está **medida**: un fallo de red no siempre
trae un código de `jose` — un resolvedor que rechaza llega **sin `code`**, y `createRemoteJWKSet`
contra un host muerto llega con `ECONNREFUSED`, que es de Node. Enumerar lo enumerable (los errores
del token) y tratar el resto como "no pude comprobar" es lo único que no deja casos sin clasificar.

`createRemoteJWKSet` cachea la clave y refresca con *cooldown* (medido en jose 5.10.0: timeout 5 s,
cooldown 30 s, cache 10 min), así que un corte breve no se nota y la rotación de claves se resuelve
sola. Durante una rotación puede haber una ventana de ~30 s en que un `kid` recién publicado no se
resuelve; es aceptable porque Supabase publica la clave nueva **antes** de empezar a firmar con ella,
y la anterior sigue en el JWKS.

**Ese razonamiento no aplica a una rotación de emergencia** *(revisión)*, y hay que dejarlo escrito
porque es justo cuando importa. Si una clave se retira **de forma reactiva** —por sospecha de
compromiso—, el caché local puede seguir aceptando firmas de la clave retirada **hasta 10 minutos**, y
los tokens de la clave nueva pueden recibir 401 hasta que termine el cooldown. Publicar-antes-de-firmar
no ocurre en ese escenario. El procedimiento de emergencia, entonces, **no es solo rotar en Supabase:
hay que reiniciar el servicio de la API** (o forzar la recarga del resolvedor) para vaciar el caché.
Va al runbook.

### Tests

Los actuales (`api/src/auth.test.ts`) firman con un secreto simétrico, así que se rehace el andamiaje:
generar un par EC en el test (`generateKeyPair('ES256')`), firmar con la privada, verificar contra un
JWKS local con la pública.

**Se conservan los doce casos que ya existen** *(revisión: son 12, no 10 — el conteo original se
escribió de memoria)*, traducidos a ES256. Ninguno se descarta:

| Caso actual | Qué protege |
| --- | --- |
| token válido → devuelve el `sub` | el camino feliz |
| sin `exp` | que un token no sea eterno (`requiredClaims`) |
| expirado | la caducidad |
| firmado por otro emisor | la firma (pasa de "otro secreto" a "otra clave") |
| sin `sub` | que haya a quién identificar |
| `sub` vacío | que no se ponga `app.user_id = ''` |
| `sub` de solo espacios | lo mismo, con `trim` |
| otro `iss` | que un token de otro proyecto no entre |
| otra `aud` | que un token para otra app no entre |
| **`alg: none`** | **el bypass clásico de JWT** — crítico conservarlo |
| `alg` fuera del contrato (era HS512) | que la política declarada se **imponga** |
| basura → `null`, no lanza | que un token malformado no tumbe la API |

**Se agregan** *(revisión)*:

1. **Resolvedor caído → `NO_DISPONIBLE`.** Que el fallo de red no abra la puerta *y* no se confunda
   con una credencial mala. Se **inyecta** un resolvedor que rechaza: nada de apuntar a
   `127.0.0.1:1`, que abriría un socket y rompería el invariante de suite sin red.
2. **Token inválido → `null`, no `NO_DISPONIBLE`.** El complemento del anterior: sin este, mandar
   todo a `NO_DISPONIBLE` dejaría el 401 sin existir y la suite en verde.
3. **Token HS256 → rechazado.** Contrato, no prueba de la lista de algoritmos (ver abajo).
4. **`kid` desconocido → rechazado**, y **token sin `kid` → aceptado** si el JWKS tiene una sola
   clave compatible. Lo segundo está medido y se fija como **decisión**: la clave sale igual del
   conjunto de confianza, y exigir `kid` nos ataría a un detalle del header que Supabase puede
   cambiar. Si algún día se decide exigirlo, ese test es el que tiene que cambiar.
5. **El emisor canónico**: barra final, host ajeno, `http`, ruta distinta, query, fragment, puerto y
   credenciales embebidas.

El de `alg: none` merece atención especial: con verificación asimétrica el atacante conoce la clave
**pública**, así que un verificador mal configurado que acepte `none` —o que acepte `HS256` usando la
clave pública como secreto— es explotable **sin conocer ningún secreto**. Con `HS256` compartido ese
ataque no existía.

**La lista de algoritmos se fija con ES384, no con HS256** *(revisión — y este fue el hallazgo más
caro)*. El diseño original decía: "agregá `HS256` a la lista y confirmá que cae exactamente ese test".
Se ejecutó y **no cae ninguno**: con un resolvedor JWKS, `jose` rechaza `HS256` aunque el algoritmo
esté permitido, porque no resuelve claves HMAC desde un JWKS (`ERR_JOSE_NOT_SUPPORTED`). La mutación
habría pasado en verde y la "garantía" habría sido falsa — la clase exacta de test que este proyecto
viene eliminando.

El test que sí la fija usa **ES384 con su clave pública dentro del JWKS de prueba**: es realmente
resoluble, así que al abrir la lista el token verifica y el test cae. Verificado ejecutándolo.

**Verificación por mutación** (no negociable): además del algoritmo, se mutan la clasificación de
errores (en las dos direcciones) y, en el portal, el orden de limpieza y la guarda de época. Cada
mutación tiene que tumbar **exactamente** el test que la nombra.

### Documentación a actualizar al cerrar

*(revisión: la lista original se quedaba corta. `SUPABASE_JWT_SECRET` y `HS256` sobreviven en más
lugares de los que se habían anotado, y varios son **instrucciones operativas** que quedarían
mandando copiar un secreto que ya no existe.)*

- `docs/proyecto/12-credenciales.md` — `SUPABASE_JWT_SECRET` ya no existe.
- `docs/proyecto/13-runbook-despliegue.md` — B.1 (ya no hace falta copiar el JWT Secret), C.5 (la
  tabla de variables de Railway pasa de 6 a 5) y el troubleshooting, que hoy nombra el secreto.
- `api/README.md` — el `alg` que verifica, el ejemplo de arranque y la tabla de variables.
- `docs/proyecto/03-stack.md` — el comentario del árbol dice `alg fijado a HS256`.
- `docs/proyecto/09-estado-y-roadmap.md` — la tabla de variables por paquete.
- `docs/proyecto/12-despliegue-fase-1.md` — la fila del secreto.
- `portal/src/app/core/auth-core.ts` — el comentario de cabecera.
- `docs/decisiones-arquitectura.md` — **ADR-23: la API verifica identidad contra el JWKS del emisor,
  no contra un secreto compartido.**
- Sincronizar las cifras de tests donde aparezcan.

**No se toca** `docs/proyecto/08-testing-calidad.md`: su mención de HS256 es el registro histórico de
la 3ª review, no una instrucción. La regla es corregir lo que hoy es falso y dejar lo que es memoria.

---

## Contexto: la demo con Frank y las otras tres piezas

Este spec sale de una sesión de diseño sobre **la demo de venta a Frank**. Las decisiones tomadas ahí
son la entrada de las piezas C y D, y se registran para no perderlas.

**Qué se vende:** la **plataforma para su agencia** — Frank gestionaría varios restaurantes. El
objetivo de la demo es **cerrar la venta**.

**El recorrido de tres golpes**, aprobado:

1. **Dashboard** → panorama de cartera + economía. El "wow".
2. **Entrar a un cliente** → la compuerta humana. No se cuenta, se ve.
3. **Entrar a una página** → la evidencia (✅ respaldada / ⚠️ sin validar).

La compuerta y el rigor **no compiten** con velocidad y panorama: son lo que las hace creíbles. La
objeción que mata esta venta no es el precio, es *"si esto publica una barbaridad en el sitio de mi
cliente, pierdo al cliente"*. Los pasos 2 y 3 **ya existen**; solo se construye el 1.

### Las cuatro piezas

| # | Pieza | Tamaño | Depende de |
| --- | --- | --- | --- |
| **A** | Verificación JWT ES256 — **este spec** | Chico | — |
| **B** | Modo oscuro (**solo el portal**) | Chico | — |
| **C** | Dashboard de cartera + seed de 4-6 restaurantes | Medio | A |
| **D** | Research en vivo (desplegar el orquestador) | Grande | A + la medición |

**B — modo oscuro:** solo el portal. El renderizador queda afuera a propósito: la web pública es la
marca del restaurante y ahí el tema lo decide su diseño.

**C — el dashboard:** cartera **sembrada** con 4-6 restaurantes ficticios en distintos estados. Los
datos para poblarlo **ya existen y están sin explotar**: cada página trae `volumen`, `dificultad`,
`opportunity_score`, `score_confidence`, `intencion`, `local`, `cluster_id` y `evidencia`; cada run
trae `coste_micros_usd` y `calidad_datos`. Se puede construir **sin tocar la API**.

**D — research en vivo:** decidido que debe ser **real**, no guionado. El orquestador **ya está
construido** (Inngest, `workflow.ts`, `functions.ts`, 18 tests): falta desplegarlo y conectarlo, no
escribirlo. Es despliegue e integración.

### La medición que condiciona D

`11-plan-fase-2.md:299` arrastra esta incógnita: **cuánto tarda un research real nunca se midió**. Se
conoce el coste ($0.31), no la duración.

Es lo que decide si D vale la pena:

- **~90 segundos** → mostrarlo en vivo es el mejor momento de la demo.
- **~12 minutos** → Frank mira un spinner y la demo se muere ahí. No hay dashboard que lo salve, y se
  habría construido D en contra del objetivo.

**Acordado: medir primero.** Una corrida real cronometrada (~$0.31), en paralelo a A/B/C, que no
dependen del resultado. **D se decide con el número en la mano.**

### Orden de trabajo

```text
A (login)  ──┬──▶  C (dashboard + seed)  ──▶  Demo
             │
             └──▶  B (modo oscuro, cuando caiga)

Medición (~$0.31, en paralelo)  ──▶  ¿D?
```

Sin fecha de demo comprometida: se ordena por dependencia. **C y D tienen su propio spec**; este
cubre solo A.

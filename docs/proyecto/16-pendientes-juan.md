# 16. Pendientes de Juan

> Checklist de las decisiones y trámites que dependen de vos — no de una sesión de desarrollo. Cada
> ítem ya está documentado en detalle en `09-estado-y-roadmap.md` o `15-plan-plataforma.md`; acá está
> resumido con un pointer a la fuente, para que lo completes de una sentada. Generado 2026-09-04 a
> partir de una auditoría de esos dos documentos.
>
> **No es un tercer lugar de estado**: si esto y `09`/`15` alguna vez se contradicen, ganan `09`/`15` —
> este archivo es un formulario, no la fuente de verdad. Cuando resuelvas un ítem, decímelo y lo tacho
> acá y actualizo la fuente.

> ## ✅ Recorrido entero el 2026-09-10 — queda abierto UN ítem: los dos números del § 7
>
> Se repasó decisión por decisión con Juan. Estado final: **#1, #3, #8, #9, #10 resueltos**;
> **#4, #5, #6, #7 (forma) y #2 decididos hoy**. Lo único que falta que escriba Juan son los **dos
> importes** de la salida gestionada (§ 7), y dos **acciones suyas** que no son decisiones:
>
> 1. Poner **`CACHE_TTL_MS=60000`** en Railway (servicio del renderizador).
> 2. Comprobar si hoy hay algún cliente con **conexión de Google** en producción — ver la trampa
>    documentada en § 2.

---

## 1. ~~Rotación de credenciales expuestas~~ — RESUELTO 2026-09-05 (según vos)

`docs/private.zip` estuvo commiteado en el repo público desde el 2026-08-01. Se sacó del índice, pero
**el objeto sigue en el historial de GitHub** — purgar no des-expone, rotar sí. Pospuesto por vos el
2026-08-04. Fuente: `15-plan-plataforma.md § Riesgo abierto`.

Dijiste primero "lo he eliminado" (que no alcanza — el objeto sigue en el historial de git) y después
confirmaste que rotaste las credenciales que estaban DENTRO del zip. Marco resuelto por tu palabra —
no tengo forma de verificar desde acá qué contenía el archivo ni si la rotación fue completa, así que
si más adelante aparece algo que dependía de esas credenciales fallando, este es el primer lugar a
revisar.

---

## 2. Acceso real a la Business Profile API de Google

Trámite externo con Google, necesario para `GOOGLE_REVIEWS_MODO=live` (hoy todo el módulo de reseñas
funciona con datos mock). Bloquea en cascada: detectar cuándo un cliente revoca el `refresh_token`.
Fuente: `15-plan-plataforma.md § Bloque F`, línea ~1336.

> ### 🔄 CORREGIDO el 2026-09-22 — el acceso a la API YA ESTÁ CONCEDIDO; el bloqueo es OTRO
>
> **El diagnóstico de abajo (2026-09-04) midió la API equivocada y la conclusión quedó mal.**
> Verificado con el `gcloud` CLI autenticado como `argentinosporespana@gmail.com`, que es la cuenta
> que sí ve el proyecto `amg-automation` (`546581198843`).
>
> **`mybusiness.googleapis.com` — la v4 legacy, la ÚNICA que lee y responde reseñas
> (`accounts.locations.reviews.list` / `.updateReply`) — está habilitada y con cuota real concedida:**
>
> | Métrica | Límite efectivo |
> | --- | --- |
> | Requests | **250.000/día**, 600/min |
> | **Update requests** (lo que consume `updateReply`) | **10.000/día**, 300/min |
> | V4 General Requests | 3.000/min |
> | Create requests | 100/día, 60/min |
>
> **Por qué el diagnóstico viejo se equivocó:** probó `GET /v1/accounts`, que es de
> `mybusinessaccountmanagement` **v1** — una API distinta, que efectivamente sigue en cuota `0`. El
> módulo de reseñas no la necesita. De medir una API se concluyó sobre otra.
>
> **Confirmación independiente:** en los otros dos proyectos de la otra cuenta (`dinamicseo`,
> `jmmoldes`) `mybusiness.googleapis.com` **ni siquiera aparece entre las APIs disponibles para
> habilitar**. Google sólo la expone a proyectos aprobados — que esté habilitada en `amg-automation`
> *es* la aprobación. Método de lectura de cuota: `serviceusage.googleapis.com/v1beta1/.../
> consumerQuotaMetrics`; un bucket **vacío** significa cero (contrastado contra BigQuery y Places, que
> sí devuelven límites numéricos en los mismos proyectos).
>
> ### ⚠️ 2026-09-26 — NO es un trámite, son DOS: tener reseñas no alcanza para CONECTAR
>
> Descubierto al implementar el provider OAuth real, verificando antes de escribir. **Conectar un
> cliente exige descubrir su ficha**, y para eso hacen falta dos APIs más:
>
> | API | Para qué | Cuota en `amg-automation` |
> | --- | --- | --- |
> | `mybusiness.googleapis.com` (v4) | leer y **responder** reseñas | ✅ 250.000/día |
> | `mybusinessaccountmanagement` | listar las cuentas de negocio | ❌ **0** |
> | `mybusinessbusinessinformation` | listar las fichas de una cuenta | ❌ **0** |
>
> **Y no hay camino alternativo:** la v4 tenía `accounts.list`, pero Google la **deprecó justamente
> en favor de la Account Management API**
> ([referencia](https://developers.google.com/my-business/reference/rest/v4/accounts/list)). Así que
> el acceso a reseñas, que sí está concedido, **no alcanza para conectar a nadie**.
>
> **Consecuencia para el pedido a AMG:** el documento de solicitud del 2026-09-25 da por hecho un solo
> trámite. Hay que pedir cuota también para esas dos APIs, o resolverlo por el otro camino (abajo).
>
> 💡 **La alternativa que evita el bloqueo entero: cargar el `locationId` a mano.** El nombre de
> recurso (`accounts/<id>/locations/<id>`) se puede sacar de la consola de Business Profile y pegarlo
> en el portal, sin llamar a ninguna de las dos APIs bloqueadas. Cuesta un campo en la ficha del
> cliente y un poco de fricción por alta; a cambio, **destraba el módulo sin depender de Google**. Es
> una decisión abierta, no una recomendación cerrada: con pocos clientes el campo manual gana, con
> muchos gana el descubrimiento automático.
>
> ### ✅ 2026-09-28 — la alternativa manual está IMPLEMENTADA: el módulo ya no depende del trámite
>
> El campo existe y funciona de punta a punta. **Con el nombre de recurso pegado a mano, conectar un
> cliente en modo `live` no toca ninguna de las dos APIs en cuota 0**, así que el trámite deja de
> bloquear el módulo y pasa a ser una mejora de comodidad.
>
> - En el portal, la pantalla de reseñas tiene un campo **opcional** junto a «Conectar Google», con la
>   forma esperada a la vista. Vacío = camino de antes (descubrir automáticamente).
> - La API valida el formato en el momento en que se pega —no diez minutos después, en el callback—,
>   y el valor viaja **dentro del `state` firmado**, no como query param.
> - El descubrimiento automático **no se borró**: vuelve a ser el camino por defecto en cuanto Google
>   conceda la cuota, sin tocar código.
>
> **Lo que sigue necesitando el trámite** (o sea: pedir cuota para `mybusinessaccountmanagement` y
> `mybusinessbusinessinformation` sigue valiendo la pena, pero ya no es urgente): que el alta de un
> cliente no exija que alguien busque y copie el nombre de recurso a mano.
>
> ⚠️ **Y ojo, que esto NO destraba el módulo entero.** Sigue haciendo falta lo de la sección de abajo:
> la app OAuth está en estado «Prueba», y ahí los refresh tokens **caducan a los 7 días**. Con el
> `locationId` a mano se puede conectar un cliente hoy, pero se desconectaría solo en una semana.
>
> ### ❌ El bloqueo REAL: la app OAuth está sin configurar
>
> Revisado en la consola (solo lectura) el 2026-09-22. Las dos mitades están en estados opuestos: la
> **API** está concedida, la **app OAuth** no sirve para este uso.
>
> | Qué | Estado |
> | --- | --- |
> | Estado de publicación | **"Prueba" (Testing)** ← el problema serio |
> | Tipo de usuario | Externo |
> | Scopes declarados | **NINGUNO.** `business.manage` no está |
> | Clientes OAuth | 1 (Aplicación web, `546581198843-aqkcsd0td...`) |
> | `redirect_uri` registrados | **sólo `https://developers.google.com/oauthplayground`** |
> | Branding | Página principal, política de privacidad y condiciones: **vacíos** |
> | Usuarios de prueba | 2 (`amgmadridequipo@`, `argentinosporespana@`) |
>
> ⚠️ **Por qué "Prueba" es el hallazgo más caro.** Una app en Testing recibe refresh tokens que
> **caducan a los 7 días**. El módulo entero depende de `clients.google_refresh_token` para pollear
> cada 30 min: se conectaría un cliente, la demo saldría perfecta, y **una semana después el polling
> dejaría de traer reseñas sin que nadie se entere** — porque la detección de revocación es
> justamente la pieza que se dejó sin construir "hasta tener acceso real". Fallo silencioso, diferido
> y en producción: la clase que ningún test ve.
>
> **Publicar a Producción elimina esa caducidad**, y NO hace falta la verificación completa de Google
> para eso: una app publicada sin verificar muestra pantalla de "app no verificada" y tiene tope de
> 100 usuarios — de sobra para AMG. La verificación completa sólo hace falta para quitar la
> advertencia y el tope.
>
> **Lo que falta, todo de consola (ver § "No se puede por CLI", abajo):**
>
> 1. Declarar el scope `https://www.googleapis.com/auth/business.manage`.
> 2. Completar Branding: página principal, política de privacidad y condiciones del servicio. **Hoy
>    el botón «Publicar app» está bloqueado por esto** (aviso textual en la consola).
> 3. Agregar el `redirect_uri` real de la API de AMG OS (hoy sólo está el OAuth Playground).
> 4. **Publicar a Producción** — el paso que mata el problema de los 7 días.
> 5. Mirar el aviso *"Tu app no está configurada para usar flujos OAuth seguros"*. Suele apuntar a
>    falta de PKCE o a flujo implícito; nuestro diseño usa authorization code con `state` firmado, así
>    que probablemente se resuelva al configurar bien el cliente.
>
> ### 📄 El paso 2 está más bloqueado de lo que parece: amgmadrid.com no tiene páginas legales
>
> Verificado el 2026-09-22 contra el HTML y el sitemap de `https://amgmadrid.com/` (WordPress). El
> sitemap lista **20 páginas** —servicios, blog, curso, galería, newsletter, diagnóstico— y **ninguna
> es política de privacidad, aviso legal, política de cookies ni condiciones del servicio**. Las ocho
> rutas típicas de WordPress (`/aviso-legal/`, `/politica-de-privacidad/`, …) devuelven **404**.
>
> ⚠️ **Cuidado con la herramienta:** un primer `WebFetch` de la home reportó enlaces de "Aviso Legal" y
> "Política de Cookies" en el pie. **Eran falsos** — el modelo que resume la página los inventó. No
> están ni en los 292 KB de HTML ni en el sitemap. La lección operativa: **un resumen de `WebFetch` no
> es evidencia; el `grep` sobre el HTML crudo sí.**
>
> Google exige una política de privacidad que **cargue** para dejar publicar la app, así que esto
> bloquea el paso 4. Y va más allá de Google: la web tiene formulario de newsletter y de "diagnóstico
> gratuito", o sea que recoge datos personales — una web española en esa situación necesita esos
> textos por RGPD y LSSI-CE de todos modos. **No es trabajo nuestro redactarlos.**
>
> ### 🔐 Requisito extra que no estaba en la lista: verificar el dominio en Search Console
>
> Para usar `amgmadrid.com` en la pantalla de consentimiento hay que añadirlo como **dominio
> autorizado**, y Google exige que los dominios autorizados estén **verificados en Google Search
> Console** por un propietario del proyecto. Hoy los autorizados son `n8n.cloud` y
> `srv1068745.hstgr.cloud`; `amgmadrid.com` **no está**.
>
> Secuencia real, entonces: crear las páginas legales → verificar el dominio en Search Console con la
> cuenta del proyecto → añadirlo como dominio autorizado → completar branding → publicar.
>
> ### 💡 La alternativa que borra casi todo lo anterior: app INTERNAL
>
> Todo el camino de arriba aplica a una app **External**. Una app **Internal** no necesita política de
> privacidad, ni verificación, ni tiene tope de 100 usuarios, **ni caduca los refresh tokens a los 7
> días**. Elimina el problema entero.
>
> La condición es que **sólo consientan cuentas de un mismo Google Workspace**, y eso depende de cómo
> trabaja AMG:
>
> - **Si cada restaurante conecta su propia cuenta** → son cuentas externas, **Internal no sirve**.
> - **Si AMG tiene acceso de gestor a las fichas** desde una cuenta propia (como suelen trabajar las
>   agencias) → sólo consiente la cuenta de AMG, e **Internal es viable** con un Workspace sobre
>   `amgmadrid.com`.
>
> Las dos cuentas vistas en el proyecto (`argentinosporespana@gmail.com`, `amgmadridequipo@gmail.com`)
> son **gmail.com**, no Workspace, así que hoy Internal no está disponible — pero si AMG tiene o puede
> tener Workspace, es de lejos el camino más corto.
>
> ⚠️ **Y esto no es sólo trámite: afecta al MODELO DE DATOS.** Hoy `clients.google_refresh_token` es
> **por cliente**, lo que asume el primer escenario (cada restaurante conecta lo suyo). Si AMG gestiona
> todo desde una cuenta, esa columna sobra: sería **una** credencial, no N. **Decidir esto antes de
> escribir la vía B**, o se construye para el caso equivocado.
>
> ❓ **Las dos preguntas para AMG**, ya enviadas en el documento de solicitud del 2026-09-25:
> (1) ¿hay Google Workspace con correos `@amgmadrid.com`? (2) ¿cómo accede AMG a las fichas de Google
> de sus clientes, con acceso de gestor a una cuenta propia o cada cliente la suya?
>
> ### 🚫 Nada de esto se puede hacer por CLI
>
> **Google apagó las APIs de administración de OAuth en marzo de 2026**, y con ellas quedaron
> deprecados `gcloud alpha iap oauth-brands` y `gcloud alpha iap oauth-clients`. La pantalla de
> consentimiento es **solo consola**: no hay API pública ni comando. Desde el CLI sólo se habilitan
> APIs y se leen cuotas — que es exactamente lo que ya está hecho.
>
> ### 🧭 Y un hallazgo lateral con consecuencias: rastro de n8n
>
> El cliente OAuth se creó el **2026-09-04**, se usó **ese mismo día y nunca más**, su único redirect
> es el **OAuth Playground**, y los **dominios autorizados son `n8n.cloud` y
> `srv1068745.hstgr.cloud`**. Eso no es el rastro de alguien integrando AMG OS: es el de alguien
> **prototipando el respondedor de reseñas en n8n**, a mano, durante una tarde — y la fecha coincide
> con el diagnóstico que quedó escrito acá.
>
> ❓ **Pregunta abierta para Juan, previa a escribir código:** ¿existe una implementación paralela del
> módulo de reseñas en n8n? Si la hay, la decisión deja de ser técnica (si AMG OS la absorbe o
> convive con ella), y construir la vía B sin saberlo arriesga duplicar algo que ya corre.
>
> ### 🐛 Bug de diseño encontrado de paso (esto sí es código)
>
> El callback es **`/clients/:id/google/callback`** — el client ID viaja **en la ruta**
> ([`api/src/app.ts:212`](../../api/src/app.ts#L212)). Google exige que el `redirect_uri` coincida
> **exacto** con uno registrado y **no admite comodines en el path**, así que **una ruta por cliente
> no puede funcionar en live**. En `mock` nunca se notó porque el callback se arma solo.
>
> **Arreglo limpio, ya casi hecho:** `EstadoOAuth` **ya lleva `clientId`** dentro del `state` firmado
> ([`api/src/oauth-state.ts:14`](../../api/src/oauth-state.ts#L14)). Basta una ruta fija
> `/google/callback` que saque el cliente del state verificado en vez del path. Cambio chico, pero
> **el plan del Bloque F no lo mencionaba** y es de los que aparecen a mitad de implementación.

**Diagnóstico (2026-09-04) — SUPERADO, ver el bloque de arriba:** el proyecto de Cloud "AMG AUTOMATION" (número `546581198843`) tiene la
API habilitada pero cuota `0` (`GET /v1/accounts` de la Account Management API devuelve `429
RESOURCE_EXHAUSTED`, `quota_limit_value: "0"`) — Google no aprobó el acceso todavía; habilitar la API
en la consola y que te aprueben el acceso son dos trámites separados. Falta enviar la **"Application
for Basic API Access"** desde `support.google.com/business/contact/api_default`. Requisito a
verificar antes de aplicar: el perfil de Business de AMG tiene que estar **verificado y activo hace
60+ días, con un sitio web cargado en la ficha** — si no cumple, Google rechaza la solicitud por
antigüedad. Aprobación: días a semanas, no bloquea desarrollo mientras tanto.

**Estado del trámite: EN PAUSA por decisión de Juan (2026-09-10) — DECISIÓN TOMADA SOBRE UN
DIAGNÓSTICO EQUIVOCADO, revisar.** No se manda la solicitud por ahora; el módulo de reseñas se queda
en `mock`. Hoy nadie reclama el módulo, así que el coste de esperar es bajo — y la aprobación puede
pedirse cuando aparezca un cliente que lo pida.

> ⚠️ **2026-09-22:** la pausa se decidió creyendo que faltaba la aprobación de la Business Profile
> API. **Esa aprobación ya estaba concedida** (ver el bloque de arriba). Lo que falta es configurar y
> publicar la app OAuth, que es trabajo de consola de minutos, no un trámite de semanas con Google.
> La premisa de la decisión cambió, así que la decisión merece revisarse.

**Lo que esta decisión NO cambia, y por eso se anota acá:** el módulo 3 queda como **demo permanente**
mientras dure (sin acceso real no hay ni una reseña real). La trampa del polling en mock **se desarmó
el 2026-09-10** (ver abajo) — precisamente porque quedarse en mock indefinidamente lo hacía MÁS
importante, no menos.

> ⚠️ **Trampa armada en producción, detectada el 2026-09-10.** `crearFuncionPollingResenas` está
> registrada **incondicionalmente** en el orquestador (`orchestrator/src/server.ts:63`). No hace nada
> mientras ningún cliente tenga conexión de Google guardada, pero **el día que alguien pulse "Conectar
> Google" en producción estando en `GOOGLE_REVIEWS_MODO=mock`**: se insertan **dos reseñas inventadas**
> ("Cliente Mock Insatisfecho" 2★ y "Cliente Mock Contento" 5★,
> `orchestrator/src/google/mock-provider.ts`) en la base **real**; se dispara una **alerta de Telegram
> de verdad** al CM por la de 2★ (`TELEGRAM_MODO=live` desde el 2026-08-24); y se gasta una **llamada
> real a OpenAI** generando el borrador de la de 5★. El radio está acotado —el `googleReviewId` es
> determinista, así que se insertan una sola vez— pero quedan permanentes en producción.
>
> **No verificado:** si hoy hay algún cliente con conexión de Google en producción (el MCP de Supabase
> de esa sesión no estaba autenticado). Vale la pena mirarlo.
>
> ✅ **DESARMADA el 2026-09-10 — pero solo para conexiones NUEVAS.** "Conectar Google" falla ahora con
> **409** cuando el modo es `mock` y el entorno es producción, en los DOS puntos del camino: `POST
> .../google/conectar` (antes de acuñar el `state`) y `GET .../google/callback` (antes de toda
> escritura — un `state` firmado antes del despliegue sigue vivo 10 minutos). La regla se calcula en
> `api/src/deps.ts` y el campo de `ApiDeps` es obligatorio, así que el typecheck no deja ningún
> arranque sin decidir.
>
> ⚠️ **Lo que el guardarraíl NO deshace: una fila que YA esté conectada.** Corta el camino de
> *conectar*; no toca `clientesConectadosGoogle()` ni el polling. Si hoy existe un cliente con
> `google_refresh_token` en producción, **sigue produciendo reseñas falsas en cada ciclo**. Por eso la
> comprobación de arriba sigue abierta y es tuya. `desconectar` NO está bloqueado, a propósito y con
> un test que lo impone: es justo el remedio que hace falta si aparece una.
>
> **El texto original de este punto decía:** que "Conectar Google" falle explícitamente cuando el modo es `mock` y
> el entorno es producción — misma doctrina que `verificarPublicacion()` ya aplica con `PIPELINE_MODO`:
> un modo que miente no debería poder arrancar en producción.

---

## 3. ~~Bot de Telegram real para las alertas~~ — RESUELTO (ya estaba, desde 2026-08-24)

`09-estado-y-roadmap.md` ya documentaba esto como cerrado desde el 2026-08-24: bot creado con
`@BotFather`, `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME`/`TELEGRAM_MODO=live` cargadas en Railway
(API y orquestador), ambos servicios levantando bien. `15-plan-plataforma.md` tenía una nota vieja
sin sincronizar que decía "pendiente" — de ahí que este checklist (generado 2026-09-04) lo listara de
nuevo; ya corregida. Lo del 2026-09-05 fue Juan reconfirmando/resincronizando `TELEGRAM_BOT_TOKEN` y
`TELEGRAM_MODO` en local (`env:sync`) — no tocó Railway, así que no cambia el estado de producción.
Confirmado el 2026-09-05: `TELEGRAM_BOT_USERNAME` también está en `docs/private/credenciales.env`
local — sin inconsistencia con Railway. Sin salvedades pendientes.

---

## 4. `CACHE_TTL_MS` — el valor real del SLA — ✅ DECIDIDO 2026-09-10 (falta aplicarlo en Railway)

El renderizador usa hoy un TTL de caché por default; falta que digas el número real que promete el
SLA para fijarlo en Railway. Fuente: `15-plan-plataforma.md § Bloque G`, `progress/current.md § Deuda
no relacionada`.

**SLA / TTL en segundos:** **60 s** — `CACHE_TTL_MS=60000` en el servicio del renderizador.

**Por qué 60 s, y qué se aceptó a cambio.** El webhook de invalidación lo dispara **solo Storyblok**;
la home, `/menu`, la nav y el pie se sintetizan desde `clients.business_profile` (Postgres) y se
hornean dentro del HTML cacheado (`renderer/src/app.ts:373-404`), así que **un cambio hecho desde el
portal —carta, perfil, contenido— no invalida nada: aparece solo cuando vence el TTL**. Con el default
de 5 min (`renderer/src/cache.ts:55`) la agencia editaba y esperaba sin forma de forzarlo. Se acepta a
cambio un colchón más corto ante una caída de la CDA de Storyblok (60 s en vez de 5 min) — el tráfico
actual hace que las peticiones extra sean despreciables.

**Queda como candidato de roadmap, NO decidido acá:** que `PATCH /clients/:id/*` invalide la cache del
renderizador desde nuestro lado (mismo mecanismo que el webhook de Storyblok, disparado por la API).
Con eso el TTL volvería a ser una red de seguridad y no el mecanismo principal.

**Acción pendiente de Juan:** poner `CACHE_TTL_MS=60000` en Railway (servicio del renderizador) y
agregarlo a `docs/private/credenciales.env` si corresponde, para que `auditar:railway` no lo reporte
como deriva.

---

## 5. Plan de Railway — límite de dominios custom — ✅ DECIDIDO 2026-09-10: esperar, con disparador

El plan actual topa en **2 dominios personalizados**. Si el beta suma más de dos clientes con dominio
propio, hay que subir de plan o resolver primero la CDN del Bloque G. Fuente:
`15-plan-plataforma.md § Bloque G`.

**Decisión: ESPERAR, con un disparador escrito.**

- **El disparador:** el día que se firme un **tercer cliente con dominio propio**. La salida es subir
  el plan de Railway — un cambio de plan, no un proyecto, así que el riesgo de esperar es bajo.
- **Estado hoy:** los dos custom domains están tomados por la **API** (`api.dinamicseo.es`) y el
  **renderizador**. El portal vive en Hostinger, fuera de Railway, y no consume cupo.
- **Lo que NO se decidió acá:** la CDN delante del renderizador. Se saca de esta decisión a propósito —
  el límite de dominios es un síntoma, no la razón para construirla. La CDN se justifica sola por el
  borde (ADR-19) y por el colchón de disponibilidad, y merece su propio diseño. Queda en el roadmap
  del Bloque G.
- **La trampa que ese diseño va a tener que tratar, anotada ahora para que no se descubra tarde:** la
  clave de cache de la CDN **tiene que incluir el `Host`**. ADR-19 dice que el dominio ES la
  autorización; una cache que ignore el host serviría la web de un cliente bajo el dominio de otro.

---

## 6. OBS-04 — quién edita la web durante el servicio — ✅ DECIDIDO 2026-09-10: (a) solo la agencia

Hoy nuestro RBAC no gobierna esto (el Visual Editor de Storyblok tampoco tiene clic-para-editar
funcionando: `desShapeBlok()` descarta `_editable`). Es la precondición para firmar ADR-11
(offboarding). Poco urgente si solo edita la agencia; importa el día que edite alguien del lado del
cliente. Fuente: `15-plan-plataforma.md § Bloque H`, `docs/decisiones-arquitectura.md` OBS-04.

**Decisión: (a) EDITA SOLO LA AGENCIA**, con el camino de crecimiento nombrado.

- **Durante el servicio, el cliente no edita.** Ve su web y aprueba desde el portal en modo lectura
  (ADR-20). Seats de Storyblok pocos y fijos — el número entra limpio en la propuesta, en vez de
  crecer con la cartera.
- **Si alguna vez un cliente tiene que editar, el camino es (c) —desde el portal, bajo nuestro RBAC—
  y NUNCA (b)**, un seat suyo en Storyblok. Se nombra ahora, con la decisión fría, para que el día de
  la presión nadie elija (b) por ser la de una tarde.
- **Lo que cuesta (c), medido, para que no se subestime:** el rol `cliente` hoy no puede escribir NADA
  en `clients` — `app.puede_escribir()` es `maestro/equipo/servicio`
  (`db/migrations/0001_init.sql:387-390`) y `client_write` la usa. Abrirlo es una migración de
  escritura acotada por columna sobre la propia fila, con su tanda de tests de aislamiento; y es
  exactamente el terreno donde la 0021/0022 ya encontraron que **un `revoke select` por columna no
  angosta un `grant` de tabla ya concedido**. No es un flag.
- **Por qué (b) queda descartada:** movería el aislamiento entre clientes desde Postgres a la lista de
  colaboradores por space de Storyblok — un sistema que no controlamos ni podemos testear. Es
  precisamente lo que ADR-15 y ADR-17 vinieron a impedir.
- **Consecuencia para ADR-11:** "handoff editable" nombra una capacidad que el cliente **gana en la
  baja**, no una que ya tenía. Con eso OBS-04 deja de bloquear la reescritura del ADR.

**Decisión adyacente, técnica, no requiere decisión de negocio:** el botón **"Editar la web"** en el
portal que firme el enlace de preview al vuelo, para retirar la URL de larga duración pegada en la
configuración del space (hoy el eslabón débil de OBS-04). Va al roadmap.

---

## 7. Precio de la "salida gestionada" — ✅ FORMA DECIDIDA 2026-09-10 (faltan los dos números)

Falta ponerle precio al escenario de offboarding donde AMG sigue gestionando el hosting/dominio del
cliente después de terminar el servicio. Fuente: `15-plan-plataforma.md § Bloque H`.

**Forma decidida: PAGO ÚNICO DE SALIDA + CUOTA MENSUAL**, con la cuota a un mínimo alto explícito.

- **El pago único** cubre el trabajo real de la baja, que ocurre una sola vez: transferir el space,
  reapuntar el DNS, verificar que quedó sirviendo.
- **La cuota mensual** cubre el hosting, el dominio y —lo que no es obvio— **el slot de dominio custom
  de Railway**, que la decisión #5 acaba de declarar capacidad escasa: un ex-cliente hosteado ocupa el
  mismo cupo que un cliente que paga el servicio completo. El mínimo alto existe para que retener a un
  ex-cliente sea una decisión consciente y no una inercia que llene el cupo.

**Faltan los dos números** (los pone Juan). Base de coste a considerar al fijarlos: el space de
Storyblok (uno por cliente, ADR-04), el slot de dominio custom de Railway, el registro del dominio en
Hostinger y la fila en Supabase. **Los seats de Storyblok ya se pueden estimar**: con OBS-04 cerrada
en (a), son pocos y fijos, no crecen con la cartera.

**Pago único (€):** ************___************

**Cuota mensual (€):** ************___************

> ✅ **RESUELTO en la reescritura de ADR-11 del 2026-09-11 — pero te deja UNA pregunta (abajo).** La
> variante **(b1) "el cliente lo hostea" no era posible tal como estaba redactada**: el ADR la escribió
> cuando el plan era un frontend Next.js entregable, y hoy el renderizador es un servicio
> **multi-tenant que lee de la base de AMG** (`clients`, vía `app_render`). Un cliente que se lleve su
> space se lleva el contenido y nada que lo renderice. O (b1) sale del ADR, o alguien construye un
> modo standalone del renderizador. **La reescritura la RETIRA de la oferta**, pero diciendo *"hoy no
> se ofrece"* y no *"no se puede"*: medido al escribirla, `demo-server.ts` ya corre el renderizador
> entero contra **PGlite en memoria sembrado desde un JSON de perfil**
> (`renderer/src/demo-server.ts:22-87`), así que las piezas existen — lo que falta es empaquetado,
> documentación y soporte. Reponerla sería un ADR nuevo, con un cliente que la pida como disparador.
> **Si querés que la salida self-hosted SÍ se ofrezca, decímelo: es una decisión tuya, no mía.**
>
> **Lo demás de ADR-11 ya está escrito y hecho.** La sección *"versión vigente"* del ADR se escribió
> el 2026-09-11, y el **snapshot estático quedó verificado como entregable** el mismo día
> (`npm run snapshot -w renderer -- <dominio> <destino>`: imágenes descargadas, cero peticiones a
> hosts externos, comprobado en un navegador). **Para firmar ADR-11 falta UNA sola cosa: los dos
> importes de acá arriba.**

---

## 8. ~~Confirmar si los hallazgos de `npm run auditar:railway` ya se corrigieron~~ — RESUELTO 2026-09-05

La corrida del 2026-08-08 había encontrado tres cosas en el Railway real:

- La API tenía credenciales de los otros dos procesos (`DATABASE_URL_ORQUESTADOR`, etc.) — **resuelto**.
- El renderizador no tenía ningún token de Storyblok — **resuelto**.
- Tres variables del orquestador diferían del panel vs. `credenciales.env` (`PIPELINE_MODO`,
  `WEB_PUBLISH_MODE`, `STORYBLOK_DRY_RUN`) — **resuelto** (de paso apareció una cuarta, `CORS_ORIGINS`
  en la API, también reconciliada).

Corrida real del 2026-09-05 (una vez agregado `RAILWAY_API_TOKEN` a `credenciales.env` y corregido el
inventario del script, que tenía ruido por variables del Bloque F nunca agregadas — commit `008537b`):
`✔ Los tres servicios coinciden con la fuente.` Fuente: `15-plan-plataforma.md § A3`, línea ~178.

---

## 9. ~~Desplegar la migración `0032`~~ — RESUELTO 2026-09-05

Corrida por vos (`npm run env:sync` + `npm run migrate:deploy -w db`, fuera de Claude Code):
`+ 0032_intento_publicacion.sql` / `✔ Aplicadas 1 migración(es)`. `kr_publicacion_intentos` ya existe
en producción — 32/32 migraciones al día.

---

## 10. ~~Rotar credenciales de Google OAuth expuestas en el chat~~ — RESUELTO 2026-09-05 (según vos)

Durante la prueba del acceso a la Business Profile API (ítem #2) se pegaron en esta conversación,
sin querer, el `client_secret` de OAuth del proyecto de Cloud "AMG AUTOMATION", y un `access_token` +
`refresh_token` completos (obtenidos vía OAuth Playground con la cuenta
`argentinosporespana@gmail.com`). Confirmaste la rotación del `client_secret` y la revocación del
acceso en `myaccount.google.com/permissions`. Marco resuelto por tu palabra — no tengo forma de
verificarlo desde acá.

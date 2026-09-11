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

**Diagnóstico (2026-09-04):** el proyecto de Cloud "AMG AUTOMATION" (número `546581198843`) tiene la
API habilitada pero cuota `0` (`GET /v1/accounts` de la Account Management API devuelve `429
RESOURCE_EXHAUSTED`, `quota_limit_value: "0"`) — Google no aprobó el acceso todavía; habilitar la API
en la consola y que te aprueben el acceso son dos trámites separados. Falta enviar la **"Application
for Basic API Access"** desde `support.google.com/business/contact/api_default`. Requisito a
verificar antes de aplicar: el perfil de Business de AMG tiene que estar **verificado y activo hace
60+ días, con un sitio web cargado en la ficha** — si no cumple, Google rechaza la solicitud por
antigüedad. Aprobación: días a semanas, no bloquea desarrollo mientras tanto.

**Estado del trámite: EN PAUSA por decisión de Juan (2026-09-10).** No se manda la solicitud por ahora;
el módulo de reseñas se queda en `mock`. Hoy nadie reclama el módulo, así que el coste de esperar es
bajo — y la aprobación puede pedirse cuando aparezca un cliente que lo pida.

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
> **Lo demás de ADR-11 ya está escrito** (sección *"versión vigente"* del ADR). Para firmarlo faltan
> solo tus dos importes de acá arriba y verificar el snapshot estático como entregable.

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

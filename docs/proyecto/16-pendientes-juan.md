# 16. Pendientes de Juan

> Checklist de las decisiones y trámites que dependen de vos — no de una sesión de desarrollo. Cada
> ítem ya está documentado en detalle en `09-estado-y-roadmap.md` o `15-plan-plataforma.md`; acá está
> resumido con un pointer a la fuente, para que lo completes de una sentada. Generado 2026-09-04 a
> partir de una auditoría de esos dos documentos.
>
> **No es un tercer lugar de estado**: si esto y `09`/`15` alguna vez se contradicen, ganan `09`/`15` —
> este archivo es un formulario, no la fuente de verdad. Cuando resuelvas un ítem, decímelo y lo tacho
> acá y actualizo la fuente.

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

**Estado del trámite:** ___________________________

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

## 4. `CACHE_TTL_MS` — el valor real del SLA

El renderizador usa hoy un TTL de caché por default; falta que digas el número real que promete el
SLA para fijarlo en Railway. Fuente: `15-plan-plataforma.md § Bloque G`, `progress/current.md § Deuda
no relacionada`.

**SLA / TTL en segundos:** ___________________________

---

## 5. Plan de Railway — límite de dominios custom

El plan actual topa en **2 dominios personalizados**. Si el beta suma más de dos clientes con dominio
propio, hay que subir de plan o resolver primero la CDN del Bloque G. Fuente:
`15-plan-plataforma.md § Bloque G`.

**Decisión (subir de plan / resolver CDN antes / esperar):** ___________________________

---

## 6. OBS-04 — quién edita la web durante el servicio

Hoy nuestro RBAC no gobierna esto (el Visual Editor de Storyblok tampoco tiene clic-para-editar
funcionando: `desShapeBlok()` descarta `_editable`). Es la precondición para firmar ADR-11
(offboarding). Poco urgente si solo edita la agencia; importa el día que edite alguien del lado del
cliente. Fuente: `15-plan-plataforma.md § Bloque H`, `docs/decisiones-arquitectura.md` OBS-04.

**Decisión:** ___________________________

---

## 7. Precio de la "salida gestionada"

Falta ponerle precio al escenario de offboarding donde AMG sigue gestionando el hosting/dominio del
cliente después de terminar el servicio. Fuente: `15-plan-plataforma.md § Bloque H`.

**Precio / condiciones:** ___________________________

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

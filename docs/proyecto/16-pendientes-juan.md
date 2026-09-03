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

## 1. Rotación de credenciales expuestas

`docs/private.zip` estuvo commiteado en el repo público desde el 2026-08-01. Se sacó del índice, pero
**el objeto sigue en el historial de GitHub** — purgar no des-expone, rotar sí. Pospuesto por vos el
2026-08-04. Fuente: `15-plan-plataforma.md § Riesgo abierto`.

**Tu respuesta / fecha en que lo hacés:** ___________________________

---

## 2. Acceso real a la Business Profile API de Google

Trámite externo con Google, necesario para `GOOGLE_REVIEWS_MODO=live` (hoy todo el módulo de reseñas
funciona con datos mock). Bloquea en cascada: detectar cuándo un cliente revoca el `refresh_token`.
Fuente: `15-plan-plataforma.md § Bloque F`, línea ~1336.

**Estado del trámite:** ___________________________

---

## 3. Bot de Telegram real para las alertas

El código de alertas por reseñas 1-3★ está hecho, en `main` y desplegado (migración `0026`, confirmada
en producción el 2026-08-24). Falta la parte que no es código: crear el bot con `@BotFather` y poner
`TELEGRAM_BOT_TOKEN` + `TELEGRAM_MODO=live` donde corresponda. Sin esto, ningún CM recibe una alerta
real todavía. Fuente: `15-plan-plataforma.md § Bloque F`, línea ~1333.

**¿Bot creado? Token puesto?:** ___________________________

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

## 8. Confirmar si los hallazgos de `npm run auditar:railway` ya se corrigieron

La corrida del 2026-08-08 encontró tres cosas en el Railway real (no en el código, así que ninguna
sesión de desarrollo puede confirmarlas sola):
- La API tenía credenciales de los otros dos procesos (`DATABASE_URL_ORQUESTADOR`, etc.) — riesgo real,
  no solo prolijidad.
- El renderizador no tenía ningún token de Storyblok — sin eso, el Visual Editor no puede andar.
- Tres variables del orquestador diferían del panel vs. `credenciales.env` (`PIPELINE_MODO`,
  `WEB_PUBLISH_MODE`, `STORYBLOK_DRY_RUN`).

Fuente: `15-plan-plataforma.md § A3`, línea ~178.

**¿Se corrigieron? Si no lo sabés, correr `npm run auditar:railway` (de solo lectura, compara nombres
y hashes cortos, nunca valores) y decirme el resultado:** ___________________________

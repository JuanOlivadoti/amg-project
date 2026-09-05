# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** sin desarrollo — revisión del checklist de pendientes de Juan
(`docs/proyecto/16-pendientes-juan.md`), en curso. C-1 (la marca de intento de publicación) ya
estaba cerrado antes de esta sesión; lo que se hizo acá fue corregir documentación stale (la nota de
Telegram en `15-plan-plataforma.md`, la fila de migraciones en `09-estado-y-roadmap.md`) y avanzar
tres ítems del checklist (#3, #9 resueltos; #10 nuevo, abierto). Commiteado y pusheado (`af2012d`).

## En vuelo (sin commitear)

Nada — working tree limpio después de `af2012d` (docs: sincroniza pendientes de Juan tras cerrar
Telegram y migración 0032).

## Próximo paso

1. **Preguntas abiertas hechas a Juan, sin responder todavía:**
   - ¿Rotó el `client_secret` de OAuth de "AMG AUTOMATION" y revocó el acceso en
     `myaccount.google.com/permissions`? (`16-pendientes-juan.md` § 10 — credenciales expuestas en
     el chat el 2026-09-05, ver `history.md`/commit `af2012d` para el detalle.)
   - ¿`TELEGRAM_BOT_USERNAME` está en su `docs/private/credenciales.env` local? (`16-pendientes-juan.md` § 3.)
2. Seguir el resto del checklist con Juan: quedan abiertos **#1** (rotar `docs/private.zip`
   expuesto — el más urgente, pospuesto desde 2026-08-04), **#2** (acceso a la Business Profile API,
   en trámite — falta que confirme si ya mandó el formulario de Google), **#4** (`CACHE_TTL_MS`),
   **#5** (plan de Railway), **#6** (OBS-04), **#7** (precio salida gestionada), **#8** (correr
   `auditar:railway` y confirmar).
3. Ninguno de estos ítems es una tarea de desarrollo — son decisiones/trámites de Juan. No hay
   código para escribir hasta que él resuelva alguno que lo requiera (p. ej. el #2 desbloquearía
   implementar `GOOGLE_REVIEWS_MODO=live`, pero recién cuando Google apruebe el acceso).

## Decisiones tomadas

- **La rotación de credenciales de Google (ítem #10) se registra en el checklist y no se resuelve
  desde ninguna sesión de Claude Code** — ninguna sesión tiene ni debe tener las credenciales de
  Google del usuario; es un trámite 100% suyo, fuera del arnés.
- **Este archivo NO se vació a la plantilla tras el commit `af2012d`**, aunque el commit cerró el
  trabajo "en vuelo": la revisión del checklist en sí sigue abierta (el usuario continuó la sesión
  explícitamente), así que vaciar a plantilla hubiera perdido el hilo de qué preguntas quedaron sin
  responder.

## Callejones sin salida

— Nada nuevo en esta sesión (no hubo desarrollo). Ver `history.md` para los de C-1.

## Archivos calientes

- `docs/proyecto/16-pendientes-juan.md` — el checklist vivo, 10 ítems, 3 resueltos (#3, #9), 7
  abiertos.

## Verificaciones

- **No corrida** — sin cambios de código en esta sesión (solo `docs/`), no aplica `npm run
  verificar`. La migración `0032` se verificó con la salida real de `migrate:deploy -w db` que pegó
  Juan, no con una corrida propia.

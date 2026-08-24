# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-23/24
**En curso:** alertas por Telegram para reseñas 1-3★ (Bloque F, fase 2 — cierra RF-018 del PRD).
**Task 1 (`datos`) cerrada e integrada** (commit `19560b7`): migración `0026` (aplicada solo local vía
PGlite — todavía NO desplegada a producción), capa de acceso en `db/`, y los tres endpoints de
auto-servicio en `api/`. Pasó por el `revisor`: un bloqueante (`GET /members` no exponía
`telegram_vinculado` pese a que la vista ya lo tenía) corregido por la sesión principal antes de
integrar. **Siguen las Tasks 2 (`pipeline`: provider de Telegram + 2 funciones de Inngest) y 3
(`front`: "Vincular Telegram" en el perfil), en serie.** El plan entero, con el SQL exacto:
[`docs/superpowers/plans/2026-08-23-alertas-telegram.md`](../docs/superpowers/plans/2026-08-23-alertas-telegram.md).
Informes de esta pieza: `progress/informes/datos-alertas-telegram.md` y
`progress/informes/revision-task1-alertas-telegram.md`.

Antes en la misma sesión, ya cerrado: el Bloque F fase 2 segunda pieza (publicar la respuesta de
vuelta a Google, mock-first) y el ítem de invalidación multi-instancia del Bloque G. Detalle completo
en [`history.md`](history.md#2026-08-23--bloque-f-fase-2-segunda-pieza-publicar-la-respuesta-de-vuelta-a-google-mock-first).

**Estado del código:** `npm run verificar` en verde (1639 tests + 298 `node:test`/196 Karma del
portal), sin cambios desde el cierre de la pieza anterior. Migración `0025` desplegada a producción,
25 migraciones aplicadas.

**Decisiones tomadas sobre las alertas (para no repetir la investigación si se retoma esto después):**
- **Canal: Telegram, no WhatsApp.** Investigado: WhatsApp Business exige verificación de negocio
  ante Meta (días), plantillas pre-aprobadas para cualquier mensaje que AMG inicie, y se paga por
  mensaje. Telegram: bot por `@BotFather` en dos minutos, gratis, sin aprobación de nadie — y sin
  gatekeeper externo (a diferencia de todo lo demás que queda de fase 2), así que el plan implementa
  `live` de verdad, no mock-first.
- **Destinatario: el CM asignado a cada cliente** (`clients.asignado_a`), no un canal/grupo único —
  RF-018 del PRD pide la alerta "al CM", personal interno de AMG.
- **Vinculación por polling (`getUpdates`), no webhook público** — mismo criterio que ya eligió este
  proyecto para las reseñas de Google (menos infraestructura nueva expuesta).
- **Retry automático de la alerta vía `alerta_telegram_enviada_en`** (columna en `resenas_google`,
  no una cola ni un botón): si Telegram falla, el próximo ciclo de polling (30 min) reintenta solo.
  Decidido después de que Codex encontrara que el diseño original perdía la alerta para siempre si
  fallaba una vez.
- **El código de vinculación y su TTL de 10 min los genera Postgres** (un trigger fuerza
  `gen_random_uuid()` + `now() + 10 min`, ignorando lo que mande el caller) — no TypeScript. Codex
  encontró que el diseño original solo lo garantizaba por convención, no por constraint.

**Codex review (2026-08-23):** veredicto original NECESITA REDISEÑO, 8 hallazgos — 2 bugs que
hubieran bloqueado el polling o fallado en runtime (grants incompletos de `app_telegram`;
`CREATE OR REPLACE` no puede agregarle una columna a `clientes_conectados_google`), 1 bug de
disponibilidad (offset de `getUpdates` se clava con un lote sin `/start`), 1 de robustez decidido
por Juan (retry automático), 1 de cableado de config (`TELEGRAM_BOT_USERNAME` sin `env:sync`), y el
resto validaciones/tests. Ninguno reabrió Telegram ni "por CM asignado". Los 8 ya están en el plan.

**Pendiente inmediato:**
- **Dispatchear la Task 2 (`pipeline`) del plan de alertas por Telegram** — provider + las dos
  funciones de Inngest, consumiendo lo que ya entregó la Task 1.
- Después, la Task 3 (`front`).
- Al cerrar las tres, migrar `0026` a producción (todavía no se desplegó) y actualizar `09`/`15`/
  `history` con el cierre completo del RF-018.
- Del Bloque F fase 2 quedan, bloqueados en cascada por un trámite externo o una decisión de
  proveedor: alertas por email, acceso real a Google (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando se detecta un refresh token revocado.
- **Fijar `CACHE_TTL_MS` en Railway** (Bloque G) al valor real que pida el SLA — sigue pendiente,
  config de despliegue, no código.
- Del Bloque G quedan el CDN en el borde y el límite de dominios custom de Railway — decisiones de
  despliegue/plan, no ingeniería.
- Del Bloque H quedan OBS-04 y el precio de la salida gestionada — decisiones de negocio de Juan.

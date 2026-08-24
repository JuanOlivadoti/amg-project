# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** —
**En curso:** nada — el Bloque F fase 2, tercera pieza (alertas por Telegram) cerró completa el
2026-08-24. Detalle en
[`history.md`](history.md#2026-08-24--bloque-f-fase-2-tercera-pieza-alertas-por-telegram-para-reseñas-1-3-cierra-rf-018).

**Pendiente, fuera de ingeniería (no bloquea ninguna otra pieza):**
- Migración `0026` desplegada a producción el 2026-08-24 (26 aplicadas).
- Que Juan cree el bot real con `@BotFather` y ponga `TELEGRAM_BOT_TOKEN`/`TELEGRAM_MODO=live` donde
  corresponda — sin esto, el código está completo y probado pero ninguna alerta real le llega a un CM.

**Qué sigue, según `docs/proyecto/09-estado-y-roadmap.md` y `docs/proyecto/15-plan-plataforma.md`:**
- Del Bloque F fase 2 queda, bloqueado por un trámite externo de Juan (pedir acceso a la Business
  Profile API de Google): acceso real a Google (`GOOGLE_REVIEWS_MODO=live`) y limpiar la conexión
  cuando el polling detecta un refresh token revocado.
- **Fijar `CACHE_TTL_MS` en Railway** (Bloque G) al valor real que pida el SLA — config de
  despliegue, no código.
- Del Bloque G quedan el CDN en el borde y el límite de dominios custom de Railway — decisiones de
  despliegue/plan, no ingeniería.
- Del Bloque H quedan OBS-04 y el precio de la salida gestionada — decisiones de negocio de Juan.

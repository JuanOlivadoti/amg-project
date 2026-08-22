# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-22
**En curso:** nada. Se cerró el Bloque F fase 2 (primera pieza) — borrador de respuesta con IA para
reseñas de Google, mergeado a `main` el 2026-08-21 y con su migración (`0024`) desplegada a producción
el 2026-08-22. Detalle completo en
[`history.md`](history.md#2026-08-22--migración-0024-desplegada-a-producción).
**Estado:** producción al día — 24 migraciones en `main`, las 24 aplicadas. `verificar --con-portal`
en verde entero (1599 tests monorepo + 298 `node:test` portal + 192 Karma, typecheck limpio),
verificado también en un navegador real.

**Decisiones de esta sesión:** ninguna nueva — el despliegue de la `0024` siguió el mismo
procedimiento ya documentado (`npm run migrate:deploy -w db`, `DATABASE_URL_ADMIN` en `db/.env`, la
credencial nunca por el chat).

**Pendiente inmediato:**
- **Decisión del usuario, sin resolver (arrastra de sesiones anteriores):** con qué bloque seguir —
  **D** (calibrar el research, cuesta ~$0.31 y lo decide Juan) o **G/H** (hacia el SLA: CDN delante
  del renderizador, invalidación multi-instancia, cerrar OBS-04).
- Lo que sigue de Bloque F fase 2, sin empezar: publicar la respuesta de vuelta a Google, alertas por
  WhatsApp/email, acceso real a la Business Profile API (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando el polling detecta un refresh token revocado.

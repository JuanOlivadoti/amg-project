# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-23
**En curso:** nada. Se cerró el ítem de invalidación multi-instancia del Bloque G: no era una brecha
de código, `CACHE_TTL_MS` ya estaba implementado de punta a punta y solo le faltaba test
(`renderer/src/deps.test.ts`, 10 tests, verificado por mutación). Detalle completo en
[`history.md`](history.md#2026-08-23--bloque-g-la-invalidación-multi-instancia-no-era-una-brecha-de-código).
**Estado:** `renderer` 172/172 (162 + 10 nuevos), typecheck limpio, `npm run verificar` en verde
(1616 tests del monorepo). Producción al día (24 migraciones aplicadas).

**Decisiones de esta sesión:**
- Juan confirmó que hay una conversación de SLA real, así que el Bloque G dejó de ser "sin urgencia
  hoy". Antes de tocar código pregunté qué exige el SLA en tiempo de propagación — la respuesta fue
  "con bajar el TTL alcanza (30-60s)", no tiempo real cross-instancia. Eso descartó la alternativa de
  cache compartida (Redis) sin necesidad de construirla para después tirarla.
- **`CACHE_TTL_MS` como único mecanismo de invalidación (sin depender del webhook) es correcto para
  cualquier número de instancias**, no solo para una: cada instancia expira sola por su propio reloj,
  así que el peor caso de propagación en toda la flota queda acotado por el TTL sin importar cuántas
  instancias corran. El webhook pasa de mecanismo a optimización local.

**Pendiente inmediato:**
- **Fijar `CACHE_TTL_MS` en Railway** al valor real que pida el SLA (sigue en el default de 5 min).
  Es config de despliegue, no código — no lo puedo hacer yo.
- Del Bloque G quedan el CDN en el borde y el límite de dominios custom de Railway — decisiones de
  despliegue/plan, no ingeniería.
- Del Bloque H quedan OBS-04 y el precio de la salida gestionada — decisiones de negocio de Juan.
- Lo que sigue de Bloque F fase 2, sin empezar: publicar la respuesta de vuelta a Google, alertas por
  WhatsApp/email, acceso real a la Business Profile API (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando el polling detecta un refresh token revocado.

# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-23
**En curso:** nada. Se cerró el Bloque F fase 2, segunda pieza — publicar la respuesta de vuelta a
Google, mock-first, comando compuesto (ADR-18), ejecutado con `datos` → `pipeline` → `front` en serie
y `APROBADO` por `revisor` con mutación propia. Antes en la misma sesión: el ítem de invalidación
multi-instancia del Bloque G. Detalle completo en
[`history.md`](history.md#2026-08-23--bloque-f-fase-2-segunda-pieza-publicar-la-respuesta-de-vuelta-a-google-mock-first).
**Estado:** `npm run verificar` en verde, 1639 tests del monorepo + 298 `node:test` y 196 Karma en el
portal. Migración `0025` desplegada a producción el **2026-08-23** (confirmado con el output real de
`migrate:deploy -w db`, corrido por Juan). Producción al día, 25 migraciones aplicadas.

**Decisiones de esta sesión (Bloque F):**
- De los cuatro ítems que quedaban de fase 2, tres dependían de un trámite externo (acceso real a la
  Business Profile API de Google, que Juan todavía no pidió) o de elegir proveedor de alertas — no
  eran ingeniería lista para hacer. Se construyó el único decision-free: publicar la respuesta,
  mock-first, mismo patrón que ya usó toda la fase 1.
- El plan se ejecutó con los agentes de área del proyecto en vez de la skill genérica de subagentes,
  contrato fijado por la sesión principal antes de delegar (SQL completo, firmas exactas) — misma
  adaptación que ya se usó en la primera pieza de fase 2.

**Pendiente inmediato:**
- Del Bloque F fase 2 quedan, bloqueados en cascada por el mismo trámite externo o por una decisión de
  proveedor: alertas por WhatsApp/email, acceso real a Google (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando se detecta un refresh token revocado (esto último ni siquiera se puede diseñar bien
  sin conocer la forma real del error de revocación de Google).
- **Fijar `CACHE_TTL_MS` en Railway** (Bloque G) al valor real que pida el SLA — sigue pendiente,
  config de despliegue, no código.
- Del Bloque G quedan el CDN en el borde y el límite de dominios custom de Railway — decisiones de
  despliegue/plan, no ingeniería.
- Del Bloque H quedan OBS-04 y el precio de la salida gestionada — decisiones de negocio de Juan.

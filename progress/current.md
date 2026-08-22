# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-22
**En curso:** nada. Se cerró el Bloque D (calibración real contra DataForSEO) — corrida de $0.2124,
`TIPOS_MAP_PACK` verificado y `lib/budget.ts` recalibrado con un bug real corregido (subestimaba el
gasto ~60%). Antes en la misma sesión: Bloque F fase 2 mergeado a `main` con su migración (`0024`)
desplegada. Detalle completo en
[`history.md`](history.md#2026-08-22--bloque-d-corrida-real-de-calibración-contra-dataforseo-en-producción).
**Estado:** `kr-service` 148/148, typecheck limpio. Producción al día (24 migraciones aplicadas).

**Decisiones de esta sesión:**
- Bloque D se cierra **parcialmente, a propósito**: `TIPOS_MAP_PACK` y `lib/budget.ts` sí se
  calibraron con datos reales; `VOLUMEN_PERCENTIL_TOPE`/`PESO_CONFIANZA_ORDEN` y la hipótesis de
  `max_pages`/`serpValidateTop` quedan sin tocar — el dataset de 23 keywords (4 con volumen conocido)
  no alcanza para medirlos sin inventar precisión.
- Orden correcto documentado para la próxima vez que haga falta: `env:sync` primero, después el
  cambio a mano de `DATAFORSEO_BASE_URL` a producción — al revés, `env:sync` pisa el cambio y la
  corrida sale gratis pero inútil (contra sandbox).

**⚠️ Pendiente inmediato — verificar antes de dar la etapa por cerrada:**
- **Confirmar que `kr-service/.env` volvió a sandbox** (`DATAFORSEO_BASE_URL`) después de la corrida
  real — no se confirmó explícitamente en el chat que se haya revertido.
- **Decisión del usuario, sin resolver (arrastra de sesiones anteriores):** con qué bloque seguir
  después — **G/H** (hacia el SLA: CDN delante del renderizador, invalidación multi-instancia, cerrar
  OBS-04) es la que queda de las dos que se venían barajando.
- Lo que sigue de Bloque F fase 2, sin empezar: publicar la respuesta de vuelta a Google, alertas por
  WhatsApp/email, acceso real a la Business Profile API (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando el polling detecta un refresh token revocado.

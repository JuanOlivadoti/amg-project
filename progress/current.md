# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-21
**En curso:** nada. Se cerró el Bloque F fase 2 (primera pieza) — borrador de respuesta con IA para
reseñas de Google, mergeado a `main`. Detalle completo en
[`history.md`](history.md#2026-08-21--bloque-f-fase-2-primera-pieza-borrador-de-respuesta-con-ia-mergeado-a-main).
**Estado:** `verificar --con-portal` en verde entero (1599 tests monorepo + 298 `node:test` portal +
192 Karma, typecheck limpio), verificado también en un navegador real (conectar Google, editar y
guardar un borrador, persistencia confirmada tras reload, consola limpia).

**Decisiones de esta sesión:**
- Retomar el worktree de una sesión anterior (`worktree-borrador-ia-resenas`) en vez de re-lanzar el
  plan desde cero — el ledger de `subagent-driven-development` mostraba las 7 tasks + un fix crítico
  ya commiteados, y solo faltaba cerrar los hallazgos de la revisión final de rama.
- Los archivos de la skill de Supabase que quedaron pendientes de decisión en la sesión anterior
  (`.agents/`, `.claude/skills/supabase-server/`, `skills-lock.json`) **ya no existen** en el
  worktree — no hubo nada que commitear ni descartar.
- La migración `0024` queda sin desplegar a producción, igual que toda migración nueva — es decisión
  de Juan, no automática.

**Pendiente inmediato:**
- **Decisión del usuario, sin resolver (arrastra de la sesión anterior):** con qué bloque seguir —
  **D** (calibrar el research, cuesta ~$0.31 y lo decide Juan) o **G/H** (hacia el SLA: CDN delante
  del renderizador, invalidación multi-instancia, cerrar OBS-04).
- Desplegar la migración `0024` cuando Juan lo decida (mismo procedimiento que `0021`-`0023`).
- Lo que sigue de Bloque F fase 2, sin empezar: publicar la respuesta de vuelta a Google, alertas por
  WhatsApp/email, acceso real a la Business Profile API (`GOOGLE_REVIEWS_MODO=live`), limpiar la
  conexión cuando el polling detecta un refresh token revocado.

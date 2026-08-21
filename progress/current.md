# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-21
**En curso:** nada. Se cerró el Bloque I (deuda menor) — seis filas más, cinco commits. Antes, el
2026-08-18, se resolvieron tres bugs de producción encontrados persiguiendo un 404 del editor de carta
(Windows CRLF en el checksum de migraciones, `credencial.mts` mudo en Windows, `PIPELINE_MODO` sin
validar publicación armada). Detalle completo de las dos etapas en
[`history.md`](history.md#2026-08-21--cierra-el-bloque-i-deuda-menor-seis-filas-tres-subagentes-en-paralelo).
**Estado:** `verificar --con-portal` en verde entero (1563 tests monorepo + 298 `node:test` portal +
187 Karma, typecheck limpio), y confirmado por el usuario en el sitio público que la `0023` (menú
enriquecido) ya se ve.

**Decisiones de esta sesión:**
- Cerrar TODO el Bloque I que se pudiera, no solo el ítem 🔴 — decisión explícita del usuario.
- El mapa de traducción de `intencion` (inglés del contrato → español para la UI) vive en
  `portal/src/app/core/intencion-labels.ts`, mismo patrón que `menu-taxonomia.ts` — decidido por la
  sesión principal antes de despachar los agentes `datos`/`front` en paralelo, para que no divergieran.
- `verificarPublicacion()` (Bloque I, el ítem 🔴) solo guarda una dirección: `PIPELINE_MODO=live` con
  publicación no armada aborta; la inversa no, porque no hay gasto por publicar (a diferencia de
  DataForSEO) y bloquearía un flujo de desarrollo legítimo.

**Pendiente inmediato:**
- **Decisión del usuario, sin resolver:** con qué bloque seguir después del I — **D** (calibrar el
  research, cuesta ~$0.31 y lo decide Juan) o **G/H** (hacia el SLA: CDN delante del renderizador,
  invalidación multi-instancia, cerrar OBS-04).
- **Decisión del usuario, sin resolver:** si sumar al repo `.agents/`, `.claude/skills/supabase-server/`
  y `skills-lock.json` — instalación automática de una skill que este proyecto no usa (accede a
  Postgres por `pg` directo, no por `@supabase/server`, ver ADR-13) — o descartarlos.
- Quedan dos filas sin acción concreta en Bloque I: la sonda del modo del SDK duplicada
  (`api/`+`orchestrator/`, no trivial por diseño — el único paquete compartido es `contrato/`, que solo
  depende de `zod`) y la falta de tests de integración del camino live (riesgo aceptado, no una tarea).

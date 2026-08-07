# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-07
**En curso:** procesar la **15ª review externa** (Codex) y arrancar el bloque **A** del
[plan de la plataforma](../docs/proyecto/15-plan-plataforma.md).
**Estado:** en progreso.

**Los siete hallazgos, clasificados** (el reporte completo, en `progress/informes/`, no versionado):
cinco verificados, uno aceptado por juicio, **una mutación refutada**. Ninguno contradice una decisión
del usuario. El relato está en [`history.md`](history.md).

**Lo que ya se hizo de esta ronda:**

- **La documentación que mentía.** Siete afirmaciones repartidas en el `09`, el `README` de
  `docs/proyecto/` y este archivo seguían diciendo que falta desplegar el orquestador. Corregidas.
- **`current.md` reseteado.** Estaba entero duplicado en las seis entradas del 2026-08-07 de la
  bitácora. Antes de vaciarlo se rescató lo que solo vivía acá: dos deudas de KR-2a pasaron al bloque
  **I** del plan, y el generador de credenciales ganó su entrada en `history.md`.
- **El plan, enmendado**: **A1** y **A2** con garantías de verdad, **C0** como precondición
  bloqueante de C, **A3** detrás de **A4**, **D** con las dos deudas que el `09` le atribuía, y el
  bloque **J** (piezas 3 y 4 del portal), que no existía.

**Pendiente inmediato, en orden:** H5 (la fila `transaccional` del fixture) → **A2** (la guarda de
`finishRun`, que es un bug de hoy, y el barrido) → **A1** (`/_health` con sonda por `Tx`) → **B1 + B2**
→ **C0 + C**.

---

## 🔴 Riesgo abierto — las credenciales expuestas, **postergado por decisión del usuario (2026-08-04)**

> **No lo levantes como bloqueante en cada sesión.** Juan decidió posponer la rotación; sigue siendo un
> riesgo real y abierto, no un asunto cerrado. Lo que corresponde es dejarlo anotado y seguir con el
> trabajo, no volver a proponerlo cada vez.

`docs/private.zip` estuvo **commiteado en este repositorio, que es público**, desde el 2026-08-01
(commit `15ae91a`). Ya se sacó del índice y el `.gitignore` quedó blindado —y desde la 13ª review cubre
también los directorios hermanos tipo `docs/private-backup/`—, pero **el objeto sigue en el historial de
GitHub** por decisión tomada: purgar no des-expone, lo que devuelve la seguridad es rotar.

**La lista priorizada vive fuera del repo:** `docs/private/rotacion-credenciales.md` (gitignoreado).

Cuando la rotación se complete, dejar acá una línea con la fecha. Eso sí es el hecho.

---

## Plantilla (dejar así al cerrar)

```markdown
**Sesión:** YYYY-MM-DD
**En curso:** <qué se está haciendo>
**Estado:** <en progreso | bloqueado | listo para revisión>

**Decisiones de esta sesión:**
- <qué se decidió y por qué>

**Pendiente inmediato:** <lo próximo>
```

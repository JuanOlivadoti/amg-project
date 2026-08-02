# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-02
**En curso:** el arnés de trabajo con agentes (agente `front` + 3 skills del portal, agente
`revisor`, `CHECKPOINTS.md`, `npm run verificar`, hook de cierre, y esta separación entre estado y
bitácora).
**Estado:** implementado y verificado en verde; sin commitear.

**Decisiones de esta sesión:**
- Los agentes se reparten por **cuerpo de conocimiento**, no por carpeta: `front`, `datos`,
  `pipeline`, `render` (solo `front` y `revisor` existen hoy).
- Las convenciones viven en **skills**, no dentro del agente, para que también las pueda cargar la
  sesión principal sin delegar.
- **No** se migra el roadmap a `feature_list.json`: el porqué no entra en un JSON. Se separa la
  bitácora del estado, que era el problema real.
- `progress/` se parte: `current.md` e `history.md` se versionan; `informes/` no.

**Pendiente inmediato:** commit + push.

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

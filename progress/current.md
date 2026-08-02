# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-02
**En curso:** nada. Cerrada la **etapa A** del [plan de agentes](../.claude/PLAN-AGENTES.md): el
agente `pipeline` y sus cuatro skills, estrenados con **KR-3** y la mitad gratis de **KR-1**. El
resumen está en [`history.md`](history.md).
**Estado:** listo, verificado en verde (682 monorepo · typecheck limpio · sin secretos).

**Lo que hay que decidir, y no lo decide un agente:** **regenerar el dataset crudo** cuesta **~$0.31**
y ~16 min de corrida real contra DataForSEO en producción. Sin él, los dos parámetros nuevos
(`VOLUMEN_PERCENTIL_TOPE = 0.9`, `PESO_CONFIANZA_ORDEN = 0.5`) quedan sin calibrar y `TIPOS_MAP_PACK`
sin verificar. El destino ya es durable, así que esta vez el dataset sobrevive. **Y si se corre, hay
que volver a sandbox** en `kr-service/.env`.

**Pendiente inmediato:** **etapa B** (`datos`, con `datos-postgres`/`datos-api`/`datos-testing`), que
se estrena con KR-2 — y de paso puede cerrar lo que la etapa A dejó abierto: que el orden del pipeline
llegue al portal (`db/src/store.ts:715,743` + `portal/src/app/core/cartera.ts:37`). Arrancarla en una
**sesión nueva**, para poder invocar a `pipeline` por nombre.

**Anotado como decisión consciente, no como olvido:** `docs/proyecto/11-plan-fase-2.md:237` dice "107
tests" dentro del bloque de la etapa 5.2 ya cerrada, y hay varias menciones de "516 tests" en bloques
fechados. Son registros de lo que entregó cada etapa, no cifras vivas, así que no se sincronizan.

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

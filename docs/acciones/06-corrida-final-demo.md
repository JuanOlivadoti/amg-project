# Acción 06 — Corrida final + republicar la demo ⏳ PENDIENTE

**Tiempo:** ~15 min · **Costo:** ~**$0.31** de saldo DataForSEO · **Cuándo:** antes de enseñárselo a Frank

---

## Por qué hace falta

**Lo que hay publicado en Storyblok hoy es de ANTES de la tanda 5.** Es correcto y se puede
enseñar, pero no refleja las mejoras. La diferencia:

| | Publicado hoy (kr.v0.4) | Lo que saldría ahora (kr.v0.5) |
|---|---|---|
| **Evidencia** | Las 8 páginas se presentan iguales. 5 no tienen datos de mercado y **no se distingue**. | Separadas: **3 respaldadas por datos**, 5 marcadas `sin_validar`. |
| **JSON-LD** | **7 de 8** páginas declaran `LocalBusiness` ante Google. Varias son falsas. | Solo las que apuntan a un lugar. El resto: `WebPage` / `Article`. |
| **Tipo de página** | Casi todo `landing_local`. | Mix real: landing local, servicio, blog. |
| **Confianza** | El aprobador no la ve. | Visible antes de publicar. |

El punto vendible de la demo es que el sistema es **honesto**: te dice qué sabe y qué no. Eso hoy
no se ve porque el brief publicado es anterior al cambio.

---

> ### ⚠️ Si intentaste esta guía ANTES del 2026-07-13 (tanda 6), volvé a correrla
>
> Había un bug grave que **yo mismo introduje en esta guía**: la cache de DataForSEO no distinguía
> sandbox de producción. Una corrida de sandbox dejaba entradas con `volume: null`, y al cambiar la
> URL base a producción **se servían como aciertos**: la corrida "real" salía barata, sin volúmenes,
> y con un brief basura **que parecía legítimo**.
>
> **Corregido:** el sandbox ya no se cachea (es gratis: cachearlo solo podía envenenar producción) y
> las claves llevan el entorno. Si tenías un `kr-service/.cache/`, borralo: `rm -rf kr-service/.cache`.

## Pasos

### 1. Producción
En **`kr-service/.env`**:
```diff
- DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
+ DATAFORSEO_BASE_URL=https://api.dataforseo.com
```

### 2. Correr con tope de gasto
```bash
cd kr-service
MAX_COST_USD=1.00 npm run spike "Restaurante italiano en Madrid centro. Especialidades: pizza napolitana, pasta fresca, menú del día, cenas para grupos y brunch de fin de semana."
```

> Idealmente usá **un cliente real de la agencia**: es lo que después le mostrás a Frank.

Comprobá en el log:
- `[calidad] cobertura volumen XX%` → **mayor a 0**.
- `[cost] total $0.3X · DFS $0.2X` → DFS **no es $0.0000**.
- `✅ Brief válido contra el esquema kr.v0.5`.

### 3. 🔴 VOLVER A SANDBOX
```diff
- DATAFORSEO_BASE_URL=https://api.dataforseo.com
+ DATAFORSEO_BASE_URL=https://sandbox.dataforseo.com
```
> Si te olvidás, **cada corrida de desarrollo te cobra**. Es el error más fácil de cometer.

### 4. Aprobar (compuerta humana, ADR-06)
El brief nace en `pending_approval` con todas las páginas en `approved: false`. **Revisá el
informe** (`kr-service/out/informe.md`) y creá la copia aprobada:

```bash
cd kr-service
node -e "const fs=require('fs');const b=JSON.parse(fs.readFileSync('out/brief.json','utf8'));b.status='approved';b.paginas_propuestas.forEach(p=>p.approved=true);fs.writeFileSync('out/brief.approved.json',JSON.stringify(b,null,2));console.log(b.paginas_propuestas.length,'páginas aprobadas')"
```

> Aprobá **a conciencia**: mirá la sección "⚠️ Sin validar" del informe. Esas páginas no tienen
> demanda demostrable. Si no querés publicarlas, dejalas en `approved: false`.

### 5. Republicar
```bash
cd web-builder

# Dry-run primero (no escribe nada en el space):
WEB_PUBLISH_MODE=storyblok STORYBLOK_DRY_RUN=1 npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json

# Real:
WEB_PUBLISH_MODE=storyblok npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json
```

Vas a ver el aviso de evidencia antes de publicar:
```
⚠️  [evidencia] 5 de 8 página(s) NO tienen datos de mercado que las respalden:
      · /menu-del-dia-italiano-madrid  (menú del día italiano Madrid) · confianza 0.3
```

**La publicación es idempotente**: reescribe las stories existentes, no duplica.

---

## Cómo saber que salió bien

- [ ] `[calidad] cobertura volumen` > 0%.
- [ ] `DFS $` mayor a cero.
- [ ] El informe tiene las dos secciones: **✅ Respaldadas por datos** y **⚠️ Sin validar**.
- [ ] Las páginas ya **no son todas** `landing_local` / `LocalBusiness`.
- [ ] **Volviste a sandbox.** ← no te olvides
- [ ] Storyblok muestra los mismos slugs, sin duplicados.

## Si no querés gastar

La demo actual **funciona y es enseñable**. Solo tené presente que el JSON-LD de varias páginas
declara `LocalBusiness` sin serlo — si Frank o alguien técnico lo audita, es una observación
válida. Por $0.31, yo lo corregiría antes de la presentación.

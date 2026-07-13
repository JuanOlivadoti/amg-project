# Acción 04 — Space de Storyblok ✅ HECHA

**Estado:** ✅ Completada el 2026-07-13. Space real, componentes provisionados, **8 páginas
publicadas en vivo** con datos reales del research.

---

## Qué se hizo

1. **Provisioning de componentes** (`npm run setup:storyblok`):
   `page` · `hero` · `section` · `faq` · `faq_item` — creados en el space vía Management API.

2. **Publicación en vivo** de las 8 páginas del research real ([acción 03](03-research-produccion-dataforseo.md)),
   con la prosa redactada por OpenAI (no mock):

   ```
   /restaurante-italiano-madrid-centro            → story:197714630731874
   /pizza-napolitana-madrid                       → story:197714631870563
   /restaurante-italiano-pasta-fresca             → story:197714632661092
   /cenas-para-grupos-en-restaurante-italiano     → story:197714633455717
   /menu-del-dia-italiano-madrid                  → story:197714634246247
   /brunch-fin-de-semana-restaurante-italiano     → story:197714635163752
   /restaurante-italiano-especializado-en-pizzas  → story:197714638088297
   /cenas-para-grupos-en-madrid-centro            → story:197714639235178
   ```

## Lo que esto valida (y no se podía validar sin un space real)

| Pieza | Resultado |
|---|---|
| **Camino live de Storyblok** | ✅ Estaba escrito y typechequeado, pero **nunca se había ejecutado** contra un space real. Era deuda técnica declarada; ya no lo es. |
| **Idempotencia** (fix #12) | ✅ Se republicó dos veces: **mismos `story:` IDs, cero duplicados**. El upsert funciona. |
| **Retry con backoff** (fix #11) | ✅ Storyblok devolvió un **HTTP 429 real** y el reintento se activó solo y salvó la corrida. Primera vez que se ejercita contra un servicio de verdad, no contra un test. |
| **Compuerta de aprobación** (ADR-06) | ✅ Bloqueó la publicación hasta tener `status: approved` **y** cada página con `approved: true`. |
| **Edición visual** | ✅ Es *el* argumento de venta del CMS (ADR-04): el cliente abre el space y edita el contenido sin tocar código ni depender de un desarrollador. |

## Sobre la compuerta de aprobación

El brief que sale del research nace en `pending_approval` con **todas las páginas en
`approved: false`**. Para esta demo se generó una copia aprobada
(`kr-service/out/brief.approved.json`); **`out/brief.json` quedó intacto**.

Es a propósito: aprobar es una decisión humana, y el original debe conservar el estado real en
que lo dejó el research.

## Cómo republicar

```bash
cd web-builder

# Dry-run: valida el camino live SIN escribir nada en el space.
WEB_PUBLISH_MODE=storyblok STORYBLOK_DRY_RUN=1 npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json

# Publicación real.
WEB_PUBLISH_MODE=storyblok npx tsx src/cli/build.ts ../kr-service/out/brief.approved.json
```

> ⚠️ El token vive en `web-builder/.env` (gitignoreado). Es un **Personal Access Token
> (Management API)**, no los Access Tokens del space.

## Lo que queda abierto

- **Costo por space/seat.** ADR-04 exige **un space por cliente** para un offboarding limpio, así
  que el costo crece con la cartera. Hay que decidir si lo absorbe la agencia o se traslada al
  cliente. Sigue pendiente en la propuesta comercial.
- **`is_local` se dispara de más:** 7 de las 8 páginas salieron como `landing_local` → JSON-LD
  `LocalBusiness`. Algunas deberían ser `Article`. Detalle en la
  [acción 03](03-research-produccion-dataforseo.md).

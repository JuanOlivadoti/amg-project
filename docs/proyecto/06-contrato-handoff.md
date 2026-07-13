# 6. Contrato de handoff (el brief JSON)

## Por qué existe

El brief es **la frontera entre los dos módulos** ([ADR-07](../decisiones-arquitectura.md)).
No es un detalle de implementación: es *la interfaz pública* del Módulo 2 y *la entrada validada*
del Módulo 1.

Se diseñó como contrato explícito por tres razones:
1. Entre medio hay una **compuerta humana**: el brief se revisa y **se edita a mano**.
2. Los módulos evolucionan por separado; el contrato los desacopla.
3. Permite que el Módulo 1 sea reutilizable con otra fuente de research.

**`web-builder` no importa nada de `kr-service`.** Redefine el subconjunto que necesita y lo
valida en runtime.

## Versionado

El brief lleva `schema_version`. Hoy: **`kr.v0.2`**.

- El Módulo 2 lo emite desde `SCHEMA_VERSION` (`kr-service/src/types.ts`).
- El Módulo 1 declara qué versiones soporta en `SUPPORTED_SCHEMA_VERSIONS` (`web-builder/src/contract.ts`)
  y **rechaza cualquier otra** con un error claro, en vez de intentar procesarla.

```
✖ schema_version "kr.v9" no soportada. Soportadas: kr.v0.2. Actualizá el adaptador o migrá el brief.
```

## Estructura

```jsonc
{
  "schema_version": "kr.v0.2",
  "run_id": "uuid",
  "cliente": "restaurante italiano madrid centro",
  "market": { "country": "ES", "language_code": "es", "location_code": 2724 },
  "generated_at": "2026-07-13T...",
  "status": "pending_approval",          // pending_approval | approved | rejected
  "paginas_propuestas": [
    {
      "cluster_id": "uuid",
      "tipo": "landing_local",           // servicio | landing_local | blog | institucional
      "page_strategy": "single",
      "url_slug": "/restaurante-italiano-madrid-centro",
      "keyword_principal": "restaurante italiano madrid centro",
      "keywords_secundarias": ["pizza napolitana madrid", "..."],
      "intencion": "local",              // transactional|commercial|local|informational|navigational
      "local": true,                     // señal compuesta, separada del enum
      "volumen": 1200,
      "dificultad": 25,                  // KD 0-100
      "opportunity_score": 78,           // 0-100
      "score_confidence": 1,             // 0-1 — baja si faltaron datos
      "seo": {
        "meta_title": "...",
        "meta_description": "...",
        "schema_type": "LocalBusiness",  // LocalBusiness | Article | FAQPage | WebPage
        "canonical": "/restaurante-italiano-madrid-centro"   // RUTA, no URL absoluta
      },
      "content_brief": {
        "h1": "...",
        "secciones_sugeridas": ["Sobre Nosotros", "Especialidades", "..."],
        "word_count_objetivo": 1100,
        "enlazado_interno": [],
        "cta": "Reserva tu mesa",
        "tono": "Cercano y profesional",
        "claims_permitidos": ["ingredientes frescos"],      // contrato editorial
        "claims_prohibidos": ["el mejor de Madrid"]         // sectores regulados
      },
      "preguntas_frecuentes": ["¿Tienen opciones sin gluten?", "..."],
      "approved": false                  // ← aprobación POR PÁGINA
    }
  ],
  "backlog": [{ "keyword_principal": "...", "opportunity_score": 42 }],
  "meta_run": {
    "keywords_analizadas": 23,
    "paginas_propuestas": 1,
    "coste_micros_usd": 0                // solo DataForSEO, NO incluye el LLM
  }
}
```

## Los campos que hay que entender bien

### `status` + `approved` — la doble compuerta

No alcanza con uno solo. **Para publicar en vivo se exigen los dos**:

| | Significa |
|---|---|
| `brief.status === "approved"` | El brief en su conjunto fue revisado. |
| `page.approved === true` | **Esa página concreta** fue aprobada. |

Toda página nace con `approved: false`. Si solo se cambiara el `status` global, se publicarían
páginas que el revisor nunca miró. El Módulo 1 **filtra las no aprobadas** y avisa cuántas omitió.

### `canonical` — es una RUTA, no una URL

El brief emite el canonical como ruta (`/mi-pagina`). El Módulo 1 la resuelve contra el dominio
del negocio (del perfil) o la deja relativa para que el frontend le anteponga su base.

**Una sola fuente de verdad:** el canonical del brief manda. No se re-deriva del slug — si un
humano lo editó en la compuerta, esa edición se respeta.

### `intencion` + `local` — separados a propósito

`intencion` tiene 5 valores; la señal local va aparte en `local` (booleano). Se decidió así en
[ADR-10](../decisiones-arquitectura.md) para no crear intenciones compuestas (`local_transactional`,
etc.) que multiplican el enum y complican el scoring.

### `score_confidence` — la honestidad del score

Un `opportunity_score` de 80 con `score_confidence` 0.3 significa: *"parece bueno, pero nos faltó
la mitad de los datos"*. Baja cuando falta volumen (−0.4), KD (−0.3) o relevancia de negocio (−0.4).

Si `business_relevance` **no se pudo evaluar**, además el score queda **capeado a 35** — no se
promueve algo que nunca se validó contra el negocio.

### `claims_permitidos` / `claims_prohibidos` — el contrato editorial

Viajan con la página hasta el contenido final. El Módulo 1 se los pasa al LLM que redacta la prose,
y se persisten en Storyblok para quien edite después. Es la salvaguarda del sistema en
**sectores regulados** (gastronomía, salud): que ningún paso de la cadena prometa lo que no debe.

### `coste_micros_usd`

En **micros** (millonésimas de USD) para evitar errores de coma flotante
([ADR-10](../decisiones-arquitectura.md)).

> ⚠️ **Solo cuenta DataForSEO.** El coste de OpenAI/Anthropic **no está incluido**. Es una brecha
> conocida (ver [roadmap](09-estado-y-roadmap.md)).

## Dónde vive el contrato

| Rol | Archivo |
|---|---|
| **Diseño canónico** (fuente de verdad) | [`../modulo-2-esquema/types.ts`](../modulo-2-esquema/types.ts) y [`schema.sql`](../modulo-2-esquema/schema.sql) |
| Ejemplo lleno | [`../modulo-2-esquema/ejemplo-brief.json`](../modulo-2-esquema/ejemplo-brief.json) |
| Tipos de implementación (M2) | `kr-service/src/types.ts` |
| **Validación de salida** (M2) | `kr-service/src/validation/brief.schema.ts` (Zod) |
| Tipos de consumo (M1) | `web-builder/src/types.ts` |
| **Validación de entrada** (M1) | `web-builder/src/contract.ts` (Zod) |

> **Deuda conocida:** el esquema Zod está **duplicado** en ambos módulos. Lo correcto a futuro es
> extraerlo a un paquete compartido para tener una sola fuente de verdad. Está anotado como TODO
> en `web-builder/src/contract.ts`.

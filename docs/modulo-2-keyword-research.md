# Módulo 2 — Disparador de Keyword Research

## 1. Propósito del módulo

Automatizar el proceso de Keyword Research que hoy se hace manualmente. El agente recibe un prompt describiendo el negocio del cliente y devuelve un **dataset estructurado de keywords priorizadas y clusterizadas por página**, listo para alimentar al Módulo 1 (Creador de Webs).

Este módulo es la **entrada del pipeline**: define qué páginas hay que crear, con qué keyword principal, qué keywords secundarias y qué intención cubrir.

## 2. Posición en el flujo general

```
Input del usuario (nicho / negocio / ubicación)
        ↓
[Módulo 2 — Keyword Research + SEMrush API]
        ↓
Dataset de keywords (volumen, dificultad, intención, SERP)
        ↓
[Capa de decisión: qué keywords van a qué página]
        ↓
Brief estructurado por página (JSON)
        ↓
[Módulo 1 — Creador de Webs → WordPress/Elementor]
        ↓
Página publicada
```

El valor no está en el módulo aislado, sino en que **alimenta directamente** al creador de webs sin intervención humana.

## 3. Motor elegido: SEMrush

Se opta por **SEMrush API** como motor principal por sobre Google Keyword Planner por los siguientes motivos:

- **Google Ads API (Keyword Planner):** requiere alta en Google Ads, developer token con aprobación de Google (proceso lento), OAuth2, cuenta activa. La integración es más rígida y con más fricción.
- **SEMrush API:** pensada comercialmente para este uso, integración directa vía REST, datos más ricos (dificultad, SERP, tendencias, keywords relacionadas).

**Costo:** la suscripción a SEMrush + créditos de API los asume el cliente final (Frank) como parte de su stack, no del desarrollo.

## 4. Funcionamiento del agente

### 4.1 Input

Prompt simple del usuario describiendo el negocio. Ejemplo:

> "Clínica dental en Valencia, España. Servicios: implantes, ortodoncia invisible, blanqueamiento."

### 4.2 Procesamiento interno

**Paso A — Generación de keywords semilla**
El LLM genera un listado inicial de keywords a partir del prompt (ej: "implantes dentales Valencia", "ortodoncia invisible precio", "clínica dental Valencia centro").

**Paso B — Enriquecimiento vía SEMrush API**
Por cada keyword semilla se consulta:
- `keyword_overview` → volumen mensual, dificultad (KD%), CPC, tendencia
- `related_keywords` → variantes y long-tails
- `keyword_suggestions` → preguntas frecuentes (útiles para FAQs)
- `serp_analysis` → competencia en primera página (para detectar intención)

**Paso C — Clustering por intención y temática**
Las keywords se agrupan según intención de búsqueda:
- **Transaccionales** → páginas de servicio
- **Informacionales** → posts de blog
- **Locales** → landings por ubicación
- **Navegacionales** → páginas institucionales

**Paso D — Priorización**
Score por keyword combinando volumen, dificultad e intención. Se elige la keyword principal de cada cluster y las secundarias como refuerzo semántico.

### 4.3 Output

JSON estructurado (no listado plano) con las decisiones ya tomadas, listo para alimentar al Módulo 1:

```json
{
  "cliente": "Clínica dental Valencia",
  "paginas_propuestas": [
    {
      "tipo": "servicio",
      "url_sugerida": "/implantes-dentales-valencia",
      "keyword_principal": "implantes dentales Valencia",
      "volumen": 1900,
      "dificultad": 42,
      "keywords_secundarias": [
        "precio implantes Valencia",
        "implantes all-on-4 Valencia"
      ],
      "intencion": "transaccional-local",
      "preguntas_frecuentes": [
        "¿Cuánto cuesta un implante en Valencia?",
        "¿Cuánto dura un implante dental?"
      ]
    },
    {
      "tipo": "blog",
      "url_sugerida": "/blog/cuanto-dura-implante-dental",
      "keyword_principal": "cuánto dura un implante dental",
      "volumen": 3200,
      "dificultad": 28,
      "keywords_secundarias": ["duración implante dental", "vida útil implante"],
      "intencion": "informacional",
      "preguntas_frecuentes": []
    }
  ]
}
```

## 5. Argumento comercial para Frank

El encadenamiento Keyword Research → Creador de Webs es el punto que justifica el precio del paquete completo:

- **Hoy paga:** SEO para keyword research + redactor + diseñador web + integrador WordPress.
- **Con la plataforma:** un prompt inicial y la salida es una web con SEO on-page ya alineado al research, sin intervención de esos perfiles.

El valor no está en cada módulo por separado, está en que **se hablan entre sí**.

## 6. Costos a considerar

- **SEMrush** (suscripción + créditos API) → lo paga Frank, se aclara en la propuesta.
- **LLM** (OpenAI / Anthropic) para generación de semillas y clustering → lo paga Frank vía su cuenta.
- **Desarrollo (nuestro)** → integración con SEMrush, clustering, sistema de priorización, formato de output JSON, testing.

## 7. Puntos técnicos abiertos

- [ ] Confirmar plan de SEMrush necesario (Business o superior para acceso completo a API).
- [ ] Definir el modelo de scoring de priorización (fórmula concreta: peso de volumen vs dificultad vs intención).
- [ ] Definir si el output es solo JSON o si también se genera un informe legible en paralelo (PDF/Markdown) para que Frank revise antes de disparar el creador de webs.
- [ ] Decidir si hay un paso de aprobación humana entre este módulo y el Módulo 1, o si el pipeline corre end-to-end.

## 8. Dependencias con otros módulos

- **Alimenta a:** Módulo 1 (Creador de Webs).
- **Puede alimentar a futuro:** Módulo 4 (Calendario de Redes Sociales), reutilizando el dataset de keywords informacionales como fuente de temas para posts.

## 9. Próximos pasos

1. Validar este documento con el socio.
2. Confirmar plan de SEMrush a contratar y presupuesto mensual estimado.
3. Definir modelo de scoring y estructura final del JSON de output.
4. Estimar horas de desarrollo para incluir en la propuesta a Frank.

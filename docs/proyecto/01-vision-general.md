# 1. Visión general

## Qué es AMG OS

Una plataforma SaaS **multi-tenant** para una agencia de marketing gastronómico (AMG Madrid).
La tesis del producto: convertir el conocimiento operativo de la agencia en software con
**agentes de IA supervisados**, para que la agencia pueda escalar su cartera de clientes sin
crecer el equipo en proporción.

El cliente (Frank) hoy terceriza diseño web, SEO y gestión de reseñas. El proyecto busca
demostrarle que una plataforma propia le sale más rentable que seguir contratando por fuera.

## El problema concreto

Dos tareas que hoy se hacen a mano y consumen horas por cada cliente:

1. **Keyword research** — se hace manualmente con el Planificador de Palabras Clave de Google.
   Lento, no reproducible, difícil de justificar ante el cliente.
2. **Creación de webs** — cada landing se maqueta a mano; el SEO on-page se aplica a ojo.

Ambas son, en el fondo, **la misma cadena**: investigar qué busca la gente → construir las
páginas que respondan a esas búsquedas. Hoy esa cadena está rota en dos procesos manuales.

## La solución: una cadena automatizada con supervisión humana

```
prompt de negocio  →  [Módulo 2]  →  brief SEO  →  ⛔ COMPUERTA HUMANA  →  [Módulo 1]  →  web publicada
   (texto libre)     keyword research   (JSON)      (revisión/aprobación)   creador de webs
```

El punto clave —y la decisión de producto más importante— es la **compuerta de aprobación
humana** ([ADR-06](../decisiones-arquitectura.md)): el research genera una propuesta, una
persona la revisa y edita, y **solo entonces** se construye la web. Nunca se publica nada
sin confirmación explícita.

## Los módulos

El proyecto original define 4 módulos vendibles por separado. **Hoy hay dos construidos**
(en estado PoC):

| Módulo | Qué hace | Estado |
|---|---|---|
| **Módulo 2 — Keyword Research** (`kr-service/`) | Recibe un prompt de negocio y devuelve un brief SEO estructurado: keywords con volumen, dificultad e intención, agrupadas en clusters y mapeadas a páginas propuestas con su contenido on-page. | ✅ **PoC funcional** |
| **Módulo 1 — Creador de Webs** (`web-builder/`) | Toma el brief del M2 y genera la web: páginas como contenido estructurado (Storyblok) + preview HTML con datos estructurados (JSON-LD). | ✅ **PoC funcional** |
| Módulo 3 — Respondedor de reseñas de Google Maps | Gestiona respuestas a reseñas de Google Business Profile. | ⛔ No iniciado |
| Módulo 4 — Calendario de redes sociales | Genera un calendario de contenidos. | ⛔ No iniciado |

## Por qué el orden importa: SEO + buscadores IA

La razón por la que el Módulo 1 usa un CMS *headless* con render propio (y no WordPress) es
que el objetivo no es solo posicionar en Google clásico, sino ser **citado por los buscadores
con IA** (AI Overviews, ChatGPT Search, Perplexity). Eso exige contenido *machine-readable*:
datos estructurados JSON-LD impecables, HTML semántico, buen rendimiento.

El Módulo 2 ya emite el `schema_type` y las FAQs pensando en esto, y el Módulo 1 los convierte
en JSON-LD válido. Es una cadena diseñada de punta a punta con ese fin
(ver [ADR-04](../decisiones-arquitectura.md)).

## Alcance de este PoC

**Qué demuestra:** que la cadena completa `prompt → research → web publicable` funciona
end-to-end, con IA real en todos los pasos que la requieren, y con una arquitectura preparada
para producción (no un prototipo desechable).

**Qué NO es todavía:** un producto en producción. Falta multi-tenancy, persistencia,
orquestación durable, y el research corre contra el *sandbox* de DataForSEO (datos ficticios).
El detalle honesto está en [Estado y roadmap](09-estado-y-roadmap.md).

## Riesgo de producto abierto

Existe un **solapamiento de alcance** entre los dos documentos de producto (`contexto-proyecto-frank.md`
habla de 4 módulos; el PRD habla de 5 agentes con prioridades distintas). Está registrado como
**OBS-01** en las [decisiones de arquitectura](../decisiones-arquitectura.md) y debe unificarse
antes de consolidar la propuesta comercial.

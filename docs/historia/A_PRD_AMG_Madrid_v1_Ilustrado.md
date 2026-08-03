**P L A T A F O R M A D E  A U T O M A T I Z A C I Ó N  I N T E G R A L** 

AMG OS 

**D O C U M E N T O  D E  R E Q U I S I T O S  ·  P R D** Versión 1.0 — Borrador inicial · 09/06/2026 

## AMG OS El sistema operativo de la agencia 

Una plataforma que convierte el conocimiento operativo de AMG Madrid — procesos, manuales de marca y criterio creativo— en un activo de software, con agentes de IA supervisados y control de acceso por roles. Diseñada para reducir el coste por cliente, eliminar la dependencia de personas clave y escalar la cartera sin crecer el equipo. 

**MARKETING GASTRONÓMICO 5 AGENTES DE IA RBAC MULTI-TENANT SEO L OCAL  ·  RRSS ·  REPORTING** 

CL I ENT E S P O NS O R P R EPA R A DO  P O R DES T I NATA R I O AMG Madrid Franco · CEO Dinamic SEO Equipo de desarrollo 

Confidencial. Los supuestos sin confirmar en la reunión se marcan a lo largo del documento como **A VALIDAR** y se consolidan en el documento de cierre de descubrimiento (entregable C). 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 1/10 

> **§01** Resumen ejecutivo 

La tesis del proyecto 

AMG Madrid es una agencia de marketing gastronómico que presta un servicio **"marketing 360"** a restaurantes de alta facturación bajo un modelo de fee mensual recurrente. Su crecimiento está limitado por una operación intensiva en mano de obra y muy dependiente de su CEO, lo que genera cuellos de botella en comunicación interna, generación creativa, tareas repetitivas (reseñas, diseño, reporting) y ausencia de medición de satisfacción. 

**AMG OS** es una plataforma centralizada que unifica gestión de tareas, comunicación con confirmación de lectura, control de acceso por roles y un conjunto de **agentes de IA especializados** (ideación, diseño asistido, análisis competitivo, reporting y gestión de reseñas). El objetivo es desacoplar el valor de la agencia de personas concretas, reducir el coste operativo por cliente y escalar la cartera sin crecer el equipo de forma proporcional. 

El proyecto responde a una tesis estratégica de Franco: la generalización de la IA presionará a la baja los precios del marketing (hoy 1.200–1.800 €/mes) y la automatización es la vía para adelantarse a esa compresión de márgenes. Por ello, la arquitectura se diseña pensando en **multi-tenancy** desde el inicio, habilitando una eventual comercialización como producto SaaS. 

## **DE CISIÓN DE  ALCANCE** 

La reunión solicita construir a la vez dashboard + 5 agentes + RBAC + portal de cliente + facturación + encuestas. Eso no es un MVP, es un riesgo de proyecto. Este PRD lo reordena en un **roadmap por fases** priorizando lo de mayor ROI y menor riesgo (comunicación/RBAC, reseñas, ideación e informes) y difiriendo lo de mayor incertidumbre (diseño generativo de alta fidelidad y web-por-prompt). 

## **§02** Perfil de la empresa 

Contexto operativo 

## **M ODEL O DE NEGOCIO** 

Agencia de **marketing gastronómico** ; fee mensual recurrente **1.200– 1.800 €/cliente** . 

ICP: restaurantes con facturación **> 50.000 €/mes** . 

Captación 100% web → WhatsApp → llamada de filtro → reunión → cierre. 

**10 clientes fijos** en cartera actual. 

## **EST RUCT URA Y HERRAM IENTAS** 

Roles: CEO (Franco), diseño/branding, diseñadora web (Mica), 2 creadoras de contenido por restaurante, Community Manager. **A** 

## **VALIDAR headcount** 

Stack actual: **Metricool** , **Google Drive 3 TB** (contraseña única compartida), Google Maps, WhatsApp. 

Sin CRM/ERP formal. **A VALIDAR** 

Servicios: marketing 360, branding y diseño, diseño web, SEO Local (Google Maps), redes sociales, campañas paid y fidelización. 

> **§03** Problema a resolver 

Raíz, no síntoma 

**Problema declarado:** operación manual, lenta y dependiente de personas clave que impide escalar y erosiona la rentabilidad futura. **Causas raíz detectadas:** 

|**ÁREA**|**DOLOR**|**FRECUENCIA**|**SEVERIDAD**|
|---|---|---|---|
|Comunicación interna|El equipo no lee informes/decisiones→errores y desalineación. No<br>hay trazabilidad de "leído".|Continua|**ALTA**|
|Dependencia creativa|La ideación (~60 contenidos/sem) recae en Franco.|Semanal|**ALTA**|
|Efemérides|Oportunidades perdidas por no anticipar (ej. Día de la Madre no<br>ejecutado).|Mensual|**MEDIA-ALTA**|
|Reseñas|Las negativas se detectan tarde.|Diaria|**ALTA**|
|Diseño a demanda|Flyers, cambios de menú: solicitudes manuales constantes.|Diaria|**MEDIA**|
|Datos del cliente|Recopilación manual de facturación/platos; el cliente no los comparte.|Trimestral|**MEDIA**|
|Satisfacción|Sin medición→churn silencioso (se perdió un cliente con buenos<br>KPIs).|Continua|**ALTA**|
|Seguridad de acceso|Contraseña única para 3 TB; offboarding manual y arriesgado.|Continua|**CRÍTICA**|



## **ACCIÓN RE QU E RIDA —  CASO DE  NE GOCIO** 

El impacto económico no se cuantificó en la reunión **A VALIDAR** . Hay que medir baseline (horas/semana por tarea, coste/hora, nº reseñas/mes, % churn) para calcular ROI. Sin esto, el caso de negocio queda en hipótesis. 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 2/10 

**§04** 

El flujo actual en 9 fases 

## Análisis AS-IS 

**AU TOMATIZAR AU TOMATIZAR** 0 1 2 3·4 5 **Estrategia Branding SEO Local Diseño Web Redes Sociales** KPIs, mercado, competencia, Logos, menús, cartelería, Google Maps: fotos, keywords, Sitio web con SEO básico (Mica). 2 creadoras/restaurante: buyer persona. uniformes. reseñas, 3–4 posts/sem. ideación → guion → grabación → edición → Metricool. 6 7 8 9 ★ **Pruebas A/B Sist. de Ventas Campaña Fidelización Foco de automatización** Test con presupuesto bajo, se Manual de campaña: objetivos, Lanzamiento planificado. Puntos y recompensas para Fases 2 y 5 son las prioritarias para Franco. roles, acciones. retener. 

**Sist. de Ventas** Manual de campaña: objetivos, roles, acciones. 

**Pruebas A/B** Test con presupuesto bajo, se escala el ganador. 

## **ACT ORES** 

Franco (estrategia+ideación), diseño/branding, Mica (web), creadoras (×2/cliente), Community Manager. 

## **VOL ÚM ENES** 

10 clientes · ~60 contenidos/semana · 3–4 posts/sem por cliente en Maps · keyword research e informes trimestrales. 

## **HERRAM IENTAS** 

Metricool, Drive 3 TB (clave compartida), Google Business Profile, WhatsApp. Sin CRM. **A VALIDAR** 

> **§05** Visión TO-BE 

Qué cambia 

|**DIMENSIÓN**|**AS-IS (HOY)**|**TO-BE (AMG OS)**|
|---|---|---|
|Comunicación|Informes que nadie confirma leer|Confirmación de lectura auditable + escalado|
|Ideación|Manual, dependiente de Franco|Agente proactivo + calendario de efemérides|
|Reseñas negativas|Detección tardía|Alerta en tiempo real al Community Manager|
|Acceso|Contraseña única para todo el Drive|RBAC por usuario + offboarding en 1 clic|
|Reporting|Manual trimestral|Generación asistida desde Metricool/Maps|
|Satisfacción|No se mide|Encuesta automática mensual|



Mejoras esperadas **A VALIDAR con baseline** : reducción de horas en tareas repetitivas, menor churn evitable y continuidad operativa independiente de personas concretas. 

## **§06** Oportunidades de mejora 

Priorizadas por ROI/riesgo 

**==> picture [586 x 266] intentionally omitted <==**

**----- Start of picture text -----**<br>
# OPORTUNIDAD IMPACTO COMPLEJIDAD PRIORIDAD<br>O1 Comunicación con confirmación de lectura + tareas Alto Media MVP<br>O2 RBAC + offboarding instantáneo + datos sensibles protegidos Alto Media MVP<br>O3 Alertas en tiempo real de reseñas negativas (1–3★) Alto Baja MVP<br>O4 Agente Generador de Ideas + efemérides Alto Media MVP<br>O5 Agente de Informes (Metricool + Maps + Web) Alto Media FASE 2<br>O6 Respuesta asistida a reseñas 4–5★ (draft + aprobar) Medio Baja FASE 2<br>O7 Portal de cliente (contenido, docs, facturas, informes) Medio Media FASE 2<br>O8 Agente de Análisis Competitivo (scraping) Medio Alta + riesgo legal FASE 3<br>O9 Agente de Diseño generativo (flyers/menús con marca) Medio Alta FASE 3<br>O10 Web-por-prompt (desacoplar a Mica) Medio Muy alta I+D<br>O11 Multi-tenancy para venta SaaS Estratégico Decisión de arquitectura DÍA 1<br>§07 Metas a validar<br>Objetivos del proyecto<br>**----- End of picture text -----**<br>


AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 3/10 

|**OBJETIVO**|**TIPO**|**KPI**|**META**|
|---|---|---|---|
|Eliminar errores por falta de lectura|Operativo|% comunicaciones críticas confirmadas|≥95%|
|Detectar insatisfacción a tiempo|Estratégico|% encuestas mensuales respondidas|≥70%|
|Reducir tiempo de reporting|Operativo|Horas por informe trimestral|−60%|
|Detección temprana de reseñas 1–3★|Operativo|Tiempo medio de respuesta|< 2 h|
|Reducir dependencia creativa del CEO|Estratégico|% ideas generadas sin Franco|≥50%|
|Escalar sin crecer equipo|Financiero|Clientes por empleado|+30%|
|Seguridad de acceso|Operativo|Tiempo de revocación (offboarding)|< 5 min|



Todas las metas son propuestas de Dinamic SEO **A VALIDAR** ; requieren baseline numérico (ver entregable C). 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 4/10 

Cuatro capas 

> **§08** Solución propuesta Cuatro capas **Experiencia** 1 Tablero de tareas (estilo Trello) · canales y mensajería (estilo Google Chat) · confirmación de lectura · organigrama · portal de cliente. **Identidad y acceso (RBAC)** 2 Usuarios individuales · roles Maestro / Equipo / Cliente · permisos por proyecto · aislamiento de datos · offboarding inmediato · multi-tenant. **Agentes de IA + orquestación** 3 5 agentes especializados · Núcleo de Conocimiento (RAG por cliente) · Compuerta de Aprobación Humana · motor de automatización (n8n). **Datos e integraciones** 4 Base de datos con aislamiento por tenant · almacenamiento de objetos · Metricool · Google Business Profile · WhatsApp · email. **Propuesta de valor diferencial:** convertir el conocimiento operativo de la agencia (manuales de marca, buyer persona, procesos) en un activo de software reutilizable, con IA supervisada que ejecuta y un control de acceso que protege el negocio. 

> **§09** Arquitectura de automatización Componentes y flujo **COM PONENT ES FL UJO DE DAT OS (ALT O NIVEL )** Frontend web responsive (SPA). **A VALIDAR stack Evento externo · reseña / métrica / mensaje** Backend/API con autorización por rol y tenant. **↓** BD relacional con aislamiento por tenant (RLS o schema-per-tenant). Almacenamiento de objetos (sustituye al Drive de clave única). Webhook / polling → motor n8n Motor de automatización: **n8n** (self-host, soberanía del dato, coste **↓** predecible). Servicio de agentes de IA (prompts, RAG, llamadas a LLM). Reglas de negocio · ¿requiere IA? Colas de eventos para tareas asíncronas (scraping, informes, polling de **↓** reseñas). Servicio de agentes (si aplica) **↓ Persistencia + notificación en AMG OS** 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 5/10 

**§10** 

El corazón del sistema 

## Arquitectura de IA — Agentes 

Cinco agentes comparten dos piezas transversales: un **Núcleo de Conocimiento** (RAG por cliente con el manual de marca, buyer persona, competencia e histórico) que los alimenta de contexto, y una **Compuerta de Aprobación Humana** que gobierna toda salida publicable. Ningún agente publica, envía o cobra de forma autónoma. 

## Núcleo de Conocimiento 

RAG por cliente · vector store 

Manual de marca (logo, color, tono) Buyer persona y objetivos (Fase 0) Análisis de competencia Histórico de contenido y métricas 

**1 · Generador de Ideas 2 · Diseño** Contenido y efemérides Flyers/menús con marca **3 · Análisis Competitivo 4 · Informes** Scraping → insights Metricool → informe 

## **5 · Gestor de Reseñas** 

Clasifica, responde 4–5★, alerta 1–3★ 

**COMPUERTA HUMANA** 

Toda salida (copys, respuestas, diseños, informes) pasa por revisión y aprobación de una persona antes de publicarse o enviarse. Las reseñas negativas **siempre** las redacta un humano. 

Modelos recomendados **A VALIDAR según presupuesto/latencia** : LLM de gama alta para tareas creativas/analíticas (ideas, informes) y uno económico para clasificación y copys cortos. Para imagen: generación + composición por plantilla. 

1 · Agente Generador de Ideas **RAG + PLANIFICACIÓN** Propone contenido y campañas y anticipa efemérides con meses de antelación. **ASISTE ENTRADAS CONOCIMIENTO PROCESO (MODELO) APROBACIÓN HUMANA SALIDA INTEGRACIÓN** Brief del cliente · objetivos · **RAG:** buyer persona, LLM de alta capacidad genera Franco/CM revisan y Tarjetas de idea priorizadas + Crea tareas en el tablero y calendario de efemérides competencia, histórico y un calendario editorial con seleccionan las ideas válidas calendario con alertas de lead notifica a las creadoras (España/LatAm + sector manual de marca del cliente ganchos, formatos y canales, y time gastronómico) su justificación 

**Nota de implementación:** Quick win de mayor ROI percibido y menor riesgo técnico. Resuelve la dependencia creativa de Franco y las efemérides perdidas (caso Día de la Madre). 

## 2 · Agente de Diseño 

Genera flyers, creativos y propuestas de menú a partir de un prompt usando el manual de marca. 

**IMAGEN + PLANTILLA ASISTE · DRAFT** 

**ENTRADAS CONOCIMIENTO PROCESO (MODELO) APROBACIÓN HUMANA SALIDA INTEGRACIÓN** Brief/prompt · datos de **Brand kit** del cliente (logo, Generación de imagen para El diseñador aprueba o Piezas editables (creativos, Se guardan en los activos del producto o menú (nombres, paleta, tipografías) + librería fondos/visual + **composición** regenera flyer, propuesta de menú) cliente y van al tablero precios) de plantillas **por plantilla** que inyecta el texto exacto como capa, no lo genera 

**Riesgo / nota técnica:** El texto exacto (precios, nombres de platos) NUNCA se genera con IA: se inyecta por plantilla para evitar errores tipográficos. Es el agente de mayor riesgo de calidad; en v1 no sustituye a un diseñador en piezas premium. Difiérase a Fase 3. 

3 · Agente de Análisis Competitivo **SCRAPING + CLASIFICACIÓN** Rastrea sitios y perfiles de competidores y extrae keywords, formatos e ideas. **ASISTE ENTRADAS CONOCIMIENTO PROCESO (MODELO) APROBACIÓN HUMANA SALIDA INTEGRACIÓN** Lista de competidores Almacena instantáneas de Crawling (respetando El estratega revisa; barreras Informe competitivo: gaps de Alimenta al Generador de Ideas (URLs/perfiles) indicada por el competidores para detectar robots/ToS) → extracción → legales aplicadas keywords, ángulos de y a la Estrategia (Fase 0) estratega + keywords semilla tendencias en el tiempo clasificación NLP (temas, contenido, benchmarks de keywords, cadencia) → síntesis cadencia con LLM 

**Riesgo / nota técnica:** El scraping de terceros conlleva riesgo legal (ToS + RGPD). Requiere revisión jurídica y respetar robots.txt antes de activarse. Difiérase a Fase 3. 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 6/10 

**==> picture [561 x 26] intentionally omitted <==**

**----- Start of picture text -----**<br>
4 · Agente de Informes ETL + GENERACIÓN<br>Conecta con Metricool, Maps y web para construir informes trimestrales de rendimiento. ASISTE<br>**----- End of picture text -----**<br>


|Conecta con Metricoo|l, Maps y web para construir in|formes trimestrales de rendimient|o.||**ASISTE**|
|---|---|---|---|---|---|
|||||||
|**ENTRADAS**|**CONOCIMIENTO**|**PROCESO (MODELO)**|**APROBACIÓN HUMANA**|**SALIDA**|**INTEGRACIÓN**|
|Métricas de Metricool, Google|Objetivos de Fase 0 como|ETL/agregación→cálculo de|El responsable de cuenta revisa|Informe trimestral de marca|Metricool, GBP, analítica web|
|Business Profile y analítica web|marco de comparación|deltas vs. objetivos→narrativa|y edita antes de publicar|(portal/PDF)|→portal del cliente|
|+ KPIs/baseline del cliente||e insights con LLM→render en||||
|||plantilla de marca||||



**Nota de implementación:** Depende de la viabilidad de la API de Metricool (action item de la reunión): valídese pronto, porque bloquea toda la Fase 2. Plan B: exportaciones/CSV. 

**==> picture [562 x 26] intentionally omitted <==**

**----- Start of picture text -----**<br>
5 · Gestor de Reseñas CLASIFICACIÓN + ALERTA<br>Monitoriza Google Maps, clasifica y responde 4–5★, y alerta de inmediato ante 1–3★. MIXTA · AUTO-ALERTA<br>**----- End of picture text -----**<br>


|Monitoriza Google Ma|ps, clasifica y responde 4–5★,|y alerta de inmediato ante 1–3★.|||**MIXTA · AUTO-ALERTA**|
|---|---|---|---|---|---|
|||||||
|**ENTRADAS**|**CONOCIMIENTO**|**PROCESO (MODELO)**|**APROBACIÓN HUMANA**|**SALIDA**|**INTEGRACIÓN**|
|Flujo de reseñas|**Tono y guía de marca**del|Clasificación por|El CM aprueba toda respuesta;|Borradores 4–5★en cola +|GBP, WhatsApp Business,|
|(polling/webhook de Google|cliente para las respuestas|estrellas/sentimiento→4–5★:|las negativas las redacta un|alerta inmediata|email, tablero|
|Business Profile)||borrador de respuesta on-|humano|(WhatsApp/email) en 1–3★+||
|||brand · 1–3★: NO responde,||log de reputación||
|||prepara contexto||||



**Nota de implementación:** Componente de mayor ROI inmediato y bajo riesgo técnico: entra en el MVP (alertas) y se completa en Fase 2 (respuestas asistidas). Nunca auto-publicar respuestas a reseñas negativas. 

## **§11** Integraciones 

||||Sistemas y prioridad|
|---|---|---|---|
|||||
|**SISTEMA**|**TIPO**|**MÉTODO**|**PRIORIDAD**|
|Metricool|Métricas RRSS/web|API REST<br>**A VALIDAR**|**ALTA**|
|Google Business Profile|Reseñas/posts Maps|API REST / OAuth|**ALTA**|
|WhatsApp Business|Notificaciones|Cloud API|**ALTA**|
|Email transaccional|Notificaciones/encuestas|API / SMTP|**ALTA**|
|Google Drive|Almacenamiento|OAuth por usuario|**MEDIA**|
|Pasarela de facturación|Facturación|API<br>**A VALIDAR alcance**|**MEDIA**|



## **RE STRICCIÓN DE  SE GU RIDAD** 

Ninguna acción irreversible (publicar, enviar, borrar, cambiar permisos, cobrar) se ejecuta de forma autónoma sin confirmación humana explícita en la interfaz. 

## **§12** Requerimientos funcionales 

Qué debe hacer el sistema 

## **GEST IÓN Y COM UNICACIÓN** 

- **RF-001:** Tablero de tareas con estados, asignación y fechas. 

- **RF-002:** Canales por cliente/proyecto y mensajería privada entre usuarios. 

- **RF-003:** Confirmación de lectura por documento/comunicación, con registro auditable (quién y cuándo). 

- **RF-004:** Notificaciones de asignación y de comunicaciones críticas (in-app + email/WhatsApp). 

- **RF-005:** Organigrama interno consultable. 

## **IDENT IDAD Y ACCESO (RB AC)** 

- **RF-006:** Usuarios individuales con autenticación propia (sin contraseña compartida). 

- **RF-007:** Roles Maestro / Equipo / Cliente con permisos granulares. 

- **RF-008:** Asignación de clientes/proyectos a usuarios; aislamiento de datos entre clientes. 

- **RF-009:** Datos sensibles (honorarios, contratos, facturación) restringidos al rol Maestro. 

- **RF-010:** Desactivar usuario revoca todos los accesos de forma inmediata. 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 7/10 

## **AGENT ES DE IA** 

- **RF-011:** Generador de Ideas con calendario de efemérides anticipado. 

- **RF-012:** Agente de Informes que consolida Metricool/Maps/Web y genera borrador trimestral. 

- **RF-013:** Agente de Análisis Competitivo (keywords y formatos de competidores). 

- **RF-014:** Agente de Diseño (pieza desde prompt + manual de marca; texto exacto por plantilla). 

- **RF-015:** Toda salida de IA pasa por aprobación humana antes de publicarse/enviarse. 

## **RESEÑAS GOOGL E M APS** 

- **RF-016:** Monitorización periódica de reseñas por cliente. 

- **RF-017:** Borrador automático de respuesta para 4–5★ (requiere aprobación). 

- **RF-018:** Alerta inmediata (WhatsApp/email) al CM ante 1–3★. 

- **RF-019:** Redacción asistida de copys para publicaciones de Maps. 

## **PORTAL  DE CL IENT E,  FACT URACIÓN Y SAT ISFACCIÓN** 

- **RF-020:** Portal donde el cliente revisa contenido, sube documentos y ve informes y facturas. 

- **RF-021:** Carga de facturas por el Maestro; el cliente las visualiza y marca estado (pagada/no). 

- **RF-022:** Encuestas de satisfacción automáticas mensuales con recordatorios y consolidación. 

- **RF-023:** Arquitectura multi-tenant que habilita uso SaaS futuro. (A VALIDAR como requisito v1) 

## **§13** Requerimientos no funcionales 

Cómo debe comportarse 

## **SEGURIDAD Y PRIVACIDAD** 

- Autenticación por usuario (MFA recomendado para Maestro), cifrado en tránsito y reposo. 

- Mínimo privilegio + registro de auditoría de accesos y acciones sensibles. 

- **RGPD (UE/España):** base legal, minimización, retención y derecho de supresión. El scraping requiere revisión jurídica. 

## **OPERACIÓN** 

- **Rendimiento:** alertas de reseñas negativas en cuasi-tiempo real (objetivo < minutos). 

- **Escalabilidad:** de 10 a N clientes y multi-tenant sin reescritura. 

- **Disponibilidad:** propuesta 99,5% en core. **A VALIDAR SLA** 

- **Monitoreo:** logging central, alertas de fallo de integración y de coste/uso de LLM. 

**Trazabilidad IA:** registro de prompts, salidas y aprobaciones humanas. 

## **§14** Flujos de trabajo detallados 

Lógica de los procesos clave 

**==> picture [586 x 229] intentionally omitted <==**

**----- Start of picture text -----**<br>
Flujo 1 · Gestión de reseña negativa<br>Reseña entra (GBP) → ¿1–3★? → Alerta inmediata al CM → CM redacta/aprueba → Publica<br>Flujo 2 · Ideación con efemérides<br>Agente consulta efemérides + RAG → Genera propuestas → Franco/CM selecciona → Crea tareas + confirmación → Listo<br>Flujo 3 · Comunicación crítica<br>Responsable publica brief → Notifica a destinatarios → ¿Leído en plazo? → No  →  recordatorio/escalado → Sí  →  registro auditable<br>Flujo 4 · Informe trimestral asistido<br>Agente extrae métricas → Consolida y redacta → Responsable revisa/edita → Publica en portal → Notifica al cliente<br>**----- End of picture text -----**<br>


AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 8/10 

## **Flujo 5 · Offboarding de empleado** 

> **Maestro desactiva usuario →** Revoca sesiones y accesos **→** Reasigna tareas **→ Auditoría** KPIs de éxito Medición 

> **§15** KPIs de éxito 

|**KPI**|**BASELINE ACTUAL**|**META**|**PLAZO**|
|---|---|---|---|
|Comunicaciones críticas confirmadas|**A VALIDAR**|≥95%|3 meses post-MVP|
|Tiempo de respuesta a reseñas 1–3★|"Tardío"|< 2 h|MVP|
|Horas por informe trimestral|**A VALIDAR**|−60%|Fase 2|
|Ideas generadas sin el CEO|~0%|≥50%|6 meses|
|Tiempo de revocación de acceso|Manual/horas|< 5 min|MVP|
|Clientes por empleado|**A VALIDAR**|+30%|12 meses|
|**§16**<br>Roadmap de implementación|||Por fases, MVP primero|



## **§16** Roadmap de implementación 

> FA SE 1  · MV P **Entregables** Operación RBAC completo (RF-006 a 010) + salida de la contraseña compartida. segura y Núcleo de tareas + comunicación con confirmación de lectura (RF-001 a 005). conectada Alertas de reseñas negativas en tiempo real (RF-016, 018). Semanas 1–X · A VALIDAR Dependencias: acceso a Google Business Profile · definición de roles por Franco. 

## **Entregables** 

Generador de Ideas + efemérides (RF-011). FA SE 2 Agente de Informes con Metricool (RF-012). IA que asiste Respuesta asistida 4–5★ y copys de Maps (RF-017, 019). Semanas X–Y Portal de cliente + facturación + encuestas (RF-020 a 022). Dependencias: manuales de marca digitalizados · integración Metricool validada. FA SE 3 · I + D **Entregables** IA que Agente de Diseño (RF-014) y Análisis Competitivo (RF-013). produce Exploración de web-por-prompt (desacoplar a Mica). Semanas Y–Z Dependencias: revisión legal del scraping · pruebas de calidad de diseño generativo. 

## **TRANSVE RSAL ·  DE SDE  E L DÍA 1** 

Decidir la **multi-tenancy** (RF-023). Incorporarla después implica rehacer la capa de datos. 

## **§17** Riesgos y mitigaciones 

Lo que puede salir mal 

|**RIESGO**|**PROB.**|**IMPACTO**|**MITIGACIÓN**||
|---|---|---|---|---|
|Sobre-alcance (querer todo a la vez)|Alta|Alto|MVP acotado + roadmap por fases.||
|Diseño generativo no alcanza calidad de marca|Alta|Medio|Plantillas + texto por capa; mantener diseñador para piezas premium.||
|API de Metricool limitada o inexistente|Media|Alto|Validar pronto; plan B: exportes/CSV o scraping autorizado.||
|Adopción interna baja (siguen sin leer)|Media|Alto|Confirmación obligatoria + escalado; gestión del cambio con Franco.||
|Riesgo legal del scraping|Media|Alto|Revisión jurídica; respetar ToS/robots; diferir a Fase 3.||
|Auto-respuesta a reseñas daña la marca|Media|Alto|Nunca auto-publicar; human-in-the-loop, sobre todo en negativas.||
|Coste de LLM sin control|Media|Medio|Modelos económicos para tareas simples; límites y monitorización.||
|RGPD / datos sensibles|Media|Alto|Privacidad por diseño, auditoría, retención y permisos estrictos.||



AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 9/10 

**RIESGO** 

Falta de baseline → ROI no demostrable 

## **§18** Recomendaciones finales 

## **PRÓXIM AS 2 SEM ANAS** 

Cerrar con Franco las 3 preguntas críticas (presupuesto/plazo, dolores prioritarios, multi-tenant). Medir baseline de tareas repetitivas. Validar la API de Metricool. Recopilar documentos de ejemplo y preguntas de la encuesta. 

**PROB. IMPACTO MITIGACIÓN** Alta Medio 

Alta Medio Medir antes/después por tarea desde la Fase 1. Próximos pasos **DECISIONES DEL  CL IENT E AT ENCIÓN URGENT E** Alcance del MVP (recomendado: RBAC + **Contraseña única del Drive de 3 TB:** comunicación + alertas). vulnerabilidad crítica → priorizar RBAC en el Facturación: ¿solo estado o cobro real? MVP. ¿Drive como backend o almacenamiento **Sobre-alcance:** el mayor riesgo de fracaso propio? → defender el MVP por fases. ¿Multi-tenant v1 o single-tenant? 

## **CÓMO SE GU IR** 

El entregable **C** (cuestionario de cierre de descubrimiento) recoge todo lo marcado como **A VALIDAR** en preguntas concretas para Franco. Respondidas, este PRD pasa de v1.0 ( ≈ 75%) a v1.1 listo para estimar esfuerzo y presupuesto. 

Documento preparado por Dinamic SEO · Confidencial, destinado exclusivamente al equipo del proyecto. 

AMG OS · PRD v1.0 — Confidencial 

Preparado por Dinamic SEO · 10/10 


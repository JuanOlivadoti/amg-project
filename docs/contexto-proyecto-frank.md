# Proyecto Frank — Plataforma de Agentes para Agencia

## 1. Contexto general

Frank es cliente de la agencia. Actualmente contrata servicios por fuera (diseño web, SEO, gestión de reseñas, etc.) y evalúa si le conviene que nosotros desarrollemos una plataforma propia de agentes de IA que automatice varias de esas tareas para su agencia.

El objetivo del proyecto es armarle una propuesta con **costos y tiempos** para que pueda decidir si le resulta rentable frente a seguir tercerizando.

## 2. Participantes

- **Frank** — Cliente final. Ya tiene avance parcial en el módulo de creación de webs.
- **Socio** — Interlocutor principal con Frank, define alcance comercial.
- **Juan** — Desarrollador que ya avanzó el agente de WordPress.
- **Nosotros** — Responsables de armar propuesta técnica, presupuesto y ejecución.

## 3. Situación actual (según audios de Frank)

- Ya tiene creado un **agente en Codex** que recibe un prompt y genera páginas.
- WordPress ya conectado; el trabajo lo hizo Juan.
- **Falta conectar Elementor** (plugin de maquetación) y "alguna cosita más".
- Muestra interés fuerte en automatizar el **Keyword Research**, que hoy hace manualmente con el Planificador de Palabras Clave de Google.
- Está dispuesto a pagar SEMrush si es necesario para automatizarlo.

## 4. Alcance propuesto — Módulos

El proyecto se desglosa en **4 módulos principales + 1 línea a futuro**. Cada módulo es vendible de forma independiente o como paquete.

### Módulo 1 — Creador de Webs
Agente que recibe un prompt y genera páginas en WordPress vía Elementor.
- **Estado:** avanzado por Juan, falta integración con Elementor.
- **Punto crítico a resolver:** confirmar si genera HTML plano o directamente el formato de datos propio de Elementor (JSON de widgets).

### Módulo 2 — Disparador de Keyword Research
Agente que a partir de un prompt entrega listado de keywords con volumen, dificultad e intención de búsqueda.
- **Opciones de motor:**
  - Google Ads API (Keyword Planner) — sin costo por uso pero requiere alta, developer token y aprobación de Google.
  - SEMrush API — costo mensual fijo, integración más directa.
- **Output ideal:** que alimente directamente al Módulo 1.

### Módulo 3 — Respondedor de Reseñas de Google Maps
Agente que gestiona respuestas a reseñas de la ficha de Google Business Profile.
- **Requiere:** Google Business Profile API + verificación de la ficha del cliente final.
- **Recomendación:** modo "borrador con aprobación humana" al inicio, no publicación automática — riesgo alto en reseñas negativas.

### Módulo 4 — Creador de Calendario de Redes Sociales
Agente que genera un calendario de contenidos organizado por fechas.
- **A definir con el socio:** si este módulo reemplaza o convive con la idea inicial de "gestor de tareas tipo Trello". Son productos distintos.

### Línea futura — Servicio de IA adicional
Mencionado por el socio, sin alcance definido aún. Se deja fuera del presupuesto inicial, como fase 2 "a definir".

## 5. Criterios comerciales

- **Precio "tirando para arriba"**, sin descuentos por amistad — indicación explícita del socio.
- La propuesta debe permitirle a Frank comparar contra el costo actual de contratar por fuera.
- Estructurar el presupuesto por módulos para que Frank pueda elegir el paquete completo o ir sumando módulos por fases.

## 6. Pendientes antes de presupuestar

- [ ] Reunión con **Juan** para confirmar estado real del Módulo 1 y esfuerzo restante.
- [ ] Confirmar con **el socio** qué proveedor/contacto tienen para Keyword Research (mencionó "el contacto del video").
- [ ] Definir con el socio si va **Trello (gestor de tareas)** o **calendario de redes sociales** — o ambos.
- [ ] Decidir motor de Keyword Research por defecto (Google Ads API vs SEMrush) para incluir en propuesta base.

## 7. Próximos pasos

1. Validar este documento de contexto.
2. Crear un documento de detalle por cada módulo (alcance técnico, dependencias, tiempo, precio).
3. Consolidar todo en la propuesta comercial final para Frank.

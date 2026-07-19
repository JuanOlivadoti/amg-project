# Proyecto Frank — Plataforma de Agentes para Agencia

> ## 📌 Este es el documento RECTOR del alcance (decidido 2026-07-19, cierra OBS-01)
>
> Donde este documento y el [PRD](A_PRD_AMG_Madrid_v1_Ilustrado.md) digan cosas distintas, **manda
> este**. El PRD queda como **visión de largo plazo**, no como alcance a presupuestar.
>
> **Alcance base: 3 módulos** (el 4 pasa a línea futura — ver §4).
>
> | Módulo | Estado real hoy |
> |---|---|
> | 1 — Creador de Webs | ✅ **Construido y funcionando** de punta a punta |
> | 2 — Keyword Research | ✅ **Construido**, corrido en producción: **$0.31** por research |
> | 3 — Respondedor de reseñas | ⛔ Sin empezar — lo único del alcance base por construir |
>
> ⚠️ **Varias afirmaciones de §3 y §4 quedaron viejas.** Se conservan como registro de cómo empezó
> el proyecto; lo que vale hoy está anotado en cada punto.

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

> ⚠️ **Actualización (2026-07-19).** Esto ya no describe lo que hay. **No va sobre WordPress ni
> Elementor**: [ADR-04](decisiones-arquitectura.md) los descartó —el JSON de Elementor es opaco y
> frágil para generación por IA, y WordPress son N instalaciones que mantener, contra la tesis de
> escalar sin crecer el equipo— y se eligió **Storyblok** (headless + Visual Editor). Confirmado al
> cerrar OBS-01.
>
> **Y ya no está "avanzado": está construido y funcionando de punta a punta.** El prompt genera el
> research, un humano aprueba en el portal, se publica en Storyblok y **el renderizador sirve la web
> en un dominio** (ADR-19), con el Visual Editor operativo para que edite un no-técnico.
>
> El "punto crítico a resolver" se disolvió con la decisión: se genera **HTML semántico + JSON-LD**,
> validado en el Rich Results Test de Google.

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

### Módulo 4 — Creador de Calendario de Redes Sociales ⏭️ FUERA DEL PRESUPUESTO INICIAL
Agente que genera un calendario de contenidos organizado por fechas.
- **A definir con el socio:** si este módulo reemplaza o convive con la idea inicial de "gestor de tareas tipo Trello". Son productos distintos.

> ⚠️ **Decidido (2026-07-19):** **ninguno de los dos entra en la propuesta inicial.** Pasa a la línea
> futura de abajo. Con eso se disuelve el dilema: no hay que elegir ahora entre dos productos
> distintos, y cada uno se puede ofrecer después por separado y con su propio precio.

### Línea futura — Servicio de IA adicional
Mencionado por el socio, sin alcance definido aún. Se deja fuera del presupuesto inicial, como fase 2 "a definir".

> Acá caen ahora: el **calendario de redes**, el **gestor de tareas tipo Trello**, y lo que el PRD
> describe más allá de los tres módulos base.

## 5. Criterios comerciales

- **Precio "tirando para arriba"**, sin descuentos por amistad — indicación explícita del socio.
- La propuesta debe permitirle a Frank comparar contra el costo actual de contratar por fuera.
- Estructurar el presupuesto por módulos para que Frank pueda elegir el paquete completo o ir sumando módulos por fases.

## 6. Pendientes antes de presupuestar

- [x] ~~Reunión con **Juan** para confirmar estado real del Módulo 1 y esfuerzo restante.~~ → El
      módulo 1 **está construido** sobre Storyblok, no sobre WordPress (ADR-04, confirmado al cerrar
      OBS-01). El esfuerzo restante del módulo 1 es **cero**; lo que falta es desplegar.
- [ ] Confirmar con **el socio** qué proveedor/contacto tienen para Keyword Research (mencionó "el contacto del video").
- [x] ~~Definir si va **Trello** o **calendario de redes** — o ambos.~~ → **Ninguno de los dos** en
      la propuesta inicial; los dos pasan a línea futura.
- [x] ~~Decidir motor de Keyword Research (Google Ads API vs SEMrush).~~ → **DataForSEO**
      ([ADR-05](decisiones-arquitectura.md)), ya integrado y **ya corrido en producción**: 52
      keywords → 8 páginas por **$0.31**. Se descartó SEMrush (~450 €/mes) y Google Ads API
      (developer token, volúmenes en rangos).

> El único pendiente que queda es el del contacto de Keyword Research — y a esta altura es
> **informativo, no bloqueante**: el motor ya está decidido, integrado y facturando centavos.

## 7. Próximos pasos

1. Validar este documento de contexto.
2. Crear un documento de detalle por cada módulo (alcance técnico, dependencias, tiempo, precio).
3. Consolidar todo en la propuesta comercial final para Frank.

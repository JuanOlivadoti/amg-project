# Acción 05 — Unificar el alcance del proyecto (OBS-01)

**Tiempo:** una conversación con el socio y con Juan · **Costo:** gratis · **Prioridad:** 🔵 antes de presupuestar

## Por qué

No es un problema técnico: es un **riesgo comercial**. Hay **dos documentos de producto que
describen proyectos distintos**, y si se presupuesta sobre ambos, se le presentan a la misma
persona **dos alcances incompatibles**.

| Documento | Sponsor | Alcance |
|---|---|---|
| [`contexto-proyecto-frank.md`](../contexto-proyecto-frank.md) | "**Frank**, cliente de la agencia" | **4 módulos**. El Creador de Webs es prioritario y "ya avanzado por Juan". |
| [`A_PRD_AMG_Madrid_v1_Ilustrado.md`](../A_PRD_AMG_Madrid_v1_Ilustrado.md) | "**Franco · CEO**" | **5 agentes**, prioridades distintas. La web-por-prompt está **diferida a I+D**. |

**Frank ≈ Franco es casi con seguridad la misma persona/proyecto**, pero los framings no cierran.
Está registrado como **OBS-01** en las [decisiones de arquitectura](../decisiones-arquitectura.md).

---

## Las 3 preguntas a resolver

### 1. ¿Frank y Franco son el mismo? ¿Cuál es el alcance acordado?
**Con quién:** el socio (es el interlocutor con el cliente).

Hay que salir de esa conversación con **un solo listado de módulos**, en orden de prioridad, y
saber cuáles entran en la propuesta base y cuáles son opcionales por fases.

### 2. ¿El Creador de Webs es prioritario o va diferido?
**Con quién:** el socio.

Es contradictorio entre los dos documentos, y **cambia la propuesta por completo**: es el módulo
más caro de construir bien.

> Contexto: **ya está construido como PoC funcional** en este repo (`web-builder/`). Eso debería
> pesar en la decisión — el trabajo grande ya está hecho.

### 3. ¿Qué pasa con el trabajo previo de Juan sobre WordPress/Elementor?
**Con quién:** Juan (el desarrollador).

Esto es **importante y potencialmente incómodo**: la [ADR-04](../decisiones-arquitectura.md) decidió
**descartar WordPress/Elementor** y usar Storyblok (headless) en su lugar.

Motivos de la decisión:
- El JSON serializado de Elementor es **opaco y frágil** para que lo genere una IA.
- WordPress implica **mantenimiento por sitio** (updates, plugins, seguridad) → trabajo recurrente
  que contradice la tesis del producto (escalar sin crecer el equipo).
- Headless + Next.js es **superior para SEO y buscadores IA** (JSON-LD, HTML semántico), que es el
  corazón de la propuesta de valor.

**Hay que confirmarlo con Juan antes de la propuesta**, porque:
- Puede tener trabajo hecho que se descarta (conviene que se entere por vos, no por el presupuesto).
- Puede tener información que no tenemos y que haga reconsiderar la decisión.

---

## Qué necesito de vos

Simplemente **contame la decisión**. Con eso yo:
- Actualizo la observación **OBS-01** en las decisiones de arquitectura (la cierro o la ajusto).
- Alineo la documentación del proyecto con el alcance real.
- Si cambia algo de fondo (ej. vuelve WordPress), lo registramos como una **nueva ADR** que
  reemplaza a la anterior — con su justificación, para no perder el rastro de por qué se decidió qué.

---

## Cómo saber que salió bien

- [ ] Hay **un solo listado de módulos** acordado, en orden de prioridad.
- [ ] Está claro si el Creador de Webs entra en la propuesta base.
- [ ] Juan está al tanto de la decisión sobre WordPress (y tuvo la chance de opinar).
- [ ] Me contaste el resultado para actualizar los documentos.

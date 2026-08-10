# Documentación — AMG OS

El código vive en [`../kr-service/`](../kr-service/) (Módulo 2) y [`../web-builder/`](../web-builder/)
(Módulo 1); cada paquete tiene su propio README. La portada del repo es
[`../README.md`](../README.md).

## Las cuatro carpetas, y qué pregunta contesta cada una

| Carpeta | Contesta | ¿Describe el sistema de hoy? |
| --- | --- | --- |
| 📘 [`proyecto/`](proyecto/) | **Cómo es y en qué estado está.** Visión, arquitectura, stack, los dos módulos, el contrato de handoff, configuración, testing, estado y despliegue | **Sí.** Es la documentación viva |
| 🧭 [`superpowers/`](superpowers/) | **Qué se va a construir y cómo se construyó.** Diseños (`specs/`), planes (`plans/`) y los ya ejecutados (`ejecutados/`) | Solo los vivos. `ejecutados/` es registro |
| 📦 [`historia/`](historia/) | **Por qué el proyecto es así.** El PRD y el contexto de origen, las acciones ya cerradas, el diseño del Módulo 2 previo a construirlo | **No.** Se conserva por el *por qué* |
| 🔒 `private/` | Credenciales y notas que no se versionan | — |

**Empezá por [`proyecto/`](proyecto/)**, y dentro de esa carpeta por
[**09 — Estado y roadmap**](proyecto/09-estado-y-roadmap.md), que dice dónde estamos y qué falta.

## Documentos sueltos de esta carpeta

| Documento | Qué es |
| --- | --- |
| [decisiones-arquitectura.md](decisiones-arquitectura.md) | **El registro de decisiones: ADR-01..24 + OBS-01..04.** El *porqué* de cada elección, con las alternativas descartadas y las decisiones que hubo que corregir. El resto de la documentación lo referencia constantemente. 🔴 **OBS-04 sigue abierta**: quién edita la web no lo gobierna nuestro RBAC |
| [guia-dataforseo.md](guia-dataforseo.md) | Alta y uso de DataForSEO, de sandbox a producción. Cada corrida en producción se paga |
| [gastos.md](gastos.md) | **Lo que el proyecto costó en dinero real y lo que va a seguir costando.** Los desembolsos hasta hoy, el consumo medido de las APIs de pago por uso, el run-rate mensual y dónde se rompe cada plan barato al escalar |

## Cómo referenciar entre documentos

El repo tiene un grafo de referencias (skill-map) que valida los enlaces en cada scan. Tres reglas
mantienen ese grafo limpio, y las tres salen de errores que ya cometimos:

**1. Un enlace se escribe como enlace markdown, con ruta relativa al documento.** Así se navega y así
se valida:

```text
[Estado y roadmap](proyecto/09-estado-y-roadmap.md)
```

**2. Un nombre de archivo en un span de código lleva su ruta completa desde la raíz del repo.** Un
nombre suelto se resuelve **contra la carpeta del documento que lo menciona**, así que el segundo
ejemplo, escrito en este archivo, se busca dentro de esta misma carpeta y no existe:

```text
`docs/proyecto/09-estado-y-roadmap.md`     ✔  resuelve
`09-estado-y-roadmap.md`                   ✘  se busca en docs/ y no está
```

Es la trampa que más veces se repitió: la misma línea escrita en un documento resuelve y en otro no.

**3. Lo que no es una referencia, no se escribe como ruta.** Un artefacto que genera el pipeline, un
nombre de ejemplo o una unidad de medida no son enlaces, y si quedan escritos como ruta el grafo los
reporta rotos para siempre:

```text
out/informe.md      artefacto generado: nunca existe en disco para el scan
€/mes               unidad de medida, leída como si fuera un slash-command
```

Cuando el texto correcto es igualmente ambiguo —un nombre dentro de un árbol de directorios ASCII, por
ejemplo— se silencia ese caso puntual con `sm issues dismiss` **y su motivo**, que queda escrito en el
`.sm` del documento. Sin el motivo, la supresión es un olvido en vez de una decisión.

**Y un aviso que se puede ignorar:** un enlace cuyo texto visible es la misma ruta dispara una
*colisión de extractores*. Es inocuo —gana el enlace y se registra bien— y hay decenas en el repo.

**Un ejemplo de ruta no se puede esconder en un bloque de código.** Lo comprobamos acá mismo: los dos
ejemplos "malos" de arriba están en un fence ```` ```text ```` y el scan **los persigue igual** —
`out/informe.md` y el nombre sin carpeta siguen contando como referencias rotas de este documento. No
hay forma de escribir un contraejemplo de ruta sin que el grafo lo reporte, así que **los dos están
silenciados con `sm issues dismiss`**, con "es el contraejemplo de la convención" como motivo en
[`README.sm`](README.sm).

Es la única excepción sana a la regla 3: cuando el documento *tiene* que mostrar una ruta que no
resuelve, se silencia con su motivo. Este archivo tardó tres intentos en aprenderlo — el primero
rompía la regla que enseñaba, el segundo apostó a que un fence bastaba, y no bastó.

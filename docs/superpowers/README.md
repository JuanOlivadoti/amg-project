# Diseños y planes de implementación

Cada pieza no trivial se **diseña** antes de planificarse y se **planifica** antes de escribirse. Los
dos artefactos viven acá:

| Carpeta | Qué contiene |
| --- | --- |
| `specs/` | El **diseño**: qué problema se resuelve, qué alternativas se descartaron y por qué |
| `plans/` | El **plan de implementación**: las etapas, en orden, con su verificación |
| `ejecutados/` | Lo que **ya aterrizó en `main`**. Diseño y plan juntos, ordenados por fecha |

**Por qué se archivan y no se borran.** Un plan ejecutado es el único lugar donde queda escrito *por
qué* el código quedó así: la alternativa que se probó y falló, el hallazgo de la review que cambió el
rumbo. Eso no lo cuenta el código ni el commit. Pero un plan terminado tampoco puede seguir
compitiendo por atención con lo que falta hacer — de eso se trata la carpeta.

**Cuándo se mueve un plan a `ejecutados/`.** Cuando su trabajo está mergeado a `main` y verificado.
No cuando "está casi": mientras quede una etapa sin cerrar, el plan es la referencia de lo que falta y
se queda donde está. Y si algo archivado vuelve a estar vivo, se saca de `ejecutados/`.

`ejecutados/` está **fuera del índice de skill-map** (`scan.ignore`), y se camina solo para validar
enlaces (`scan.referencePaths`): así los ~9.400 renglones de historia no compiten en el grafo con los
documentos vivos, pero las referencias que les apuntan siguen resolviendo.

---

## Vivos — lo que todavía no está construido

El estado manda desde [`../proyecto/09-estado-y-roadmap.md`](../proyecto/09-estado-y-roadmap.md); acá
va el resumen de una línea.

| Documento | Qué propone | Estado |
| --- | --- | --- |
| [plans/2026-08-01-portal-agencia-programa.md](plans/2026-08-01-portal-agencia-programa.md) | El programa de las 4 piezas del portal de la agencia, en orden clientes → usuarios → ideas → dashboard | 🟡 **2 de 4 cerradas** (clientes y usuarios, mergeadas) |
| [plans/2026-08-01-modulo-ideas-portal.md](plans/2026-08-01-modulo-ideas-portal.md) | Pieza 3 — el módulo de ideas: modelo, pantallas y seed (no el ingreso por n8n) | 🟡 Sin empezar |
| [plans/2026-08-01-dashboard-home-portal.md](plans/2026-08-01-dashboard-home-portal.md) | Pieza 4 — el dashboard como home del portal (stats de ideas + tabla) | 🟡 Sin empezar. Va última: depende de ideas |
| [specs/2026-08-01-plantillas-landings-design.md](specs/2026-08-01-plantillas-landings-design.md) | Plantillas de landing + manual de marca: shell fijo, catálogo de piezas, carta con categorías | 🟡 Diseñado, sin empezar. Migración `0014`, tres entregas. Tiene una **colisión de contrato abierta** (`logo_url`/`portada_url` se guardan en `contacto`, que es interno, y el renderizador solo lee `business_profile_publico`) |

## Ejecutados — cómo se construyó lo que ya funciona

| Fecha | Documento | Qué implementó | Dónde aterrizó |
| --- | --- | --- | --- |
| 2026-07-26 | [diseño](ejecutados/2026-07-26-verificacion-jwt-es256-design.md) · [plan](ejecutados/2026-07-26-verificacion-jwt-es256.md) | Verificación de JWT con ES256 contra el JWKS de Supabase, en vez de confiar en el token | ✅ `9706bec`, `2630878`; login verificado en el navegador |
| 2026-07-30 | [diseño](ejecutados/2026-07-30-dashboard-ui-portal-design.md) · [plan](ejecutados/2026-07-30-dashboard-ui-portal.md) | El shell del portal y el dashboard de cartera, traídos de `dashboard-project` | ✅ `d670c23` (13/13 tareas) |
| 2026-07-30 | [plan](ejecutados/2026-07-30-tailwind-v4-migracion-portal.md) | Migración de Tailwind v3 → v4 (sin archivo de configuración, tokens en `@theme`) | ✅ Cerrado y mergeado con el shell |
| 2026-07-30 | [diseño](ejecutados/2026-07-30-modo-oscuro-portal-design.md) · [plan](ejecutados/2026-07-30-modo-oscuro-portal.md) | El tema claro/oscuro del portal, con el contraste AA impuesto por tests | ✅ `7c9b921` (21 tests nuevos) |
| 2026-07-31 | [diseño](ejecutados/2026-07-31-navegacion-sitio-cliente-design.md) · [plan](ejecutados/2026-07-31-navegacion-sitio-cliente.md) | La navegación del sitio público: nav fijo de 4 secciones, footer con NAP multi-local, home sintetizada | ✅ Migración `0010`; una de las cuatro piezas de la demo con Frank |
| 2026-08-01 | [plan](ejecutados/2026-08-01-paginas-clientes-portal.md) | Pieza 1 — el CRM de clientes en el portal | ✅ Mergeada a `main`, migración `0011` |
| 2026-08-02 | [plan](ejecutados/2026-08-01-paginas-usuarios-portal.md) | Pieza 2 — usuarios: gestión de membresías y rol derivado de `memberships`, no del token | ✅ `0589140`, migración `0012` |

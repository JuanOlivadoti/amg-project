# El sistema de render de AMG OS

Todo lo que convierte una ficha de cliente y un brief aprobado en **el HTML que ve un desconocido**.

Esta carpeta documenta un cuerpo de conocimiento que vive en **dos paquetes**, y conviene decirlo en
la primera línea porque es la confusión más cara:

```text
web-builder/src/render/   PRODUCE el HTML: shell, recetas, piezas, CSS, tokens, JSON-LD
renderer/                 lo SIRVE: dominio → cliente → Storyblok CDA → cache → respuesta
```

El renderizador **importa** `renderStory`/`renderHome`/`renderMenu`/`renderBlogIndex` de
`web-builder`. Por eso una regla CSS escrita en `web-builder/src/render/piezas/` termina servida a
internet anónimo sin pasar por ningún otro filtro, y por eso las dos mitades se documentan juntas: se
rompen juntas.

## Los documentos

| Archivo | Qué responde |
| --- | --- |
| [`01-sistema-de-render.md`](01-sistema-de-render.md) | Cómo se arma una página: el shell, la receta, el catálogo de piezas y el CSS. **Empezá por acá** |
| [`02-escribir-una-pieza.md`](02-escribir-una-pieza.md) | La guía práctica: el contrato de `Pieza`, las reglas de aislamiento y las trampas que ya mordieron |
| [`03-tema-y-marca.md`](03-tema-y-marca.md) | Los tokens en dos capas, el tema claro/`auto`, las tipografías self-hosted y los dos anchos |
| [`04-plantilla-base.md`](04-plantilla-base.md) | Qué aspecto tiene hoy la plantilla `base`, de dónde salió cada valor y qué falta |
| [`05-el-servicio.md`](05-el-servicio.md) | El renderizador como servicio: dominios, CDA, cache, preview, webhook y sus límites |

## Quién lo mantiene

El agente [`render`](../../.claude/agents/render.md) y sus tres skills:

| Skill | Cuándo cargarla |
| --- | --- |
| `render-plantillas` | Tocás una pieza, una receta, el CSS, un token o el tema |
| `render-seguridad` | Tocás el borde público: dominio, perfil, allowlist, preview, webhook |
| `render-cda-cache` | Tocás la lectura de Storyblok, la cache o su invalidación |

## Las reglas que no se negocian

1. **El renderizador no emite JavaScript.** Es la única superficie expuesta a internet anónimo. Todo
   lo interactivo —carruseles, acordeones— se hace con CSS o no se hace. Meter JS acá necesita un ADR.
2. **Storyblok son dos APIs que no se cruzan.** Acá se **lee** por la Content Delivery API. Quien
   escribe es el orquestador, por la Management API, y con otra credencial.
3. **Todo lo interpolado va escapado**, sin excepciones ni "este valor viene de nuestra base". En
   producción el dato llega de la CDA **sin pasar por Zod**.
4. **El dominio ES la autorización.** No hay usuario del otro lado; filtrar por tenant sería teatro.

## Cómo se verifica

```bash
npm test -w web-builder       # el render: piezas, recetas, tema, aislamiento, imágenes
npm test -w renderer          # el servicio: dominio, cache, perfil, webhook, preview
npm run dev:server -w renderer  # levanta el renderizador sobre PGlite y una CDA de mentira
```

⚠️ **`npm run demo -w renderer` pega contra el Storyblok REAL con credencial real.** No es parte de
la verificación y no lo corre ningún subagente.

**Los tests no ven layout.** Que el `<style>` sea correcto no dice que la página se vea bien: el
sticky roto, el salto de 203 px del carrusel y el logo de 56 px en un móvil los encontró un
navegador, no una aserción. Manejá la app — está en el ritual de `AGENTS.md` por este motivo.

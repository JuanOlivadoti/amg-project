# Sesión en curso

> El estado **vivo**: en qué se está trabajando ahora mismo. Se escribe mientras se trabaja, no al
> final. Al cerrar la etapa, el resumen se mueve a [`history.md`](history.md) y este archivo vuelve a
> la plantilla de abajo.
>
> Si acá dice algo de hace tres semanas, está mintiendo: o se cierra o se vacía.

**Sesión:** 2026-08-10
**En curso:** **bloque K — el rediseño de la plantilla base** de las webs de cliente, con la
referencia visual de un template comercial de restaurante (`Foodu`, `home-6`).
**Estado:** etapas 1 y 2 **commiteadas y pusheadas**. **1372 tests**, `verificar` en verde.

```text
a6753ec  etapa 1  tema claro por defecto · cabecera · portada con carrusel
34e2ac9  etapa 2  el patrón de sección compartido + cartaCategorias
bc15f6d  etapa 2  barraDatos · platosDestacados · galeria · ctaFinal (agente `render`)
```

De paso se cerró la **etapa C del plan de agentes**: existe el agente `render` con tres skills y la
documentación del sistema de render en [`renderer/docs/`](../renderer/docs/README.md). El relato de
todo esto está en [`history.md`](history.md).

## 🎯 Cómo continuar (prompt para después de `/compact`)

> Copiá el bloque de abajo tal cual.

```text
Continuamos el bloque K (rediseño de la plantilla base). Leé primero:
  - progress/current.md (este archivo)
  - renderer/docs/04-plantilla-base.md   ← qué se copió de la referencia y qué no
  - docs/proyecto/15-plan-plataforma.md § Bloque K
y cargá la skill `render-plantillas`.

Etapas 1 y 2 están hechas y pusheadas (a6753ec, 34e2ac9, bc15f6d). Falta:

ETAPA 2, lo que queda — rediseñar con el patrón de sección ya fijado
(.seccion / .banda / .encabezado en CSS_BASE; el ejemplo es carta-categorias.ts):
    hero · seccionProsa · faq · indice · blogIndice
    contacto + locales (el footer: en la referencia son 4 columnas)
  Y quitarles el andamio `.p-<id>{max-width:var(--ancho-lectura);margin:0 auto}`.

ETAPA 3 — las tres secciones nuevas, con contenido por defecto (decisión del
usuario, 2026-08-10; el límite está en renderer/docs/04-plantilla-base.md):
    bienvenida · destacados (bullets) · testimonios
  Cada campo cruza las CUATRO fronteras: Zod de contrato.ts, la allowlist SQL
  (migración: es del agente `datos`), perfilValido, y la pieza.
  ⚠️ Un default puede rellenar una sección, NUNCA afirmar un hecho sobre el
  negocio. Sin nombres de persona ni valoraciones numéricas en los testimonios.

Al terminar cada tanda: medir la paridad ANTES de re-capturar (el usuario ya
autorizó `capturar:paridad` para este rediseño), verificar en un navegador
—escritorio 1440 y móvil 390—, y commit + push.
```

## ⚠️ Las trampas de esta área, que ya mordieron

Están en la skill `render-plantillas` y en [`renderer/docs/02-escribir-una-pieza.md`](../renderer/docs/02-escribir-una-pieza.md),
pero estas cinco son las que se repitieron en esta sesión:

```text
backtick en un comentario del CSS      rompe el build con "Expected } but found @"; me pasó 3 veces
`url(` o `href=` en un comentario      dos tests analizan el <style> sin distinguir comentario de regla
font-weight en un titular              se precarga UN archivo (peso 700): el preload se vuelve basura
color literal sin contrapartida        el detector de modo oscuro lo caza; o pasa a token, o se redeclara
especificidad dentro de un @media      `.p-x .a` pierde contra `.p-x .b .a` aunque esté después
```

Y dos del método, que valen más que las cinco:

- **El navegador cachea.** Recargá ignorando cache o vas a estar mirando la página vieja. Si dudás,
  comprobá con `curl` que el HTML servido es el tuyo. Y matá los `dev-server` viejos: `tsx` no recarga
  en caliente y un servidor zombi sirve código de hace media hora.
- **Los tests no ven layout.** De los defectos de esta sesión, la mayoría los encontró el navegador:
  un `sticky` que no pegaba, un ancla que movía la página 203 px, un logo sin achicar en móvil.

## ✅ Lo que quedó hecho, en una línea cada cosa

- **El tema lo decide la ficha, no el sistema operativo del visitante.** `brand.tema`, default
  `claro`. Era un bug de producto: el fondo de marca del cliente lo pisaba `prefers-color-scheme`.
- **Cabecera**: barra superior con teléfono y horario, sticky, nav centrado, CTA `tel:`.
- **Portada**: dos columnas, titular grande y carrusel de fotos **sin una línea de JavaScript**
  (radios + `:checked`; las anclas movían la página 203 px).
- **Patrón de sección** compartido, y cinco secciones que lo usan.
- `heroPortada` y `carta` **retiradas** del catálogo: se quedaron sin receta.

## ⚠️ Deuda declarada (no descubierta después)

**`brand.tema: "auto"` es inalcanzable en producción.** No cruza las tres primeras fronteras (Zod,
allowlist `0014`, `perfilValido`), así que una ficha que lo pidiera se queda por el camino tres veces
sin error y sin log. **El default se cumple siempre**, que es la conducta que se quería, pero la
opción no existe hasta agregarlo a las tres. Lo encontró el agente que escribía `render-seguridad`,
verificando el trabajo del mismo día.

Tres más, del servicio, en [`renderer/docs/05-el-servicio.md`](../renderer/docs/05-el-servicio.md):
el cupo del semáforo en producción (64) no lo fija ningún test —el único que hay pasa `2`, o sea que
elige el parámetro en vez de fijar el de producción—, el `Semaforo` envuelve al `Coalescedor` y no al
revés, y `.env.example` no documenta lo que `leerConfig()` exige.

Y una del propio gate de paridad: **extrae los enlaces con una regex que entra en el `<style>`**, así
que un `href=` citado en un comentario CSS se cuela en su huella como si fuera un enlace de la página.

## ⏸️ Pausado, no abandonado

**Bloque J, pieza 3 (Ideas).** Etapas **1-4 commiteadas** (`afe1725`, `73fcd35`, `c929a98`); faltan
las **5-7**, las pantallas, que son del agente `front`.

## ⏳ Lo que espera a Juan

| Qué | Por qué él | Bloquea |
| --- | --- | --- |
| **Cuáles diferencias de Railway son intencionales** (3 de las 4) | Solo él ve los valores | Sí, para dejar `auditar:railway` en verde |
| **Una foto distinta por elemento** en carta (`menu[].foto`) y ubicaciones | Son los assets | No; hoy repiten una imagen por destino |
| **Si `brand.tema: "auto"` se completa** o se queda como deuda | Es de producto | No |
| **Si los testimonios llevan nombres y estrellas** de muestra | Publicarlos sería publicidad engañosa | Sí, para la etapa 3 |

**Abiertos y sin bloquear a nadie:** **C-1** (en dry-run el ensayo no se puede observar) y **C-2** (la
marca de C0 y el workflow real pueden discrepar; el barrido no cancela el workflow).

---

## 🔴 Riesgo abierto — las credenciales expuestas, **postergado por decisión del usuario (2026-08-04)**

> **No lo levantes como bloqueante en cada sesión.** Juan decidió posponer la rotación; sigue siendo un
> riesgo real y abierto, no un asunto cerrado. Lo que corresponde es dejarlo anotado y seguir con el
> trabajo, no volver a proponerlo cada vez.

`docs/private.zip` estuvo **commiteado en este repositorio, que es público**, desde el 2026-08-01
(commit `15ae91a`). Ya se sacó del índice y el `.gitignore` quedó blindado —y desde la 13ª review cubre
también los directorios hermanos tipo `docs/private-backup/`—, pero **el objeto sigue en el historial de
GitHub** por decisión tomada: purgar no des-expone, lo que devuelve la seguridad es rotar.

**La lista priorizada vive fuera del repo:** `docs/private/rotacion-credenciales.md` (gitignoreado).

Cuando la rotación se complete, dejar acá una línea con la fecha. Eso sí es el hecho.

---

## Plantilla (dejar así al cerrar)

```markdown
**Sesión:** YYYY-MM-DD
**En curso:** <qué se está haciendo>
**Estado:** <en progreso | bloqueado | listo para revisión>

**Decisiones de esta sesión:**
- <qué se decidió y por qué>

**Pendiente inmediato:** <lo próximo>
```

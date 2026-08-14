# Menú digital enriquecido — diseño

> **Estado:** 🟡 diseñado, sin empezar.
>
> Enfoque: extender `MenuItem` con video, alérgenos, etiquetas dietéticas y nutrición, cruzando **las
> cuatro fronteras** que ya defiende el sistema (Zod → allowlist de Postgres → `perfilValido` →
> render). Sin editor en el portal — el menú se sigue cargando por SQL/seed. Referencias de mercado:
> [barmanager.app](https://www.barmanager.app/es), [biomenus.com](https://biomenus.com),
> [iq-rest.com](https://iq-rest.com/es/menu-digital-restaurantes).
>
> **La migración de este spec es la `0021`** (la próxima libre — ver `09-estado-y-roadmap.md`).

---

## Por qué

Hoy `MenuItem` (`web-builder/src/types.ts:195-211`) tiene nombre, descripción, hasta 3 variantes de
precio con etiqueta libre, una nota corta y una sola foto. No hay alérgenos, no hay información
nutricional, no hay video — y no hay ningún lugar del modelo que distinga "para cuántas personas
rinde" de "cuánto cuesta". Es la carta mínima viable, y el pedido es llevarla a lo que ya ofrece la
competencia (alérgenos con taxonomía UE, macros, video por plato) sin perder lo que hace bien: nada
se inventa, y un dato mal cargado degrada el plato, nunca tira la carta entera.

El menú **no vive en `contrato/`** (ese paquete es del brief de keyword research, `paginas_propuestas`
y afines). Vive en `web-builder/src/types.ts` y `contract.ts`, es parte de `BusinessProfile`, y de ahí
sale por un camino con nombre propio en este código — **las cuatro fronteras**
(`web-builder/src/types.ts:238-241`, `renderer/src/tres-fronteras.test.ts:12-26`):

1. El Zod de `web-builder/src/contract.ts`.
2. La allowlist generada de Postgres, `app.nap_publico()` (hoy en la migración `0020`).
3. `perfilValido()` en `renderer/src/perfil.ts` — revalidación TS, defensa en profundidad.
4. El render — la pieza que finalmente emite HTML.

Un campo que falte en una de las cuatro **no da error: no aparece**. Es el modo de fallo que ya
produjo tres migraciones de reparación (`brand` en la `0009`, `locations`/`menu` en la `0010`, fotos en
la `0014`). Este diseño agrega campos nuevos siguiendo el mismo camino, no uno atajado.

---

## Qué se construye

### 1. El modelo de datos

```ts
/** Los 14 alérgenos del Reglamento UE 1169/2011. Taxonomía FIJA: texto libre produciría
 *  "sin gluten" y "gluten-free" como dos alérgenos distintos en la misma carta. */
export type Alergeno =
  | "gluten" | "crustaceos" | "huevos" | "pescado" | "cacahuetes" | "soja" | "lacteos"
  | "frutos_cascara" | "apio" | "mostaza" | "sesamo" | "sulfitos" | "altramuces" | "moluscos";

/** Etiquetas dietéticas. Igual de fija que `Alergeno`, por la misma razón. */
export type EtiquetaDietetica =
  | "vegano" | "vegetariano" | "sin_gluten" | "sin_lactosa" | "picante" | "halal" | "kosher";

/** Nutrición de la RACIÓN DE REFERENCIA del plato — ver §Qué NO hace esta etapa. */
export interface InfoNutricional {
  calorias?: number;
  proteinas_g?: number;
  carbohidratos_g?: number;
  grasas_g?: number;
}

/** Un video autoalojado. Mismo criterio de seguridad que `Foto` — ver §2. */
export interface Video {
  src: string;
  /** Fotograma de portada. Sin él no hay `poster`, y el navegador no tiene qué mostrar sin cargar
   *  el video entero — por eso el render exige uno para emitir el `<video>` (ver §3). */
  poster?: Foto;
}

export interface MenuItem {
  // ...lo que ya existe (category, name, description, price, nota, foto)...
  precios?: Array<{
    etiqueta: string;
    importe: string;
    /** NUEVO. "1-2 personas", libre — mismo criterio que `etiqueta`/`importe`: no hace falta más
     *  que imprimir lo que escribió el cliente. */
    comensales?: string;
  }>;
  video?: Video;
  alergenos?: Alergeno[];
  etiquetas?: EtiquetaDietetica[];
  nutricion?: InfoNutricional;
}
```

**Por qué taxonomía fija y no texto libre**, para alérgenos y etiquetas: es el mismo criterio que ya
usa `FuenteNombre`/`BrandTheme.fuentes` en este código (`renderer/src/perfil.ts:16-22`) — un valor de
una lista cerrada se puede validar, iconar y comparar; texto libre no. Ampliar la lista más adelante es
un cambio de código revisado, igual que `HOSTS_DE_ASSETS` — no un campo de la ficha.

**Por qué "raciones" son dos campos y no uno.** La etiqueta libre que ya existe (`"Media"` /
`"Ración entera"`) sigue cubriendo el tamaño con su propio precio. `comensales` es el dato nuevo: para
cuántas personas rinde esa variante. Son preguntas distintas — una es de precio, la otra de porción —
y confundirlas en un solo campo obligaría a parsear texto libre para saber cuál es cuál.

**`video` reemplaza a `foto` en la miniatura si el plato tiene los dos.** Un plato, una miniatura — no
dos elementos visuales compitiendo en la fila compacta de la carta.

### 2. Las cuatro fronteras — qué toca cada una

| Frontera | Archivo | Qué se agrega |
| --- | --- | --- |
| 1. Zod + tipos | `web-builder/src/types.ts`, `contract.ts` | Los tipos de arriba + su `z.object`/`z.enum` |
| 2. Allowlist Postgres | migración `0021` (reemplaza `app.nap_publico`) | `video`, `alergenos`, `etiquetas`, `nutricion`, `precios[].comensales` — cada lista con su tope (14 / 7 / 1) |
| 3. `perfilValido` | `renderer/src/perfil.ts` | Revalida forma + cada enum contra un `Set` fijo, mismo patrón que `FUENTES` (líneas 14-22) |
| 4. El render | `web-builder/src/render/piezas/carta-categorias.ts` | Ver §4 |

**En Postgres no se valida que un alérgeno sea uno de los 14.** Es la misma decisión que ya documenta
la migración `0020` (comentario, líneas 16-21): la allowlist restringe **nombres de clave** y **forma
de valor** (string vs objeto vs número); el **contenido** —¿es `"gluten"` un alérgeno real?— lo validan
Zod y `perfilValido`. Meter una regla de contenido en la allowlist daría una falsa sensación de defensa
ahí, y dejaría que alguien quitara la de las otras capas creyendo que Postgres ya cubre.

La allowlist necesita dos funciones SQL nuevas, en la línea de `app.foto_publica`/`app.numero_publico`
(`0014_fotos_publicas.sql:65-87`):

```sql
-- Array de strings, con tope. `alergenos` (14) y `etiquetas` (7) la usan.
create or replace function app.lista_texto_publica(v jsonb, tope int) returns jsonb ...

-- Mismo criterio que app.foto_publica: forma de objeto, un `src` https + poster opcional.
create or replace function app.video_publico(v jsonb) returns jsonb ...
```

`nutricion` no necesita función propia: es un `jsonb_build_object` con `app.numero_publico` en cada
clave, igual que ya se hace con `menu_categorias[].orden`.

### 3. Seguridad del video

Mismo patrón que la §Política de imágenes (`web-builder/src/render/imagenes.ts`), en un archivo
análogo:

- **Allowlist exacta de hosts** contra un `Set` (empieza con `a.storyblok.com`; a confirmar en
  implementación si Storyblok sirve video del mismo host que las imágenes o de uno distinto).
- **https obligatorio**, mismo motivo que las fotos: fuga de IP/user-agent del visitante + contenido
  mixto bloqueado por el navegador.
- **Presupuesto propio por documento** (`PresupuestoVideos`, análogo a `PresupuestoImagenes`), con un
  tope bajo — propuesto **10** por documento. Es un default de producción: lo fija un test, no quien
  renderiza (mismo criterio que `MAX_IMAGENES_POR_DOCUMENTO`).
- **Sin autoplay.** Se emite `<video controls preload="none" poster="...">` — sin `poster` válido no
  se emite el `<video>` (degrada a la `foto` si la tiene, o a nada). `preload="none"` evita que el
  navegador descargue el video de todos los platos de golpe al cargar la carta.
- El `poster` es una `Foto` normal: reutiliza la allowlist de imágenes que ya existe, no hace falta
  mecanismo nuevo para el fotograma.

### 4. Cómo se ve un plato — `unPlato()` en `carta-categorias.ts`

```text
<li>
  [miniatura: <video> si hay video+poster, si no <img> si hay foto, si no nada]
  <nombre> [nota]
  [alérgenos: "Contiene: gluten, lácteos" — texto, un <p>]
  [etiquetas: píldoras "Vegano" "Picante" — texto, no iconos]
  [descripción]
  [<details><summary>Información nutricional</summary>
     calorías / proteínas / carbohidratos / grasas — los que estén presentes]
  [precios, cada uno con su comensales si lo tiene: "15,90 € · 1-2 personas"]
</li>
```

**Badges de texto, no iconos.** Un set de iconos SVG para 14 alérgenos + 7 etiquetas es un proyecto de
diseño visual aparte (paleta, tamaño, legibilidad en los dos temas) que bloquearía esta etapa sin
aportar al modelo de datos ni a la seguridad, que es donde está el riesgo real. Si más adelante se
quieren iconos, es un cambio localizado a esta pieza — el modelo de datos no cambia.

**`<details>` para nutrición, sin JavaScript.** Es el widget nativo de disclosure del navegador:
colapsado por defecto (no satura una carta de 40 platos con cuatro números por plato), accesible por
teclado y lector de pantalla sin nada de código propio. Mismo espíritu que el resto del render, que no
depende de JS del lado del cliente.

---

## Qué NO hace esta etapa

- **Sin editor en el portal.** El menú se sigue cargando por SQL/seed, como hoy. Un editor en el
  portal (`front`) queda para una fase futura, cuando haya clientes reales cargando su propio menú.
- **La nutrición es UN valor por plato**, para la ración de referencia (la primera entrada de
  `precios`, o el `price` único si no hay variantes) — no un valor distinto por cada variante de
  tamaño. Si "media ración" y "ración entera" necesitan calorías distintas, esta etapa no lo cubre; el
  campo queda documentado como "de la ración de referencia" para que no se lea como un dato exacto de
  cada variante.
- **Sin embeds externos** (YouTube/Vimeo) — solo video autoalojado. Un embed abriría una superficie de
  iframe que el renderizador no maneja hoy, y el objetivo es que la carta no lleve marca de terceros.
- **Sin QR, sin multi-idioma, sin pedidos ni reservas desde el menú.** Existen en IQ-Rest y podrían ser
  una etapa de producto futura, pero no forman parte de esta.
- **Sin iconos** para alérgenos/etiquetas — ver §4.

---

## Testing y verificación

- **Fixtures compartidas** (`perfilConManual`/`perfilLegacy` en `web-builder/fixtures`) se enriquecen
  con los campos nuevos. `tres-fronteras.test.ts` compara con `assert.deepEqual` contra el perfil
  parseado completo — no hay que tocar sus aserciones, agarra cualquier campo que falte en una capa por
  el mismo mecanismo que ya usa hoy.
- **Aislamiento de Postgres**: un test nuevo, mismo patrón que `fotos-publicas.test.ts` y
  `secciones-publicas.test.ts` — conectado como `app_render`, confirma que los campos nuevos llegan y
  que un valor fuera de la allowlist (una clave que la función no enumera) no llega y no da error.
- **Render**: tests de pieza para el `<video>` (con/sin poster, host no permitido → cae a `foto` o a
  nada), los badges de alérgenos/etiquetas, y el `<details>` de nutrición con distintas combinaciones
  de campos presentes/ausentes.
- **Mutación**, como en el resto del código: quitar la validación de host del video tiene que hacer
  caer el test de host no permitido; quitar el enum de `perfilValido` tiene que dejar pasar un valor
  inventado hasta el render.

---

## Referencias de mercado (contexto, no alcance de esta etapa)

- **IQ-Rest** — el más completo: foto o video por plato, 14 alérgenos UE, 13 etiquetas dietéticas,
  variantes con suplemento, QR, dominio propio, 35 idiomas con traducción IA, digitalización de un
  menú en foto/PDF.
- **biomenus.com (Sandra's Rose)** — minimalista: solo nombre y precio, sirve de referencia de "lo
  mínimo", no de lo completo.
- **BarManager** — se anuncia como menú digital + pedidos + reservas; contenido no accesible para
  extraer detalle de campos.

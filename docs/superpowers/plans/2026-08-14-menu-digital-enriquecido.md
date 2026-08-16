# Menú digital enriquecido — plan de implementación

> **Estado:** ✅ implementado — ver `docs/proyecto/09-estado-y-roadmap.md` (entrada 2026-08-16) y el
> ledger de ejecución. Los checkboxes de abajo quedan como se escribieron, sin tildar uno por uno: lo
> que sigue es el plan tal como se planificó, como registro histórico, no un tablero de seguimiento.
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extender el menú digital de un cliente con video (autoalojado), alérgenos, etiquetas
dietéticas, información nutricional y "para cuántas personas rinde" — cruzando las cuatro fronteras
que ya defiende el sistema (Zod → allowlist de Postgres → `perfilValido` → render) para que ningún
campo nuevo desaparezca en producción en silencio.

**Architecture:** El menú vive en `web-builder/src/types.ts` (`MenuItem`, dentro de `BusinessProfile`),
no en `contrato/`. Cada campo nuevo cruza, en orden: el Zod de `web-builder/src/contract.ts`, la
función SQL `app.nap_publico` (Postgres, columna generada `clients.business_profile_publico`),
`perfilValido()` en `renderer/src/perfil.ts`, y por último la pieza de render
`web-builder/src/render/piezas/carta-categorias.ts`. El video usa una política de seguridad propia
(`web-builder/src/render/videos.ts`), calcada de la que ya protege las fotos (`imagenes.ts`): allowlist
de hosts, presupuesto por documento, sin autoplay.

**Tech Stack:** TypeScript ESM estricto, Zod (validación), PostgreSQL/PGlite (allowlist generada,
tests de aislamiento por rol), `node:test` + `node:assert` (todos los tests).

## Global Constraints

- **Ningún campo nuevo se declara "hecho" en una sola frontera.** Tiene que cruzar las cuatro (Zod,
  allowlist SQL, `perfilValido`, render) o desaparece en producción sin error ni log — es el modo de
  fallo que ya documentan las migraciones `0009`, `0010` y `0014`.
- **Taxonomía fija, nunca texto libre**, para `Alergeno` (14 valores, Reglamento UE 1169/2011) y
  `EtiquetaDietetica` (7 valores). Las dos listas de valores están definidas una única vez por capa
  (Zod, `perfilValido`) y tienen que coincidir exactamente entre las dos.
- **Postgres no valida CONTENIDO**, solo nombres de clave y forma de valor (string/objeto/número/
  array). Que un alérgeno sea uno de los 14 lo deciden Zod y `perfilValido`, nunca la migración SQL —
  es la misma decisión que ya documenta la `0020`.
- **Video sin `poster` no se emite.** El render exige un fotograma de portada para no forzar la
  descarga del video completo solo para mostrar la carta.
- **Sin autoplay, nunca.** Todo `<video>` lleva `controls preload="none"`.
- **Sin editor en el portal en esta etapa.** El menú se sigue cargando por SQL/seed.
- La migración de este plan es la **`0023`** — confirmar en el paso 1 de la Tarea 4 que sigue siendo
  la próxima libre en `db/migrations/`, porque puede haber cambiado si otra rama mergeó antes.
- **Task 7 (verificación de conjunto, documentación, commit) la ejecuta la sesión principal, no un
  subagente fresco** — es la regla de este proyecto (`AGENTS.md`, "Integrar, verificar el conjunto y
  commitear es siempre de la sesión principal").

---

### Task 1: El modelo de datos — tipos y Zod (frontera 1)

**Files:**
- Modify: `web-builder/src/types.ts:195-211` (interfaz `MenuItem`)
- Modify: `web-builder/src/contract.ts:88-107` (`menuItemSchema`)
- Modify: `web-builder/src/index.ts:17` (exports de tipos)
- Test: `web-builder/src/contract.test.ts` (nuevos casos, después de la línea 194)

**Interfaces:**
- Produces: `Alergeno` (union de 14 strings), `EtiquetaDietetica` (union de 7 strings),
  `InfoNutricional` (`{calorias?, proteinas_g?, carbohidratos_g?, grasas_g?}`, todos `number`),
  `Video` (`{src: string; poster?: Foto}`) — los cuatro exportados desde `web-builder`.
  `MenuItem` gana `video?: Video`, `alergenos?: Alergeno[]`, `etiquetas?: EtiquetaDietetica[]`,
  `nutricion?: InfoNutricional`, y `precios[].comensales?: string`.

- [ ] **Step 1: Escribir los tests que fallan (Zod acepta y rechaza lo nuevo)**

En `web-builder/src/contract.test.ts`, después del test que termina en la línea 194 (`"frontera 1 —
una entrada de \`precios\` a medias se rechaza..."`), agregar:

```ts
test("frontera 1 — el menú enriquecido (video, alérgenos, etiquetas, nutrición, comensales) pasa entero", () => {
  const p = parseProfile({
    name: "X",
    menu: [
      {
        name: "Margherita",
        precios: [{ etiqueta: "Media", importe: "9 €", comensales: "1 persona" }],
        video: {
          src: "https://a.storyblok.com/f/1/margherita.mp4",
          poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza recién horneada" },
        },
        alergenos: ["gluten", "lacteos"],
        etiquetas: ["vegetariano"],
        nutricion: { calorias: 820, proteinas_g: 34, carbohidratos_g: 96, grasas_g: 28 },
      },
    ],
  });

  const item = p.menu?.[0];
  assert.equal(item?.precios?.[0]?.comensales, "1 persona");
  assert.equal(item?.video?.src, "https://a.storyblok.com/f/1/margherita.mp4");
  assert.equal(item?.video?.poster?.alt, "Pizza recién horneada");
  assert.deepEqual(item?.alergenos, ["gluten", "lacteos"]);
  assert.deepEqual(item?.etiquetas, ["vegetariano"]);
  assert.equal(item?.nutricion?.calorias, 820);
  assert.equal(item?.nutricion?.proteinas_g, 34);
});

test("frontera 1 — un alérgeno o etiqueta fuera de la taxonomía fija se rechaza (nunca texto libre)", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ name: "P", alergenos: ["gluten-free"] }] }),
    /inválido/,
  );
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ name: "P", etiquetas: ["sin gluten"] }] }),
    /inválido/,
  );
});

test("frontera 1 — un video sin https se rechaza, igual que una foto", () => {
  assert.throws(
    () => parseProfile({ name: "X", menu: [{ name: "P", video: { src: "http://a.storyblok.com/f/1/x.mp4" } }] }),
    /https/,
  );
});

test("frontera 1 — un video sin `poster` es válido: el poster lo exige el RENDER, no el modelo", () => {
  const p = parseProfile({
    name: "X",
    menu: [{ name: "P", video: { src: "https://a.storyblok.com/f/1/x.mp4" } }],
  });
  assert.equal(p.menu?.[0]?.video?.src, "https://a.storyblok.com/f/1/x.mp4");
  assert.equal(p.menu?.[0]?.video?.poster, undefined);
});

test("frontera 1 — 15 alérgenos o 8 etiquetas se rechazan (los topes son 14 y 7, el tamaño de cada taxonomía)", () => {
  const alergeno15 = Array(15).fill("gluten");
  assert.throws(() => parseProfile({ name: "X", menu: [{ name: "P", alergenos: alergeno15 }] }), /inválido/);

  const etiqueta8 = Array(8).fill("vegano");
  assert.throws(() => parseProfile({ name: "X", menu: [{ name: "P", etiquetas: etiqueta8 }] }), /inválido/);
});
```

- [ ] **Step 2: Correr los tests nuevos y verificar que fallan**

Run: `npm test -w web-builder`
Expected: FAIL — `menuItemSchema` todavía no conoce `video`, `alergenos`, `etiquetas`, `nutricion` ni
`comensales`, así que Zod los descarta en silencio (los `assert.equal`/`assert.deepEqual` comparan
contra `undefined`) y los `assert.throws` no lanzan porque no hay nada que rechazar.

- [ ] **Step 3: Extender `MenuItem` en `types.ts`**

Reemplazar el bloque `web-builder/src/types.ts:195-211` (la interfaz `MenuItem` completa) por:

```ts
/** Los 14 alérgenos del Reglamento UE 1169/2011. Taxonomía FIJA: texto libre produciría "sin gluten"
 *  y "gluten-free" como dos alérgenos distintos en la misma carta. Ampliarla es un cambio de código
 *  revisado — igual que `HOSTS_DE_ASSETS` — nunca un campo de la ficha. */
export type Alergeno =
  | "gluten"
  | "crustaceos"
  | "huevos"
  | "pescado"
  | "cacahuetes"
  | "soja"
  | "lacteos"
  | "frutos_cascara"
  | "apio"
  | "mostaza"
  | "sesamo"
  | "sulfitos"
  | "altramuces"
  | "moluscos";

/** Etiquetas dietéticas. Misma taxonomía fija que `Alergeno`, por la misma razón. */
export type EtiquetaDietetica =
  | "vegano"
  | "vegetariano"
  | "sin_gluten"
  | "sin_lactosa"
  | "picante"
  | "halal"
  | "kosher";

/** Nutrición de la RACIÓN DE REFERENCIA del plato (la primera entrada de `precios`, o el `price`
 *  único si no hay variantes) — no un valor distinto por cada variante de tamaño. */
export interface InfoNutricional {
  calorias?: number;
  proteinas_g?: number;
  carbohidratos_g?: number;
  grasas_g?: number;
}

/** Un video autoalojado. Mismo criterio de seguridad que `Foto` — allowlist de hosts propia en
 *  `render/videos.ts`. Sin `poster` el render no emite el `<video>` (ver esa función para el porqué),
 *  pero acá es opcional: el modelo no impone una regla que es del render. */
export interface Video {
  src: string;
  poster?: Foto;
}

export interface MenuItem {
  /** Agrupador ("Hamburguesas", "Cervezas"). Los ítems sin categoría se muestran juntos, al final. */
  category?: string;
  name: string;
  description?: string;
  price?: string;
  /**
   * Varios importes del mismo plato ("Media" 9 €, "Ración" 15 €). **Manda sobre `price`**, que queda
   * como el atajo del caso de un solo importe. `importe` sigue siendo texto libre por la misma razón
   * que `price`. Máx 3: una carta con seis columnas de precio deja de ser legible.
   */
  precios?: Array<{
    etiqueta: string;
    importe: string;
    /** "1-2 personas", libre — mismo criterio que `etiqueta`/`importe`: alcanza con imprimir lo que
     *  escribió el cliente. Es un dato de PORCIÓN, distinto del tamaño con su propio precio. */
    comensales?: string;
  }>;
  /** Aviso corto del plato ("Sin gluten", "Picante"). */
  nota?: string;
  /** Miniatura del plato. */
  foto?: Foto;
  /** Video del plato. Si el plato tiene los dos, el render usa el video en la miniatura y no la foto. */
  video?: Video;
  alergenos?: Alergeno[];
  etiquetas?: EtiquetaDietetica[];
  /** De la ración de referencia — ver `InfoNutricional`. */
  nutricion?: InfoNutricional;
}
```

- [ ] **Step 4: Extender `menuItemSchema` en `contract.ts`**

En `web-builder/src/contract.ts`, agregar antes de `menuItemSchema` (línea 88), después de
`locationSchema`:

```ts
/** Los 14 alérgenos del Reglamento UE 1169/2011. Tiene que coincidir EXACTAMENTE con `Alergeno` de
 *  `types.ts` y con el `Set` de `renderer/src/perfil.ts` — un valor en dos de las tres listas y no en
 *  la tercera es la misma clase de fuga silenciosa que ya documentan las otras fronteras. */
const ALERGENOS = [
  "gluten",
  "crustaceos",
  "huevos",
  "pescado",
  "cacahuetes",
  "soja",
  "lacteos",
  "frutos_cascara",
  "apio",
  "mostaza",
  "sesamo",
  "sulfitos",
  "altramuces",
  "moluscos",
] as const;
const alergenoSchema = z.enum(ALERGENOS);
/** El tope es el TAMAÑO de la taxonomía: un plato nunca declara un alérgeno dos veces con sentido. */
const MAX_ALERGENOS = ALERGENOS.length;

const ETIQUETAS_DIETETICAS = [
  "vegano",
  "vegetariano",
  "sin_gluten",
  "sin_lactosa",
  "picante",
  "halal",
  "kosher",
] as const;
const etiquetaDieteticaSchema = z.enum(ETIQUETAS_DIETETICAS);
const MAX_ETIQUETAS = ETIQUETAS_DIETETICAS.length;

/** De la ración de referencia. Cada clave es independiente: un plato puede declarar solo calorías. */
const infoNutricionalSchema = z.object({
  calorias: z.number().optional(),
  proteinas_g: z.number().optional(),
  carbohidratos_g: z.number().optional(),
  grasas_g: z.number().optional(),
});

/**
 * Un video. Mismo criterio de `fotoSchema`: https obligatorio, la allowlist de hosts vive en el
 * render (frontera 4), no acá.
 *
 * `poster` es OPCIONAL en el modelo a propósito: exigirlo acá sería una regla de RENDER (sin poster
 * no se emite el `<video>`) colada en el modelo de datos. Un video sin poster todavía es un dato
 * válido — el render decide qué hacer con él.
 */
const videoSchema = z.object({
  src: z
    .string()
    .url()
    .refine((u) => /^https:\/\//i.test(u), "el video debe ser una URL https"),
  poster: fotoSchema.optional(),
});
```

Y reemplazar `menuItemSchema` (líneas 88-107) por:

```ts
/** `name` es lo único obligatorio: un ítem de carta sin nombre no se puede mostrar. */
const menuItemSchema = z.object({
  category: z.string().optional(),
  name: z.string().min(1),
  description: z.string().optional(),
  price: z.string().optional(),
  // Las dos claves obligatorias: una entrada sin etiqueta o sin importe no es un precio a medias, es
  // basura que el render no podría dibujar.
  //
  // **Acá eso RECHAZA el archivo entero**, por la misma razón que los topes de arriba: quien escribe
  // el JSON a mano tiene que enterarse de que le falta un campo. Son las fronteras 2 y 3 las que
  // descartan la entrada sola y dejan vivo el plato, porque ahí el dato ya está guardado y tirar la
  // carta por un precio mal cargado sería peor.
  precios: z
    .array(
      z.object({
        etiqueta: z.string().min(1),
        importe: z.string().min(1),
        // "1-2 personas" — libre, por el mismo motivo que `etiqueta`/`importe`.
        comensales: z.string().optional(),
      }),
    )
    .max(MAX_PRECIOS)
    .optional(),
  nota: z.string().optional(),
  foto: fotoSchema.optional(),
  video: videoSchema.optional(),
  alergenos: z.array(alergenoSchema).max(MAX_ALERGENOS).optional(),
  etiquetas: z.array(etiquetaDieteticaSchema).max(MAX_ETIQUETAS).optional(),
  nutricion: infoNutricionalSchema.optional(),
});
```

- [ ] **Step 5: Exportar los tipos nuevos desde `index.ts`**

En `web-builder/src/index.ts:17`, reemplazar la línea del `export type` por:

```ts
export type {
  KrBrief,
  KrProposedPage,
  Alergeno,
  BusinessProfile,
  BrandTheme,
  Destacado,
  EtiquetaDietetica,
  Foto,
  FuenteNombre,
  Imagen,
  InfoNutricional,
  Location,
  MenuCategoria,
  MenuItem,
  NavItem,
  Story,
  Testimonio,
  Video,
  Blok,
} from "./types.js";
```

- [ ] **Step 6: Correr los tests y verificar que pasan**

Run: `npm test -w web-builder`
Expected: PASS — los 5 tests nuevos del Step 1, y ningún test existente roto (revisar en particular
`contract.test.ts` completo y `fixtures.ts`, que todavía no cambia en esta tarea).

- [ ] **Step 7: Typecheck y commit**

Run: `npm run typecheck -w web-builder`
Expected: sin errores.

```bash
git add web-builder/src/types.ts web-builder/src/contract.ts web-builder/src/index.ts web-builder/src/contract.test.ts
git commit -m "Feat: el modelo del menú suma video, alérgenos, etiquetas, nutrición y comensales (frontera 1)"
```

---

### Task 2: La fixture compartida — checkpoint en rojo

**Files:**
- Modify: `web-builder/src/fixtures.ts:112-125` (el `menu` de `perfilConManual()`)

**Interfaces:**
- Consumes: `Alergeno`, `EtiquetaDietetica`, `InfoNutricional`, `Video` (Task 1).
- Produces: nada nuevo — enriquece un fixture que ya consumen `contract.test.ts`,
  `renderer/src/tres-fronteras.test.ts` y `web-builder/src/render/paridad/casos.ts` (indirectamente,
  vía `landing-perfil-con-manual`).

**Por qué esta tarea existe sola.** `perfilConManual()` es el perfil que recorre las **tres fronteras
encadenadas** en `renderer/src/tres-fronteras.test.ts` (comentario en `fixtures.ts:126-128`). Enriquecerlo
ahora, antes de tocar la allowlist de Postgres o `perfilValido`, deja ese test **en rojo a propósito**:
confirma que las fronteras 2 y 3 todavía no saben nada de los campos nuevos, antes de implementarlas.
Es la misma disciplina "rojo primero" aplicada a una garantía que cruza tres paquetes, no una función.

- [ ] **Step 1: Enriquecer el ítem "Margherita" de `perfilConManual()`**

En `web-builder/src/fixtures.ts`, reemplazar el primer ítem del array `menu` (líneas 113-123) por:

```ts
      {
        category: "Pizzas",
        name: "Margherita",
        description: "Tomate San Marzano, mozzarella fior di latte, albahaca",
        precios: [
          { etiqueta: "Media", importe: "9,00 €", comensales: "1 persona" },
          { etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" },
        ],
        nota: "Disponible sin gluten",
        foto: { src: "https://a.storyblok.com/f/1/margherita.jpg" },
        video: {
          src: "https://a.storyblok.com/f/1/margherita.mp4",
          poster: {
            src: "https://a.storyblok.com/f/1/margherita-poster.jpg",
            alt: "Pizza Margherita recién horneada",
          },
        },
        alergenos: ["gluten", "lacteos"],
        etiquetas: ["vegetariano"],
        nutricion: { calorias: 820, proteinas_g: 34, carbohidratos_g: 96, grasas_g: 28 },
      },
```

El segundo ítem (`"Cacio e pepe"`, línea 124) queda **sin tocar**: es el control que prueba que un
plato con la forma vieja (sin ninguno de los campos nuevos) sigue funcionando igual.

- [ ] **Step 2: Correr `contract.test.ts` y confirmar que sigue en verde**

Run: `npm test -w web-builder`
Expected: PASS — la frontera 1 (Task 1) ya sabe validar estos campos.

- [ ] **Step 3: Correr el test de las tres fronteras encadenadas y OBSERVAR el rojo**

Run: `npm --prefix renderer test -- --test-name-pattern "tres fronteras"` (o
`node --import tsx --test src/tres-fronteras.test.ts` desde `renderer/`)
Expected: **FAIL** en `"el perfil con manual de marca completo llega ENTERO al otro lado"`. El
`assert.deepEqual(salida, parseProfile(entrada))` va a mostrar que a `salida` le faltan `video`,
`alergenos`, `etiquetas`, `nutricion` y `precios[].comensales` — la allowlist de Postgres (frontera 2,
todavía en la `0020`) los descarta en silencio, y `perfilValido` (frontera 3) tampoco los conoce.
**Esto es lo esperado**: confirma que las Tareas 4 y 5 son necesarias, no una regresión de esta tarea.

- [ ] **Step 4: Commit**

```bash
git add web-builder/src/fixtures.ts
git commit -m "Test: enriquece la fixture compartida del menú (checkpoint rojo, fronteras 2 y 3 pendientes)"
```

---

### Task 3: La seguridad del video (frontera 4, la primitiva)

**Files:**
- Create: `web-builder/src/render/videos.ts`
- Test: `web-builder/src/render/videos.test.ts`

**Interfaces:**
- Consumes: nada del resto del plan — es una primitiva independiente, mismo nivel que `imagenes.ts`.
- Produces: `HOSTS_DE_VIDEO: ReadonlySet<string>`, `MAX_VIDEOS_POR_DOCUMENTO: number`,
  `PresupuestoVideos` (interfaz `{restantes: number}`), `nuevoPresupuestoVideos(): PresupuestoVideos`,
  `consumirCupoVideo(p: PresupuestoVideos): boolean`, `fuenteVideoPermitida(src: string): boolean` —
  los seis, para que Task 6 los use desde `lib.ts` y `carta-categorias.ts`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `web-builder/src/render/videos.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_VIDEOS_POR_DOCUMENTO,
  consumirCupoVideo,
  fuenteVideoPermitida,
  nuevoPresupuestoVideos,
} from "./videos.js";

/**
 * **La política de video**, calcada de la §Política de imágenes (`imagenes.test.ts`). Mismos casos
 * nominales de la allowlist de hosts: un video es otro vector hacia una petición que el navegador del
 * visitante hace solo, con la misma fuga de IP/user-agent que una foto.
 */

test("🔴 allowlist: `a.storyblok.com.evil.tld` NO es `a.storyblok.com` (sufijo, no host)", () => {
  assert.equal(fuenteVideoPermitida("https://a.storyblok.com.evil.tld/x.mp4"), false);
});

test("🔴 allowlist: `evil-storyblok.com` NO es `a.storyblok.com` (subcadena, no host)", () => {
  assert.equal(fuenteVideoPermitida("https://evil-storyblok.com/x.mp4"), false);
});

test("🔴 allowlist: `http:` se rechaza aunque el host esté permitido (HTTPS obligatorio)", () => {
  assert.equal(fuenteVideoPermitida("http://a.storyblok.com/x.mp4"), false);
});

test("🔴 allowlist: una URL protocol-relative (`//host/x.mp4`) se rechaza", () => {
  assert.equal(fuenteVideoPermitida("//a.storyblok.com/x.mp4"), false);
});

test("🔴 allowlist: `javascript:` se rechaza", () => {
  assert.equal(fuenteVideoPermitida("javascript:alert(1)"), false);
});

test("🔴 allowlist: basura que no es una URL devuelve false, NO lanza", () => {
  for (const basura of ["", "   ", "no soy una url", "https://", "http://[", " "]) {
    assert.equal(fuenteVideoPermitida(basura), false, `"${basura}" no puede pasar ni lanzar`);
  }
});

test("allowlist: el único host de video permitido hoy es `a.storyblok.com`", () => {
  assert.equal(fuenteVideoPermitida("https://a.storyblok.com/f/1/x.mp4"), true);
  assert.equal(fuenteVideoPermitida("https://cdn.ej/x.mp4"), false);
});

test("el tope de videos por documento es 10", () => {
  // Default de PRODUCCIÓN: lo fija este test, no quien renderiza.
  assert.equal(MAX_VIDEOS_POR_DOCUMENTO, 10);
});

test("presupuesto: se agota exactamente en el tope, y una URL rechazada no gasta cupo", () => {
  const p = nuevoPresupuestoVideos();
  assert.equal(p.restantes, MAX_VIDEOS_POR_DOCUMENTO);
  for (let i = 0; i < MAX_VIDEOS_POR_DOCUMENTO; i++) {
    assert.equal(consumirCupoVideo(p), true, `hueco ${i} tendría que estar disponible`);
  }
  assert.equal(consumirCupoVideo(p), false, "el hueco 11 no existe");
});

test("presupuesto: dos documentos no comparten cupo (uno por llamada a `nuevoPresupuestoVideos`)", () => {
  const a = nuevoPresupuestoVideos();
  const b = nuevoPresupuestoVideos();
  consumirCupoVideo(a);
  assert.equal(b.restantes, MAX_VIDEOS_POR_DOCUMENTO, "el segundo documento no ve el gasto del primero");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm test -w web-builder`
Expected: FAIL con `Cannot find module './videos.js'` — el archivo todavía no existe.

- [ ] **Step 3: Crear `videos.ts`**

Crear `web-builder/src/render/videos.ts`:

```ts
/**
 * **La política de video**, calcada de la §Política de imágenes (`imagenes.ts`) — ver ese archivo
 * para el razonamiento completo de cada regla, que acá no se repite.
 *
 * Un `<video>` es el mismo vector que un `<img>`: una petición que el navegador del visitante hace
 * solo, y el host que la recibe se lleva su IP, su user-agent y el patrón de tráfico de esa visita.
 * La pregunta que gobierna el diseño es la misma: *si me lo toman, ¿qué se llevan?*.
 */

/**
 * Los hosts de video permitidos. **Comparación exacta**, nunca `endsWith`/`includes` — mismo criterio
 * y misma trampa que `HOSTS_DE_ASSETS` en `imagenes.ts`.
 *
 * Hoy solo `a.storyblok.com`, la misma allowlist que las fotos: es el host que sirve el space real.
 * Si Storyblok terminara sirviendo video desde un host distinto, ampliar esta lista es un cambio de
 * código revisado — exactamente lo que la distingue de un campo de la ficha.
 */
export const HOSTS_DE_VIDEO: ReadonlySet<string> = new Set(["a.storyblok.com"]);

/**
 * Tope de videos por documento. Mucho más bajo que el de imágenes (60): un video pesa órdenes de
 * magnitud más que una foto, y no hay motivo para que una carta entera tenga video en cada plato.
 * Default de PRODUCCIÓN: lo fija un test (`videos.test.ts`), no quien renderiza.
 */
export const MAX_VIDEOS_POR_DOCUMENTO = 10;

/**
 * El presupuesto de videos de **UN** documento. Mismo criterio que `PresupuestoImagenes`: mutable,
 * uno por documento, nunca una constante de módulo — el renderizador es un proceso largo que atiende
 * a todos los clientes.
 */
export interface PresupuestoVideos {
  restantes: number;
}

export function nuevoPresupuestoVideos(): PresupuestoVideos {
  return { restantes: MAX_VIDEOS_POR_DOCUMENTO };
}

/** `false` = no queda cupo. Se llama solo cuando el video se va a emitir de verdad — una URL
 *  rechazada por la allowlist no gasta cupo (mismo criterio que `consumirCupo`). */
export function consumirCupoVideo(p: PresupuestoVideos): boolean {
  if (p.restantes <= 0) return false;
  p.restantes--;
  return true;
}

/** ¿Puede esta `src` llegar a un `<video src>` que se sirve a internet anónimo? Exige https y host de
 *  la allowlist — misma implementación que `fuentePermitida`, duplicada a propósito: una imagen y un
 *  video son políticas independientes aunque hoy compartan la lista de hosts, y fusionarlas ataría el
 *  día que dejen de coincidir. */
export function fuenteVideoPermitida(src: string): boolean {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return HOSTS_DE_VIDEO.has(url.hostname.toLowerCase());
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm test -w web-builder`
Expected: PASS — los 10 tests de `videos.test.ts`.

- [ ] **Step 5: Typecheck y commit**

Run: `npm run typecheck -w web-builder`

```bash
git add web-builder/src/render/videos.ts web-builder/src/render/videos.test.ts
git commit -m "Feat: la política de seguridad del video (allowlist de hosts + presupuesto por documento)"
```

---

### Task 4: La allowlist de Postgres (frontera 2) — migración 0023

**Files:**
- Create: `db/migrations/0023_menu_enriquecido.sql`
- Test: `db/src/menu-enriquecido-publico.test.ts`

**Interfaces:**
- Consumes: nada de TypeScript — es SQL puro sobre la función `app.nap_publico`.
- Produces: la columna generada `clients.business_profile_publico` expone, dentro de cada `menu[]`,
  las claves nuevas `video`, `alergenos`, `etiquetas`, `nutricion` y `precios[].comensales`.

- [ ] **Step 1: Confirmar el número de migración libre**

Run: `ls db/migrations | sort | tail -3`
Expected: la última es `0022_resenas_google_polling.sql` (o superior, si otra rama mergeó desde que se
escribió este plan). Si es superior a `0022`, renombrar el archivo de este paso al siguiente número
libre **antes** de escribirlo, y actualizar ese número en todos los pasos de esta tarea.

- [ ] **Step 2: Escribir el test que falla**

Crear `db/src/menu-enriquecido-publico.test.ts`:

```ts
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { seed, TestDb, type Seed } from "./testdb.js";

/**
 * La FRONTERA 2 de las cuatro que cruza un campo del perfil para llegar al HTML — mismo criterio y
 * mismo patrón que `fotos-publicas.test.ts` (la `0014`): cada campo nuevo se asevera en EXACTAMENTE
 * UN test de este archivo, para que la verificación por mutación señale un único culpable.
 */
async function publicar(
  db: TestDb,
  s: Seed,
  dominio: string,
  perfil: unknown,
): Promise<Record<string, unknown>> {
  await db.asService(
    `update clients set domain = $2, storyblok_space_id = 'SB-0023', business_profile = $3::jsonb
       where id = $1`,
    [s.clientA2, dominio, JSON.stringify(perfil)],
  );
  const [fila] = await db.asRender<{ p: Record<string, unknown> | null }>(
    "select business_profile_publico as p from clients where domain = $1",
    [dominio],
  );
  return fila?.p ?? {};
}

describe("0023 — frontera 2: menú enriquecido en la allowlist del renderizador", () => {
  let db: TestDb;
  let s: Seed;

  before(async () => {
    db = await TestDb.create();
    s = await seed(db);
  });

  after(async () => await db.close());

  it("`menu[].video`: cruza con src+poster, y un video sin `src` sale ausente", async () => {
    const perfil = await publicar(db, s, "video-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          video: {
            src: "https://a.storyblok.com/f/1/margherita.mp4",
            poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza" },
            duracion_interna_segundos: 42,
          },
        },
      ],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["video"], {
      src: "https://a.storyblok.com/f/1/margherita.mp4",
      poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza" },
    });

    const sinSrc = await publicar(db, s, "video-sin-src-0023.es", {
      name: "Casa Lucio",
      menu: [{ name: "P", video: { poster: { src: "https://a.storyblok.com/f/1/poster.jpg" } } }],
    });
    assert.equal((sinSrc["menu"] as Record<string, unknown>[])[0]?.["video"], undefined);
  });

  it("`menu[].alergenos` y `menu[].etiquetas`: cruzan como array de strings, cortan en 14 y 7", async () => {
    const perfil = await publicar(db, s, "alergenos-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          alergenos: [...Array(15).fill("gluten")],
          etiquetas: [...Array(8).fill("vegano")],
        },
      ],
    });
    const item = (perfil["menu"] as Record<string, unknown>[])[0]!;
    assert.equal((item["alergenos"] as unknown[]).length, 14, "el tope corta en 14");
    assert.equal((item["etiquetas"] as unknown[]).length, 7, "el tope corta en 7");
  });

  it("`menu[].alergenos`: un elemento que no es string se descarta, el resto sobrevive", async () => {
    const perfil = await publicar(db, s, "alergenos-basura-0023.es", {
      name: "Casa Lucio",
      menu: [{ name: "P", alergenos: ["gluten", { objeto: true }, "lacteos"] }],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["alergenos"], ["gluten", "lacteos"]);
  });

  it("`menu[].nutricion`: cruzan los cuatro campos numéricos, y uno con forma de texto sale ausente", async () => {
    const perfil = await publicar(db, s, "nutricion-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          nutricion: { calorias: 820, proteinas_g: "34", carbohidratos_g: 96, grasas_g: 28, azucar_interno: 4 },
        },
      ],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["nutricion"], {
      calorias: 820,
      carbohidratos_g: 96,
      grasas_g: 28,
    });
  });

  it("`menu[].precios[].comensales`: cruza junto con etiqueta e importe", async () => {
    const perfil = await publicar(db, s, "comensales-0023.es", {
      name: "Casa Lucio",
      menu: [
        {
          name: "Margherita",
          precios: [{ etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" }],
        },
      ],
    });
    assert.deepEqual((perfil["menu"] as Record<string, unknown>[])[0]?.["precios"], [
      { etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" },
    ]);
  });

  it("🔴 el grant sobrevive al `drop column`: app_render sigue leyendo la pública y no la cruda", async () => {
    await publicar(db, s, "grant-0023.es", { name: "Casa Lucio" });
    const filas = await db.asRender<{ p: unknown }>(
      "select business_profile_publico as p from clients where domain = 'grant-0023.es'",
    );
    assert.equal(filas.length, 1);
    await assert.rejects(
      () => db.asRender("select business_profile from clients"),
      /permission denied|no tiene permiso/i,
    );
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `npm test -w db`
Expected: FAIL en los cuatro tests nuevos que aseveran `video`/`alergenos`/`etiquetas`/`nutricion`/
`comensales` — la función `app.nap_publico` todavía es la de la `0020` y no los conoce (van a salir
`undefined`). El test del grant PASA igual (no depende de esta migración), lo cual está bien.

- [ ] **Step 4: Escribir la migración `0023_menu_enriquecido.sql`**

Crear `db/migrations/0023_menu_enriquecido.sql`:

```sql
-- =============================================================================
-- AMG OS — El menú digital enriquecido, dentro de la allowlist
--
-- Cuatro campos nuevos por plato: `video`, `alergenos`, `etiquetas`, `nutricion`, y `comensales`
-- dentro de cada entrada de `precios`. Esta es la FRONTERA 2 de las cuatro que cruza un campo del
-- perfil para llegar al HTML (junto con el Zod de `web-builder/src/contract.ts`, `perfilValido` del
-- renderizador y el render). Un campo que falte acá no da error: no aparece — el mismo modo de fallo
-- silencioso que ya tuvieron `brand` (0009), `locations`/`menu` (0010) y las fotos (0014).
--
-- ## Lo que esta migración NO valida, y por qué
--
-- Igual que la 0014 y la 0020: acá se restringen NOMBRES de clave (`jsonb_build_object` enumera) y
-- FORMA de valor (`app.texto_publico` / `app.numero_publico` / string vs objeto vs array). El
-- CONTENIDO —¿es "gluten" uno de los 14 alérgenos reales?— lo validan las fronteras que emiten (el Zod
-- y `perfilValido`). Meter esa regla acá daría una falsa sensación de defensa y dejaría que alguien
-- quitara la de las otras dos creyendo que Postgres cubre.
--
-- Se REEMPLAZA `app.nap_publico` y se re-materializa la columna generada, porque una columna STORED
-- no se recalcula porque cambie la función. Mismo mecanismo que la 0009, la 0010, la 0014 y la 0020.
-- =============================================================================

set lock_timeout = '5s';

-- Un array de strings, con tope. La usan `alergenos` (14) y `etiquetas` (7): las dos son listas de
-- valores de una taxonomía fija, y el contenido —¿es un valor real de la taxonomía?— no lo valida
-- esta capa (ver cabecera). El tope corta sobre la POSICIÓN EN LA FUENTE, igual que los 200 platos de
-- la 0010: un elemento que no es string gasta su cupo igual, así que esta rama nunca depende de
-- cuánta basura traiga la ficha.
create or replace function app.lista_texto_publica(v jsonb, tope int) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'array' then (
      select jsonb_agg(app.texto_publico(el))
      from jsonb_array_elements(v) with ordinality as t(el, i)
      where jsonb_typeof(el) = 'string' and i <= tope
    )
    else null
  end
$$;

-- Un video: forma de objeto, `src` de texto y `poster` con la MISMA sub-allowlist que cualquier otra
-- foto (`app.foto_publica`, de la 0014). Sin `src` el objeto entero queda vacío y `nullif` lo tira:
-- un video sin `src` no es un video a medias, es nada que mostrar.
create or replace function app.video_publico(v jsonb) returns jsonb
language sql immutable as $$
  select case
    when jsonb_typeof(v) = 'object' then nullif(
      jsonb_strip_nulls(jsonb_build_object(
        'src', app.texto_publico(v -> 'src'),
        'poster', app.foto_publica(v -> 'poster')
      )),
      '{}'::jsonb
    )
    else null
  end
$$;

create or replace function app.nap_publico(perfil jsonb) returns jsonb
language sql immutable as $$
  select case
    when perfil is null or jsonb_typeof(perfil) <> 'object' then null
    else jsonb_strip_nulls(jsonb_build_object(
      'name',          app.texto_publico(perfil -> 'name'),
      'telephone',     app.texto_publico(perfil -> 'telephone'),
      'priceRange',    app.texto_publico(perfil -> 'priceRange'),
      'url',           app.texto_publico(perfil -> 'url'),
      'image',         app.texto_publico(perfil -> 'image'),
      'opening_hours', app.texto_publico(perfil -> 'opening_hours'),
      'address', case
        when jsonb_typeof(perfil -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'streetAddress',   app.texto_publico(perfil -> 'address' -> 'streetAddress'),
          'addressLocality', app.texto_publico(perfil -> 'address' -> 'addressLocality'),
          'postalCode',      app.texto_publico(perfil -> 'address' -> 'postalCode'),
          'addressRegion',   app.texto_publico(perfil -> 'address' -> 'addressRegion'),
          'addressCountry',  app.texto_publico(perfil -> 'address' -> 'addressCountry')
        ))
        else null
      end,
      'portada', app.foto_publica(perfil -> 'portada'),
      'fotos', case
        when jsonb_typeof(perfil -> 'fotos') = 'array' then (
          select jsonb_agg(app.foto_publica(f))
          from jsonb_array_elements(perfil -> 'fotos') with ordinality as t(f, i)
          where app.foto_publica(f) is not null and i <= 30
        )
        else null
      end,
      'brand', case
        when jsonb_typeof(perfil -> 'brand') = 'object' then jsonb_strip_nulls(jsonb_build_object(
          'color', app.texto_publico(perfil -> 'brand' -> 'color'),
          'font',  app.texto_publico(perfil -> 'brand' -> 'font'),
          'logo',  app.texto_publico(perfil -> 'brand' -> 'logo'),
          'plantilla', app.texto_publico(perfil -> 'brand' -> 'plantilla'),
          'colores', case
            when jsonb_typeof(perfil -> 'brand' -> 'colores') = 'object' then nullif(
              jsonb_strip_nulls(jsonb_build_object(
                'primario',   app.texto_publico(perfil -> 'brand' -> 'colores' -> 'primario'),
                'secundario', app.texto_publico(perfil -> 'brand' -> 'colores' -> 'secundario'),
                'titulo',     app.texto_publico(perfil -> 'brand' -> 'colores' -> 'titulo'),
                'texto',      app.texto_publico(perfil -> 'brand' -> 'colores' -> 'texto'),
                'fondo',      app.texto_publico(perfil -> 'brand' -> 'colores' -> 'fondo'),
                'fondoAlt',   app.texto_publico(perfil -> 'brand' -> 'colores' -> 'fondoAlt')
              )),
              '{}'::jsonb
            )
            else null
          end,
          'fuentes', case
            when jsonb_typeof(perfil -> 'brand' -> 'fuentes') = 'object' then nullif(
              jsonb_strip_nulls(jsonb_build_object(
                'titulo',     app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'titulo'),
                'texto',      app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'texto'),
                'decorativa', app.texto_publico(perfil -> 'brand' -> 'fuentes' -> 'decorativa')
              )),
              '{}'::jsonb
            )
            else null
          end
        ))
        else null
      end,
      'locations', case
        when jsonb_typeof(perfil -> 'locations') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'name', app.texto_publico(loc -> 'name'),
            'address', case
              when jsonb_typeof(loc -> 'address') = 'object' then jsonb_strip_nulls(jsonb_build_object(
                'streetAddress',   app.texto_publico(loc -> 'address' -> 'streetAddress'),
                'addressLocality', app.texto_publico(loc -> 'address' -> 'addressLocality'),
                'postalCode',      app.texto_publico(loc -> 'address' -> 'postalCode'),
                'addressRegion',   app.texto_publico(loc -> 'address' -> 'addressRegion'),
                'addressCountry',  app.texto_publico(loc -> 'address' -> 'addressCountry')
              ))
              else null
            end,
            'telephone',     app.texto_publico(loc -> 'telephone'),
            'opening_hours', app.texto_publico(loc -> 'opening_hours'),
            'foto',          app.foto_publica(loc -> 'foto')
          )))
          from jsonb_array_elements(perfil -> 'locations') with ordinality as t(loc, i)
          where jsonb_typeof(loc) = 'object' and i <= 20
        )
        else null
      end,
      -- La carta: tope de 200 (0010). NUEVO en la 0023: `video`, `alergenos`, `etiquetas`,
      -- `nutricion`, y `comensales` dentro de `precios`.
      'menu', case
        when jsonb_typeof(perfil -> 'menu') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'category',    app.texto_publico(item -> 'category'),
            'name',        app.texto_publico(item -> 'name'),
            'description', app.texto_publico(item -> 'description'),
            'price',       app.texto_publico(item -> 'price'),
            'nota',        app.texto_publico(item -> 'nota'),
            'foto',        app.foto_publica(item -> 'foto'),
            'precios', case
              when jsonb_typeof(item -> 'precios') = 'array' then (
                select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                  'etiqueta',   app.texto_publico(p -> 'etiqueta'),
                  'importe',    app.texto_publico(p -> 'importe'),
                  'comensales', app.texto_publico(p -> 'comensales')
                )))
                from jsonb_array_elements(item -> 'precios') with ordinality as tp(p, i)
                where jsonb_typeof(p) = 'object'
                  and app.texto_publico(p -> 'etiqueta') is not null
                  and app.texto_publico(p -> 'importe')  is not null
                  and i <= 3
              )
              else null
            end,
            -- NUEVO (0023): el video del plato.
            'video', app.video_publico(item -> 'video'),
            -- NUEVO (0023): alérgenos y etiquetas, cada uno con el tope de SU taxonomía.
            'alergenos', app.lista_texto_publica(item -> 'alergenos', 14),
            'etiquetas', app.lista_texto_publica(item -> 'etiquetas', 7),
            -- NUEVO (0023): nutrición de la ración de referencia. `orden` de menu_categorias ya probó
            -- el patrón de un campo numérico (`app.numero_publico`, de la 0014).
            'nutricion', case
              when jsonb_typeof(item -> 'nutricion') = 'object' then nullif(
                jsonb_strip_nulls(jsonb_build_object(
                  'calorias',        app.numero_publico(item -> 'nutricion' -> 'calorias'),
                  'proteinas_g',     app.numero_publico(item -> 'nutricion' -> 'proteinas_g'),
                  'carbohidratos_g', app.numero_publico(item -> 'nutricion' -> 'carbohidratos_g'),
                  'grasas_g',        app.numero_publico(item -> 'nutricion' -> 'grasas_g')
                )),
                '{}'::jsonb
              )
              else null
            end
          )))
          from jsonb_array_elements(perfil -> 'menu') with ordinality as t(item, i)
          where jsonb_typeof(item) = 'object' and i <= 200
        )
        else null
      end,
      'menu_categorias', case
        when jsonb_typeof(perfil -> 'menu_categorias') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'nombre', app.texto_publico(cat -> 'nombre'),
            'foto',   app.foto_publica(cat -> 'foto'),
            'orden',  app.numero_publico(cat -> 'orden')
          )))
          from jsonb_array_elements(perfil -> 'menu_categorias') with ordinality as t(cat, i)
          where jsonb_typeof(cat) = 'object' and i <= 20
        )
        else null
      end,
      'bienvenida', app.texto_publico(perfil -> 'bienvenida'),
      'destacados', case
        when jsonb_typeof(perfil -> 'destacados') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'titulo', app.texto_publico(d -> 'titulo'),
            'texto',  app.texto_publico(d -> 'texto')
          )))
          from jsonb_array_elements(perfil -> 'destacados') with ordinality as t(d, i)
          where jsonb_typeof(d) = 'object'
            and app.texto_publico(d -> 'titulo') is not null
            and i <= 6
        )
        else null
      end,
      'testimonios', case
        when jsonb_typeof(perfil -> 'testimonios') = 'array' then (
          select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
            'texto', app.texto_publico(t2 -> 'texto'),
            'autor', app.texto_publico(t2 -> 'autor')
          )))
          from jsonb_array_elements(perfil -> 'testimonios') with ordinality as t(t2, i)
          where jsonb_typeof(t2) = 'object'
            and app.texto_publico(t2 -> 'texto') is not null
            and i <= 12
        )
        else null
      end
    ))
  end
$$;

alter table clients drop column if exists business_profile_publico;

alter table clients
  add column business_profile_publico jsonb
  generated always as (app.nap_publico(business_profile)) stored;

comment on column clients.business_profile_publico is
  'Perfil publico del negocio (allowlist): name, telephone, priceRange, url, image, opening_hours, '
  'address, brand, locations (con foto), menu (con precios/comensales/nota/foto/video/alergenos/'
  'etiquetas/nutricion), menu_categorias, portada, fotos, bienvenida, destacados y testimonios. '
  'Generada — nunca se escribe directo. Es lo UNICO que ve app_render. Ver 0008/0009/0010/0014/0020/0023.';

-- ⚠️ `drop column` borra el grant de columna. Sin esto, app_render pierde el select y caen las webs
-- de todos los clientes a la vez (ya pasó en la 0009).
grant select (business_profile_publico) on clients to app_render;
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `npm test -w db`
Expected: PASS — los seis tests de `menu-enriquecido-publico.test.ts`, y ningún test existente roto
(en particular `db/src/fotos-publicas.test.ts` y `db/src/seed-demo.test.ts`, que también leen
`business_profile_publico`).

- [ ] **Step 6: Correr el test de las tres fronteras y confirmar que AVANZA (sigue rojo, por la frontera 3)**

Run: `node --import tsx --test src/tres-fronteras.test.ts` (desde `renderer/`)
Expected: sigue FAIL, pero el `assert.deepEqual` ahora debería mostrar que solo faltan los campos que
`perfilValido` todavía no valida (Task 5) — la parte de Postgres ya está.

- [ ] **Step 7: Typecheck y commit**

```bash
npm run typecheck -w db
git add db/migrations/0023_menu_enriquecido.sql db/src/menu-enriquecido-publico.test.ts
git commit -m "Feat: video, alérgenos, etiquetas y nutrición en la allowlist de Postgres (frontera 2, migración 0023)"
```

---

### Task 5: `perfilValido` (frontera 3) — cierra las tres fronteras encadenadas

**Files:**
- Modify: `renderer/src/perfil.ts`
- Test: `renderer/src/perfil.test.ts`

**Interfaces:**
- Consumes: `Alergeno`, `EtiquetaDietetica` (tipos, Task 1); la columna
  `business_profile_publico` con los campos nuevos (Task 4).
- Produces: `perfilValido()` deja pasar `menu[].video`, `menu[].alergenos`, `menu[].etiquetas`,
  `menu[].nutricion` y `menu[].precios[].comensales`, revalidando cada enum contra un `Set` fijo.

- [ ] **Step 1: Escribir los tests que fallan**

En `renderer/src/perfil.test.ts`, agregar (después de los tests de `locations`, en el mismo estilo):

```ts
it("🔴 `menu[].video`: cruza con src+poster; sin poster también es válido (lo exige el render, no acá)", () => {
  const p = perfilValido({
    name: "N",
    menu: [
      {
        name: "Margherita",
        video: {
          src: "https://a.storyblok.com/f/1/x.mp4",
          poster: { src: "https://a.storyblok.com/f/1/poster.jpg", alt: "Pizza" },
        },
      },
      { name: "Sin poster", video: { src: "https://a.storyblok.com/f/1/y.mp4" } },
    ],
  });
  assert.equal(p?.menu?.[0]?.video?.src, "https://a.storyblok.com/f/1/x.mp4");
  assert.equal(p?.menu?.[0]?.video?.poster?.alt, "Pizza");
  assert.equal(p?.menu?.[1]?.video?.src, "https://a.storyblok.com/f/1/y.mp4");
  assert.equal(p?.menu?.[1]?.video?.poster, undefined);
});

it("🔴 `menu[].video` sin `src` https se descarta entero", () => {
  const p = perfilValido({ name: "N", menu: [{ name: "P", video: { src: "http://a.storyblok.com/f/1/x.mp4" } }] });
  assert.equal(p?.menu?.[0]?.video, undefined);
});

it("🔴 `menu[].alergenos`: los de la taxonomía cruzan, uno inventado se descarta SOLO (no tira el plato)", () => {
  const p = perfilValido({
    name: "N",
    menu: [{ name: "Margherita", alergenos: ["gluten", "lacteos", "gluten-free-inventado"] }],
  });
  assert.deepEqual(p?.menu?.[0]?.alergenos, ["gluten", "lacteos"]);
});

it("🔴 `menu[].etiquetas`: mismo criterio que alergenos", () => {
  const p = perfilValido({ name: "N", menu: [{ name: "P", etiquetas: ["vegano", "sin gluten"] }] });
  assert.deepEqual(p?.menu?.[0]?.etiquetas, ["vegano"]);
});

it("🔴 `menu[].nutricion`: cada clave numérica sobrevive sola; una en texto se descarta esa clave", () => {
  const p = perfilValido({
    name: "N",
    menu: [{ name: "Margherita", nutricion: { calorias: 820, proteinas_g: "34" } }],
  });
  assert.equal(p?.menu?.[0]?.nutricion?.calorias, 820);
  assert.equal(p?.menu?.[0]?.nutricion?.proteinas_g, undefined);
});

it("🔴 `menu[].precios[].comensales`: cruza junto con etiqueta e importe", () => {
  const p = perfilValido({
    name: "N",
    menu: [{ name: "Margherita", precios: [{ etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" }] }],
  });
  assert.equal(p?.menu?.[0]?.precios?.[0]?.comensales, "2-3 personas");
});
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `npm --prefix renderer test`
Expected: FAIL — `carta()` en `perfil.ts` todavía no lee ninguno de estos campos.

- [ ] **Step 3: Extender `perfil.ts`**

En `renderer/src/perfil.ts`, cambiar el import del tipo (línea 1-11) para incluir `Alergeno` y
`EtiquetaDietetica`:

```ts
import type {
  BrandTheme,
  BusinessProfile,
  Alergeno,
  Destacado,
  EtiquetaDietetica,
  Foto,
  FuenteNombre,
  Location,
  MenuCategoria,
  MenuItem,
  Testimonio,
} from "web-builder";
```

Agregar, después de los topes existentes (`renderer/src/perfil.ts:177-183`, junto a `MAX_LOCALES` etc.):

```ts
/** Los 14 alérgenos del Reglamento UE 1169/2011. Tiene que coincidir EXACTAMENTE con `Alergeno` de
 *  `types.ts` y con `ALERGENOS` de `web-builder/src/contract.ts` — ver el comentario ahí. */
const ALERGENOS = new Set<string>([
  "gluten",
  "crustaceos",
  "huevos",
  "pescado",
  "cacahuetes",
  "soja",
  "lacteos",
  "frutos_cascara",
  "apio",
  "mostaza",
  "sesamo",
  "sulfitos",
  "altramuces",
  "moluscos",
]);
const ETIQUETAS_DIETETICAS = new Set<string>([
  "vegano",
  "vegetariano",
  "sin_gluten",
  "sin_lactosa",
  "picante",
  "halal",
  "kosher",
]);
const MAX_ALERGENOS = ALERGENOS.size;
const MAX_ETIQUETAS = ETIQUETAS_DIETETICAS.size;
```

Agregar estas tres funciones nuevas, después de `precios()` (línea 228) y antes de `carta()`:

```ts
/** Una lista de valores de una allowlist FIJA (alérgenos, etiquetas). Los que no están en el `Set`
 *  se descartan uno a uno — mismo criterio que una entrada de `precios` a medias: el resto sobrevive. */
function listaDeAllowlist<T extends string>(
  v: unknown,
  permitidos: ReadonlySet<string>,
  tope: number,
): T[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: T[] = [];
  for (const item of v.slice(0, tope)) {
    if (typeof item === "string" && permitidos.has(item)) out.push(item as T);
  }
  return out.length ? out : undefined;
}

/**
 * El video de un plato. Sin `src` https no hay video. `poster` es OPCIONAL acá a propósito: exigirlo
 * sería una regla del RENDER (frontera 4, que no emite `<video>` sin poster) colada en esta capa —
 * mismo criterio que aplica `videoSchema` en el Zod (frontera 1).
 */
function video(v: unknown): MenuItem["video"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const src = texto(o["src"]);
  if (!src || !/^https:\/\//i.test(src)) return undefined;
  const p = foto(o["poster"]);
  return p ? { src, poster: p } : { src };
}

/** Nutrición de la ración de referencia. Cada clave sobrevive sola: un plato puede declarar solo
 *  calorías y nada más — mismo criterio que `locales`, donde un local con un solo dato usable no se
 *  descarta entero. */
function nutricion(v: unknown): MenuItem["nutricion"] | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const out: NonNullable<MenuItem["nutricion"]> = {};
  for (const k of ["calorias", "proteinas_g", "carbohidratos_g", "grasas_g"] as const) {
    if (typeof o[k] === "number") out[k] = o[k] as number;
  }
  return Object.keys(out).length ? out : undefined;
}
```

Reemplazar `precios()` (líneas 216-228) para que también lea `comensales`:

```ts
function precios(v: unknown): MenuItem["precios"] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: NonNullable<MenuItem["precios"]> = [];
  for (const item of v.slice(0, MAX_PRECIOS)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const p = item as Record<string, unknown>;
    const etiqueta = texto(p["etiqueta"]);
    const importe = texto(p["importe"]);
    if (!etiqueta || !importe) continue;
    out.push({
      etiqueta,
      importe,
      ...(texto(p["comensales"]) ? { comensales: texto(p["comensales"])! } : {}),
    });
  }
  return out.length ? out : undefined;
}
```

Reemplazar `carta()` (líneas 230-252) para que enganche las cuatro funciones nuevas:

```ts
function carta(v: unknown): MenuItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: MenuItem[] = [];
  for (const item of v.slice(0, MAX_ITEMS_CARTA)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const m = item as Record<string, unknown>;
    const nombre = texto(m["name"]);
    if (!nombre) continue;
    const lista = precios(m["precios"]);
    const f = foto(m["foto"]);
    const v2 = video(m["video"]);
    const alergenos = listaDeAllowlist<Alergeno>(m["alergenos"], ALERGENOS, MAX_ALERGENOS);
    const etiquetas = listaDeAllowlist<EtiquetaDietetica>(m["etiquetas"], ETIQUETAS_DIETETICAS, MAX_ETIQUETAS);
    const nut = nutricion(m["nutricion"]);
    out.push({
      name: nombre,
      ...(texto(m["category"]) ? { category: texto(m["category"])! } : {}),
      ...(texto(m["description"]) ? { description: texto(m["description"])! } : {}),
      ...(texto(m["price"]) ? { price: texto(m["price"])! } : {}),
      ...(lista ? { precios: lista } : {}),
      ...(texto(m["nota"]) ? { nota: texto(m["nota"])! } : {}),
      ...(f ? { foto: f } : {}),
      ...(v2 ? { video: v2 } : {}),
      ...(alergenos ? { alergenos } : {}),
      ...(etiquetas ? { etiquetas } : {}),
      ...(nut ? { nutricion: nut } : {}),
    });
  }
  return out.length ? out : undefined;
}
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `npm --prefix renderer test`
Expected: PASS — los 6 tests nuevos de `perfil.test.ts`, y el resto del archivo sin regresiones.

- [ ] **Step 5: Correr el test de las tres fronteras y confirmar el VERDE**

Run: `node --import tsx --test src/tres-fronteras.test.ts` (desde `renderer/`)
Expected: **PASS**. Con esto se cierra el checkpoint que la Task 2 dejó abierto: los tres campos
(Zod, allowlist, `perfilValido`) enumeran exactamente lo mismo.

- [ ] **Step 6: Typecheck y commit**

```bash
npm run typecheck -w renderer
git add renderer/src/perfil.ts renderer/src/perfil.test.ts
git commit -m "Feat: perfilValido revalida video, alérgenos, etiquetas y nutrición (frontera 3, cierra las tres fronteras)"
```

---

### Task 6: El render — video, alérgenos, etiquetas, nutrición y comensales en la carta

**Files:**
- Modify: `web-builder/src/render/piezas/tipos.ts` (`CtxPieza`)
- Modify: `web-builder/src/render/ctx-de-prueba.ts` (`ctxDe`)
- Modify: `web-builder/src/render/shell.ts` (`Documento.ctx`, `renderDocumento`)
- Modify: `web-builder/src/render/lib.ts` (`Precio`, `preciosDe`, + `renderVideo`/`comoVideo` nuevos)
- Modify: `web-builder/src/render/piezas/carta-categorias.ts` (`unPlato`, `unaCategoria`, `render`, CSS)
- Test: `web-builder/src/render/piezas/piezas-foto.test.ts` (nuevos casos de `cartaCategorias`)

**Interfaces:**
- Consumes: `PresupuestoVideos`, `nuevoPresupuestoVideos`, `consumirCupoVideo`, `fuenteVideoPermitida`
  (Task 3); `MenuItem.video`/`.alergenos`/`.etiquetas`/`.nutricion`/`.precios[].comensales` (Task 1).
- Produces: `CtxPieza.presupuestoVideos: PresupuestoVideos`; `lib.ts` exporta `renderVideo()` y
  `comoVideo()`, y `Precio` gana `comensales?: string`.

- [ ] **Step 1: `CtxPieza` gana `presupuestoVideos`**

En `web-builder/src/render/piezas/tipos.ts`, agregar el import y el campo:

```ts
import type { BusinessProfile, NavItem, Story } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import type { PresupuestoVideos } from "../videos.js";
```

Y al final de la interfaz `CtxPieza` (después de `presupuestoImagenes`, línea 74):

```ts
  presupuestoImagenes: PresupuestoImagenes;
  /** El presupuesto de videos de ESTE documento — mismo criterio que `presupuestoImagenes`, ver ahí. */
  presupuestoVideos: PresupuestoVideos;
}
```

- [ ] **Step 2: `ctxDe()` lo rellena en los tests**

En `web-builder/src/render/ctx-de-prueba.ts`, agregar el import:

```ts
import { nuevoPresupuestoImagenes } from "./imagenes.js";
import { nuevoPresupuestoVideos } from "./videos.js";
```

Y en `ctxDe()` (línea 24-35), agregar la línea:

```ts
export function ctxDe(over: Partial<CtxPieza> = {}): CtxPieza {
  return {
    story: null,
    profile: null,
    activeSlug: "",
    titulo: "",
    bajada: "",
    paginas: [],
    presupuestoImagenes: nuevoPresupuestoImagenes(),
    presupuestoVideos: nuevoPresupuestoVideos(),
    ...over,
  };
}
```

- [ ] **Step 3: `renderDocumento` crea un presupuesto de video por documento (producción)**

En `web-builder/src/render/shell.ts`, agregar el import:

```ts
import { nuevoPresupuestoImagenes } from "./imagenes.js";
import { nuevoPresupuestoVideos } from "./videos.js";
```

Cambiar el tipo de `Documento.ctx` (línea 70):

```ts
  ctx: Omit<CtxPieza, "presupuestoImagenes" | "presupuestoVideos">;
```

Y la construcción del contexto en `renderDocumento` (línea 95):

```ts
  const ctx: CtxPieza = {
    ...doc.ctx,
    presupuestoImagenes: nuevoPresupuestoImagenes(),
    presupuestoVideos: nuevoPresupuestoVideos(),
  };
```

- [ ] **Step 4: Correr los tests existentes — todavía tienen que pasar (cambio mecánico, sin conducta nueva)**

Run: `npm test -w web-builder`
Expected: PASS. Este paso no agrega conducta, solo hace que el tipo exista en todos lados que ya
construyen un `CtxPieza`; si algo rompe acá es porque queda un literal de `CtxPieza` sin actualizar.

- [ ] **Step 5: Escribir los tests que fallan para el render de `cartaCategorias`**

En `web-builder/src/render/piezas/piezas-foto.test.ts`, agregar al final de la sección de
`cartaCategorias` (después de la línea 500, antes del `for` que recorre el catálogo en la línea 600):

```ts
const VIDEO_OK = "https://a.storyblok.com/f/1/margherita.mp4";
const POSTER_OK = { src: FOTO_OK, alt: "Pizza recién horneada" };

test("cartaCategorias: un plato con video Y foto muestra el VIDEO, no la foto", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", foto: { src: FOTO_OK }, video: { src: VIDEO_OK, poster: POSTER_OK } }],
      }),
    }),
  );
  assert.match(html, /<video class="plato-foto"[^>]*src="https:\/\/a\.storyblok\.com\/f\/1\/margherita\.mp4"/);
  assert.doesNotMatch(html, /<img class="plato-foto"/, "la foto no se dibuja cuando hay video");
});

test("cartaCategorias: un video de host prohibido cae a la FOTO, no a un hueco", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", foto: { src: FOTO_OK }, video: { src: "https://cdn.evil.tld/x.mp4", poster: POSTER_OK } }],
      }),
    }),
  );
  assert.doesNotMatch(html, /<video/);
  assert.match(html, /<img class="plato-foto"[^>]*src="https:\/\/a\.storyblok\.com/);
});

test("cartaCategorias: un video SIN poster no se dibuja (cae a la foto si la hay, si no a nada)", () => {
  const conFoto = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "P", foto: { src: FOTO_OK }, video: { src: VIDEO_OK } }] }) }),
  );
  assert.doesNotMatch(conFoto, /<video/);
  assert.match(conFoto, /<img class="plato-foto"/);

  const sinFoto = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "P", video: { src: VIDEO_OK } }] }) }),
  );
  assert.doesNotMatch(sinFoto, /<video|<img class="plato-foto"/);
});

test("cartaCategorias: TODO <video> lleva controls, preload=\"none\" y NUNCA autoplay", () => {
  const html = cartaCategorias.render(
    ctxDe({ profile: validProfile({ menu: [{ name: "P", video: { src: VIDEO_OK, poster: POSTER_OK } }] }) }),
  );
  assert.match(html, /<video[^>]*\bcontrols\b/);
  assert.match(html, /<video[^>]*preload="none"/);
  assert.doesNotMatch(html, /autoplay/);
});

test("cartaCategorias: alérgenos y etiquetas se dibujan como texto, escapado", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", alergenos: ["gluten", "lacteos"], etiquetas: ["vegetariano"] }],
      }),
    }),
  );
  assert.match(html, /class="alergenos"/);
  assert.match(html, /Gluten/);
  assert.match(html, /Lácteos/);
  assert.match(html, /class="tag">Vegetariano</);
});

test("cartaCategorias: sin alérgenos ni etiquetas, no se dibuja ningún bloque vacío", () => {
  const html = cartaCategorias.render(ctxDe({ profile: validProfile({ menu: [{ name: "Cacio e pepe" }] }) }));
  assert.doesNotMatch(html, /class="alergenos"|class="tags"/);
});

test("cartaCategorias: la nutrición sale en un <details> colapsado, con solo los campos presentes", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", nutricion: { calorias: 820, proteinas_g: 34 } }],
      }),
    }),
  );
  assert.match(html, /<details class="nutricion"><summary>Información nutricional<\/summary>/);
  assert.match(html, /820 kcal/);
  assert.match(html, /Proteínas: 34 g/);
  assert.doesNotMatch(html, /Carbohidratos:|Grasas:/);
});

test("cartaCategorias: sin nutrición, no se dibuja el <details>", () => {
  const html = cartaCategorias.render(ctxDe({ profile: validProfile({ menu: [{ name: "Cacio e pepe" }] }) }));
  assert.doesNotMatch(html, /<details class="nutricion"/);
});

test("cartaCategorias: `comensales` se muestra junto a su precio", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [{ name: "Margherita", precios: [{ etiqueta: "Ración", importe: "14,50 €", comensales: "2-3 personas" }] }],
      }),
    }),
  );
  assert.match(html, /14,50 €.*\(2-3 personas\)/);
});

test("🔴 cartaCategorias: alérgenos, etiquetas y comensales se escapan", () => {
  const html = cartaCategorias.render(
    ctxDe({
      profile: validProfile({
        menu: [
          {
            name: "P",
            alergenos: ["gluten"],
            precios: [{ etiqueta: VENENO, importe: "9 €", comensales: VENENO }],
          },
        ],
      }),
    }),
  );
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
```

- [ ] **Step 6: Correr los tests y verificar que fallan**

Run: `npm test -w web-builder`
Expected: FAIL — `carta-categorias.ts` todavía no lee `video`/`alergenos`/`etiquetas`/`nutricion`/
`comensales`.

- [ ] **Step 7: Extender `Precio` y `preciosDe()` en `lib.ts`**

En `web-builder/src/render/lib.ts`, reemplazar la interfaz `Precio` (líneas 259-262):

```ts
/** Un importe de la carta, ya normalizado. `etiqueta` vacía = el importe único de `price`. */
export interface Precio {
  etiqueta: string;
  importe: string;
  /** "1-2 personas" — ver `MenuItem.precios[].comensales`. */
  comensales?: string;
}
```

Y `preciosDe()` (líneas 279-294), para que pase `comensales` cuando esté presente:

```ts
export function preciosDe(item: MenuItem): Precio[] {
  const brutos = Array.isArray(item.precios) ? item.precios : [];
  const validos = brutos
    .filter(
      (p): p is { etiqueta: string; importe: string; comensales?: string } =>
        typeof p?.etiqueta === "string" &&
        p.etiqueta.length > 0 &&
        typeof p.importe === "string" &&
        p.importe.length > 0,
    )
    .slice(0, MAX_PRECIOS_RENDER)
    .map((p) => ({
      etiqueta: p.etiqueta,
      importe: p.importe,
      ...(typeof p.comensales === "string" && p.comensales.length > 0 ? { comensales: p.comensales } : {}),
    }));
  if (validos.length > 0) return validos;
  return typeof item.price === "string" && item.price.length > 0
    ? [{ etiqueta: "", importe: item.price }]
    : [];
}
```

- [ ] **Step 8: Agregar `renderVideo()` y `comoVideo()` a `lib.ts`**

Agregar el import al principio de `web-builder/src/render/lib.ts` (línea 1-3):

```ts
import type { BusinessProfile, Foto, Imagen, Location, MenuItem, NavItem, Video } from "../types.js";
import type { CtxPieza } from "./piezas/tipos.js";
import { type PresupuestoImagenes, consumirCupo, fuentePermitida } from "./imagenes.js";
import { type PresupuestoVideos, consumirCupoVideo, fuenteVideoPermitida } from "./videos.js";
```

Y agregar, después de `comoImagen()` (línea 305-308):

```ts
/** Un video listo para el render: `src` + `poster` ya convertido a `Imagen`. */
export interface VideoRenderable {
  src: string;
  poster?: Imagen;
}

/** Mismo criterio que `comoImagen`: la conversión del tipo del perfil (`Video`) al que habla el
 *  render, en un solo sitio. */
export function comoVideo(video: Video | undefined): VideoRenderable | undefined {
  if (!video || typeof video.src !== "string") return undefined;
  return { src: video.src, poster: comoImagen(video.poster) };
}

/**
 * Un `<video>`, listo para la §Política de video (`videos.ts`). **Sin `poster` válido no se emite
 * nada** — un video sin fotograma de portada forzaría al navegador a descargarlo entero solo para
 * mostrar la carta, y eso es peor que no mostrar video.
 *
 * Mismo orden que `renderImagen`: primero la allowlist de host, después el presupuesto — una URL
 * rechazada no puede consumir cupo.
 *
 * **Nunca autoplay.** `controls preload="none"`: el visitante decide si lo reproduce, y el navegador
 * no descarga nada hasta que lo haga.
 */
export function renderVideo(
  video: VideoRenderable | undefined,
  clase: string,
  presupuesto: PresupuestoVideos,
): string {
  if (!video || !fuenteVideoPermitida(video.src)) return "";
  if (!video.poster || !fuentePermitida(video.poster.src)) return "";
  if (!consumirCupoVideo(presupuesto)) return "";
  return `<video class="${clase}" src="${esc(video.src)}" poster="${esc(video.poster.src)}" controls preload="none"></video>`;
}
```

- [ ] **Step 9: Reescribir `carta-categorias.ts`**

En `web-builder/src/render/piezas/carta-categorias.ts`, cambiar los imports (líneas 1-12):

```ts
import type { Alergeno, BusinessProfile, EtiquetaDietetica, Foto, MenuItem } from "../../types.js";
import type { PresupuestoImagenes } from "../imagenes.js";
import type { PresupuestoVideos } from "../videos.js";
import {
  MAX_CATEGORIAS_RENDER,
  agruparCarta,
  comoImagen,
  comoVideo,
  envolver,
  esc,
  preciosDe,
  renderImagen,
  renderVideo,
} from "../lib.js";
import type { CtxPieza, Pieza } from "./tipos.js";
```

Agregar, después de la interfaz `GrupoCarta` (línea 131), las dos tablas de etiquetas y las tres
funciones de dibujo:

```ts
/** Nombres en español de los 14 alérgenos, para el badge de texto. Viven ACÁ y no en `lib.ts`:
 *  `cartaCategorias` es la única pieza que los usa hoy (YAGNI). */
const ETIQUETA_ALERGENO: Record<Alergeno, string> = {
  gluten: "Gluten",
  crustaceos: "Crustáceos",
  huevos: "Huevos",
  pescado: "Pescado",
  cacahuetes: "Cacahuetes",
  soja: "Soja",
  lacteos: "Lácteos",
  frutos_cascara: "Frutos de cáscara",
  apio: "Apio",
  mostaza: "Mostaza",
  sesamo: "Sésamo",
  sulfitos: "Sulfitos",
  altramuces: "Altramuces",
  moluscos: "Moluscos",
};

const ETIQUETA_DIETETICA: Record<EtiquetaDietetica, string> = {
  vegano: "Vegano",
  vegetariano: "Vegetariano",
  sin_gluten: "Sin gluten",
  sin_lactosa: "Sin lactosa",
  picante: "Picante",
  halal: "Halal",
  kosher: "Kosher",
};

/** "Contiene: gluten, lácteos" — o `""` sin alérgenos. Revalida contra la allowlist (frontera 4:
 *  en PROD el dato llega de la base sin pasar por Zod), igual que hace `preciosDe` con sus entradas. */
function alergenosDe(it: MenuItem): string {
  const lista = (Array.isArray(it.alergenos) ? it.alergenos : []).filter(
    (a): a is Alergeno => typeof a === "string" && a in ETIQUETA_ALERGENO,
  );
  if (lista.length === 0) return "";
  return `<p class="alergenos">Contiene: ${lista.map((a) => esc(ETIQUETA_ALERGENO[a])).join(", ")}</p>`;
}

/** Píldoras de etiquetas dietéticas — o `""` sin ninguna. */
function etiquetasDe(it: MenuItem): string {
  const lista = (Array.isArray(it.etiquetas) ? it.etiquetas : []).filter(
    (e): e is EtiquetaDietetica => typeof e === "string" && e in ETIQUETA_DIETETICA,
  );
  if (lista.length === 0) return "";
  return `<p class="tags">${lista.map((e) => `<span class="tag">${esc(ETIQUETA_DIETETICA[e])}</span>`).join("")}</p>`;
}

/** El `<details>` de información nutricional — o `""` sin ningún campo presente. Colapsado por
 *  defecto (sin JS: es el widget nativo del navegador) para no saturar una carta de 40 platos. */
function nutricionDe(it: MenuItem): string {
  const n = it.nutricion;
  if (!n || typeof n !== "object") return "";
  const filas: string[] = [];
  if (typeof n.calorias === "number") filas.push(`<li>${n.calorias} kcal</li>`);
  if (typeof n.proteinas_g === "number") filas.push(`<li>Proteínas: ${n.proteinas_g} g</li>`);
  if (typeof n.carbohidratos_g === "number") filas.push(`<li>Carbohidratos: ${n.carbohidratos_g} g</li>`);
  if (typeof n.grasas_g === "number") filas.push(`<li>Grasas: ${n.grasas_g} g</li>`);
  if (filas.length === 0) return "";
  return `<details class="nutricion"><summary>Información nutricional</summary><ul>${filas.join("")}</ul></details>`;
}
```

Reemplazar `unaCategoria()` (líneas 176-194) para que reciba y propague el presupuesto de video:

```ts
function unaCategoria(g: GrupoCarta, presupuesto: PresupuestoImagenes, presupuestoVideos: PresupuestoVideos): string {
  const foto = renderImagen(comoImagen(g.foto), "categoria-img", presupuesto);
  const filas = g.items.map((it) => unPlato(it, presupuesto, presupuestoVideos)).join("\n");
  const n = g.items.length;
  const conteo = `<p class="conteo">${n} ${n === 1 ? "plato" : "platos"}</p>`;
  const cabecera = g.categoria
    ? `<header class="cab ${foto ? "con-img" : "sin-img"}">${foto}<h3>${esc(g.categoria)}</h3>${conteo}</header>`
    : "";
  return `<section class="categoria">
  ${cabecera}
  <ul class="platos">
${filas}
  </ul>
</section>`;
}
```

Reemplazar `unPlato()` (líneas 196-209):

```ts
function unPlato(it: MenuItem, presupuesto: PresupuestoImagenes, presupuestoVideos: PresupuestoVideos): string {
  // El video reemplaza a la foto en la miniatura si el plato tiene los dos: un plato, una miniatura.
  const video = renderVideo(comoVideo(it.video), "plato-foto", presupuestoVideos);
  const foto = video ? "" : renderImagen(comoImagen(it.foto), "plato-foto", presupuesto);
  const nota = it.nota ? `<span class="nota">${esc(it.nota)}</span>` : "";
  const alergenos = alergenosDe(it);
  const etiquetas = etiquetasDe(it);
  const desc = it.description ? `<p class="desc">${esc(it.description)}</p>` : "";
  const nutricion = nutricionDe(it);
  const precios = preciosDe(it)
    .map(
      (p) =>
        `<span class="precio">${p.etiqueta ? `<span class="etiqueta">${esc(p.etiqueta)}</span>` : ""}${esc(p.importe)}${p.comensales ? ` <span class="comensales">(${esc(p.comensales)})</span>` : ""}</span>`,
    )
    .join("");
  return `    <li><div class="fila">${video || foto}<div class="datos"><p class="nombre">${esc(it.name)}${nota}</p>${alergenos}${etiquetas}${desc}${nutricion}</div>${precios ? `<p class="precios">${precios}</p>` : ""}</div></li>`;
}
```

Y actualizar `render()` (líneas 106-124) para pasar `ctx.presupuestoVideos`:

```ts
  render(ctx: CtxPieza): string {
    const profile = ctx.profile;
    if (!profile || !profile.menu || profile.menu.length === 0) return "";

    const bloques = gruposDe(profile)
      .map((g) => unaCategoria(g, ctx.presupuestoImagenes, ctx.presupuestoVideos))
      .join("\n");
    return envolver(
      "p-cartaCategorias",
      `<section class="seccion"><div class="banda">
  <div class="encabezado"><p class="antetitulo">Nuestra carta</p><h2>Lo que se cocina hoy</h2></div>
${bloques}
</div></section>`,
    );
  },
```

Por último, agregar al final del template de `css` (después de la línea 95, antes del cierre de la
plantilla en la línea 96):

```css
.p-cartaCategorias .alergenos{margin:4px 0 0;color:var(--muted);font-size:.82rem}
.p-cartaCategorias .tags{margin:4px 0 0;display:flex;flex-wrap:wrap;gap:4px}
.p-cartaCategorias .tag{display:inline-block;padding:2px 8px;border-radius:999px;background:var(--soft);color:var(--muted);font-size:.75rem}
.p-cartaCategorias .nutricion{margin:6px 0 0;font-size:.85rem}
.p-cartaCategorias .nutricion summary{cursor:pointer;color:var(--acento-legible)}
.p-cartaCategorias .nutricion ul{margin:6px 0 0;padding-left:18px;color:var(--muted)}
.p-cartaCategorias .comensales{color:var(--muted);font-weight:400;font-size:.78rem}
```

- [ ] **Step 10: Correr los tests y verificar que pasan**

Run: `npm test -w web-builder`
Expected: PASS — los tests nuevos del Step 5, y **todo** el resto de `web-builder` sin regresiones
(en particular `piezas.test.ts`, `piezas-foto.test.ts` completo, `ensamblado.test.ts`, y el gate de
paridad — ver el Step 11 sobre por qué este último no debería necesitar recaptura).

- [ ] **Step 11: Confirmar que el gate de paridad NO necesita recaptura, y por qué**

`perfilConManual()` (enriquecida en la Task 2) se usa en el caso de paridad `landing-perfil-con-manual`
(`web-builder/src/render/paridad/casos.ts:158`), pero ese caso renderiza con `platosDestacados`, no
con `cartaCategorias` — y `platosDestacados.ts` (`web-builder/src/render/piezas/platos-destacados.ts`)
solo lee `it.foto`, `it.description` y `preciosDe(it)[0].importe`: los campos nuevos son invisibles
para esa pieza. Los dos casos de paridad de `/menu` (`menu-agrupado`, `menu-sin-categorias`) usan
perfiles propios de `casos.ts` que tampoco llevan los campos nuevos. Confirmarlo corriendo:

Run: `npm --prefix web-builder run capturar:paridad -- --dry-run` si el script lo soporta, o
directamente `npm test -w web-builder` y revisar que ningún test de `paridad.test.ts` cayó.
Expected: PASS sin cambios — si algo cae acá, es señal de que `platosDestacados` sí quedó afectado
por accidente, y hay que investigar antes de seguir (no recapturar a ciegas).

- [ ] **Step 12: Manejar el sitio en un navegador**

Run: `npm run dev:server -w api` (o el `dev-server` del renderer, según cuál tenga datos de la demo
con el menú), y confirmar visualmente: un plato con video muestra el `<video>` con controles y sin
reproducirse solo; los badges de alérgenos y etiquetas se leen en claro y en oscuro; el `<details>` de
nutrición abre y cierra con teclado; `comensales` se lee junto al precio sin desbordar en 390px.

- [ ] **Step 13: Typecheck y commit**

```bash
npm run typecheck -w web-builder
git add web-builder/src/render/piezas/tipos.ts web-builder/src/render/ctx-de-prueba.ts \
        web-builder/src/render/shell.ts web-builder/src/render/lib.ts \
        web-builder/src/render/piezas/carta-categorias.ts web-builder/src/render/piezas/piezas-foto.test.ts
git commit -m "Feat: la carta dibuja video, alérgenos, etiquetas dietéticas, nutrición y comensales"
```

---

### Task 7: Verificación de conjunto y documentación

> Esta tarea la ejecuta **la sesión principal**, no un subagente fresco — es la regla del proyecto
> para integrar, verificar el conjunto y commitear (`AGENTS.md`).

**Files:**
- Modify: `docs/proyecto/09-estado-y-roadmap.md`
- Modify: `docs/proyecto/15-plan-plataforma.md`

- [ ] **Step 1: Verificación completa**

Run: `npm run verificar`
Expected: exit 0 — entorno, arnés, higiene de secretos, typecheck y **todos** los tests de los 7
workspaces en verde, incluidos los nuevos de `web-builder`, `db` y `renderer`.

- [ ] **Step 2: Auto-revisión adversarial (CHECKPOINTS.md)**

Revisar el diff completo de las 6 tareas contra `CHECKPOINTS.md`: ¿qué se afirmó sin verificar?, ¿qué
default de producción (el tope de 10 videos, la ración de referencia para nutrición) tiene un test que
lo fije?, ¿alguna garantía quedó en un comentario en vez de una constraint o una mutación?

- [ ] **Step 3: Actualizar `09-estado-y-roadmap.md` y `15-plan-plataforma.md`**

Agregar una entrada nueva describiendo el menú enriquecido: qué campos se sumaron, la migración
`0023` (o la que corresponda si cambió el número), y la cifra de tests actualizada del monorepo.
Sincronizar el conteo de migraciones y de tests donde aparezcan ambos documentos.

- [ ] **Step 4: Commit y push**

```bash
git add docs/proyecto/09-estado-y-roadmap.md docs/proyecto/15-plan-plataforma.md
git commit -m "Doc: cierre del menú digital enriquecido — estado y roadmap"
git push -u origin feature/menu-digital-enriquecido
```

# KR-2a — El paquete `contrato/` · plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usá `superpowers:subagent-driven-development` (recomendada) o
> `superpowers:executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan checkbox
> (`- [ ]`) para llevar el registro.

**Objetivo.** Extraer a un paquete compartido los tipos del contrato del brief, `renderReport()` y una
base de esquema Zod con dos derivados, de modo que `api/` pueda renderizar el informe sin depender del
pipeline de research — y de paso cerrar la deuda de las dos fuentes de verdad del contrato M2/M1.

**Arquitectura.** Nuevo workspace `contrato/` (7º), sin dependencias más que `zod`, que no conoce
Postgres ni HTTP ni UI. Los dos validadores Zod **siguen siendo dos** —`emisionM2` estricto y
`consumoM1` laxo multi-versión— derivados de una `esquemaBase` común: no son dos copias del mismo
contrato, son dos contratos con propósitos opuestos (emitir vs. recibir). Lo que se unifica son los
**tipos** y el **render**.

**Stack.** TypeScript ESM strict con `noUncheckedIndexedAccess`, `tsx` sin paso de build, `zod` ^3.23.8,
tests con `node:test` + `node:assert`.

**Spec:** [`2026-08-04-informe-kr-portal-design.md`](../specs/2026-08-04-informe-kr-portal-design.md)
(§4.1, §4.2, §7.1, §12). Revisada por la 14ª ronda externa de Codex y corregida.

## Restricciones globales

- **Cero cambios visibles.** KR-2a no toca ningún comportamiento observable: mismos briefs, mismo
  informe salvo los arreglos de datos incompletos y escapado (tareas 6-8). No hay migración, ni endpoint,
  ni pantalla — todo eso es KR-2b.
- **Nombres de dominio en español** (`emisionM2`, `consumoM1`, `esquemaBase`, `escaparCelda`). Los
  comentarios explican **por qué**, no qué.
- **Se importa por nombre de paquete** (`import { renderReport } from "contrato"`), nunca por ruta
  relativa entre paquetes.
- **`zod` es la ÚNICA dependencia de producción** de `contrato/`. Si una tarea necesita otra, es señal de
  que algo que no es contrato se está colando adentro.
- **Rojo primero, después el arreglo, después la mutación:** reintroducí el bug y confirmá que cae
  _exactamente_ su test. Una mutación que no tumba nada es un resultado: o falta el test, o la línea no
  hace lo que su comentario dice — averiguá cuál **antes** de tocar el test.
- **Si vas a citar una cifra o un comportamiento del motor, medilo en el momento.** `db/` corre
  PostgreSQL 16.4 y `api/` 18.3; nada de KR-2a toca Postgres, pero la regla vale para cualquier número
  que escribas en un comentario.
- **Commit al final de cada tarea**, en español, terminando con
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **`npm install` después de la tarea 1** (el workspace nuevo necesita el symlink en `node_modules`); si
  no, las tareas siguientes fallan con "Cannot find package 'contrato'" y no es un bug.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `contrato/package.json` | Declara el workspace. **Tiene que declarar `test` y `typecheck`** o el `--if-present` de la raíz lo saltea en silencio |
| `contrato/tsconfig.json` | Igual que los otros paquetes: ESM strict + `noUncheckedIndexedAccess` |
| `contrato/src/index.ts` | La superficie pública. Lo único que otros paquetes importan |
| `contrato/src/tipos.ts` | Los tipos del **contrato del brief**: `Market`, `SearchIntent`, `PageType`, `PageStrategy`, `PageEvidence`, `DataQuality`, `PageSeo`, `ContentBrief`, `ProposedPage`, `KeywordResearchBrief`, `CostBreakdown`, `SCHEMA_VERSION` |
| `contrato/src/dinero.ts` | `usdFromMicros`. Chico a propósito: lo usan el informe **y** los logs de `kr-service`, así que no puede vivir dentro de `informe.ts` |
| `contrato/src/esquema.ts` | `esquemaBase` → `emisionM2` / `consumoM1`, `SUPPORTED_SCHEMA_VERSIONS`, `parseBrief` |
| `contrato/src/fixtures.ts` | `briefM2()` y `briefM1()`. **No es un `.test.ts` a propósito:** importar un módulo de test desde otro test hace que `node:test` corra sus casos dos veces. Mismo patrón que `web-builder/src/fixtures.ts` |
| `contrato/src/esquema.test.ts` | Fixtures positivos y **negativos** de los dos derivados, y el test de inclusión |
| `contrato/src/informe.ts` | `renderReport` + el escapado de delimitadores |
| `contrato/src/informe.test.ts` | Datos incompletos (`n/d`, nunca `NaN`) e inyección estructural |
| `scripts/paquetes.test.mts` | **Nuevo.** Que todo workspace declare `test` y `typecheck` |

Lo que **NO** se mueve, y hay que resistir la tentación:

- `web-builder/src/contract.ts` conserva **`parseProfile` y todo el `businessProfileSchema`** (perfil de
  negocio, locales, carta, marca): es del M1, no del contrato del brief. Solo se va la parte del brief.
- `kr-service/src/types.ts` conserva los tipos **internos del pipeline**: `ScoringWeights`,
  `WEIGHTS_DEFAULT`, `KeywordResearchInput`, `Seed`, `MonthlyTrend`, `EnrichedKeyword`.
- `kr-service/src/lib/cost.ts` conserva el resto (tarifas por modelo, el medidor); solo se va
  `CostBreakdown` (tipo del contrato) y `usdFromMicros`.

---

### Tarea 1: El workspace existe, y no puede quedar fuera del verde

**Archivos:**
- Crear: `contrato/package.json`, `contrato/tsconfig.json`, `contrato/src/index.ts`
- Crear: `scripts/paquetes.test.mts`
- Modificar: `package.json` (raíz, array `workspaces`)
- Modificar: `scripts/verificar.sh` (los dos mensajes que dicen "6 paquetes", líneas ~120 y ~140)

**Interfaces:**
- Consume: nada.
- Produce: el workspace `contrato` resoluble por nombre desde los otros paquetes.

**Por qué esta tarea existe y no es scaffolding trivial:** `npm test` y `npm run typecheck` de la raíz
usan `--workspaces --if-present`. Un paquete que no declara esos scripts **se saltea en silencio** y el
arnés anuncia verde igual. Lo encontró la 14ª review. El test de esta tarea es la garantía de que el 7º
paquete —y el 8º— estén de verdad en el verde.

- [ ] **Paso 1: Escribir el test que falla**

Crear `scripts/paquetes.test.mts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * `npm test` y `npm run typecheck` de la raíz corren con `--workspaces --if-present`: un paquete que
 * NO declara esos scripts se saltea EN SILENCIO y el arnés informa verde igual. Este test es la única
 * cosa que impide que un workspace nuevo quede fuera de la verificación sin que nada avise.
 *
 * Lo pidió la 14ª review externa, que lo encontró como riesgo del paquete `contrato/`.
 */
const raiz = new URL("..", import.meta.url).pathname;
const workspaces = JSON.parse(readFileSync(join(raiz, "package.json"), "utf8")).workspaces as string[];

test("todo workspace declara `test` y `typecheck`", () => {
  assert.ok(workspaces.length > 0, "el package.json de la raíz no declara workspaces");
  for (const w of workspaces) {
    const pkg = JSON.parse(readFileSync(join(raiz, w, "package.json"), "utf8"));
    for (const script of ["test", "typecheck"]) {
      assert.ok(
        typeof pkg.scripts?.[script] === "string",
        `${w}/package.json no declara el script "${script}": ` +
          `--if-present lo saltearía y quedaría fuera del verde`,
      );
    }
  }
});

test("`contrato` está declarado como workspace", () => {
  assert.ok(
    workspaces.includes("contrato"),
    `el paquete compartido tiene que estar en workspaces; hoy: ${workspaces.join(", ")}`,
  );
});
```

- [ ] **Paso 2: Correr el test y verificar que falla**

Correr: `node --import tsx --test "scripts/paquetes.test.mts"`
Esperado: FALLA el segundo test — `el paquete compartido tiene que estar en workspaces; hoy: db, kr-service, web-builder, orchestrator, api, renderer`.

- [ ] **Paso 3: Crear el paquete**

`contrato/package.json`:

```json
{
  "name": "contrato",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "description": "Contrato compartido M2↔M1: tipos del brief, validación Zod (emisión y consumo) e informe legible.",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "node --import tsx --test \"src/**/*.test.ts\""
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.2",
    "typescript": "^5.6.3"
  }
}
```

`contrato/tsconfig.json` — copiar **textualmente** el de `web-builder/tsconfig.json` (mismas opciones
strict; no inventar flags). Verificar con `diff web-builder/tsconfig.json contrato/tsconfig.json` que la
única diferencia sea la ruta de salida si la hubiera.

`contrato/src/index.ts` (por ahora vacío de contenido real, solo para que el paquete resuelva):

```ts
// La superficie pública del contrato compartido. Lo que no se exporta acá, no existe para los demás
// paquetes: se importa por NOMBRE de paquete (`from "contrato"`), nunca por ruta relativa.
export {};
```

En `package.json` de la raíz, agregar `"contrato"` al array `workspaces`. **Va primero**, porque los
demás dependen de él y el orden del array documenta la dirección de las dependencias:

```json
  "workspaces": ["contrato", "db", "kr-service", "web-builder", "orchestrator", "api", "renderer"],
```

- [ ] **Paso 4: Correr `npm install` y el test**

Correr: `npm install && node --import tsx --test "scripts/paquetes.test.mts"`
Esperado: PASA. `npm install` crea el symlink en `node_modules/contrato` — sin eso, las tareas
siguientes fallan con "Cannot find package 'contrato'".

- [ ] **Paso 5: Derivar el conteo de paquetes en `verificar.sh`**

En `scripts/verificar.sh`, los mensajes de las líneas ~120 y ~140 dicen `(6 paquetes + scripts/)`
literalmente. **No cambiar el 6 por un 7** — eso vuelve a envejecer con el 8º. Derivarlo:

```bash
N_PAQUETES=$(node -e 'console.log(require("./package.json").workspaces.length)')
```

y usar `($N_PAQUETES paquetes + scripts/)` en los dos mensajes.

- [ ] **Paso 6: Verificar el conteo derivado**

Correr: `npm run verificar -- --rapido`
Esperado: dice **`(7 paquetes + scripts/)`**, no 6. Si sigue diciendo 6, el `$N_PAQUETES` no se está
expandiendo (comillas simples en bash no interpolan).

- [ ] **Paso 7: Comprobar que `env-sync` no se rompe con un paquete que no espera**

`scripts/env-sync.mts` reparte las claves de `docs/private/credenciales.env` a cada paquete, y ahora hay
uno más. `contrato/` **no usa credenciales** —solo `zod`—, así que no debería recibir nada; lo que hay que
descartar es que el script **falle** o cree un `.env` vacío al encontrar un workspace que no está en su
mapa.

⚠️ **NO corras `npm run env:sync`**: reescribe los `.env` reales y está en `permissions.deny`. Comprobalo
leyendo el script y sus tests:

Correr: `npm test -w scripts 2>/dev/null || node --import tsx --test "scripts/*.test.mts"`
Y **leer** `scripts/env-sync.mts` para confirmar que itera sobre **su propio mapa de paquetes** y no sobre
`workspaces` del `package.json`. Si itera sobre `workspaces`, hay que agregar `contrato` con un conjunto
de claves **vacío** y explicar por qué en un comentario.

Esperado: los tests de `scripts/` en verde y el reparto sin sorpresas. Anotá en el commit cuál de los dos
casos era.

- [ ] **Paso 8: Mutación — sacarle el script `test` al paquete nuevo**

Quitar la línea `"test": …` de `contrato/package.json` y correr
`node --import tsx --test "scripts/paquetes.test.mts"`.
Esperado: **FALLA** con `contrato/package.json no declara el script "test"`. Restaurar la línea.

Si NO falla, el test está leyendo otro archivo — arreglá el test antes de seguir.

- [ ] **Paso 9: Commit**

```bash
git add contrato/ scripts/paquetes.test.mts scripts/verificar.sh package.json package-lock.json
git commit -m "$(cat <<'EOF'
KR-2a: el 7º workspace, y el test de que no puede quedar fuera del verde

`npm test` y `npm run typecheck` de la raíz usan `--workspaces --if-present`:
un paquete que no declara esos scripts se saltea EN SILENCIO y el arnés
informa verde igual. Lo encontró la 14ª review como riesgo de `contrato/`.

`scripts/paquetes.test.mts` lo impide para todo workspace, presente y futuro.
Y el conteo que imprime `verificar.sh` se DERIVA de los workspaces en vez de
estar escrito a mano, así el 8º paquete no vuelve a requerir acordarse.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 2: Los tipos del contrato viven en `contrato/`

**Archivos:**
- Crear: `contrato/src/tipos.ts`, `contrato/src/dinero.ts`
- Modificar: `contrato/src/index.ts`
- Modificar: `kr-service/src/types.ts` (los del contrato pasan a re-export)
- Modificar: `kr-service/src/lib/cost.ts` (`CostBreakdown` y `usdFromMicros` pasan a re-export)
- Modificar: `kr-service/package.json` (agregar `"contrato": "*"` a `dependencies`)

**Interfaces:**
- Consume: el workspace `contrato` de la tarea 1.
- Produce: `import { SCHEMA_VERSION, usdFromMicros } from "contrato"` y
  `import type { KeywordResearchBrief, ProposedPage, DataQuality, CostBreakdown, Market, PageSeo, ContentBrief, SearchIntent, PageType, PageStrategy, PageEvidence } from "contrato"`.

**La decisión de esta tarea:** `kr-service/src/types.ts` **re-exporta** desde `contrato` en vez de que
se cambien los ~20 imports que lo usan. Un solo lugar cambia, el diff queda chico y revisable, y no hay
dos caminos vivos: el archivo viejo deja de **definir** y pasa a **reenviar**.

- [ ] **Paso 1: Escribir el test que falla**

Crear `contrato/src/tipos.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCHEMA_VERSION, usdFromMicros } from "./index.js";

test("SCHEMA_VERSION es la versión del contrato vigente", () => {
  assert.equal(SCHEMA_VERSION, "kr.v0.5");
});

test("usdFromMicros formatea micros a USD con 4 decimales", () => {
  // 309700 micros = $0.3097, el coste real de la corrida de la demo.
  assert.equal(usdFromMicros(309_700), "0.3097");
  assert.equal(usdFromMicros(0), "0.0000");
});
```

- [ ] **Paso 2: Correr el test y verificar que falla**

Correr: `npm test -w contrato`
Esperado: FALLA — `SCHEMA_VERSION` no se exporta de `./index.js`.

- [ ] **Paso 3: Mover los tipos y el formateo**

`contrato/src/tipos.ts` — mover **textualmente** desde `kr-service/src/types.ts`, **con sus comentarios**
(explican por qué cada campo es nullable, y esa historia no se puede perder): `SCHEMA_VERSION`, `Market`,
`SearchIntent`, `PageType`, `PageStrategy`, `PageEvidence`, `DataQuality`, `PageSeo`, `ContentBrief`,
`ProposedPage`, `KeywordResearchBrief`. Y desde `kr-service/src/lib/cost.ts`, la interfaz
`CostBreakdown`.

`contrato/src/dinero.ts`:

```ts
/**
 * Micros de USD → string con 4 decimales. El dinero viaja SIEMPRE en micros enteros (ADR-10): nunca
 * en coma flotante. Esta función es el único punto donde se convierte para mostrar.
 *
 * Vive en el contrato y no dentro de `informe.ts` porque tiene dos consumidores: el informe legible y
 * los logs de coste de `kr-service`.
 */
export function usdFromMicros(micros: number): string {
  return (micros / 1_000_000).toFixed(4);
}
```

`contrato/src/index.ts`:

```ts
// La superficie pública del contrato compartido. Lo que no se exporta acá, no existe para los demás
// paquetes: se importa por NOMBRE de paquete (`from "contrato"`), nunca por ruta relativa.
export { SCHEMA_VERSION } from "./tipos.js";
export type {
  Market,
  SearchIntent,
  PageType,
  PageStrategy,
  PageEvidence,
  DataQuality,
  PageSeo,
  ContentBrief,
  ProposedPage,
  KeywordResearchBrief,
  CostBreakdown,
} from "./tipos.js";
export { usdFromMicros } from "./dinero.js";
```

En `kr-service/src/types.ts`, reemplazar las definiciones movidas por un re-export, y **dejar escrito por
qué**:

```ts
/*
 * Los tipos del CONTRATO del brief viven en el paquete `contrato` (KR-2a): los comparten el M2 (que los
 * emite), el M1 (que los recibe) y la API (que renderiza el informe). Acá se re-exportan para no tocar
 * los ~20 imports que ya apuntaban a este archivo — pero este archivo ya NO los define.
 *
 * Lo que sigue viviendo acá es lo INTERNO del pipeline: pesos de scoring, la entrada del research y las
 * keywords enriquecidas. Nada de eso cruza la frontera del módulo.
 */
export { SCHEMA_VERSION } from "contrato";
export type {
  Market,
  SearchIntent,
  PageType,
  PageStrategy,
  PageEvidence,
  DataQuality,
  PageSeo,
  ContentBrief,
  ProposedPage,
  KeywordResearchBrief,
} from "contrato";
```

En `kr-service/src/lib/cost.ts`, lo mismo para `CostBreakdown` y `usdFromMicros`:

```ts
// El desglose de coste y su formateo son parte del contrato del brief (viajan en `meta_run`), así que
// viven en `contrato`. Acá se re-exportan porque los usan el medidor y los logs de este paquete.
export type { CostBreakdown } from "contrato";
export { usdFromMicros } from "contrato";
```

Agregar a `kr-service/package.json` → `dependencies`: `"contrato": "*"`.

- [ ] **Paso 4: Correr los tests y el typecheck**

Correr: `npm install && npm test -w contrato && npm run typecheck`
Esperado: los de `contrato` PASAN y el typecheck está limpio en los 7 paquetes. Si `kr-service` no
compila, es que quedó una definición duplicada (el mismo nombre exportado dos veces desde `types.ts`) —
borrá la vieja, no renombres.

- [ ] **Paso 5: Correr la suite entera**

Correr: `npm test`
Esperado: los **698** tests que había siguen pasando, más los de `contrato`. Ni uno menos: esta tarea no
cambia comportamiento, solo de dónde salen los tipos. Si cae alguno, **no lo edites** — el import quedó
apuntando a un tipo que ya no está donde estaba.

- [ ] **Paso 6: Commit**

```bash
git add contrato/ kr-service/ package-lock.json
git commit -m "$(cat <<'EOF'
KR-2a: los tipos del contrato del brief se mudan a `contrato`

Los comparten el M2 (que los emite), el M1 (que los recibe) y la API (que va a
renderizar el informe en KR-2b). `kr-service/src/types.ts` y `lib/cost.ts`
pasan a RE-EXPORTAR en vez de definir: un solo lugar cambia y los ~20 imports
que ya apuntaban ahí siguen funcionando.

Se movieron con sus comentarios, no solo con sus firmas: explican por qué
`volumen` y `dificultad` son nullable y por qué `evidencia` existe, y esa
historia es la mitad del valor del tipo.

Lo interno del pipeline (pesos de scoring, la entrada del research, las
keywords enriquecidas) se queda en kr-service: no cruza la frontera del módulo.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 3: `esquemaBase` y `emisionM2` (el validador estricto del M2)

**Archivos:**
- Crear: `contrato/src/esquema.ts`, `contrato/src/esquema.test.ts`
- Modificar: `contrato/src/index.ts`

**Interfaces:**
- Consume: los tipos de la tarea 2.
- Produce: `import { emisionM2, esquemaBase } from "contrato"` — `emisionM2` es un `z.ZodType` con
  `.safeParse()`.

`emisionM2` es el esquema de `kr-service/src/validation/brief.schema.ts` **tal cual**: exige `run_id`,
`generated_at`, `backlog` y `meta_run`, `url_slug` que empieza con `/`, `page_strategy`, `evidencia` y
`score_confidence` presentes, y los rangos (`dificultad` 0..100, `opportunity_score` 0..100).

- [ ] **Paso 1: Escribir los tests que fallan**

Crear **dos** archivos. Primero `contrato/src/fixtures.ts` — **no** dentro del test, porque importar un
módulo `.test.ts` desde otro test hace que `node:test` corra sus casos **dos veces**:

```ts
import type { KeywordResearchBrief } from "./index.js";

/** Brief válido de EMISIÓN (lo que el M2 produce hoy, kr.v0.5). Overridable por campo. */
export function briefM2(over: Partial<KeywordResearchBrief> = {}): KeywordResearchBrief {
  return {
    schema_version: "kr.v0.5",
    run_id: "11111111-1111-1111-1111-111111111111",
    cliente: "La Birra Bar",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    generated_at: "2026-07-30T12:00:00.000Z",
    status: "pending_approval",
    paginas_propuestas: [
      {
        cluster_id: "c1",
        tipo: "landing_local",
        page_strategy: "single",
        url_slug: "/hamburgueseria-madrid-centro",
        keyword_principal: "hamburgueseria madrid centro",
        keywords_secundarias: ["hamburguesa de autor madrid"],
        intencion: "local",
        local: true,
        volumen: 1200,
        dificultad: 25,
        evidencia: "datos_mercado",
        opportunity_score: 78,
        score_confidence: 0.9,
        seo: {
          meta_title: "Hamburguesería en Madrid Centro",
          meta_description: "Hamburguesas de autor en el centro de Madrid.",
          schema_type: "LocalBusiness",
          canonical: "/hamburgueseria-madrid-centro",
        },
        content_brief: {
          h1: "Hamburguesería en Madrid Centro",
          secciones_sugeridas: ["La carta", "Los locales"],
          word_count_objetivo: 1100,
          enlazado_interno: ["/menu"],
        },
        preguntas_frecuentes: ["¿Hacen reservas?"],
        approved: false,
      },
    ],
    backlog: [{ keyword_principal: "cerveza artesanal madrid", opportunity_score: 41 }],
    meta_run: {
      keywords_analizadas: 55,
      paginas_propuestas: 1,
      calidad_datos: { cobertura_volumen: 0.57, cobertura_kd: 0.31, endpoints_degradados: [] },
      coste_micros_usd: 309_700,
      coste_breakdown: {
        dataforseo_micros: 252_200,
        llm_generation_micros: 57_500,
        llm_embeddings_micros: 0,
      },
    },
    ...over,
  };
}
```

Y después `contrato/src/esquema.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { emisionM2 } from "./index.js";
import { briefM2 } from "./fixtures.js";

test("emisionM2 acepta el brief que el M2 produce hoy", () => {
  const r = emisionM2.safeParse(briefM2());
  assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
});

// --- Fixtures NEGATIVOS. Un validador se prueba con lo que tiene que RECHAZAR: un fixture positivo
// --- sigue pasando aunque el esquema se relaje, así que no prueba que la exigencia siga en pie.
// --- Lo señaló la 14ª review sobre la matriz de mutaciones de la spec.

test("emisionM2 RECHAZA un brief sin meta_run", () => {
  const { meta_run, ...sinMeta } = briefM2();
  assert.equal(emisionM2.safeParse(sinMeta).success, false);
});

test("emisionM2 RECHAZA un brief sin run_id ni generated_at", () => {
  const { run_id, generated_at, ...sinIds } = briefM2();
  assert.equal(emisionM2.safeParse(sinIds).success, false);
});

test("emisionM2 RECHAZA un url_slug que no empieza con /", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.url_slug = "hamburgueseria-madrid-centro";
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 RECHAZA una página sin evidencia", () => {
  const b = briefM2();
  // @ts-expect-error: se borra a propósito para probar que el esquema lo exige.
  delete b.paginas_propuestas[0]!.evidencia;
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 RECHAZA una dificultad fuera de 0..100", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.dificultad = 101;
  assert.equal(emisionM2.safeParse(b).success, false);
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Correr: `npm test -w contrato`
Esperado: FALLAN los seis — `emisionM2` no se exporta.

- [ ] **Paso 3: Escribir `esquema.ts`**

Copiar el contenido de `kr-service/src/validation/brief.schema.ts` a `contrato/src/esquema.ts`,
renombrando `briefSchema` → **`emisionM2`**, y extrayendo a `esquemaBase` las piezas que el consumo del
M1 va a reutilizar en la tarea 4 (`marketSchema`, `searchIntent`, los enums de tipo y de schema, y la
forma común de `seo` / `content_brief`). Exportar `esquemaBase` para que la tarea 4 derive de ahí.

Encabezar el archivo con el porqué de que haya dos:

```ts
/*
 * DOS validadores, UNA base. No son dos copias del mismo contrato: son dos contratos con propósitos
 * opuestos, y por eso NO se fusionan (lo confirmó la 14ª review).
 *
 *  · `emisionM2` valida LO QUE EL M2 PRODUCE: estricto, versión actual, todos los campos.
 *  · `consumoM1` valida LO QUE EL M1 PUEDE RECIBIR: laxo, cuatro `schema_version`, con `evidencia` y
 *    `score_confidence` opcionales para no rechazar briefs viejos que siguen siendo publicables.
 *
 * Fusionarlos obliga a que uno pierda su garantía: o el M1 deja de aceptar briefs históricos, o el M2
 * deja de exigir campos que hoy exige. Lo que se comparte es `esquemaBase` y los tipos.
 */
```

Agregar a `contrato/src/index.ts`: `export { emisionM2, esquemaBase } from "./esquema.js";`

- [ ] **Paso 4: Correr los tests**

Correr: `npm test -w contrato`
Esperado: los seis PASAN.

- [ ] **Paso 5: Mutación — relajar el `startsWith("/")`**

En `contrato/src/esquema.ts`, cambiar `url_slug: z.string().startsWith("/")` por `z.string().min(1)` y
correr `npm test -w contrato`.
Esperado: **FALLA** `emisionM2 RECHAZA un url_slug que no empieza con /`. Restaurar.

Esta es la mutación que importa: el fixture **positivo** habría seguido pasando, que es exactamente el
error que la 14ª review encontró en la matriz de la spec.

- [ ] **Paso 6: Commit**

```bash
git add contrato/
git commit -m "$(cat <<'EOF'
KR-2a: `emisionM2`, el validador estricto, con fixtures negativos

Es el esquema de kr-service tal cual, renombrado, más `esquemaBase` con las
piezas que el consumo del M1 reutiliza en la tarea siguiente.

Los cinco tests nuevos son NEGATIVOS a propósito: un fixture positivo sigue
pasando aunque el esquema se relaje, así que no prueba que la exigencia siga
en pie. La 14ª review encontró exactamente eso en la matriz de la spec
("relajar un campo" no era una mutación que cayera). La mutación que sí cae es
bajar el `startsWith("/")` del slug a `min(1)`.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 4: `consumoM1` y `parseBrief` (el validador laxo del M1)

**Archivos:**
- Modificar: `contrato/src/esquema.ts`, `contrato/src/esquema.test.ts`, `contrato/src/index.ts`

**Interfaces:**
- Consume: `esquemaBase` de la tarea 3.
- Produce: `import { consumoM1, parseBrief, SUPPORTED_SCHEMA_VERSIONS } from "contrato"`.
  `parseBrief(raw: unknown)` devuelve el brief tipado y **lanza** con mensaje claro si la forma o la
  versión no cuadran (misma firma que hoy en `web-builder/src/contract.ts`).

**La divergencia medida, campo por campo** (esto es lo que `consumoM1` tiene que preservar):

| Campo | `emisionM2` | `consumoM1` |
|---|---|---|
| `run_id`, `generated_at`, `backlog`, `meta_run` | exigidos | **ausentes** (el M1 no los consume) |
| `page_strategy` | exigido | **ausente** |
| `evidencia`, `score_confidence` | exigidos | **`.optional()`** |
| `url_slug` | `.startsWith("/")` | `.min(1)` |
| `volumen` | `.int().nonnegative().nullable()` | `.number().nullable()` |
| `dificultad` | `.min(0).max(100)` | sin rango |
| `opportunity_score` | `.min(0).max(100)` | sin rango |
| `schema_version` | libre (la fija el M2) | **una de cuatro**, verificada en `parseBrief` |

- [ ] **Paso 1: Escribir los tests que fallan**

En `contrato/src/fixtures.ts`, agregar:

```ts
/**
 * Brief válido de CONSUMO: la forma mínima que el M1 acepta. Es el `validBrief()` que vivía en
 * `web-builder/src/fixtures.ts`, y NO trae `run_id`, `generated_at`, `backlog`, `meta_run` ni
 * `page_strategy`. Que esto valide `consumoM1` y NO valide `emisionM2` es el diseño, no un fallo.
 *
 * No está tipado como `KeywordResearchBrief` a propósito: no lo es — le faltan campos obligatorios.
 */
export function briefM1(over: Record<string, unknown> = {}) {
  return {
    schema_version: "kr.v0.2",
    cliente: "restaurante italiano madrid centro",
    market: { country: "ES", language_code: "es", location_code: 2724 },
    status: "pending_approval",
    paginas_propuestas: [
      {
        cluster_id: "c1",
        tipo: "landing_local",
        url_slug: "/restaurante-italiano-madrid-centro",
        keyword_principal: "restaurante italiano madrid centro",
        keywords_secundarias: ["pizza napolitana madrid"],
        intencion: "local",
        local: true,
        volumen: 1200,
        dificultad: 25,
        opportunity_score: 78,
        seo: {
          meta_title: "Restaurante Italiano en Madrid Centro",
          meta_description: "Auténtica cocina italiana en el corazón de Madrid.",
          schema_type: "LocalBusiness",
          canonical: "/restaurante-italiano-madrid-centro",
        },
        content_brief: {
          h1: "Restaurante Italiano en Madrid Centro",
          secciones_sugeridas: ["Sobre Nosotros"],
          word_count_objetivo: 1100,
          enlazado_interno: ["/menu"],
        },
        preguntas_frecuentes: ["¿Tienen opciones sin gluten?"],
        approved: false,
      },
    ],
    ...over,
  };
}
```

Y en `contrato/src/esquema.test.ts`:

```ts
import { consumoM1, parseBrief, SUPPORTED_SCHEMA_VERSIONS } from "./index.js";
import { briefM1 } from "./fixtures.js";

test("consumoM1 acepta un brief kr.v0.2 sin meta_run ni evidencia", () => {
  const r = consumoM1.safeParse(briefM1());
  assert.equal(r.success, true, r.success ? "" : JSON.stringify(r.error.issues));
});

test("consumoM1 acepta las cuatro versiones soportadas", () => {
  assert.deepEqual([...SUPPORTED_SCHEMA_VERSIONS], ["kr.v0.2", "kr.v0.3", "kr.v0.4", "kr.v0.5"]);
  for (const v of SUPPORTED_SCHEMA_VERSIONS) {
    assert.doesNotThrow(() => parseBrief(briefM1({ schema_version: v })), `falló con ${v}`);
  }
});

test("parseBrief RECHAZA una schema_version fuera de las cuatro", () => {
  assert.throws(() => parseBrief(briefM1({ schema_version: "kr.v0.9" })), /no soportada/);
});

test("parseBrief RECHAZA un brief con la forma mal", () => {
  assert.throws(() => parseBrief({ schema_version: "kr.v0.5" }), /Brief inválido/);
});

test("consumoM1 CONSERVA evidencia y score_confidence cuando vienen", () => {
  // El bug histórico: no estaban en el esquema, así que Zod los DESCARTABA al parsear — el M2 los
  // calculaba y el M1 los tiraba. Son la señal de honestidad del research.
  const b = briefM1();
  (b.paginas_propuestas[0] as Record<string, unknown>).evidencia = "sin_validar";
  (b.paginas_propuestas[0] as Record<string, unknown>).score_confidence = 0.2;
  const r = consumoM1.safeParse(b);
  assert.equal(r.success, true);
  assert.equal(r.success && r.data.paginas_propuestas[0]?.evidencia, "sin_validar");
  assert.equal(r.success && r.data.paginas_propuestas[0]?.score_confidence, 0.2);
});
```

- [ ] **Paso 2: Correr los tests y verificar que fallan**

Correr: `npm test -w contrato`
Esperado: FALLAN los cinco nuevos — `consumoM1` no se exporta.

- [ ] **Paso 3: Escribir `consumoM1` y `parseBrief`**

En `contrato/src/esquema.ts`, agregar `consumoM1` derivado de `esquemaBase` con las relajaciones de la
tabla de arriba, `SUPPORTED_SCHEMA_VERSIONS`, y `parseBrief` con el `formatIssues` que hoy vive en
`web-builder/src/contract.ts` (moverlo tal cual, con sus mensajes: son los que un humano lee cuando un
brief no cuadra).

Exportar los tres desde `contrato/src/index.ts`.

- [ ] **Paso 4: Correr los tests**

Correr: `npm test -w contrato`
Esperado: los once (6 de la tarea 3 + 5 de esta) PASAN.

- [ ] **Paso 5: Dos mutaciones**

1. Quitar `.optional()` de `evidencia` en `consumoM1` → **FALLA** `consumoM1 acepta un brief kr.v0.2 sin
   meta_run ni evidencia`. Restaurar.
2. Sacar `"kr.v0.2"` de `SUPPORTED_SCHEMA_VERSIONS` → **FALLA** `consumoM1 acepta las cuatro versiones
   soportadas`. Restaurar.

- [ ] **Paso 6: Commit**

```bash
git add contrato/
git commit -m "$(cat <<'EOF'
KR-2a: `consumoM1`, el validador laxo, derivado de la misma base

El M1 acepta cuatro `schema_version` y hace `evidencia`/`score_confidence`
opcionales A PROPÓSITO: son briefs viejos que siguen siendo publicables. El M2
exige el brief completo de la versión actual. Los dos derivan de `esquemaBase`,
pero siguen siendo dos, porque emitir y recibir no son la misma operación.

`parseBrief` se movió con sus mensajes de error tal cual: son los que un humano
lee cuando un brief no cuadra, y reescribirlos habría perdido información que
ya estaba bien.

Un test fija el bug histórico que esto no puede volver a introducir: cuando
`evidencia` no estaba en el esquema, Zod la DESCARTABA al parsear — el M2 la
calculaba y el M1 la tiraba a la basura.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 5: El test de inclusión — lo que el M2 emite, el M1 lo acepta

**Archivos:**
- Modificar: `contrato/src/esquema.test.ts`

**Interfaces:**
- Consume: `emisionM2`, `consumoM1` y el fixture `briefM2()` de la tarea 3.
- Produce: nada nuevo — es la garantía que ata los dos derivados.

**Por qué es su propia tarea:** es la única cosa que impide que los dos esquemas **se separen en
silencio**. Sin ella, alguien puede endurecer `consumoM1` (o cambiar un enum en `emisionM2`) y romper el
handoff M2→M1 con toda la suite en verde. Reemplaza a la garantía que la spec pedía y que era
inalcanzable ("los fixtures de los dos lados pasan contra el esquema unificado").

- [ ] **Paso 1: Escribir el test que falla**

Agregar a `contrato/src/esquema.test.ts`:

```ts
test("todo brief que valide emisionM2 valida consumoM1 (emisionM2 ⊆ consumoM1)", () => {
  // La relación NO es simétrica, y eso es correcto: hay briefs kr.v0.2 que el M1 acepta y el M2 ya no
  // emite. Lo que no puede pasar es lo contrario — que el M2 emita algo que el M1 rechaza, porque ahí
  // el handoff se rompe en producción con toda la suite en verde.
  const casos = [
    briefM2(),
    briefM2({ paginas_propuestas: [] }),
    briefM2({ status: "approved" }),
  ];
  for (const brief of casos) {
    assert.equal(emisionM2.safeParse(brief).success, true, "el fixture ya no es válido para el M2");
    const r = consumoM1.safeParse(brief);
    assert.equal(
      r.success,
      true,
      `el M2 emite algo que el M1 rechaza: ${r.success ? "" : JSON.stringify(r.error.issues)}`,
    );
  }
});
```

- [ ] **Paso 2: Correr el test**

Correr: `npm test -w contrato`
Esperado: **PASA** ya, si las tareas 3 y 4 quedaron bien. Un test que pasa de entrada no es inútil acá:
lo que fija es una relación que **hoy se cumple** y que nada impedía romper. Su valor se demuestra con la
mutación del paso 3, no con un rojo previo.

- [ ] **Paso 3: Mutación — endurecer `consumoM1`**

Agregar a `consumoM1` un campo requerido que `emisionM2` no emita, p. ej.
`resumen_ejecutivo: z.string()` en el nivel raíz, y correr `npm test -w contrato`.
Esperado: **FALLA** `emisionM2 ⊆ consumoM1` con `el M2 emite algo que el M1 rechaza`. Restaurar.

Segunda mutación, más realista: en `emisionM2`, agregar `"institucional_v2"` al enum de `tipo` sin
agregarlo en `consumoM1` → **FALLA** igual, en cuanto un fixture lo use. Si no falla con los tres casos
actuales, agregá un cuarto caso al array que use el valor nuevo — y ahí está la lección: **el test de
inclusión solo cubre lo que sus fixtures ejercitan.**

- [ ] **Paso 4: Commit**

```bash
git add contrato/
git commit -m "$(cat <<'EOF'
KR-2a: el test de inclusión emisionM2 ⊆ consumoM1

Es lo único que impide que los dos validadores se separen en silencio: sin él,
endurecer `consumoM1` o agregar un valor de enum en `emisionM2` rompe el
handoff M2→M1 en producción con toda la suite en verde.

La relación no es simétrica a propósito: hay briefs kr.v0.2 que el M1 acepta y
el M2 ya no emite. Lo que no puede pasar es lo contrario.

Reemplaza al criterio que la spec pedía y que era inalcanzable —"los fixtures
de los dos lados pasan contra el esquema unificado"—, porque el fixture del M1
no trae run_id, generated_at, backlog ni meta_run.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 6: `DataQuality` admite "no sé"

**Archivos:**
- Modificar: `contrato/src/tipos.ts`, `contrato/src/esquema.ts`, `contrato/src/esquema.test.ts`

**Interfaces:**
- Consume: los tipos de la tarea 2 y los esquemas de las 3-4.
- Produce: `DataQuality` con `cobertura_volumen: number | null`, `cobertura_kd: number | null`,
  `endpoints_degradados: string[] | null`.

**Por qué:** hoy los tres son no-nullable, así que **el tipo obliga a poner un número que no se midió** —
y el seed de KR-2b no tiene esos datos (se perdieron con `out/brief.json`). Poner un número inventado es
peor que decir `n/d`. Es la misma corrección que la tanda 4 le hizo a `volumen` y `dificultad`, que quedó
sin aplicar acá.

Relajarlo es seguro y está medido: el único lector que los **interpreta** es `renderReport`; el
orquestador (`workflow.ts`, `deps.ts`) y el portal (`models.ts`) los pasan como
`Record<string, unknown>` opaco.

- [ ] **Paso 1: Escribir los tests que fallan**

Agregar a `contrato/src/esquema.test.ts`:

```ts
test("emisionM2 acepta coberturas null (no se sabe) y sigue exigiendo el campo", () => {
  const b = briefM2();
  b.meta_run.calidad_datos = {
    cobertura_volumen: null,
    cobertura_kd: null,
    endpoints_degradados: null,
  };
  assert.equal(emisionM2.safeParse(b).success, true);

  // Pero la CLAVE sigue siendo obligatoria: "no sé" es un valor, no una ausencia.
  // @ts-expect-error: se borra a propósito.
  delete b.meta_run.calidad_datos.cobertura_kd;
  assert.equal(emisionM2.safeParse(b).success, false);
});

test("emisionM2 sigue rechazando una cobertura fuera de 0..1", () => {
  const b = briefM2();
  b.meta_run.calidad_datos.cobertura_volumen = 1.5;
  assert.equal(emisionM2.safeParse(b).success, false);
});
```

- [ ] **Paso 2: Correr y verificar que falla**

Correr: `npm test -w contrato`
Esperado: FALLA el primero — hoy `cobertura_volumen: z.number().min(0).max(1)` no admite `null`.

- [ ] **Paso 3: Relajar el tipo y el esquema**

En `contrato/src/tipos.ts`:

```ts
export interface DataQuality {
  /**
   * Fracción de keywords con volumen conocido (0..1), o **`null` = no se sabe**.
   *
   * `null` no es lo mismo que `0`: `0` dice "ninguna keyword tenía volumen" —un dato— y `null` dice
   * "esta corrida no registró la cobertura". El seed de la demo cae en el segundo caso, porque el
   * dato se perdió con `out/brief.json`. Sin `null`, el tipo OBLIGA a inventar un número.
   */
  cobertura_volumen: number | null;
  /** Ídem para la dificultad (KD). */
  cobertura_kd: number | null;
  /**
   * Endpoints de pago que fallaron ENTEROS, o **`null` = no se sabe**.
   *
   * `[]` afirma "ninguno falló", que es una afirmación con contenido. `null` es la ausencia de dato.
   * Confundirlos fue el hallazgo de la 14ª review sobre el seed: trataba tres datos como desconocidos
   * y convertía este cuarto en certeza.
   */
  endpoints_degradados: string[] | null;
}
```

En `contrato/src/esquema.ts`, dentro de `calidad_datos`: `.nullable()` en los tres, **sin** `.optional()`
— la clave sigue siendo obligatoria.

- [ ] **Paso 4: Correr los tests y el typecheck**

Correr: `npm test -w contrato && npm run typecheck`
Esperado: los dos nuevos PASAN. El typecheck **puede fallar** en `kr-service/src/pipeline/run.ts` y en
`brief.ts` si alguna operación asume `number`: ahí es donde el tipo estaba mintiendo, y se arregla en la
tarea 7 (el informe) o con un guard en el pipeline. **No lo silencies con `!` ni con un cast.**

- [ ] **Paso 5: Correr la suite entera**

Correr: `npm test`
Esperado: verde. `run.ts:241` calcula las coberturas y siempre produce un número, así que el pipeline no
cambia de comportamiento; lo que cambió es que **ahora se puede expresar la ausencia**.

- [ ] **Paso 6: Mutación**

Quitar `.nullable()` de `cobertura_kd` en el esquema y correr `npm test -w contrato`.
Esperado: **FALLA** `emisionM2 acepta coberturas null`. Restaurar.

- [ ] **Paso 7: Commit**

```bash
git add contrato/ kr-service/
git commit -m "$(cat <<'EOF'
KR-2a: la calidad de los datos puede decir "no sé"

`cobertura_volumen`, `cobertura_kd` y `endpoints_degradados` eran no-nullable,
así que el TIPO obligaba a poner un número que nadie midió. Es la corrección
que la tanda 4 le hizo a `volumen` y `dificultad` y que quedó sin aplicar acá.

La distinción que esto habilita: `0` dice "ninguna keyword tenía volumen" —un
dato— y `null` dice "esta corrida no lo registró". Igual con `[]` contra `null`
en los endpoints degradados: `[]` afirma que ninguno falló. Confundirlos fue un
hallazgo de la 14ª review sobre el seed de la demo, que iba a sembrar `[]` sin
tener la evidencia.

La clave sigue siendo OBLIGATORIA: "no sé" es un valor, no una ausencia. Un
test lo fija.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 7: `renderReport` en `contrato/`, y sin un solo `NaN`

**Archivos:**
- Crear: `contrato/src/informe.ts`, `contrato/src/informe.test.ts`
- Modificar: `contrato/src/index.ts`
- Modificar: `kr-service/src/pipeline/brief.ts` (pierde `renderReport`, conserva `assembleBrief`)

**Interfaces:**
- Consume: los tipos de la tarea 2, `usdFromMicros`, `DataQuality` nullable de la tarea 6.
- Produce: `import { renderReport } from "contrato"` — `renderReport(brief: KeywordResearchBrief): string`.

**El bug que se arregla:** con `coste_breakdown: {}` (el default de la columna, y lo que el seed deja
hoy) las tres filas de la tabla de coste salen `$NaN`, y con `cobertura_kd` ausente sale `NaN%`. Hoy es
invisible porque el único llamador es el CLI, que siempre tiene el brief completo. En KR-2b el llamador
va a ser el seed, que no.

- [ ] **Paso 1: Escribir los tests que fallan**

Crear `contrato/src/informe.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderReport } from "./index.js";
import type { KeywordResearchBrief } from "./index.js";
// El mismo fixture de emisión, desde `fixtures.ts` y NO desde `esquema.test.ts`: importar un módulo de
// test haría que node:test corra sus casos dos veces.
import { briefM2 } from "./fixtures.js";

test("el informe nunca contiene NaN, con cualquier dato incompleto", () => {
  const b = briefM2();
  // El default de la columna `coste_breakdown` es '{}' y el seed de la demo no lo puebla.
  b.meta_run.coste_breakdown = {} as KeywordResearchBrief["meta_run"]["coste_breakdown"];
  b.meta_run.calidad_datos = {
    cobertura_volumen: null,
    cobertura_kd: null,
    endpoints_degradados: null,
  };

  const md = renderReport(b);
  assert.ok(!md.includes("NaN"), `el informe emitió NaN:\n${md}`);
  assert.ok(!md.includes("undefined"), `el informe emitió undefined:\n${md}`);
});

test("sin desglose, NO se pinta la tabla de desglose, y el total sigue estando", () => {
  const b = briefM2();
  b.meta_run.coste_breakdown = {} as KeywordResearchBrief["meta_run"]["coste_breakdown"];

  const md = renderReport(b);
  // Una tabla de tres `n/d` ocupa el lugar del argumento comercial sin decirlo, y parece un fallo del
  // sistema en vez de un dato que falta. El total SÍ es un dato: se muestra.
  assert.ok(!md.includes("| DataForSEO |"), "pintó el desglose sin tener los datos");
  assert.ok(md.includes("0.3097"), "perdió el total, que sí se conoce");
  assert.match(md, /desglose.*no.*registr/i, "no dijo que el desglose falta");
});

test("una cobertura null sale n/d, no 0% ni NaN%", () => {
  const b = briefM2();
  b.meta_run.calidad_datos.cobertura_kd = null;
  const md = renderReport(b);
  assert.match(md, /dificultad \(KD\).*\bn\/d\b/i);
  assert.ok(!md.includes("0%"), "un dato ausente se mostró como 0%");
});

test("endpoints_degradados null dice que no se sabe; [] no dice nada", () => {
  const sinSaber = briefM2();
  sinSaber.meta_run.calidad_datos.endpoints_degradados = null;
  assert.match(renderReport(sinSaber), /no.*se.*registr/i);

  const ninguno = briefM2();
  ninguno.meta_run.calidad_datos.endpoints_degradados = [];
  const md = renderReport(ninguno);
  assert.ok(!md.includes("🔴"), "avisó de un fallo que no hubo");
  assert.ok(!/no.*se.*registr/i.test(md), "dijo 'no se sabe' cuando sí se sabe: ninguno falló");
});

test("un backlog vacío no pinta la sección", () => {
  const md = renderReport(briefM2({ backlog: [] }));
  assert.ok(!md.includes("Backlog"), "pintó una sección vacía");
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

Correr: `npm test -w contrato`
Esperado: FALLAN — `renderReport` no se exporta de `contrato`.

- [ ] **Paso 3: Mover `renderReport` y endurecerlo**

Mover la función desde `kr-service/src/pipeline/brief.ts` a `contrato/src/informe.ts` **con todos sus
comentarios**, y aplicar tres cambios:

1. `metric()` ya devuelve `n/d` para `null`: dejarla igual y **usarla también** para las coberturas, con
   un `pct()` que admita `null`:

```ts
/** Porcentaje, o `n/d` si el dato no se conoce. `0%` sería una afirmación, y no la tenemos. */
function pct(n: number | null): string {
  return n === null ? "n/d" : `${Math.round(n * 100)}%`;
}
```

2. La tabla de desglose **solo se pinta si el desglose está completo**; si no, el total y una nota:

```ts
const c = brief.meta_run.coste_breakdown;
const desgloseCompleto =
  typeof c?.dataforseo_micros === "number" &&
  typeof c?.llm_generation_micros === "number" &&
  typeof c?.llm_embeddings_micros === "number";
```

3. `endpoints_degradados === null` emite una nota de "no se registró"; `[]` no emite nada.

En `kr-service/src/pipeline/brief.ts`, borrar `renderReport` y dejar `assembleBrief`. Los dos
importadores (`cli/spike.ts` y `pipeline/cluster-map.test.ts`) pasan a
`import { renderReport } from "contrato"`.

- [ ] **Paso 4: Correr los tests**

Correr: `npm test -w contrato && npm test -w kr-service`
Esperado: los cinco nuevos PASAN y los **146** de `kr-service` siguen verdes.

- [ ] **Paso 5: Tres mutaciones**

1. Volver `pct()` a `Math.round(n * 100)` sin el guard → **FALLA** `una cobertura null sale n/d`.
2. Pintar siempre la tabla de desglose (quitar el `if (desgloseCompleto)`) → **FALLA**
   `el informe nunca contiene NaN` **y** `sin desglose, NO se pinta la tabla`.
3. Tratar `null` como `[]` en `endpoints_degradados` → **FALLA**
   `endpoints_degradados null dice que no se sabe`.

- [ ] **Paso 6: Commit**

```bash
git add contrato/ kr-service/
git commit -m "$(cat <<'EOF'
KR-2a: `renderReport` se muda a `contrato`, y deja de emitir NaN

Con `coste_breakdown: {}` —el default de la columna, y lo que el seed de la
demo deja— las tres filas de la tabla de coste salían `$NaN`, y con la
cobertura ausente salía `NaN%`. Hoy era invisible porque el único llamador es
el CLI, que siempre tiene el brief completo; en KR-2b el llamador va a ser el
seed, que no.

Y una decisión de forma, no solo de valor: sin desglose NO se pinta la tabla
de desglose. Una tabla de tres `n/d` ocupa el lugar del argumento comercial
(81% DataForSEO / 19% LLM) sin decirlo, y parece un fallo del sistema en vez de
un dato que falta. El total sí se conoce, así que se muestra.

`endpoints_degradados: null` dice que no se registró; `[]` no dice nada,
porque afirma que ninguno falló.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 8: El informe escapa los delimitadores de Markdown

**Archivos:**
- Modificar: `contrato/src/informe.ts`, `contrato/src/informe.test.ts`

**Interfaces:**
- Consume: `renderReport` de la tarea 7.
- Produce: nada nuevo en la superficie — `renderReport` deja de producir Markdown mal formado.

**El bug, que YA EXISTE hoy** en el `out/informe.md` del CLI: `renderReport` interpola texto de LLM sin
escapar delimitadores. Una keyword con `|` agrega columnas; un `h1` con `\n##` inventa un encabezado; un
slug con backticks abre un bloque de código. No ejecuta nada —el parser del portal escapa el HTML— pero
**altera el significado del entregable** y puede simular u ocultar los avisos de evidencia ⚠️, que son
el argumento de venta. KR-2 no lo introduce: lo hace visible en una pantalla.

- [ ] **Paso 1: Escribir los tests que fallan**

Agregar a `contrato/src/informe.test.ts`:

```ts
/** Cuenta las columnas de una fila de tabla Markdown (los `|` de los extremos no cuentan). */
function columnas(fila: string): number {
  return fila.trim().replace(/^\||\|$/g, "").split("|").length;
}

test("un | en una keyword no agrega columnas a la tabla", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.keyword_principal = "hamburguesa | madrid";

  const md = renderReport(b);
  const filas = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("|---"));
  const anchos = new Set(filas.map(columnas));
  assert.equal(anchos.size, 1, `filas con distinto número de columnas: ${[...anchos].join(", ")}`);
});

test("un salto de línea en un h1 no inventa un encabezado", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.content_brief.h1 = "Hamburguesería\n## Sección falsa";

  const md = renderReport(b);
  assert.ok(!/^## Sección falsa/m.test(md), "el dato se convirtió en estructura del documento");
});

test("backticks en un slug no abren un bloque de código", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.url_slug = "/pizza```madrid";

  const md = renderReport(b);
  // Un número impar de ``` deja el resto del documento dentro de un bloque de código.
  const cercas = (md.match(/```/g) ?? []).length;
  assert.equal(cercas % 2, 0, "quedó una cerca de código sin cerrar");
});

test("el escapado no destruye el texto legible", () => {
  const b = briefM2();
  b.paginas_propuestas[0]!.keyword_principal = "hamburguesa | madrid";
  const md = renderReport(b);
  // Escapar no es borrar: la keyword tiene que seguir siendo legible para un humano.
  assert.match(md, /hamburguesa .* madrid/);
});
```

- [ ] **Paso 2: Correr y verificar que fallan**

Correr: `npm test -w contrato`
Esperado: FALLAN al menos los tres primeros. **Anotá cuál falla y con qué mensaje** — si alguno pasa ya,
averiguá por qué antes de escribir el arreglo (puede que el dato no llegue a donde creés).

- [ ] **Paso 3: Escribir el escapado**

En `contrato/src/informe.ts`:

```ts
/*
 * ESCAPADO. Todo lo que se interpola en el informe es texto generado por un LLM (h1, meta title y
 * description, slug, keywords, secciones, FAQs), así que es un dato que NO puede convertirse en
 * estructura del documento.
 *
 * No ejecuta nada —el parser del portal escapa el HTML y Angular no interpola markup— pero cambia el
 * SIGNIFICADO: una keyword con `|` desalinea la tabla de ahí para abajo, un `\n##` inventa una
 * sección, y una cerca de código sin cerrar se come el resto del informe. Con eso se puede ocultar o
 * simular un aviso ⚠️ de evidencia, que es justamente el argumento de venta del entregable.
 *
 * Lo encontró la 14ª review externa, y el bug ya existía en el informe del CLI.
 */

/** Texto que va en una CELDA de tabla: además del escapado, la celda no puede tener saltos. */
function celda(v: string): string {
  return texto(v).replace(/\s*\n+\s*/g, " ");
}

/** Texto que va en cualquier otra parte del informe. */
function texto(v: string): string {
  return String(v)
    .replace(/\\/g, "\\\\") // primero la barra, o se escapan las barras que agregamos abajo
    .replace(/([|`*_#\[\]<>])/g, "\\$1")
    // Un salto seguido de `#`, `-` o `>` en columna 0 inventa estructura: se le quita la columna 0.
    .replace(/\n(?=[#\->])/g, "\n ");
}
```

Aplicarlas en **todos** los puntos de interpolación de dato: las celdas de las dos tablas de páginas
(`tipo`, `keyword_principal`, `intencion`), y en el detalle por página el `h1`, `url_slug`, `tipo`,
`schema_type`, `meta_title`, `meta_description`, `keyword_principal`, `keywords_secundarias`,
`secciones_sugeridas`, `preguntas_frecuentes` y `claims_prohibidos`. También `brief.cliente`,
`brief.market.*` y el `keyword_principal` del backlog.

**No escapar** lo que genera el propio informe (los `**`, los `|` de la estructura, los `###`): el
escapado va sobre el **dato**, no sobre la plantilla.

- [ ] **Paso 4: Correr los tests**

Correr: `npm test -w contrato`
Esperado: los cuatro PASAN, y los cinco de la tarea 7 siguen verdes.

- [ ] **Paso 5: Correr la suite entera**

Correr: `npm test`
Esperado: verde. Ojo con `kr-service/src/pipeline/cluster-map.test.ts`, que llama a `renderReport` y
puede afirmar sobre el texto exacto: si cae, **verificá si su aserción era sobre un dato con caracteres
especiales**; si el dato es limpio, el escapado no lo toca y el fallo es un bug del escapado.

- [ ] **Paso 6: Mutación**

Quitar el ``.replace(/([|`*_#\[\]<>])/g, "\\$1")`` de `texto()` y correr `npm test -w contrato`.
Esperado: **FALLA** `un | en una keyword no agrega columnas`. Restaurar.

Segunda mutación: quitar el colapso de saltos en `celda()` → **FALLA** el mismo test o el del `h1`,
según dónde caiga el dato. Averiguá cuál antes de restaurar: dice qué punto de interpolación cubre cada
test.

- [ ] **Paso 7: Commit**

```bash
git add contrato/
git commit -m "$(cat <<'EOF'
KR-2a: el informe escapa los delimitadores, y el dato deja de ser estructura

`renderReport` interpolaba texto de LLM sin escapar: una keyword con `|`
agregaba columnas y desalineaba la tabla de ahí para abajo, un `h1` con `\n##`
inventaba una sección, y un slug con backticks abría un bloque de código que se
comía el resto del documento.

No ejecuta nada —el parser del portal escapa el HTML— pero cambia el
SIGNIFICADO del entregable, y con eso se puede ocultar o simular un aviso de
evidencia, que es el argumento de venta.

El bug ya existía en el `out/informe.md` del CLI: KR-2 no lo introduce, lo hace
visible en una pantalla. Lo encontró la 14ª review.

El escapado va sobre el DATO, nunca sobre la plantilla: los `**` y los `|` que
el propio informe genera se quedan como están.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Tarea 9: `web-builder` consume el contrato, y no quedan dos fuentes de verdad

**Archivos:**
- Modificar: `web-builder/src/contract.ts` (pierde la parte del brief, **conserva** `parseProfile` y todo
  el `businessProfileSchema`)
- Modificar: `web-builder/src/types.ts` (`KrBrief`/`KrProposedPage` pasan a alias del contrato)
- Modificar: `web-builder/src/fixtures.ts` (`validBrief`/`validPage` quedan, pero tipados del contrato)
- Modificar: `web-builder/package.json` (agregar `"contrato": "*"`)
- Borrar: `kr-service/src/validation/brief.schema.ts`
- Modificar: `kr-service/src/cli/spike.ts` y `kr-service/src/pipeline/cluster-map.test.ts` (importan
  `emisionM2` de `contrato`)
- Crear: `contrato/src/una-sola-fuente.test.ts`

**Interfaces:**
- Consume: todo lo anterior.
- Produce: la deuda cerrada — ningún paquete define el contrato del brief por su cuenta.

- [ ] **Paso 1: Escribir el test que falla**

Crear `contrato/src/una-sola-fuente.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/*
 * La deuda que KR-2a cierra: el contrato del brief vivía en DOS archivos copiados a mano
 * (`kr-service/src/validation/brief.schema.ts` y la mitad de `web-builder/src/contract.ts`), así que
 * cambiar uno dejaba el otro mintiendo sin que nada avisara.
 *
 * Este test DESCUBRE los archivos en vez de listarlos, así que también cubre el paquete que alguien
 * agregue mañana. Es el mismo patrón que usa el portal para los colores incrustados.
 */
const raiz = new URL("../..", import.meta.url).pathname;
const PAQUETES = ["kr-service", "web-builder", "orchestrator", "api", "renderer", "db"];

function ts(dir: string): string[] {
  const salida: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) salida.push(...ts(p));
    else if (e.endsWith(".ts")) salida.push(p);
  }
  return salida;
}

test("ningún paquete define su propio esquema Zod del brief", () => {
  const culpables: string[] = [];
  for (const paq of PAQUETES) {
    for (const archivo of ts(join(raiz, paq, "src"))) {
      const src = readFileSync(archivo, "utf8");
      // La firma de un esquema de brief propio: un z.object con `paginas_propuestas` adentro.
      if (/z\s*\.\s*object\s*\(/.test(src) && /paginas_propuestas\s*:/.test(src)) {
        culpables.push(archivo.slice(raiz.length));
      }
    }
  }
  assert.deepEqual(
    culpables,
    [],
    `el contrato del brief se define fuera de \`contrato\`:\n  ${culpables.join("\n  ")}`,
  );
});
```

- [ ] **Paso 2: Correr y verificar que falla**

Correr: `npm test -w contrato`
Esperado: FALLA listando `kr-service/src/validation/brief.schema.ts` y `web-builder/src/contract.ts`.

- [ ] **Paso 3: Migrar `web-builder` y borrar el archivo viejo de `kr-service`**

En `web-builder/src/contract.ts`: borrar `proposedPageSchema`, `briefSchema`,
`SUPPORTED_SCHEMA_VERSIONS` y `parseBrief`, y re-exportar `parseBrief` desde `contrato`. **Dejar intacto**
todo el bloque de perfil (`postalAddressSchema`, `locationSchema`, `menuItemSchema`, `brandSchema`,
`businessProfileSchema`, `parseProfile`, `MAX_LOCALES`, `MAX_ITEMS_CARTA`) y su `formatIssues`: es del
M1, no del contrato del brief, y sus comentarios sobre inyección de CSS son de ADR-19.

Reemplazar el `TODO (Fase 2)` del encabezado por lo que quedó hecho:

```ts
/*
 * El contrato del brief vive en el paquete `contrato` desde KR-2a: el M1 valida con `parseBrief`, que
 * usa el derivado LAXO (`consumoM1`) — cuatro `schema_version`, `evidencia` y `score_confidence`
 * opcionales. Esa laxitud es deliberada: acepta briefs viejos que siguen siendo publicables.
 *
 * Lo que sigue acá es el perfil de negocio, que NO es parte del contrato del brief.
 */
```

En `web-builder/src/types.ts`, `KrBrief` y `KrProposedPage` pasan a alias:

```ts
// El M1 consume un SUBCONJUNTO del brief del M2. Los nombres `Kr*` se conservan porque los usan ~15
// archivos de este paquete, pero ya no son una definición paralela: son el tipo del contrato.
export type { KeywordResearchBrief as KrBrief, ProposedPage as KrProposedPage } from "contrato";
```

Agregar `"contrato": "*"` a `web-builder/package.json`.

Borrar `kr-service/src/validation/brief.schema.ts` y apuntar sus dos importadores a
`import { emisionM2 } from "contrato"` (renombrando el uso de `briefSchema` a `emisionM2`).

- [ ] **Paso 4: Correr todo**

Correr: `npm install && npm run verificar`
Esperado: **todo verde**, con el mensaje diciendo `(7 paquetes + scripts/)`. Los **96** tests de
`web-builder` pasan **sin editarse** — si alguno hay que editarlo, no es un ajuste: es una divergencia
que la tabla de la tarea 4 no capturó, y hay que decidir explícitamente qué lado tenía razón antes de
tocar el test.

- [ ] **Paso 5: Mutación**

Volver a crear un `z.object({ paginas_propuestas: z.array(z.any()) })` en cualquier archivo de
`web-builder/src/` y correr `npm test -w contrato`.
Esperado: **FALLA** `ningún paquete define su propio esquema Zod del brief`, nombrando el archivo.
Borrarlo.

- [ ] **Paso 6: Commit**

```bash
git add contrato/ kr-service/ web-builder/ package-lock.json
git commit -m "$(cat <<'EOF'
KR-2a: cerrada la deuda de las dos fuentes de verdad del contrato

`kr-service/src/validation/brief.schema.ts` se borra y la mitad-brief de
`web-builder/src/contract.ts` pasa a re-exportar. Los ~15 archivos que usaban
`KrBrief`/`KrProposedPage` no cambian: los nombres se conservan como alias del
tipo del contrato.

Lo que NO se movió, y no es un olvido: `parseProfile` y todo el
`businessProfileSchema` se quedan en web-builder. El perfil de negocio no es
parte del contrato del brief, y sus validaciones de color/font/logo son
defensa de inyección de ADR-19.

Y la deuda no se cierra con una promesa: `una-sola-fuente.test.ts` recorre los
seis paquetes buscando un `z.object` con `paginas_propuestas` adentro y falla
nombrando el archivo. Descubre en vez de listar, así que también cubre el
paquete que alguien agregue mañana.

Los 96 tests de web-builder pasan sin editarse, que era el criterio.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Cierre de KR-2a

- [ ] **`npm run verificar` en verde**, con el output a la vista y el conteo diciendo **7 paquetes**.
- [ ] **Los 698 tests que había siguen pasando**, más los nuevos de `contrato`. Ni uno menos: KR-2a no
      cambia comportamiento salvo los arreglos de las tareas 6-8.
- [ ] **Los tests de `kr-service` (146) y `web-builder` (96) pasan sin editarse.** Si hubo que editar
      alguno, escribí en el commit **qué divergencia** apareció y qué lado tenía razón.
- [ ] **Actualizar la documentación** (ritual de `AGENTS.md`, paso 3):
      `docs/proyecto/09-estado-y-roadmap.md` (KR-2a cerrado, la deuda del Zod duplicado cerrada, el
      conteo de paquetes 6 → 7 y las cifras de tests), `docs/proyecto/11-plan-fase-2.md`,
      `docs/proyecto/08-testing-calidad.md` (los tests nuevos por paquete) y `progress/current.md` +
      `progress/history.md`.
- [ ] **No hay navegador que manejar**: KR-2a no toca el portal ni el renderizador. Esa parte del ritual
      corresponde a KR-2b.
- [ ] **Commit + push a `main`.**

**Lo que queda explícitamente afuera de KR-2a**, y es KR-2b: la migración `0016` con sus grants,
`guardarInforme`, el step del orquestador, los dos endpoints, la pantalla, el parser de Markdown del
portal y el seed. El plan de KR-2b se escribe **cuando KR-2a esté cerrado**, con las firmas reales del
paquete a la vista en vez de inventadas.

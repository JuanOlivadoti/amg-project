// El informe legible (Markdown) del brief — el entregable humano de la compuerta de aprobación
// (ADR-07).
//
// Vivía en `kr-service/src/pipeline/brief.ts`, junto a `assembleBrief()`. Se mudó acá (KR-2a) porque
// tiene más de un llamador: hoy el CLI (`out/informe.md`), y en KR-2b el seed de la demo, que lee el
// brief de Postgres. Duplicar el render habría duplicado el criterio de qué se le dice al cliente
// cuando falta un dato, y esa es justo la parte que no puede tener dos versiones.
import { usdFromMicros } from "./dinero.js";
import type { KeywordResearchBrief, ProposedPage } from "./tipos.js";

/**
 * Métrica ausente → "n/d", nunca "0". El informe es el entregable que ve el cliente: mostrar 0
 * donde no hay dato equivale a afirmar que la keyword no tiene búsquedas, que es falso.
 */
function metric(v: number | null): string {
  return v === null ? "n/d" : String(v);
}

/**
 * Porcentaje, o `n/d` si el dato no se conoce. `0%` sería una afirmación, y no la tenemos.
 *
 * Las coberturas son `number | null` desde KR-2a: `null` = esta corrida no las registró, que NO es
 * 0%. Mismo criterio que `metric()` unas líneas arriba y por el mismo motivo — el informe es el
 * entregable que ve el cliente, y un 0% inventado le afirma que no hay demanda.
 */
function pct(n: number | null): string {
  return n === null ? "n/d" : `${Math.round(n * 100)}%`;
}

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

/**
 * **Para quién es el documento.** No qué bloques lleva: eso se deriva de acá.
 *
 * Era `{ incluirCoste: boolean }`, un flag. Con un solo bloque condicional daba igual; en cuanto
 * apareció el segundo (la línea de metadatos del pipeline) quedaron **cuatro combinaciones de las
 * que solo dos significan algo**, y nada impedía pedir la tercera. Un llamador no tiene por qué
 * saber qué bloques distinguen a los dos documentos — tiene que saber a quién se lo manda.
 *
 * Es la división que ADR-20 ya nombra, y ahora el tipo la nombra igual.
 */
export type Audiencia = "agencia" | "restaurante";

/** Qué documento se está produciendo. Ver {@link renderReport}. */
export interface OpcionesInforme {
  /**
   * Quién lo va a leer. **Sin default, a propósito** (ver {@link renderReport}).
   *
   * - `"agencia"` — el informe **interno**. Lleva el bloque «Coste del research» —ante Frank es el
   *   argumento de venta, "te costó $0.31"— y la línea de mercado/idioma/timestamp, que identifica
   *   la corrida cuando hay varias del mismo cliente.
   * - `"restaurante"` — el **entregable**. Ninguna de las dos cosas: el margen de la agencia no es
   *   suyo, y el `2026-08-07T18:35:27.490Z` de un pipeline delante de un dueño de restaurante es
   *   ruido con aspecto de error.
   */
  readonly audiencia: Audiencia;
}

/**
 * Informe legible (Markdown) — el entregable humano de la compuerta (ADR-07).
 *
 * ## Por qué `opciones` es obligatorio y no tiene default
 *
 * Porque las dos respuestas son correctas para documentos distintos, y ninguna es "la normal". Un
 * default `"agencia"` haría que quien lo olvide **filtre el margen** al restaurante; uno
 * `"restaurante"` haría que el informe interno pierda en silencio su argumento comercial. Sin
 * default, cada llamada declara qué documento está produciendo y `tsc` no deja pasar la duda.
 *
 * Es la misma forma que `PIPELINE_MODO` en el orquestador: cuando la opción segura y la opción útil
 * son distintas, no hay default correcto — hay una decisión que alguien tiene que escribir.
 *
 * ## Y por qué es una AUDIENCIA y ya no una lista de flags
 *
 * `{ incluirCoste: boolean }` funcionaba mientras el coste fuera lo único que separaba los dos
 * documentos. Al aparecer el segundo bloque condicional —la línea de metadatos— habría hecho falta
 * un `{ incluirCoste, incluirMetadatos }`: **cuatro combinaciones de las que dos no significan
 * nada**, y ningún tipo impidiendo pedirlas. Peor, la decisión de qué bloque va en qué documento se
 * habría repartido entre todos los sitios de llamada en vez de vivir acá.
 *
 * Con la audiencia, agregar un tercer bloque condicional se hace **en un solo sitio** y ningún
 * llamador se entera.
 *
 * Son **4 llamadas de producción** —el CLI (`kr-service/src/cli/spike.ts`), el seed
 * (`db/src/seed-demo.ts`), el workflow (`orchestrator/src/workflow.ts`) y el entregable
 * (`api/src/app.ts`)— más ~24 en tests. **Contado, no estimado**: el plan decía "6 (3 de producción,
 * 3 de test)" y las dos cifras estaban mal; migrarlo destapó dos paquetes que ni figuraban.
 */
export function renderReport(brief: KeywordResearchBrief, opciones: OpcionesInforme): string {
  const paraLaAgencia = opciones.audiencia === "agencia";

  const l: string[] = [];
  l.push(`# Keyword Research — ${texto(brief.cliente)}`);
  /*
   * La línea de mercado · idioma · timestamp: **solo para la agencia**.
   *
   * En el entregable salía `_ES · es · 2026-08-07T18:35:27.490Z_` bajo el título, y ahí es metadato
   * de pipeline delante de un dueño de restaurante. La decisión (Juan, 2026-08-07) fue **quitar la
   * línea, no formatearla**: formatear la fecha dejaría bonito un dato que en ese documento no va,
   * mientras que en el informe interno los tres sirven —identifican mercado y momento cuando hay
   * varios runs del mismo cliente.
   *
   * El documento no se queda sin fecha: la lleva el encabezado que ya pinta el portal, con las dos
   * fechas y su aviso (KR-2b).
   */
  if (paraLaAgencia) {
    l.push(
      `\n_${texto(brief.market.country)} · ${texto(brief.market.language_code)} · ${brief.generated_at}_\n`,
    );
  }
  l.push(`- Keywords analizadas: **${brief.meta_run.keywords_analizadas}**`);
  l.push(`- Páginas propuestas: **${brief.meta_run.paginas_propuestas}**`);

  // El coste vive en su propia función porque la exclusión es un bloque que NO SE GENERA, no unas
  // líneas que alguien tacha después. Si se filtrara sobre el texto ya renderizado, la frontera
  // dependería de un `split` sobre Markdown — y el margen de la agencia no puede depender de que un
  // encabezado no cambie de nombre.
  if (paraLaAgencia) l.push(...bloqueDeCoste(brief));

  // Calidad de los datos del run. Va ARRIBA de las páginas a propósito: quien aprueba tiene que
  // saber sobre qué base está aprobando ANTES de mirar la lista.
  const q = brief.meta_run.calidad_datos;
  l.push(`### Calidad de los datos\n`);
  l.push(`| Métrica | Cobertura |`);
  l.push(`|---|---|`);
  l.push(`| Keywords con **volumen** conocido | **${pct(q.cobertura_volumen)}** |`);
  l.push(`| Keywords con **dificultad (KD)** conocida | **${pct(q.cobertura_kd)}** |`);
  // Los tres estados de `endpoints_degradados` dicen tres cosas distintas, y el informe tiene que
  // distinguirlos: `null` = no se registró si alguno falló (no se puede avisar de un fallo que no se
  // conoce, ni negarlo); `[]` = ninguno falló, una afirmación con contenido, que no necesita nota;
  // una lista = falló eso y las métricas que faltan NO son ceros.
  if (q.endpoints_degradados === null) {
    l.push(
      `\n> ⚠️ **No se registró** si algún endpoint de datos falló durante esta corrida. Que no haya ` +
        `fallos anotados no es lo mismo que no haber tenido ninguno.`,
    );
  } else if (q.endpoints_degradados.length) {
    l.push(
      `\n> 🔴 **Datos incompletos:** falló el endpoint \`${q.endpoints_degradados.join("`, `")}\`. ` +
        `Las métricas que faltan **no son ceros**: no se pudieron obtener.`,
    );
  }
  l.push("");

  // Las páginas se separan por EVIDENCIA, no solo por score. Mezclarlas en una sola tabla hacía
  // indistinguible una página respaldada por 480 búsquedas/mes de una apuesta sin ningún dato.
  const conDatos = brief.paginas_propuestas.filter((p) => p.evidencia === "datos_mercado");
  const sinValidar = brief.paginas_propuestas.filter((p) => p.evidencia === "sin_validar");

  const tabla = (pages: ProposedPage[], offset: number) => {
    l.push(`| # | Tipo | Keyword principal | Vol. | KD | Score | Conf. | Intención |`);
    l.push(`|---|---|---|---|---|---|---|---|`);
    pages.forEach((p, i) => {
      l.push(
        `| ${offset + i + 1} | ${celda(p.tipo)} | ${celda(p.keyword_principal)} | ${metric(p.volumen)} | ${metric(p.dificultad)} | ` +
          `${p.opportunity_score} | ${p.score_confidence} | ${celda(p.intencion)}${p.local ? " (local)" : ""} |`,
      );
    });
  };

  l.push(`## Páginas propuestas\n`);

  if (conDatos.length) {
    l.push(`### ✅ Respaldadas por datos de mercado (${conDatos.length})\n`);
    l.push(`Hay demanda de búsqueda **demostrable** detrás de estas páginas.\n`);
    tabla(conDatos, 0);
    l.push("");
  }

  if (sinValidar.length) {
    l.push(`### ⚠️ Sin validar (${sinValidar.length})\n`);
    l.push(
      `**Ninguna keyword de estos grupos tiene volumen de búsqueda conocido.** Suelen ser servicios ` +
        `reales que el negocio ofrece, y por eso la página puede tener sentido igual — pero **no hay ` +
        `evidencia de que alguien los busque**, así que no se pueden vender como oportunidad SEO.\n`,
    );
    tabla(sinValidar, conDatos.length);
    l.push("");
  }

  if (brief.paginas_propuestas.some((p) => p.volumen === null || p.dificultad === null)) {
    l.push(
      `> **n/d** = el proveedor de datos no devolvió la métrica para esa keyword. ` +
        `**No es un 0**: es un dato que no tenemos, y por eso esas páginas van con la confianza baja.`,
    );
  }

  l.push(`\n## Detalle por página\n`);
  brief.paginas_propuestas.forEach((p, i) => {
    l.push(`### ${i + 1}. ${texto(p.content_brief.h1)}`);
    l.push(
      `- **Slug:** \`${texto(p.url_slug)}\` · **Tipo:** ${texto(p.tipo)} · **Schema:** ${texto(p.seo.schema_type)}`,
    );
    l.push(`- **Meta title:** ${texto(p.seo.meta_title)}`);
    l.push(`- **Meta description:** ${texto(p.seo.meta_description)}`);
    l.push(
      `- **Keyword principal:** ${texto(p.keyword_principal)} (vol ${metric(p.volumen)} · KD ${metric(p.dificultad)})`,
    );
    if (p.keywords_secundarias.length)
      l.push(`- **Secundarias:** ${p.keywords_secundarias.map((v) => texto(v)).join(", ")}`);
    if (p.content_brief.secciones_sugeridas.length)
      l.push(`- **Secciones:** ${p.content_brief.secciones_sugeridas.map((v) => texto(v)).join(" · ")}`);
    if (p.preguntas_frecuentes.length)
      l.push(`- **FAQs:** ${p.preguntas_frecuentes.map((q) => `_${texto(q)}_`).join(" · ")}`);
    if (p.content_brief.claims_prohibidos?.length)
      l.push(`- ⚠️ **Claims prohibidos:** ${p.content_brief.claims_prohibidos.map((v) => texto(v)).join(", ")}`);
    l.push("");
  });

  if (brief.backlog.length) {
    l.push(`## Backlog (fases futuras)\n`);
    for (const b of brief.backlog)
      l.push(`- ${texto(b.keyword_principal)} — score ${b.opportunity_score}`);
  }
  return l.join("\n") + "\n";
}

/**
 * El bloque «Coste del research» — **el margen de la agencia**.
 *
 * Solo lo lleva el informe interno (`audiencia: "agencia"`). El entregable del restaurante se genera
 * sin él, y "sin él" quiere decir que estas líneas **no existen** en su Markdown: no se ocultan en la
 * pantalla ni se tapan con CSS, porque eso las habría mandado igual al navegador.
 */
function bloqueDeCoste(brief: KeywordResearchBrief): string[] {
  const l: string[] = [];

  // El desglose por proveedor es el argumento comercial del research (81% DataForSEO / 19% LLM), pero
  // solo si están los TRES números. Con `coste_breakdown: {}` —el default de la columna en Postgres
  // (`db/migrations/0001_init.sql:133`: `not null default '{}'::jsonb`), y lo que el seed de la demo
  // deja— cada fila salía `$NaN`.
  //
  // Este chequeo NO es defensivo: es OBLIGATORIO, y lo impone `tsc`. El tipo declara los tres campos
  // opcionales (`Partial<CostBreakdown>`, ver `tipos.ts`), así que sin el guard cada `usdFromMicros`
  // de abajo recibe `number | undefined` y el typecheck cae. Antes el tipo los declaraba obligatorios y
  // este guard era la única pieza que sabía que podían faltar: un tipo y un guard contradiciéndose
  // dentro del mismo paquete, con el guard teniendo razón. Lo arregló la review final de rama de KR-2a.
  //
  // Se desestructura, y eso también es a propósito: con los tres en `const` el estrechamiento por
  // condición aliaseada de TS aplica dentro del `if`, así que el guard y el uso no pueden separarse.
  // La CLAVE `coste_breakdown` sí se accede directo, sin `?.`: es obligatoria en el tipo, `emisionM2`
  // la exige y la columna es `not null`. Un `?.` acá volvería a afirmar que puede faltar algo que
  // ninguna de las tres capas permite faltar.
  //
  // Y la decisión no es solo de valor, es de forma: sin desglose NO se pinta la tabla. Una tabla de
  // tres `n/d` ocupa el lugar del argumento sin decirlo, y se lee como un fallo del sistema en vez de
  // como un dato que falta. El TOTAL sí se conoce, así que se muestra igual: es lo que el cliente
  // necesita, y es un dato, no una conjetura.
  const { dataforseo_micros, llm_generation_micros, llm_embeddings_micros } =
    brief.meta_run.coste_breakdown;
  const desgloseCompleto =
    typeof dataforseo_micros === "number" &&
    typeof llm_generation_micros === "number" &&
    typeof llm_embeddings_micros === "number";

  l.push(`\n### Coste del research\n`);
  if (desgloseCompleto) {
    l.push(`| Proveedor | Coste |`);
    l.push(`|---|---|`);
    l.push(`| DataForSEO | $${usdFromMicros(dataforseo_micros)} |`);
    l.push(`| LLM (generación) | $${usdFromMicros(llm_generation_micros)} |`);
    l.push(`| LLM (embeddings) | $${usdFromMicros(llm_embeddings_micros)} |`);
    l.push(`| **TOTAL** | **$${usdFromMicros(brief.meta_run.coste_micros_usd)}** |`);
  } else {
    l.push(`- Coste total: **$${usdFromMicros(brief.meta_run.coste_micros_usd)}**`);
    l.push(
      `\n> El **desglose** por proveedor no quedó registrado en esta corrida. El total sí, y es el ` +
        `de arriba: lo que falta es saber en qué se repartió.`,
    );
  }
  // El aviso de tarifas faltantes también habla de coste, así que también es del informe interno: al
  // restaurante no le importa —ni le corresponde— saber que nos falta configurar el precio de un modelo.
  if (brief.meta_run.modelos_sin_precio?.length) {
    l.push(
      `\n> ⚠️ Coste **incompleto**: sin tarifa configurada para ${brief.meta_run.modelos_sin_precio.join(", ")}.`,
    );
  }
  l.push("");
  return l;
}

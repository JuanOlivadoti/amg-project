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

/** Informe legible (Markdown) — el entregable humano de la compuerta (ADR-07). */
export function renderReport(brief: KeywordResearchBrief): string {
  const l: string[] = [];
  l.push(`# Keyword Research — ${texto(brief.cliente)}`);
  l.push(
    `\n_${texto(brief.market.country)} · ${texto(brief.market.language_code)} · ${brief.generated_at}_\n`,
  );
  l.push(`- Keywords analizadas: **${brief.meta_run.keywords_analizadas}**`);
  l.push(`- Páginas propuestas: **${brief.meta_run.paginas_propuestas}**`);

  // El desglose por proveedor es el argumento comercial del research (81% DataForSEO / 19% LLM), pero
  // solo si están los TRES números. Con `coste_breakdown: {}` —el default de la columna en Postgres, y
  // lo que el seed de la demo deja— cada fila salía `$NaN`.
  //
  // Y la decisión no es solo de valor, es de forma: sin desglose NO se pinta la tabla. Una tabla de
  // tres `n/d` ocupa el lugar del argumento sin decirlo, y se lee como un fallo del sistema en vez de
  // como un dato que falta. El TOTAL sí se conoce, así que se muestra igual: es lo que el cliente
  // necesita, y es un dato, no una conjetura.
  const c = brief.meta_run.coste_breakdown;
  const desgloseCompleto =
    typeof c?.dataforseo_micros === "number" &&
    typeof c?.llm_generation_micros === "number" &&
    typeof c?.llm_embeddings_micros === "number";

  l.push(`\n### Coste del research\n`);
  if (desgloseCompleto) {
    l.push(`| Proveedor | Coste |`);
    l.push(`|---|---|`);
    l.push(`| DataForSEO | $${usdFromMicros(c.dataforseo_micros)} |`);
    l.push(`| LLM (generación) | $${usdFromMicros(c.llm_generation_micros)} |`);
    l.push(`| LLM (embeddings) | $${usdFromMicros(c.llm_embeddings_micros)} |`);
    l.push(`| **TOTAL** | **$${usdFromMicros(brief.meta_run.coste_micros_usd)}** |`);
  } else {
    l.push(`- Coste total: **$${usdFromMicros(brief.meta_run.coste_micros_usd)}**`);
    l.push(
      `\n> El **desglose** por proveedor no quedó registrado en esta corrida. El total sí, y es el ` +
        `de arriba: lo que falta es saber en qué se repartió.`,
    );
  }
  if (brief.meta_run.modelos_sin_precio?.length) {
    l.push(
      `\n> ⚠️ Coste **incompleto**: sin tarifa configurada para ${brief.meta_run.modelos_sin_precio.join(", ")}.`,
    );
  }
  l.push("");

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

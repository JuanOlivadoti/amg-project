/**
 * Verificación de que `environment.prod.ts` está LISTO para desplegar.
 *
 * El agujero que cierra (10ª review, #6): el build de producción termina verde aunque queden los
 * placeholders (`api.tudominio.com`, `TU-PROYECTO`, `TU-ANON-KEY-PUBLICA`), y se puede publicar un
 * portal que apunta a ninguna parte. La inspección manual no impone nada; esto sí. Corre como
 * `prebuild` (ver package.json): si la config no está completa, el build ni arranca.
 */

export interface ConfigProd {
  apiBaseUrl: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

/** Fragmentos que solo aparecen en los VALORES-PLANTILLA del repo, nunca en una config real. */
const PLACEHOLDERS = ["tudominio.com", "TU-PROYECTO", "TU-ANON-KEY"];

/**
 * Devuelve la lista de problemas (vacía = lista para producción). Es una función pura para poder
 * testearla sin tocar el entorno real.
 */
export function problemasDeConfigProd(env: ConfigProd): string[] {
  const problemas: string[] = [];

  // SOLO las tres claves que Juan completa. El objeto real trae además `production`/`features` (que
  // son decisiones fijas de Fase 1, no config editable): recorrerlas con `Object.entries` las marcaría
  // como "vacías" y ensuciaría el reporte. Por eso la lista es explícita.
  const claves = ["apiBaseUrl", "supabaseUrl", "supabaseAnonKey"] as const;

  for (const clave of claves) {
    const valor = env[clave];
    if (typeof valor !== "string" || valor.trim() === "") {
      problemas.push(`${clave} está vacío.`);
      continue;
    }
    if (PLACEHOLDERS.some((p) => valor.includes(p))) {
      problemas.push(`${clave} sigue con un valor-plantilla: "${valor}".`);
    }
  }

  // Las URLs tienen que ser HTTPS (la anon key no es una URL, no se le exige). El portal se sirve por
  // TLS y llamar a un backend http:// desde una página https:// lo bloquea el navegador igual.
  for (const clave of ["apiBaseUrl", "supabaseUrl"] as const) {
    const valor = env[clave];
    if (typeof valor === "string" && valor.trim() !== "" && !valor.startsWith("https://")) {
      problemas.push(`${clave} no es HTTPS: "${valor}".`);
    }
  }

  return problemas;
}

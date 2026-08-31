import { leerConfig, type ModoPostBlog } from "../config.js";
import { MockPostProvider } from "./mock-provider.js";
import { OpenAIPostProvider } from "./openai-provider.js";

/**
 * Genera el post de blog por IA (sub-proyecto 3, publicar posts en blog externo). Mismo molde que
 * `BorradorProvider` (`../borrador/provider.ts`): una interfaz, dos implementaciones (mock/openai),
 * seleccionadas por config — nunca `openai` a medio implementar.
 */
export interface PostBlogGenerado {
  titulo: string;
  // Formato canónico: HTML crudo del LLM. Se sanitiza recién al persistir (db/src/store.ts,
  // guardarPost) — este provider no sanitiza, no es su responsabilidad.
  cuerpo: string;
}

export interface PostProvider {
  generar(args: {
    contentBrief: Record<string, unknown>;
    keywordPrincipal: string;
    perfilCliente: Record<string, unknown> | null;
    // Opcional y a propósito (revisión conjunta de los tres sub-proyectos, 2026-08-26): el
    // sub-proyecto 1 (multi-vertical) agrega `clients.vertical`, pero este sub-proyecto NO depende de
    // que ese esté implementado primero — el orden fijado solo obliga a "sub-proyecto 2 antes que
    // este", no a "sub-proyecto 1 antes que este". Si `vertical` está disponible (cliente.vertical,
    // una vez que el sub-proyecto 1 exista), el prompt lo usa; si no, genera con lenguaje neutro. Ver
    // OpenAIPostProvider más abajo.
    vertical?: "restauracion" | "correduria_seguros" | null;
  }): Promise<PostBlogGenerado>;
}

/**
 * El selector. Mismo criterio que `getBorradorProvider`: quien ya tiene la config la pasa explícita,
 * quien no deja que se resuelva sola desde `leerConfig()`.
 */
export function getPostProvider(modo: ModoPostBlog = leerConfig().postBlog): PostProvider {
  return modo === "openai" ? new OpenAIPostProvider() : new MockPostProvider();
}

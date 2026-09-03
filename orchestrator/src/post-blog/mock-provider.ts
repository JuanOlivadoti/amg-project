import type { PostBlogGenerado, PostProvider } from "./provider.js";

/**
 * El prefijo que hace que un post mock NUNCA se confunda con uno real de OpenAI cuando alguien lo
 * revisa en el portal — mismo criterio que `PREFIJO_MOCK_BORRADOR` (`../borrador/mock-provider.ts`).
 * Un post sin este prefijo, en cualquier fila de `blog_posts`, es evidencia de que salió de
 * `OpenAIPostProvider`.
 */
export const PREFIJO_MOCK_POST = "[POST MOCK — no generado por IA]";

/** Texto determinista de fixture — nunca sale a internet. Mismo criterio que `MockBorradorProvider`. */
export class MockPostProvider implements PostProvider {
  // Tipado completo (no solo `keywordPrincipal`, aunque sea lo único que usa) para que el excess
  // property check de TS no rechace llamadas que pasan el resto de `args` de `PostProvider` — el
  // método implementa la interfaz completa, no un subconjunto.
  async generar(args: {
    contentBrief: Record<string, unknown>;
    keywordPrincipal: string;
    perfilCliente: Record<string, unknown> | null;
    vertical?: "restauracion" | "correduria_seguros" | null;
  }): Promise<PostBlogGenerado> {
    return {
      titulo: `${PREFIJO_MOCK_POST} ${args.keywordPrincipal}`,
      cuerpo: `<p>${PREFIJO_MOCK_POST} Contenido de ejemplo para "${args.keywordPrincipal}".</p>`,
    };
  }
}

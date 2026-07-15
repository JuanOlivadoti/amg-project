import { jwtVerify } from "jose";
import type { MiddlewareHandler } from "hono";
import type { TenantContext } from "db";

/**
 * Verifica el token y devuelve QUIÉN es. Nada más.
 *
 * Se INYECTA a propósito: los tests pasan un verificador de mentira y ejercitan toda la API sin
 * Supabase ni criptografía; producción pasa el de abajo. Es la misma disciplina que ya separa el
 * emisor de eventos de Inngest.
 */
export type VerificadorToken = (token: string) => Promise<{ userId: string } | null>;

/**
 * Verificador de JWT de Supabase (HS256 con el secreto del proyecto).
 *
 * `jwtVerify` comprueba la **firma** y la **expiración**; si algo no cierra, lanza y devolvemos
 * `null` (→ 401). El `sub` del token es el user id. Acá termina lo que la API afirma: **quién es**.
 * **Qué puede hacer** no se decide en TypeScript — lo deriva Postgres de `memberships` (ADR-15).
 */
export function verificadorSupabase(jwtSecret: string): VerificadorToken {
  const secret = new TextEncoder().encode(jwtSecret);
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, secret);
      const sub = payload.sub;
      return typeof sub === "string" && sub.length > 0 ? { userId: sub } : null;
    } catch {
      return null;
    }
  };
}

/** UUID, para rechazar un tenant basura antes de tocar la base. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El tenant viaja en un header. **Es una coordenada, no una autoridad** (ver `autenticar`). */
export const TENANT_HEADER = "x-amg-tenant";

/** Lo que el middleware deja en el contexto de Hono para los handlers. */
export type Variables = { ctx: TenantContext };

/**
 * Middleware de autenticación. Deja un `TenantContext` en el contexto de Hono, o corta con 401/400.
 *
 * Dos entradas, y su diferencia ES el modelo de seguridad:
 *  · El **token** dice quién sos y está **firmado**: sin la clave del emisor no se falsifica.
 *  · El **tenant** (header `x-amg-tenant`) es una **coordenada sin firmar**, y está bien que lo sea:
 *    aunque alguien reclame un tenant ajeno, RLS no encuentra su membresía ahí, así que no deriva
 *    rol y no ve ni escribe nada (ADR-15). Por eso solo se valida que sea un UUID — **autorizar es
 *    trabajo de Postgres, no de este header.**
 */
export function autenticar(
  verificar: VerificadorToken,
): MiddlewareHandler<{ Variables: Variables }> {
  return async (c, next) => {
    const auth = c.req.header("authorization") ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    if (!token) return c.json({ error: "Falta el token Bearer." }, 401);

    const claims = await verificar(token);
    if (!claims) return c.json({ error: "Token inválido o expirado." }, 401);

    const tenantId = c.req.header(TENANT_HEADER) ?? "";
    if (!UUID.test(tenantId)) {
      return c.json({ error: `Falta o es inválido el header ${TENANT_HEADER}.` }, 400);
    }

    c.set("ctx", { tenantId, userId: claims.userId });
    await next();
  };
}

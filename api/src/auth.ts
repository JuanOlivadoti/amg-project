import { jwtVerify, createRemoteJWKSet, type JWTVerifyGetKey } from "jose";
import type { MiddlewareHandler } from "hono";
import type { TenantContext } from "db";

/**
 * El verificador no pudo COMPROBAR la firma: JWKS inalcanzable, DNS caído, timeout.
 *
 * No es lo mismo que un token inválido, y confundirlos tiene una consecuencia concreta: el portal
 * trata cualquier 401 como "token vencido", así que quema el refresh token y reintenta. Con esto,
 * una caída del JWKS devuelve 503 y el portal no destruye la sesión de nadie.
 *
 * **Sigue fallando cerrado**: 401 y 503 deniegan igual. Lo único que cambia es qué se informa.
 */
export const NO_DISPONIBLE = "no-disponible";

/**
 * Verifica el token y devuelve QUIÉN es. Nada más.
 *
 * Se INYECTA a propósito: los tests pasan un verificador de mentira y ejercitan toda la API sin
 * Supabase ni criptografía; producción pasa el de abajo. Es la misma disciplina que ya separa el
 * emisor de eventos de Inngest.
 */
export type VerificadorToken = (
  token: string,
) => Promise<{ userId: string } | null | typeof NO_DISPONIBLE>;

/** Qué se le exige al token además de la firma. Ver `verificadorSupabase`. */
export interface OpcionesJwt {
  /** `aud` esperado. Supabase emite `authenticated` para un usuario logueado. */
  audience?: string;
  /** `iss` esperado (`https://<proy>.supabase.co/auth/v1`). Si no se configura, no se exige. */
  issuer?: string;
}

/** El `aud` que Supabase pone en el token de un usuario logueado. */
export const AUD_SUPABASE = "authenticated";

/**
 * Códigos de `jose` que hablan del TOKEN: la credencial que trajo el usuario está mal.
 *
 * Todo lo que NO esté acá se trata como "no pude comprobar". Es a propósito que la lista sea de
 * códigos de token y no de códigos de red: un fallo de red no siempre trae un código de `jose` —
 * está medido que un resolvedor que rechaza llega **sin `code`**, y `createRemoteJWKSet` contra un
 * host muerto llega con `ECONNREFUSED`, que es de Node. Enumerar lo enumerable y tratar el resto
 * como infraestructura es lo único que no deja un caso sin clasificar.
 *
 * `ERR_JWKS_NO_MATCHING_KEY` cuenta como token: el `kid` no está en el conjunto de confianza. La
 * rotación no lo dispara en la práctica — Supabase publica la clave nueva antes de firmar con ella,
 * y la vieja sigue en el JWKS.
 *
 * `ERR_JWKS_MULTIPLE_MATCHING_KEYS` NO está acá, y es a propósito: ese código sale cuando el token no
 * trae `kid` y DOS claves de NUESTRO JWKS matchean el algoritmo — describe nuestro conjunto de
 * claves, no la credencial. Pasa durante una rotación que publica dos claves ES256 a la vez, que es
 * justo la ventana para la que existe el 503: tratarlo como culpa del token le manda un 401 a un
 * usuario con una credencial perfectamente buena.
 *
 * Trade-off asumido, no un descuido: durante esa ventana de rotación, CUALQUIERA puede forzar el 503
 * mandando un JWT ES256 sin `kid` — no hace falta credencial válida, alcanza con el algoritmo. No es
 * una escalada (no se otorga acceso, y ninguna otra request se ve afectada) pero sí significa que,
 * mientras dure la rotación, el 503 deja de ser "puramente nuestra infraestructura" y pasa a ser
 * gatillable por un cliente cualquiera — con el costo de ensuciar métricas y alertas de esa señal.
 * Se eligió así a propósito: la alternativa (401) le cuesta la sesión a un usuario legítimo que cayó
 * en esa ventana con una credencial perfectamente buena, y ese costo es peor. Ver ADR-23.
 */
const CODIGOS_DE_TOKEN = new Set([
  "ERR_JWS_INVALID",
  "ERR_JWT_INVALID",
  "ERR_JWS_SIGNATURE_VERIFICATION_FAILED",
  "ERR_JWT_EXPIRED",
  "ERR_JWT_CLAIM_VALIDATION_FAILED",
  "ERR_JOSE_ALG_NOT_ALLOWED",
  "ERR_JOSE_NOT_SUPPORTED",
  "ERR_JWKS_NO_MATCHING_KEY",
]);

/**
 * Verificador de JWT de Supabase (**ES256 contra el JWKS del proyecto**).
 *
 * No recibe un secreto: recibe un RESOLVEDOR de claves. Producción le pasa `jwksDeSupabase(...)`
 * —que baja la clave pública y la cachea— y los tests le pasan un JWKS local. Esa inversión es lo
 * que mantiene la suite sin red.
 *
 * Por qué no hay secreto compartido: Supabase firma con una clave asimétrica y **la privada nunca
 * sale de Supabase**. Antes había un `SUPABASE_JWT_SECRET` en las variables de Railway, en las notas
 * de despliegue y en cualquier transcript donde se hubiera pegado. Ahora no hay nada que filtrar.
 *
 * Comprueba la firma **y exige `exp` y `sub`**. Lo de `exp` no es un detalle: `jwtVerify` valida la
 * expiración *si el claim está*, pero **no lo exige** — así que un token bien firmado y **sin `exp`
 * no caducaba nunca**. Con `requiredClaims` deja de pasar. (Lo encontró la 8ª review: yo escribí
 * este verificador y **ningún test lo tocaba**.)
 *
 * Un token **sin `kid`** se acepta si el JWKS tiene una sola clave compatible. Está medido y es una
 * decisión, no un descuido: la clave sale igual del conjunto de confianza, y exigir `kid` nos ata a
 * un detalle del header que Supabase puede cambiar. Hay un test que lo fija.
 *
 * Acá termina lo que la API afirma: **quién es**. **Qué puede hacer** no se decide en TypeScript —
 * lo deriva Postgres de `memberships` (ADR-15).
 */
export function verificadorSupabase(
  claves: JWTVerifyGetKey,
  opts: OpcionesJwt = {},
): VerificadorToken {
  // `||`, no `??`: una audiencia en blanco NO debe significar "no compruebes la audiencia". Con `??`
  // un `""` —una variable de entorno vacía, un trim de más— apagaba la comprobación en silencio.
  const audience = opts.audience?.trim() || AUD_SUPABASE;
  return async (token) => {
    try {
      const { payload } = await jwtVerify(token, claves, {
        // Lista CERRADA de un solo algoritmo, y ahora importa más que antes: con firma asimétrica la
        // clave pública es conocida, así que aceptar un segundo algoritmo abre la puerta a que el
        // token se valide contra una clave que no es la que debería firmarlo. La fija el test de
        // ES384 (el de HS256 NO sirve para esto: ver su comentario).
        algorithms: ["ES256"],
        // Sin esto, un token sin `exp` es eterno. Y sin `sub` no hay a quién identificar.
        requiredClaims: ["exp", "sub"],
        ...(audience ? { audience } : {}),
        ...(opts.issuer ? { issuer: opts.issuer } : {}),
      });
      const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
      // `sub` en blanco (o solo espacios) no identifica a nadie: `app.user_id` quedaría vacío.
      return sub.length > 0 ? { userId: sub } : null;
    } catch (e) {
      const code = (e as { code?: unknown }).code;
      // Los dos caminos deniegan. La diferencia es si el problema es del token o nuestro.
      return typeof code === "string" && CODIGOS_DE_TOKEN.has(code) ? null : NO_DISPONIBLE;
    }
  };
}

/** Emisor Supabase ya validado y canonizado: el `iss` que se exige y de dónde sale su clave. */
export interface EmisorSupabase {
  /** `iss` exacto que tiene que traer el token. Sin barra final. */
  issuer: string;
  /** `<issuer>/.well-known/jwks.json`. */
  jwksUrl: URL;
}

/**
 * Valida y canoniza el emisor. **Lanza** si no cierra: una API a medio configurar no arranca.
 *
 * Por qué canoniza en UN solo lugar: si se le quitara la barra final solo para armar la URL del
 * JWKS, el `iss` que se exige quedaría con la barra, no coincidiría con el que emite Supabase y
 * **ningún token verificaría** — el mismo 401 total que este cambio viene a arreglar.
 *
 * Por qué no alcanza con exigir `https`: `https://atacante.example/auth/v1` es https y válido, y
 * bajaría el JWKS de un host ajeno. Eso no es solo una petición saliente indeseada: sustituye el
 * emisor de confianza entero, y a partir de ahí cualquier token que ese host firme entra. Por eso se
 * ancla al dominio de Supabase.
 *
 * Limitación conocida y aceptada: un dominio de auth propio (Supabase lo permite) no pasaría esta
 * validación. Si algún día se usa, hay que ampliar esto a propósito — que falle ruidosamente al
 * arrancar es exactamente lo que se busca.
 */
export function emisorSupabase(valor: string): EmisorSupabase {
  const crudo = valor.trim();
  let url: URL;
  try {
    url = new URL(crudo);
  } catch {
    throw new Error(`SUPABASE_JWT_ISS no es una URL válida: "${crudo}".`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`SUPABASE_JWT_ISS debe ser https (es "${url.protocol}").`);
  }
  if (url.username || url.password) {
    throw new Error("SUPABASE_JWT_ISS no puede llevar credenciales embebidas.");
  }
  // No es "sin puerto": es "sin puerto NO estándar". `URL.port` viene vacío tanto si no se escribió
  // ninguno como si se escribió el default del esquema (`:443` en https) — el propio parser lo
  // canoniza así. `https://abc.supabase.co:443/auth/v1` pasa esta guarda y termina en el mismo
  // origen portless que sin puerto: rechazarlo sería pedantería, no seguridad. Lo que sí para acá es
  // un puerto EXPLÍCITO y distinto del estándar (`:8443`), que si se aceptara cambiaría a qué host
  // real apunta el emisor.
  if (url.port) {
    throw new Error(`SUPABASE_JWT_ISS no puede llevar un puerto no estándar (tiene ":${url.port}").`);
  }
  if (url.search || url.hash) {
    throw new Error("SUPABASE_JWT_ISS no puede llevar query ni fragment.");
  }
  // Exactamente `<project-ref>.supabase.co`, y `<project-ref>` tiene que ser una etiqueta DNS válida:
  // 1-63 caracteres, sin guion inicial ni final. Sin este último requisito, `[a-z0-9-]+` deja pasar
  // `-abc.supabase.co` o `abc-.supabase.co` — un typo que no es un host DNS resoluble. Con eso la API
  // arrancaría igual (esto solo mira la forma) y el error recién aparecería como un 503 inexplicable
  // en el primer login, en vez de fallar acá, ruidosamente, que es todo el sentido de validar esto.
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)\.supabase\.co$/.test(url.hostname)) {
    throw new Error(
      `SUPABASE_JWT_ISS debe ser un host de proyecto Supabase (es "${url.hostname}"). ` +
        "Formato esperado: https://<project-ref>.supabase.co/auth/v1",
    );
  }
  const ruta = url.pathname.replace(/\/+$/, "");
  if (ruta !== "/auth/v1") {
    throw new Error(
      `SUPABASE_JWT_ISS debe terminar en /auth/v1 (su ruta es "${url.pathname}").`,
    );
  }
  const issuer = `${url.origin}${ruta}`;
  return { issuer, jwksUrl: new URL(`${issuer}/.well-known/jwks.json`) };
}

/**
 * El resolvedor de claves del proyecto.
 *
 * `createRemoteJWKSet` cachea la clave y refresca con cooldown (medido en jose 5.10.0: timeout 5 s,
 * cooldown 30 s, cache 10 min), así que soporta rotación sin redeploy y no pega en cada request.
 * Durante una rotación puede haber hasta ~30 s en que un `kid` recién publicado no se resuelve; es
 * aceptable porque Supabase publica la clave nueva antes de firmar con ella.
 */
export function jwksDeSupabase(emisor: EmisorSupabase): JWTVerifyGetKey {
  return createRemoteJWKSet(emisor.jwksUrl);
}

/**
 * El verificador de un emisor concreto: el `iss` que se exige y la URL del JWKS salen del **mismo**
 * valor, así que no hay dos que puedan discrepar.
 *
 * Existe porque `verificadorSupabase` recibe el resolvedor y el issuer por separado —lo que hace
 * testeable la criptografía sin red— y esa separación permite pasarle un par que no case. Acá se
 * cierra: quien arma el verificador de producción no puede equivocarse en eso.
 *
 * `claves` se inyecta solo en tests; producción usa el JWKS remoto del propio emisor.
 */
export function verificadorDeEmisor(
  emisor: EmisorSupabase,
  claves: JWTVerifyGetKey = jwksDeSupabase(emisor),
  opts: { audience?: string } = {},
): VerificadorToken {
  return verificadorSupabase(claves, { ...opts, issuer: emisor.issuer });
}

/** UUID, para rechazar un tenant basura antes de tocar la base. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** El tenant viaja en un header. **Es una coordenada, no una autoridad** (ver `autenticar`). */
export const TENANT_HEADER = "x-amg-tenant";

/** Lo que el middleware deja en el contexto de Hono para los handlers. */
export type Variables = { ctx: TenantContext };

/**
 * Middleware de autenticación. Deja un `TenantContext` en el contexto de Hono, o corta con 401
 * (credencial mala), 503 (no se pudo comprobar) o 400 (tenant inválido).
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
    if (claims === NO_DISPONIBLE) {
      // No es culpa de la credencial: no pudimos comprobarla. Con 401 el portal daría por muerta la
      // sesión y quemaría el refresh token por una caída de Supabase.
      return c.json({ error: "No se puede verificar el token en este momento." }, 503);
    }
    if (!claims) return c.json({ error: "Token inválido o expirado." }, 401);

    const tenantId = c.req.header(TENANT_HEADER) ?? "";
    if (!UUID.test(tenantId)) {
      return c.json({ error: `Falta o es inválido el header ${TENANT_HEADER}.` }, 400);
    }

    c.set("ctx", { tenantId, userId: claims.userId });
    await next();
  };
}

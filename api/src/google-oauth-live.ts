import type { GoogleOAuthProvider } from "./google-oauth.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Descubrir la ficha exige la Account Management API — ver {@link LiveGoogleOAuthProvider.intercambiarCode}. */
const CUENTAS_URL = "https://mybusinessaccountmanagement.googleapis.com/v1/accounts";

/** El único scope que hace falta: leer y responder reseñas de las fichas que la cuenta gestiona. */
export const SCOPE_BUSINESS = "https://www.googleapis.com/auth/business.manage";

/** Mismo criterio que el resto de los clientes HTTP del proyecto: si tarda, algo está roto. */
const TIMEOUT_MS = 10_000;

/**
 * La conexión OAuth real con Google (Bloque F). Mismo molde que `LiveGoogleReviewsProvider` en el
 * orquestador: `fetch` nativo, timeout explícito, cero reintentos.
 *
 * ⚠️ **Está partido en dos mitades con estados muy distintos**, y conviene saberlo antes de tocarlo:
 *
 * - `urlDeConsentimiento` y el intercambio del `code` por un refresh token funcionan hoy: usan el
 *   endpoint de OAuth de Google, que no depende de ninguna cuota de la Business Profile API.
 * - **Descubrir la ficha del negocio NO funciona hoy**: exige la Account Management API, que en el
 *   proyecto `amg-automation` está en **cuota 0** (medido el 2026-09-22). La v4 tenía `accounts.list`
 *   pero Google la deprecó justamente en favor de esa API, así que no hay camino alternativo.
 */
export class LiveGoogleOAuthProvider implements GoogleOAuthProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    /**
     * Fijo, de configuración, y NO derivado del origen de la request: Google exige que el
     * `redirect_uri` coincida **exacto** con uno registrado en la consola, y detrás de un proxy el
     * origen que ve el proceso puede no ser el público. Tiene que ser la ruta FIJA
     * (`.../google/callback`), no una por cliente — ver `api/src/app.ts`.
     */
    private readonly redirectUri: string,
  ) {}

  urlDeConsentimiento(state: string, _callbackBaseUrl: string): string {
    // `callbackBaseUrl` se ignora a propósito en live (lo dice el contrato): el redirect_uri real es
    // el registrado en Google Cloud, no el origen de esta request.
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: "code",
      scope: SCOPE_BUSINESS,
      /*
       * Las dos que deciden si esto sirve para un proceso desatendido:
       *
       * - `access_type=offline` es lo que hace que Google emita un refresh token. Sin él sólo llega
       *   un access token de una hora y el polling muere al rato.
       * - `prompt=consent` fuerza la pantalla de consentimiento AUNQUE la persona ya haya autorizado
       *   antes. Sin él, un segundo consentimiento devuelve el code pero NO un refresh token nuevo
       *   — y ahí se reconecta un cliente y queda sin credencial, en silencio.
       */
      access_type: "offline",
      prompt: "consent",
      state,
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  async intercambiarCode(code: string): Promise<{ refreshToken: string; locationId: string }> {
    if (!code.trim()) throw new Error("intercambiarCode: code vacío");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: this.redirectUri,
        grant_type: "authorization_code",
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const motivo =
        typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : "sin `error` en la respuesta";
      throw new Error(`intercambiarCode: HTTP ${res.status} (${motivo})`);
    }

    const refreshToken =
      typeof body === "object" && body !== null ? (body as { refresh_token?: unknown }).refresh_token : undefined;
    if (typeof refreshToken !== "string" || !refreshToken) {
      /*
       * El fallo más traicionero de este flujo, y por eso tiene mensaje propio: Google devuelve
       * `refresh_token` SOLO en el primer consentimiento, salvo que se pida `prompt=consent`. Sin
       * esta comprobación el cliente quedaría "conectado" con un access token de una hora, y el
       * polling dejaría de traer reseñas al rato sin que nada avisara.
       */
      throw new Error(
        "intercambiarCode: Google no devolvió refresh_token. Suele pasar en un segundo " +
          "consentimiento sin `prompt=consent`, o si el cliente ya tenía la app autorizada.",
      );
    }

    const accessToken =
      typeof body === "object" && body !== null ? (body as { access_token?: unknown }).access_token : undefined;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("intercambiarCode: la respuesta no trae access_token para descubrir la ficha");
    }

    return { refreshToken, locationId: await this.descubrirUbicacion(accessToken) };
  }

  /**
   * El nombre de recurso completo (`accounts/<id>/locations/<id>`) de la ficha del cliente, que es
   * como direcciona la v4 de reseñas.
   *
   * ⚠️ **Hoy esto no puede completarse**, y no por un error nuestro: la Account Management API está
   * en cuota 0 en `amg-automation`. El código queda escrito y probado porque es el camino documentado
   * y funcionará el día que Google conceda esa cuota; hasta entonces el 429 se traduce a un mensaje
   * que nombra el trámite, en vez de propagar un error de red que no le dice nada a nadie.
   */
  private async descubrirUbicacion(accessToken: string): Promise<string> {
    const res = await fetch(CUENTAS_URL, {
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (res.status === 429) {
      throw new Error(
        "No se puede descubrir la ficha: la Account Management API responde 429 (cuota 0). " +
          "Es un trámite aparte del acceso a reseñas, que sí está concedido. " +
          "Ver docs/proyecto/16-pendientes-juan.md § 2.",
      );
    }
    if (!res.ok) throw new Error(`descubrirUbicacion: HTTP ${res.status} al listar cuentas`);

    const body: unknown = await res.json();
    const cuentas =
      typeof body === "object" && body !== null ? (body as { accounts?: unknown }).accounts : undefined;
    if (!Array.isArray(cuentas) || cuentas.length === 0) {
      throw new Error("descubrirUbicacion: la cuenta de Google no gestiona ninguna ficha de negocio.");
    }
    if (cuentas.length > 1) {
      // Elegir una sería inventar: cuál corresponde a este cliente de AMG es exactamente la decisión
      // que sigue abierta. Falla nombrándola en vez de conectar la ficha equivocada en silencio.
      throw new Error(
        `descubrirUbicacion: la cuenta gestiona ${cuentas.length} cuentas de negocio y todavía no hay ` +
          "forma de elegir cuál. Decisión pendiente — ver docs/proyecto/16-pendientes-juan.md § 2.",
      );
    }

    const nombreCuenta = (cuentas[0] as { name?: unknown }).name;
    if (typeof nombreCuenta !== "string" || !nombreCuenta) {
      throw new Error("descubrirUbicacion: la cuenta vino sin `name`");
    }

    const resUbic = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${nombreCuenta}/locations?readMask=name`,
      { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (resUbic.status === 429) {
      throw new Error(
        "No se puede descubrir la ficha: la Business Information API responde 429 (cuota 0). " +
          "Mismo trámite pendiente que la Account Management API.",
      );
    }
    if (!resUbic.ok) throw new Error(`descubrirUbicacion: HTTP ${resUbic.status} al listar ubicaciones`);

    const cuerpo: unknown = await resUbic.json();
    const ubicaciones =
      typeof cuerpo === "object" && cuerpo !== null ? (cuerpo as { locations?: unknown }).locations : undefined;
    if (!Array.isArray(ubicaciones) || ubicaciones.length === 0) {
      throw new Error("descubrirUbicacion: esa cuenta de negocio no tiene ninguna ficha.");
    }
    if (ubicaciones.length > 1) {
      // El caso que el plan del Bloque F nunca resolvió. Mismo criterio que arriba: no se adivina.
      throw new Error(
        `descubrirUbicacion: el negocio tiene ${ubicaciones.length} fichas y el modelo actual guarda ` +
          "una sola (`clients.google_location_id`). Hace falta una pantalla de selección — decisión " +
          "pendiente, ver docs/proyecto/16-pendientes-juan.md § 2.",
      );
    }

    const nombreUbicacion = (ubicaciones[0] as { name?: unknown }).name;
    if (typeof nombreUbicacion !== "string" || !nombreUbicacion) {
      throw new Error("descubrirUbicacion: la ficha vino sin `name`");
    }
    // La v4 espera `accounts/<id>/locations/<id>`; la Business Information API devuelve `locations/<id>`.
    return `${nombreCuenta}/${nombreUbicacion}`;
  }
}

import { esNombreDeUbicacionGoogle } from "db";
import type { GoogleReviewsProvider, ReseñaCruda } from "./provider.js";

/**
 * ⚠️ La v4 legacy, y no es un descuido. Google partió la Business Profile API en una familia nueva
 * (Account Management, Business Information, Q&A, Performance…) pero **nunca migró las reseñas**:
 * `reviews.list` y `reviews.updateReply` siguen viviendo sólo acá. Verificado el 2026-09-22 contra el
 * proyecto `amg-automation`, que tiene esta API habilitada con cuota concedida (250.000 req/día,
 * 10.000 updates/día) mientras las de la familia nueva están en cuota 0.
 */
const BASE = "https://mybusiness.googleapis.com/v4";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Mismo criterio que `LiveTelegramProvider`: "esta llamada es puntual, si tarda algo está roto". */
const TIMEOUT_MS = 10_000;

/**
 * Tope de páginas por ficha. Esto corre dentro de un step de Inngest: un servidor que devolviera
 * `nextPageToken` para siempre colgaría el ciclo de polling entero, no sólo esta llamada. 20 páginas
 * de 50 reseñas son 1000 reseñas por corrida, de sobra para un ciclo de 30 minutos.
 */
const MAX_PAGINAS = 20;
const POR_PAGINA = 50;

/**
 * El `starRating` de la v4 es un ENUM, no un número. Es la trampa más fácil de este provider: tratarlo
 * como número da `NaN`, y el filtro de 4-5★ que decide qué reseñas reciben borrador de IA no
 * dispararía **nunca**, en silencio.
 */
const ESTRELLAS: Readonly<Record<string, number>> = {
  ONE: 1,
  TWO: 2,
  THREE: 3,
  FOUR: 4,
  FIVE: 5,
};

/*
 * El formato del nombre de recurso (`accounts/<id>/locations/<id>`) se importa de `db` y NO se
 * redeclara acá: la dueña es la columna `clients.google_location_id`, y desde que `api/` también lo
 * valida —un humano puede pegarlo a mano al conectar, porque las APIs de descubrimiento de Google
 * están en cuota 0— hay dos lados manipulando el mismo formato. Dos copias de la misma regex en dos
 * paquetes divergen sin que nada avise. Acá se valida antes de armar ninguna URL: con un id suelto
 * la petición saldría igual y volvería un 404 genérico, más difícil de diagnosticar que este error.
 */

/** El `error` de un fallo de OAuth (`invalid_grant`, `invalid_client`…), si viene con la forma documentada. */
function motivoOAuth(body: unknown): string {
  if (typeof body === "object" && body !== null && typeof (body as { error?: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return "sin `error` en la respuesta";
}

/**
 * Llamadas reales a la Business Profile API. Sin dependencias nuevas: `fetch` nativo, timeouts
 * explícitos y **cero reintentos** — la doctrina del proyecto rechaza reintentar automáticamente una
 * llamada facturable (mismo criterio que `kr-service/src/dataforseo/client.ts` y el cliente de
 * OpenAI). Quien decide reintentar es la función de Inngest que llama, con `retries: 0`.
 */
export class LiveGoogleReviewsProvider implements GoogleReviewsProvider {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async refrescarToken(refreshToken: string): Promise<string> {
    if (!refreshToken.trim()) throw new Error("refrescarToken: refresh token vacío");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      /*
       * El motivo de Google viaja en el mensaje a propósito. `invalid_grant` es exactamente lo que
       * devuelve cuando el cliente REVOCÓ el acceso desde su cuenta, y limpiar la conexión en ese
       * caso es la pieza que el Bloque F dejó pendiente por no conocer la forma real del error.
       * Quien la implemente necesita este dato legible; perderlo acá lo obligaría a adivinar otra vez.
       */
      throw new Error(`refrescarToken: HTTP ${res.status} (${motivoOAuth(body)})`);
    }

    const accessToken =
      typeof body === "object" && body !== null ? (body as { access_token?: unknown }).access_token : undefined;
    if (typeof accessToken !== "string" || !accessToken) {
      // Un 200 sin `access_token` no es un éxito: devolver `undefined` acá haría que el fallo
      // apareciera recién en la llamada siguiente, con un 401 que no explica nada.
      throw new Error("refrescarToken: la respuesta no trae access_token");
    }
    return accessToken;
  }

  async listarResenas(accessToken: string, locationId: string): Promise<ReseñaCruda[]> {
    if (!esNombreDeUbicacionGoogle(locationId)) {
      throw new Error(
        `listarResenas: se esperaba un nombre de recurso "accounts/<id>/locations/<id>" y llegó "${locationId}". ` +
          "En modo live, clients.google_location_id guarda el nombre completo.",
      );
    }

    const resenas: ReseñaCruda[] = [];
    let pageToken: string | undefined;

    for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
      const params = new URLSearchParams({ pageSize: String(POR_PAGINA) });
      if (pageToken) params.set("pageToken", pageToken);

      const res = await fetch(`${BASE}/${locationId}/reviews?${params.toString()}`, {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`listarResenas: HTTP ${res.status}`);

      const body: unknown = await res.json();
      if (typeof body !== "object" || body === null) {
        throw new Error("listarResenas: respuesta con forma inesperada");
      }
      // Una ficha sin reseñas NO trae la clave `reviews`. Es una respuesta válida, no un error.
      const crudas = (body as { reviews?: unknown }).reviews;
      if (crudas !== undefined) {
        if (!Array.isArray(crudas)) throw new Error("listarResenas: `reviews` no es una lista");
        for (const c of crudas) resenas.push(aResenaCruda(c));
      }

      const siguiente = (body as { nextPageToken?: unknown }).nextPageToken;
      if (typeof siguiente !== "string" || !siguiente) return resenas;
      pageToken = siguiente;
    }

    // Se llegó al tope: se devuelve lo juntado en vez de lanzar. Perder la cola de un histórico muy
    // largo es recuperable (el próximo ciclo vuelve a empezar por las más nuevas); colgar el ciclo no.
    return resenas;
  }

  async publicarRespuesta(
    accessToken: string,
    locationId: string,
    googleReviewId: string,
    texto: string,
  ): Promise<void> {
    if (!esNombreDeUbicacionGoogle(locationId)) {
      throw new Error(`publicarRespuesta: locationId no es un nombre de recurso v4: "${locationId}"`);
    }
    // Publicar una respuesta vacía en la ficha pública de un cliente es peor que no publicar nada,
    // y es un estado al que se puede llegar con un borrador que alguien vació sin querer.
    if (!texto.trim()) throw new Error("publicarRespuesta: el texto de la respuesta está vacío");

    const res = await fetch(
      `${BASE}/${locationId}/reviews/${encodeURIComponent(googleReviewId)}/reply`,
      {
        method: "PUT",
        headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
        body: JSON.stringify({ comment: texto }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    // "Publicado" significa lo que confirma el proveedor, no lo que intentamos (misma regla que el
    // publicador de Storyblok): sin este chequeo, `marcarRespuestaPublicada` mentiría en la base.
    if (!res.ok) throw new Error(`publicarRespuesta: HTTP ${res.status}`);
  }
}

/** Valida y traduce una reseña cruda de la v4 al contrato que consume el polling. */
function aResenaCruda(c: unknown): ReseñaCruda {
  if (typeof c !== "object" || c === null) throw new Error("listarResenas: una reseña no es un objeto");
  const r = c as Record<string, unknown>;

  const googleReviewId = r["reviewId"];
  if (typeof googleReviewId !== "string" || !googleReviewId) {
    // Es la clave de idempotencia (`unique (client_id, google_review_id)` en la 0021): sin ella no
    // hay forma de no duplicar la reseña en el próximo ciclo.
    throw new Error("listarResenas: una reseña vino sin reviewId");
  }

  const estrella = r["starRating"];
  const puntuacion = typeof estrella === "string" ? ESTRELLAS[estrella] : undefined;
  if (puntuacion === undefined) {
    /*
     * Incluye `STAR_RATING_UNSPECIFIED`, que la v4 documenta en el enum. Se falla en vez de
     * descartar la reseña: `puntuacion` tiene `check (puntuacion between 1 and 5)` en la 0021, así
     * que no hay número que inventar, y saltearla en silencio dejaría una reseña real que nadie
     * responde nunca y que nadie ve. Si esto aparece en producción, queremos enterarnos.
     */
    throw new Error(`listarResenas: starRating desconocido o sin estrellas: ${String(estrella)}`);
  }

  const publicadaEn = r["createTime"];
  if (typeof publicadaEn !== "string" || !publicadaEn) {
    // La fecha que decide el orden real de aparición es la de GOOGLE, no la del polling (0021).
    throw new Error("listarResenas: una reseña vino sin createTime");
  }

  const reviewer = r["reviewer"];
  const nombre =
    typeof reviewer === "object" && reviewer !== null
      ? (reviewer as { displayName?: unknown }).displayName
      : undefined;
  /*
   * `autor` es NOT NULL (0021) y una reseña anónima es un caso REAL y documentado de Google, no un
   * dato corrupto: por eso cae a una etiqueta en vez de lanzar. No es inventar un autor — es nombrar
   * con precisión al que Google no identifica.
   */
  const autor = typeof nombre === "string" && nombre.trim() ? nombre : "Anónimo";

  const comentario = r["comment"];
  // Una reseña de solo estrellas es real en Google Maps: `texto` es nullable justamente para eso.
  const texto = typeof comentario === "string" && comentario ? comentario : null;

  return { googleReviewId, puntuacion, autor, texto, publicadaEn };
}

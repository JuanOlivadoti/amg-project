import { config } from "../config.js";
import type { Story } from "../types.js";
import { MockPublisher } from "./mock-publisher.js";
import { StoryblokDryRunPublisher, StoryblokPublisher } from "./storyblok-publisher.js";

export interface PublishResult {
  slug: string;
  /** Ubicación del artefacto: ruta local (mock) o id de story en Storyblok (live). */
  location: string;
  mode: "mock" | "storyblok";
  /**
   * ¿Quedó **realmente publicada**? No "¿la mandamos?", sino "¿el proveedor confirma que lo está?".
   *
   * Existe porque la respuesta era que no: el publisher mandaba las stories **como draft** y la base
   * escribía `published_at` igual. La distinción entre "lo pedí" y "pasó" es la que evita que la
   * base mienta sobre el mundo exterior.
   */
  published: boolean;
}

/** Publica las stories generadas. Implementaciones: mock (out/) | storyblok (Management API). */
export interface Publisher {
  publish(stories: Story[], html: Map<string, string>): Promise<PublishResult[]>;
}

/**
 * En qué modo publica el proceso. Lo reporta `/_health` del orquestador, y por eso es un tipo
 * exportado y no tres literales sueltos: el portal de Railway no alcanza para saberlo (salen de
 * **tres** entradas, no de una variable), y una declaración que solo vive en el panel no se puede
 * auditar mirando el servicio.
 */
export type ModoPublicacion = "mock" | "dry-run" | "live";

/**
 * La decisión que NO depende del cliente: qué haría este proceso con un cliente cualquiera.
 *
 * Existe separada de `decisionDePublicacion` por una sola razón: **`/_health` no tiene cliente**. Lo
 * que puede afirmar del proceso es esto, y nada más.
 *
 * Devuelve el token en el caso `live` en vez de dejar que quien construye el publisher lo relea de
 * `config`: la relectura obligaría a un `!` (TypeScript no sabe que ya se comprobó) y, sobre todo,
 * volvería a abrir la puerta a que lo decidido y lo usado sean dos lecturas distintas — que es
 * exactamente el fallo que la clave de firma de Inngest ya causó una vez.
 */
function decisionDelServicio():
  | { modo: "mock" }
  | { modo: "dry-run"; sinToken: boolean }
  | { modo: "live"; token: string } {
  if (config.publishMode !== "storyblok") return { modo: "mock" };
  const token = config.storyblok.managementToken;
  // Dry-run si se pide explícito o si falta el token. Lo del space se decide más abajo: es del cliente.
  if (config.storyblok.dryRun || !token) return { modo: "dry-run", sinToken: !token };
  return { modo: "live", token };
}

/**
 * En qué modo publica **este proceso**, sin mirar a ningún cliente. Es lo que responde `/_health`.
 *
 * ⚠️ Es el **techo**, no una promesa por corrida: un cliente sin `storyblok_space_id` degrada a
 * dry-run en su propia publicación (y el publisher lo reporta con `published: false`), pero eso es
 * un hecho de esa corrida, no del proceso. Lo que este valor responde es *"¿este servicio está
 * armado para escribir en Storyblok de verdad?"*, que es la pregunta que hay que contestar **antes**
 * de lanzar nada. Un test lo fija: con `live`, pedir el publisher de un cliente sin space devuelve
 * dry-run y este valor no se mueve.
 */
export function modoPublicacion(): ModoPublicacion {
  return decisionDelServicio().modo;
}

/**
 * La decisión completa, ya con el cliente. **El space viaja como argumento, no por variable de
 * entorno.**
 *
 * Sin `spaceId` no hay publisher live: es preferible **detenerse** a escribir en el space de otro
 * cliente. Quien lo resuelve es el orquestador, leyendo `clients.storyblok_space_id` **bajo RLS**
 * (ADR-04: un space por cliente). El CLI, que es monocliente por definición, lo toma de la config.
 */
function decisionDePublicacion(
  spaceId?: string | null,
):
  | { modo: "mock" }
  | { modo: "dry-run"; sinToken: boolean; sinSpace: boolean }
  | { modo: "live"; space: string; token: string } {
  const servicio = decisionDelServicio();
  if (servicio.modo === "mock") return servicio;

  /*
   * `null` y `undefined` NO son lo mismo, y confundirlos era un cruce multi-tenant (6ª review):
   *
   *  · `undefined` → nadie preguntó por un cliente. Es el CLI, monocliente: usa el space global.
   *  · `null`      → el orquestador SÍ preguntó y el cliente **no tiene** space. Caer al global
   *                  significa publicar en el space de OTRO cliente. Jamás: se va a dry-run.
   *
   * El `spaceId ?? config…` de antes trataba `null` como "no me pasaron nada" y caía al global.
   */
  const space = spaceId === undefined ? config.storyblok.spaceId : spaceId;

  // Ya estábamos en dry-run: se sigue estando, pero el motivo del space se calcula igual. Que falte
  // el space se avisa AUNQUE el dry-run sea explícito — es lo que va a impedir publicar el día que
  // se apague el flag, y enterarse ese día es tarde.
  if (servicio.modo === "dry-run") {
    return { modo: "dry-run", sinToken: servicio.sinToken, sinSpace: !space };
  }

  // NO SABEMOS DÓNDE publicar.
  if (!space) return { modo: "dry-run", sinToken: false, sinSpace: true };

  return { modo: "live", space, token: servicio.token };
}

/**
 * Construye el publisher para un cliente. **La decisión no se toma acá**: sale de
 * `decisionDePublicacion`, la misma que reporta `modoPublicacion()`. Acá solo se cumple.
 */
export function getPublisher(spaceId?: string | null): Publisher {
  const decision = decisionDePublicacion(spaceId);

  switch (decision.modo) {
    case "mock":
      return new MockPublisher();

    case "dry-run":
      if (decision.sinToken) {
        console.warn(
          "  [publish] sin token de Storyblok → DRY-RUN (escribo el payload en out/storyblok/, no publico).",
        );
      } else if (decision.sinSpace) {
        console.warn(
          "  [publish] el cliente no tiene storyblok_space_id → DRY-RUN. NO se publica a ciegas: " +
            "escribir en el space equivocado sobrescribe las páginas de otro cliente.",
        );
      }
      return new StoryblokDryRunPublisher();

    case "live":
      return new StoryblokPublisher({
        spaceId: decision.space,
        managementToken: decision.token,
        mapiHost: config.storyblok.mapiHost,
      });
  }
}

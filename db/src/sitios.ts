import type { DbPool } from "./pool.js";

/**
 * Dominio → sitio de cliente. Lo que el renderizador (ADR-19) necesita saber, y nada más.
 *
 * ## Por qué esto NO es un método más de `PgStore`
 *
 * `PgStore` empieza cada transacción seteando `app.tenant_id` y `app.user_id` y asumiendo
 * `app_user` o `app_service`. Los tres presuponen una identidad. **Acá no hay ninguna**: del otro
 * lado hay un navegante anónimo que abrió la web de un restaurante.
 *
 * Meterlo en el Store obligaría a inventarle un contexto —un `tenantId` que el propio renderizador
 * derivaría del dominio, o un `servicio: true` que le daría acceso a todo el research— y las dos
 * salidas convierten una frontera de credenciales en una de código. La separación de archivo y de
 * rol es la misma decisión que 0003 tomó para la API y el orquestador, aplicada al tercer proceso.
 *
 * Ver `migrations/0007_render_publico.sql` para el razonamiento completo del rol `app_render`.
 */

/** Lo único que se sabe de un cliente sin estar autenticado. Todo esto ya es público. */
export interface Sitio {
  clientId: string;
  domain: string;
  /** `null` = el cliente tiene dominio pero todavía no tiene space: no hay nada que servir. */
  spaceId: string | null;
  /** Token de contenido PUBLICADO. No es un secreto (ver 0007). */
  publicToken: string | null;
  /** Token de BORRADORES. **Sí** es un secreto: solo se usa tras validar una firma de preview. */
  previewToken: string | null;
  /**
   * NAP del negocio → enriquece el JSON-LD. Ya va impreso en cada página publicada.
   *
   * Sale de `clients.business_profile_publico`, una columna GENERADA con allowlist de claves — NO
   * de la columna cruda. La ficha de un cliente puede tener campos privados y `app_render` no los
   * ve: la garantía la impone el esquema, no el código que la consume (10ª review, #8).
   */
  businessProfile: unknown;
  languageCode: string;
}

export interface SitioResolver {
  /**
   * `null` cuando el dominio no corresponde a ningún sitio publicado.
   *
   * No distingue entre "no existe", "está archivado" y "no tiene dominio": las tres son la misma
   * respuesta a propósito. Un 404 que dice *por qué* falló convierte al renderizador en un oráculo
   * para enumerar la cartera de la agencia.
   */
  porDominio(domain: string): Promise<Sitio | null>;
}

/** Resolver en memoria, para tests y para el modo mock del renderizador. */
export class MemSitios implements SitioResolver {
  private readonly porHost = new Map<string, Sitio>();

  constructor(sitios: readonly Sitio[] = []) {
    for (const s of sitios) this.porHost.set(s.domain.toLowerCase(), s);
  }

  agregar(sitio: Sitio): void {
    this.porHost.set(sitio.domain.toLowerCase(), sitio);
  }

  async porDominio(domain: string): Promise<Sitio | null> {
    return this.porHost.get(domain.toLowerCase()) ?? null;
  }
}

interface FilaSitio {
  id: string;
  domain: string;
  storyblok_space_id: string | null;
  storyblok_public_token: string | null;
  storyblok_preview_token: string | null;
  business_profile_publico: unknown;
  market_language: string;
}

/**
 * El resolver contra Postgres, bajo RLS, como `app_render`.
 *
 * Fijate en lo que NO hace esta clase, comparada con `PgStore`: no setea `app.tenant_id` ni
 * `app.user_id`. No es un olvido — es que no hay ninguno que sea verdad, y setear uno derivado del
 * propio dominio sería un control autoexpedido. Lo que protege acá es el rol: `app_render` tiene
 * `select` sobre CINCO columnas de UNA tabla, y la política solo le muestra clientes con dominio
 * publicado y sin archivar.
 *
 * Las columnas del `select` son literales por la misma razón: si alguien agrega una columna a
 * `clients`, esta query sigue devolviendo lo mismo. Un `select *` la haría crecer sola.
 */
export class PgSitios implements SitioResolver {
  constructor(private readonly pool: DbPool) {}

  async porDominio(domain: string): Promise<Sitio | null> {
    const host = domain.toLowerCase();

    return this.pool.transaction(async (tx) => {
      await tx.exec("set local role app_render");

      const { rows } = await tx.query<FilaSitio>(
        `select id, domain, storyblok_space_id, storyblok_public_token, storyblok_preview_token,
                business_profile_publico, market_language
           from clients
          where domain = $1`,
        [host],
      );

      const fila = rows[0];
      if (!fila) return null;

      return {
        clientId: fila.id,
        domain: fila.domain,
        spaceId: fila.storyblok_space_id,
        publicToken: fila.storyblok_public_token,
        previewToken: fila.storyblok_preview_token,
        businessProfile: fila.business_profile_publico ?? null,
        languageCode: fila.market_language,
      };
    });
  }
}

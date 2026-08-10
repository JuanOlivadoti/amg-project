import { PERFIL_BORCELLE } from "../perfil-demo.js";

/**
 * Imprime el SQL que da de alta el **cliente de demo** («Borcelle Burger») en una base ya desplegada.
 *
 * ## Por qué un generador y no un `.sql` escrito a mano
 *
 * El perfil vive en `perfil-demo.ts` y lo usa también el `dev-server`. Un archivo `.sql` con el JSON
 * copiado sería una segunda copia del mismo perfil, y el día que alguien ajuste una foto o un precio
 * en uno de los dos, los dos van a seguir funcionando **diciendo cosas distintas**. Generarlo es lo
 * que hace que la demo que se enseña y la que se desarrolla sean la misma.
 *
 * ## Lo que este script NO hace, a propósito
 *
 * **No toca la base.** Escribe SQL por stdout y nada más. La base de producción se toca a mano o con
 * `migrate:deploy`, nunca desde un script de conveniencia que alguien pueda correr «para ver qué
 * pasa» — es la misma regla que separa `reseed:demo --dry-run` de la siembra de verdad.
 *
 * **No inventa credenciales.** El `storyblok_space_id` y los dos tokens de la CDA van como
 * marcadores: se completan al pegar. Nunca salen de un archivo del repo ni de una variable, porque el
 * resultado de este comando se pega en un editor y se pasea por una terminal.
 *
 * ## Uso
 *
 * ```bash
 * npm run sql:demo -w renderer                       # subdominio por defecto
 * npm run sql:demo -w renderer -- micliente.bigballs.es
 * ```
 */

const DOMINIO = process.argv[2] ?? "borcelle.bigballs.es";

/**
 * Un literal SQL con las comillas simples escapadas.
 *
 * El JSON lo produce `JSON.stringify` sobre un objeto tipado —no hay entrada de usuario en el
 * camino— pero el escape va igual: «este valor viene de nuestro código» es la frase con la que
 * empiezan las inyecciones el día que alguien cambia de dónde viene el valor.
 */
function literal(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const perfil = JSON.stringify(PERFIL_BORCELLE, null, 2);

process.stdout.write(`-- ============================================================================
-- Cliente de DEMO: «Borcelle Burger» → https://${DOMINIO}
--
-- Generado por \`npm run sql:demo -w renderer\`. NO lo edites a mano: el perfil vive en
-- renderer/src/perfil-demo.ts y lo comparte el dev-server.
--
-- ⚠️ ANTES de pegarlo, completá los tres marcadores:
--    <TENANT_ID>       select id, nombre, slug from tenants;
--    <SPACE_ID>        Storyblok → el space de ESTE cliente → Settings › General
--    <TOKEN_PUBLIC>    Storyblok → Settings › Access Tokens → tipo "Public"
--    <TOKEN_PREVIEW>   el mismo panel, tipo "Preview"
--
-- ⚠️ El space tiene que ser PROPIO de este cliente, no el de otro: el nav y el índice de páginas
--    salen de ahí, así que compartirlo le mostraría a un cliente las páginas del vecino. Es ADR-04
--    ("un space por cliente"), y sin \`storyblok_space_id\` el renderizador devuelve 404.
--
-- ⚠️ El token de MANAGEMENT no va acá nunca. Estos dos son de la Content Delivery API, de LECTURA:
--    el proceso anónimo no puede tener a mano una credencial que modifique el space.
-- ============================================================================

insert into clients (tenant_id, nombre, domain, storyblok_space_id,
                     storyblok_public_token, storyblok_preview_token, business_profile)
values ('<TENANT_ID>',
        'Borcelle Burger',
        ${literal(DOMINIO)},
        '<SPACE_ID>',
        '<TOKEN_PUBLIC>',
        '<TOKEN_PREVIEW>',
        ${literal(perfil)}::jsonb)
on conflict (domain) do update
   set nombre                  = excluded.nombre,
       storyblok_space_id      = excluded.storyblok_space_id,
       storyblok_public_token  = excluded.storyblok_public_token,
       storyblok_preview_token = excluded.storyblok_preview_token,
       business_profile        = excluded.business_profile;

-- Comprobación (no imprime los tokens):
select nombre, domain, storyblok_space_id,
       business_profile_publico ? 'testimonios' as trae_resenas,
       jsonb_array_length(business_profile_publico -> 'fotos') as fotos
  from clients where domain = ${literal(DOMINIO)};
`);
